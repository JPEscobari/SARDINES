const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { CloudantClient } = require('../operational/cloudantClient');
const { createRepository } = require('../operational/repository');
const { createReadinessRouter } = require('../routes/readiness');
const { CloudantRepository } = require('../operational/cloudantRepository');
const { createReviewRouter } = require('../routes/review');
const { FakeCloudant, fixture } = require('./helpers/fakeCloudant');
const config = { url: 'https://test.cloudant.com', apiKey: 'synthetic-key', database: 'sardines-test' };
function mockHttp(respond) {
  const calls = [];
  return { calls, async request(options) {
    calls.push(options);
    if (options.url.includes('iam.cloud.ibm.com')) return { status: 200, data: { access_token: 'synthetic-token', expires_in: 3600 } };
    return respond(options);
  } };
}
test('Cloudant transport mock: IAM token reuse, encoded IDs, timeouts and no redirects', async () => {
  const http = mockHttp(() => ({ status: 200, data: { db_name: 'sardines-test' } }));
  const client = new CloudantClient({ ...config, http });
  await client.health(); await client.get('source:a/b'); await client.put({ _id: 'source:a/b' });
  assert.equal(http.calls.filter(c => c.url.includes('iam.cloud.ibm.com')).length, 1);
  assert.ok(http.calls.every(c => c.timeout === 15000 && c.maxRedirects === 0));
  assert.ok(http.calls.at(-1).url.endsWith('/source%3Aa%2Fb'));
  assert.equal(http.calls.at(-1).headers.Authorization, 'Bearer synthetic-token');
});
test('Cloudant transport mock: reads retry once, writes do not blindly retry, errors sanitized', async () => {
  let attempts = 0;
  const http = mockHttp(() => { attempts++; throw { response: { status: 503, data: 'SECRET' }, config: { credentials: 'SECRET' } }; });
  const client = new CloudantClient({ ...config, http });
  await assert.rejects(client.health(), error => error.status === 503 && !JSON.stringify(error).includes('SECRET'));
  assert.equal(attempts, 2);
  attempts = 0; await assert.rejects(client.put({ _id: 'source:x' })); assert.equal(attempts, 1);
});
test('Cloudant transport mock: missing docs, auth renewal and unconfirmed 202', async () => {
  let n = 0;
  const http = mockHttp(() => { if (!n++) throw { response: { status: 401 } }; return { status: 200, data: { db_name: 'test' } }; });
  const client = new CloudantClient({ ...config, http }); await client.health();
  assert.equal(http.calls.filter(c => c.url.includes('iam.cloud.ibm.com')).length, 2);
  client.http = mockHttp(() => { throw { response: { status: 404 } }; }); assert.equal(await client.get('missing'), null);
  client.http = mockHttp(() => ({ status: 202, data: { ok: true } }));
  await assert.rejects(client.put({ _id: 'source:x' }), { status: 202 });
});
test('explicit backend selection rejects missing configuration and unknown stores', () => {
  assert.throws(() => createRepository({ OPERATIONAL_STORE: 'cloudant' }));
  assert.throws(() => createRepository({ OPERATIONAL_STORE: 'typo' }));
  for (const url of ['http://test.cloudant.com', 'https://user:secret@test.cloudant.com', 'https://test.cloudant.com/path']) assert.throws(() => new CloudantClient({ ...config, url }));
});
async function serve(t, app) {
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}
test('readiness HTTP reports read scope and sanitizes unavailable storage', async t => {
  let fail = false; const app = express();
  app.use('/ready', createReadinessRouter(() => { if (fail) throw new Error('SECRET URL'); return { health: async () => ({ ready: true, backend: 'cloudant', scope: 'database_read' }) }; }));
  const url = await serve(t, app);
  const ok = await fetch(url + '/ready'); assert.equal(ok.status, 200); assert.equal((await ok.json()).scope, 'database_read');
  fail = true; const bad = await fetch(url + '/ready'); assert.equal(bad.status, 503);
  assert.deepEqual(await bad.json(), { success: false, ready: false, code: 'STORAGE_UNAVAILABLE' });
});
test('Cloudant mock HTTP preserves review envelopes and stale-update 409', async t => {
  const repo = new CloudantRepository(new FakeCloudant()); const app = express(); app.use('/review', createReviewRouter(() => repo));
  const url = await serve(t, app);
  const post = (route, method, body) => fetch(url + '/review' + route, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const response = await post('/sources', 'POST', fixture()); assert.equal(response.status, 201);
  const saved = await response.json(); const id = encodeURIComponent(saved.promises[0].id);
  assert.equal((await post(`/promises/${id}`, 'PATCH', { version: 1, status: 'open' })).status, 200);
  const stale = await post(`/promises/${id}`, 'PATCH', { version: 1, status: 'blocked' }); assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, 'VERSION_CONFLICT');
  const list = await (await fetch(url + '/review/promises')).json(); assert.equal(list.backend, 'cloudant'); assert.equal(list.approvalEnabled, false);
});
