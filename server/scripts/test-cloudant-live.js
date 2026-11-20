// Read-only by default. --write requires explicit opt-in and an existing development database.
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createRepository } = require('../operational/repository');
(async () => {
  if (process.env.CLOUDANT_LIVE_TEST !== 'true') { console.log('SKIPPED: set CLOUDANT_LIVE_TEST=true to opt in.'); return; }
  const keys = ['CLOUDANT_URL', 'CLOUDANT_API_KEY', 'CLOUDANT_DATABASE'];
  if (keys.some(k => !process.env[k])) { console.log('BLOCKED: required Cloudant configuration is missing.'); process.exitCode = 2; return; }
  const repo = createRepository({ ...process.env, OPERATIONAL_STORE: 'cloudant' });
  await repo.health();
  console.log('LIVE: Cloudant database read connectivity passed (write permission not yet verified).');
  if (!process.argv.includes('--write')) return;
  if (process.env.CLOUDANT_TEST_ALLOW_WRITE !== 'development') throw new Error('Write opt-in required');
  const content = `Synthetic Cloudant verification ${randomUUID()}: Acme promised a quote.`;
  const body = { sourceType: 'meeting_note', content, analysis: { summary: 'Synthetic integration test', promises: [{ customerName: 'Acme', title: 'Quote', ownerName: null, dueAt: null, dueText: null, sourceQuote: 'Acme promised a quote.' }], actions: [], blockers: [] } };
  const saved = await repo.saveAnalysis(body);
  assert.equal((await repo.saveAnalysis(body)).duplicate, true);
  const promise = saved.promises[0];
  await repo.updatePromise(promise.id, { version: 1, status: 'open' });
  await assert.rejects(repo.updatePromise(promise.id, { version: 1, status: 'blocked' }), { code: 'VERSION_CONFLICT' });
  const reopened = createRepository({ ...process.env, OPERATIONAL_STORE: 'cloudant' });
  assert.equal((await reopened.getPromise(promise.id)).status, 'open');
  assert.ok((await reopened.listAuditEvents()).some(e => e.entityId === promise.id));
  console.log('LIVE: save/read/review/deduplication/audit verification passed. Synthetic source retained: ' + saved.source.id);
})().catch(() => { console.error('LIVE verification failed; inspect service configuration and permissions. No credentials or source bodies logged.'); process.exitCode = 1; });
