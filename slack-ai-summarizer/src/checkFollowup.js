'use strict';
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });
const { WebClient } = require('@slack/web-api');
const { getRepository } = require('../../server/operational/repository');
const { checkPreview } = require('../../server/integrations/slackFollowup');
const { checkSlackReadiness } = require('./slack/readiness');
async function main() {
  const [id, ...extra] = process.argv.slice(2);
  if (!id || extra.length) throw new Error('Provide one action ID');
  const repo = getRepository();
  try {
    const a = await repo.getAction(id); if (!a?.slackFollowup) throw new Error('No preview');
    const p = await repo.getPromise(a.promiseId);
    const previewValid = checkPreview(a, p, process.env);
    const client = new WebClient(process.env.SLACK_BOT_TOKEN, { retryConfig: { retries: 0 }, rejectRateLimitedCalls: true, timeout: 15000 });
    const result = await checkSlackReadiness(client, a.slackFollowup.recipient);
    console.log(JSON.stringify({ actionId: id, backend: repo.backend, version: a.version, status: a.slackFollowup.status, previewValid,
      sendingEnabled: process.env.SARDINES_SLACK_SEND_ENABLED === 'true', recoveryEnabled: process.env.SARDINES_SLACK_RECOVERY_ENABLED === 'true', ...result }, null, 2));
    if (!previewValid || !result.apiReady) process.exitCode = 1;
  } finally { repo.close(); }
}
if (require.main === module) main().catch(() => { console.error('Read-only readiness check failed; credentials and upstream details suppressed.'); process.exitCode = 1; });
module.exports = { main };
