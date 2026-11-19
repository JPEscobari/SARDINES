'use strict';
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });
const { WebClient } = require('@slack/web-api');
const { getRepository } = require('../../server/operational/repository');
const { inspectRecovery, applyRecovery } = require('../../server/integrations/slackRecovery');
const { createRecoveryTransport } = require('./slack/recoveryTransport');
async function main() {
  const [id, channelId, messageTs, version, planHash, flag, ...extra] = process.argv.slice(2);
  if (!id || !channelId || !messageTs || extra.length || (flag && flag !== '--confirm-recovery') || (!flag && (version || planHash))) throw new Error('Usage: recoverFollowup action-id DM-channel root-ts [version plan-hash --confirm-recovery]');
  const repo = getRepository();
  const transport = createRecoveryTransport(new WebClient(process.env.SLACK_BOT_TOKEN, { retryConfig: { retries: 0 }, rejectRateLimitedCalls: true, timeout: 15000 }));
  try {
    if (!flag) { console.log(JSON.stringify(await inspectRecovery(repo, id, channelId, messageTs, transport), null, 2)); return; }
    if (!process.stdin.isTTY) throw new Error('Recovery confirmation requires an interactive local terminal');
    const a = await applyRecovery(repo, id, channelId, messageTs, { kind: 'local_cli', subject: `local:${require('node:os').userInfo().username}`, version: Number(version), planHash }, transport);
    console.log(JSON.stringify({ recovered: true, actionId: a.id, version: a.version, status: a.slackFollowup.status, replies: a.slackFollowup.replies.length, messagesSent: 0 }));
  } finally { repo.close(); }
}
if (require.main === module) main().catch(() => { console.error('Recovery blocked. Keep the send claim; inspect permissions, exact message identity and current plan. No resend.'); process.exitCode = 1; });
module.exports = { main };
