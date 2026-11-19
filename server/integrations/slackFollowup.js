const { createHash, randomUUID } = require('node:crypto');
const { ReviewError } = require('../operational/validation');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fingerprint = (a, p) => hash([a.promiseId, a.review, a.description, a.sourceQuote, p]);
const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
function directory(env = process.env) {
  if (env.NODE_ENV === 'production') return [];
  try {
    const rows = JSON.parse(env.SARDINES_SLACK_RECIPIENTS || '[]');
    if (!Array.isArray(rows) || rows.length > 30 || rows.some(r => !r || Object.keys(r).sort().join(',') !== 'label,ownerId,teamId,userId' || ![r.label,r.ownerId].every(v => typeof v === 'string' && v.length > 0 && v.length < 200) || !/^T[A-Z0-9]+$/.test(r.teamId) || !/^[UW][A-Z0-9]+$/.test(r.userId)) || new Set(rows.map(r => r.ownerId)).size !== rows.length) return [];
    return rows;
  } catch { return []; }
}
function change(a, followup, event, actor = 'system') {
  const time = new Date().toISOString();
  return { action: { ...a, slackFollowup: followup, version: a.version + 1, updatedAt: time }, events: [{ id: `audit:${randomUUID()}`, type: 'audit', version: 1, createdAt: time, updatedAt: time, entityId: a.id, event,
    actorId: actor, actorType: 'system', changedFields: ['slackFollowup'], reason: `Follow-up ${followup.id}; payload ${followup.payloadHash}`, ...(['slack_previewed', 'slack_send_claimed'].includes(event) ? { followupSnapshot: structuredClone(followup) } : {}) }] };
}
function reviewed(a, promises) {
  const p = promises.find(p => p.id === a.promiseId);
  if (!p || p.status === 'completed' || !a.review || (a.state || 'pending_review') === 'rejected') throw new ReviewError('Link and review this action before preparing a follow-up');
  return p;
}
async function preview(repo, id, input, env = process.env) {
  if (!input || Object.keys(input).some(k => !['version','userId'].includes(k))) throw new ReviewError('Invalid preview fields');
  const original = await repo.getAction(id);
  if (!original) throw new ReviewError('Action not found', 404);
  const source = await repo.getSource(original.sourceId);
  if (!source) throw new ReviewError('Source not found', 404);
  const blockers = source.analysis.blockers.map(b => b.description).join('; ') || 'None recorded; please report any blockers.';
  const sourceReference = source.slack ? `${source.slack.teamId}/${source.slack.channelId}/${source.slack.threadTs}` : original.sourceId;
  return repo.mutateAction(id, (a, promises) => {
    if (input.version !== a.version) throw new ReviewError('Reload changed action', 409, 'VERSION_CONFLICT');
    if (a.slackFollowup && a.slackFollowup.status !== 'preview') throw new ReviewError('A send attempt already exists; do not resend', 409);
    const p = reviewed(a, promises);
    const recipient = directory(env).find(r => r.userId === input.userId && r.ownerId === a.review.ownerId);
    if (!recipient) throw new ReviewError('Recipient must match the configured owner directory');
    const text = escape(`Development follow-up\nAction: ${a.review.title}\nPromise: ${p.title}\nDeadline: ${a.review.dueAt || 'Unresolved'}\nBlocker: ${blockers}\nSource: ${sourceReference}\nEvidence: ${a.sourceQuote}\nPlease reply in this thread with progress or blockers. A reply does not complete the Promise.`);
    if (text.length > 12000) throw new ReviewError('Follow-up is too long');
    const snapshot = fingerprint(a, p);
    const payloadHash = hash([recipient, text, snapshot]);
    return change(a, { id: randomUUID(), status: 'preview', recipient, text, snapshot, payloadHash, replies: [] }, 'slack_previewed', 'local_review');
  });
}
function checkPreview(a, p, env = process.env) {
  const f = a?.slackFollowup;
  return !!(env.NODE_ENV !== 'production' && f?.status === 'preview' && p && p.id === a.promiseId && p.status !== 'completed' && a.review && a.state !== 'rejected' &&
    f.recipient.teamId === env.SARDINES_SLACK_TEAM_ID && f.payloadHash === hash([f.recipient, f.text, f.snapshot]) && fingerprint(a, p) === f.snapshot &&
    directory(env).some(r => ['teamId','userId','ownerId','label'].every(k => r[k] === f.recipient[k])));
}
// Only wired to the local CLI. No HTTP send route, test principal, or auto-send caller.
async function send(repo, id, confirmation, transport, env = process.env) {
  if (env.NODE_ENV === 'production' || env.SARDINES_SLACK_SEND_ENABLED !== 'true' || confirmation?.kind !== 'local_cli' || !confirmation.subject) throw new ReviewError('Demo send disabled', 403);
  const current = await repo.getAction(id);
  const f = current?.slackFollowup;
  if (!f || f.payloadHash !== hash([f.recipient, f.text, f.snapshot]) || f.status !== 'preview' || confirmation.payloadHash !== f.payloadHash || confirmation.version !== current.version) throw new ReviewError('Exact current preview confirmation required', 409);
  if (f.recipient.teamId !== env.SARDINES_SLACK_TEAM_ID || !directory(env).some(r => JSON.stringify(r) === JSON.stringify(f.recipient))) throw new ReviewError('Recipient is no longer allowlisted', 403);
  // Read-only Slack validation precedes the durable claim and any message write.
  await transport.verify(f.recipient);
  const claimed = await repo.mutateAction(id, (a, promises) => {
    const p = reviewed(a, promises);
    if (a.version !== confirmation.version || a.slackFollowup?.status !== 'preview' || fingerprint(a, p) !== f.snapshot) throw new ReviewError('Review changed; regenerate preview', 409);
    return change(a, { ...f, status: 'sending', confirmedBy: confirmation.subject, confirmedAt: new Date().toISOString() }, 'slack_send_claimed', confirmation.subject);
  });
  let sent;
  try {
    sent = await transport.send(f.recipient, f.text, f.id);
    if (!/^D[A-Z0-9]+$/.test(sent?.channel) || !/^\d{10,}\.\d{6}$/.test(sent?.ts)) throw new Error('Unconfirmed send');
  } catch {
    await repo.mutateAction(id, a => {
      if (a.slackFollowup?.id !== f.id || a.slackFollowup.status !== 'sending') return { action: a, events: [] };
      return change(a, { ...a.slackFollowup, status: 'uncertain' }, 'slack_send_uncertain');
    });
    throw new ReviewError('Send outcome unknown. Do not retry; reconcile with Slack manually', 503, 'SLACK_SEND_UNCERTAIN');
  }
  // If persistence fails, the durable sending state still prevents another send.
  return repo.mutateAction(id, a => {
    if (a.slackFollowup?.id !== claimed.slackFollowup.id) throw new ReviewError('Follow-up changed', 409);
    if (['sent', 'replied'].includes(a.slackFollowup.status)) {
      if (a.slackFollowup.channelId !== sent.channel || a.slackFollowup.messageTs !== sent.ts) throw new ReviewError('Conflicting recovered message identity', 409);
      return { action: a, events: [] };
    }
    return change(a, { ...a.slackFollowup, status: 'sent', channelId: sent.channel, messageTs: sent.ts, sentAt: new Date().toISOString(), ...(sent.permalink ? { permalink: sent.permalink } : {}) }, 'slack_sent');
  });
}
// Invoked only by Bolt Socket Mode, which supplies the authenticated event envelope.
async function receiveReply(repo, body) {
  const e = body?.event;
  if (!body?.event_id || !e || e.type !== 'message' || e.subtype || e.bot_id || e.bot_profile || !e.user || !e.thread_ts || !e.text || e.text.length > 20000 || e.ts === e.thread_ts || !/^\d{10,}\.\d{6}$/.test(e.ts)) return false;
  const matches = (await repo.listActions()).filter(a => {
    const f = a.slackFollowup;
    return f && ['sent','replied'].includes(f.status) && f.recipient.teamId === body.team_id && f.recipient.userId === e.user && f.channelId === e.channel && f.messageTs === e.thread_ts;
  });
  if (matches.length !== 1) return false;
  await repo.mutateAction(matches[0].id, a => {
    const f = a.slackFollowup;
    if (f.replies.some(r => r.eventId === body.event_id || r.ts === e.ts)) return { action: a, events: [] };
    if (f.replies.length >= 100) throw new ReviewError('Reply capacity reached', 413);
    return change(a, { ...f, status: 'replied', replies: [...f.replies, { eventId: body.event_id, ts: e.ts, userId: e.user, text: e.text, receivedAt: new Date().toISOString() }] }, 'slack_reply_received', e.user);
  });
  return true;
}
module.exports = { directory, preview, send, receiveReply, change, checkPreview };
