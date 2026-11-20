'use strict';
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });
const { WebClient } = require('@slack/web-api');
const { getRepository } = require('../../server/operational/repository');
const { send } = require('../../server/integrations/slackFollowup');
const { createFollowupTransport } = require('./slack/followupTransport');
async function main() {
  const [id, version, payloadHash, flag, ...extra] = process.argv.slice(2);
  if (!id || extra.length || (flag && flag !== '--confirm-demo-send') || (!flag && (version || payloadHash))) throw new Error('Provide an action ID to inspect its saved preview');
  const repo = getRepository();
  try {
    const action = await repo.getAction(id);
    if (!action?.slackFollowup) throw new Error('Prepare a preview in Action Review first');
    const f = action.slackFollowup;
    console.log(JSON.stringify({ actionId: action.id, sourceId: action.sourceId, promiseId: action.promiseId, version: action.version, channelId: f.channelId, messageTs: f.messageTs, replies: f.replies, status: f.status, recipient: f.recipient, text: f.text, payloadHash: f.payloadHash }, null, 2));
    if (flag !== '--confirm-demo-send') return;
    if (!process.stdin.isTTY) throw new Error('Confirmation requires an interactive local terminal');
    const client = new WebClient(process.env.SLACK_BOT_TOKEN, { retryConfig: { retries: 0 }, rejectRateLimitedCalls: true, timeout: 15000 });
    const readiness = await require('./slack/readiness').checkSlackReadiness(client, f.recipient);
    if (!readiness.apiReady) { console.log(JSON.stringify(readiness)); throw new Error('Slack readiness blocked'); }
    const sent = await send(repo, id, { kind: 'local_cli', subject: `local:${require('node:os').userInfo().username}`, version: Number(version), payloadHash }, createFollowupTransport(client));
    console.log(JSON.stringify({ sent: true, actionId: sent.id, version: sent.version, status: sent.slackFollowup.status, channelId: sent.slackFollowup.channelId, messageTs: sent.slackFollowup.messageTs }));
  } finally { repo.close(); }
}
if (require.main === module) main().catch(() => { console.error('Follow-up command failed. Inspect persisted status before any retry; no automatic resend.'); process.exitCode = 1; });
module.exports = { main };
