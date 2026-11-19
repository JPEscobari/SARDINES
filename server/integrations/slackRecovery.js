const { createHash } = require('node:crypto');
const { ReviewError } = require('../operational/validation');
const { directory, change } = require('./slackFollowup');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = message => { throw new ReviewError(message, 409, 'RECOVERY_BLOCKED'); };
function authorize(a, env) {
  const f = a?.slackFollowup;
  if (env.NODE_ENV === 'production' || !f || f.recipient.teamId !== env.SARDINES_SLACK_TEAM_ID || !directory(env).some(r => ['teamId','userId','ownerId','label'].every(k => r[k] === f.recipient[k]))) fail('Recovery requires the current workspace and recipient allowlist');
  if (f.payloadHash !== digest([f.recipient, f.text, f.snapshot])) fail('Stored payload integrity check failed');
  return f;
}
// Transport reads Slack directly. Never accept a caller-supplied message as proof.
async function inspectRecovery(repo, id, channelId, messageTs, transport, env = process.env) {
  const a = await repo.getAction(id); const f = authorize(a, env);
  if (!['sending','uncertain','sent','replied'].includes(f.status)) fail('No claimed send to recover');
  if (f.channelId && (channelId !== f.channelId || messageTs !== f.messageTs)) fail('Cannot replace persisted Slack message identity');
  const evidence = await transport.readThread(f.recipient, channelId, messageTs);
  const root = evidence.messages.find(m => m.ts === messageTs);
  if (!root || root.edited || root.client_msg_id !== f.id || root.user !== evidence.botUserId || root.text !== f.text || (root.thread_ts && root.thread_ts !== root.ts)) fail('Slack root does not prove this exact bot send; keep the claim locked');
  const replies = evidence.messages.filter(m => m.ts !== messageTs && m.thread_ts === messageTs && m.user === f.recipient.userId && !m.subtype && !m.bot_id && !m.bot_profile && !m.edited && typeof m.text === 'string' && m.text.length > 0 && m.text.length <= 20000 && /^\d{10,}\.\d{6}$/.test(m.ts))
    .map(m => ({ ts: m.ts, userId: m.user, text: m.text })).sort((x,y) => x.ts.localeCompare(y.ts));
  if (new Set(replies.map(r => r.ts)).size !== replies.length) fail('Ambiguous duplicate Slack evidence');
  const additions = replies.filter(r => !f.replies.some(old => old.ts === r.ts));
  if (f.replies.length + additions.length > 100) fail('Reply capacity exceeded; no changes made');
  const plan = { actionId: id, version: a.version, followupId: f.id, payloadHash: f.payloadHash, previousStatus: f.status,
    channelId, messageTs, rootHash: digest([root.ts, root.user, root.client_msg_id, root.text]), replies: additions };
  return { ...plan, planHash: digest(plan), writes: 0 };
}
async function applyRecovery(repo, id, channelId, messageTs, confirmation, transport, env = process.env) {
  if (env.SARDINES_SLACK_RECOVERY_ENABLED !== 'true' || confirmation?.kind !== 'local_cli' || !confirmation.subject) throw new ReviewError('Local recovery confirmation disabled', 403);
  // Fresh Slack evidence, version and digest must still match the operator's inspected plan.
  const plan = await inspectRecovery(repo, id, channelId, messageTs, transport, env);
  if (plan.version !== confirmation.version || plan.planHash !== confirmation.planHash) fail('Recovery evidence changed; inspect and confirm again');
  return repo.mutateAction(id, a => {
    const f = authorize(a, env);
    if (a.version !== plan.version || f.id !== plan.followupId) fail('Action changed during recovery');
    if (['sent','replied'].includes(f.status) && !plan.replies.length) return { action: a, events: [] };
    const receivedAt = new Date().toISOString();
    const replies = [...f.replies, ...plan.replies.map(r => ({ ...r, eventId: `replay:${f.recipient.teamId}:${channelId}:${r.ts}`, receivedAt }))];
    const result = change(a, { ...f, channelId, messageTs, sentAt: f.sentAt || new Date(Number(messageTs) * 1000).toISOString(),
      status: replies.length ? 'replied' : 'sent', replies }, 'slack_reconciled', confirmation.subject);
    result.events[0].reason = `Operator recovery ${plan.planHash}; verified root ${plan.rootHash}; replayed ${plan.replies.length} replies`;
    return result;
  });
}
module.exports = { inspectRecovery, applyRecovery };
