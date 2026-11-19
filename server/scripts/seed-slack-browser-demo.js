// Synthetic local fixture only. Never loads .env, Cloudant, IBM or Slack clients.
const path = require('node:path');
const { LocalRepository } = require('../operational/localRepository');
const { transcript } = require('../operational/slackSource');
const { fixture } = require('../tests/helpers/fakeCloudant');
const { preview, send, receiveReply } = require('../integrations/slackFollowup');
const recipient = { label: 'Synthetic Jamie', ownerId: 'owner-test', teamId: 'TTEST', userId: 'UTEST' };
async function main() {
  const repo = new LocalRepository(path.resolve(__dirname, '../data/phase4-synthetic-browser.sqlite'));
  try {
    for (const variant of ['preview', 'reply']) {
      const body = fixture();
      body.slack = { teamId: 'TTEST', channelId: variant === 'preview' ? 'CPREVIEW' : 'CREPLY', threadTs: '1700000000.000001', requestedBy: 'UTEST', messages: [{ ts: '1700000000.000001', userId: 'UTEST', text: body.content }] };
      body.sourceType = 'slack_thread'; body.content = transcript(body.slack);
      body.analysis.decisions = [{ description: 'Synthetic quote decision', sourceQuote: 'Acme promised a quote.' }];
      const saved = await repo.saveAnalysis(body);
      if (saved.duplicate) continue;
      const a = await repo.reviewAction(saved.actions[0].id, { version: 1, promiseId: saved.promises[0].id, ownerId: 'owner-test', title: `Synthetic ${variant} follow-up` });
      if (variant === 'preview') continue;
      const env = { SARDINES_SLACK_TEAM_ID: 'TTEST', SARDINES_SLACK_SEND_ENABLED: 'true', SARDINES_SLACK_RECIPIENTS: JSON.stringify([recipient]) };
      const p = await preview(repo, a.id, { version: a.version, userId: 'UTEST' }, env);
      await send(repo, a.id, { kind: 'local_cli', subject: 'synthetic-test', version: p.version, payloadHash: p.slackFollowup.payloadHash }, {
        verify: async () => {}, send: async () => ({ channel: 'DTEST', ts: '1700000000.000001' }),
      }, env);
      await receiveReply(repo, { team_id: 'TTEST', event_id: 'EvBROWSER', event: { type: 'message', channel: 'DTEST', thread_ts: '1700000000.000001', ts: '1700000001.000001', user: 'UTEST', text: 'Synthetic reply: checking stock, confirmation still pending.' } });
    }
    console.log('Synthetic SQLite browser fixtures ready; all transports mocked; no live writes.');
  } finally { repo.close(); }
}
if (require.main === module) main().catch(() => { console.error('Synthetic fixture failed'); process.exitCode = 1; });
