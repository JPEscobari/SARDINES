const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const express = require('express');
const { LocalRepository } = require('../operational/localRepository');
const { createReviewRouter } = require('../routes/review');
const fixture = () => ({ sourceType: 'meeting_note', content: 'We promised Acme a quote. Jamie will check stock tomorrow.', analysis: {
  summary: 'A quote is promised.', promises: [{ customerName: 'Acme', title: 'Send quote', ownerName: null, dueAt: null, dueText: null, sourceQuote: 'We promised Acme a quote.' }],
  actions: [{ description: 'Check stock', ownerName: 'Jamie', dueAt: null, dueText: 'tomorrow', sourceQuote: 'Jamie will check stock tomorrow.' }], blockers: [],
} });
function repository(t) {
  const filename = path.join(mkdtempSync(path.join(tmpdir(), 'sardines-review-')), 'test.sqlite');
  const repo = new LocalRepository(filename);
  t.after(() => repo.close());
  return { repo, filename };
}
test('valid save, nullable fields, source provenance, action boundaries and restart persistence', async t => {
  const { repo, filename } = repository(t);
  const result = await repo.saveAnalysis(fixture());
  assert.equal(result.duplicate, false);
  assert.equal(result.promises[0].ownerName, null);
  assert.equal(result.promises[0].dueAt, null);
  assert.equal(result.promises[0].status, 'needs_review');
  assert.equal(result.actions[0].promiseId, null);
  assert.equal(result.actions[0].approvalStatus, 'pending');
  assert.equal(result.actions[0].executionStatus, 'disabled');
  const second = new LocalRepository(filename);
  try {
    assert.deepEqual(await second.getSource(result.source.id), result.source);
    assert.deepEqual(await second.getPromise(result.promises[0].id), result.promises[0]);
    assert.equal((await second.listAuditEvents()).length, 2);
    assert.ok((await second.listAuditEvents()).every(e => e.actorId === null));
  } finally { second.close(); }
});
test('identical submissions deduplicate across connections and preserve review edits', async t => {
  const { repo, filename } = repository(t);
  const first = await repo.saveAnalysis(fixture());
  await repo.updatePromise(first.promises[0].id, { version: 1, ownerName: 'Jamie', status: 'open' });
  const second = new LocalRepository(filename);
  try {
    const duplicate = await second.saveAnalysis(fixture());
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.promises[0].ownerName, 'Jamie');
    assert.equal((await second.listPromises()).length, 1);
    assert.equal((await second.listActions()).length, 1);
    assert.equal((await second.listAuditEvents()).length, 3);
  } finally { second.close(); }
});
test('malformed analysis, extra IDs, empty titles and evidence mismatch never persist', async t => {
  const { repo } = repository(t);
  for (const mutate of [b => delete b.analysis.actions, b => b.analysis.promises[0].id = 'invented', b => b.analysis.promises[0].sourceQuote = 'not in source', b => b.analysis.promises[0].title = '', b => b.content = '', b => b.sourceType = 'other']) {
    const body = fixture(); mutate(body);
    await assert.rejects(repo.saveAnalysis(body));
  }
  assert.deepEqual(await repo.listPromises(), []);
  assert.deepEqual(await repo.listAuditEvents(), []);
});
test('review validates statuses, optimistic versions, dates and immutable fields', async t => {
  const { repo } = repository(t);
  const body = fixture(); body.analysis.promises[0].dueAt = '2026-11-22';
  const p = (await repo.saveAnalysis(body)).promises[0];
  assert.equal(p.extractedDueAt, '2026-11-22'); assert.equal(p.dueAt, null);
  for (const patch of [{ status: 'completed' }, { status: 'approved' }, { sourceQuote: 'new' }, { actorId: 'admin' }, { dueAt: '2026-02-30T00:00:00.000Z' }, { dueAt: 'tomorrow' }, { ownerName: 42 }]) {
    await assert.rejects(repo.updatePromise(p.id, { version: 1, ...patch }));
  }
  const updated = await repo.updatePromise(p.id, { version: 1, status: 'open', dueAt: '2026-11-22T17:00:00.000Z' });
  assert.equal(updated.deadlineState, 'reviewed');
  await assert.rejects(repo.updatePromise(p.id, { version: 1, ownerName: 'stale' }), { code: 'VERSION_CONFLICT' });
  const changed = await repo.updatePromise(p.id, { version: 2, dueText: 'next week' });
  assert.equal(changed.dueAt, null);
  assert.equal(changed.deadlineState, 'unresolved');
});
test('storage failure rolls back all source, promise, action and audit records', async t => {
  const { repo } = repository(t);
  const original = repo.put;
  repo.put = function(record) { if (record.type === 'audit') throw new Error('synthetic failure'); return original.call(this, record); };
  await assert.rejects(repo.saveAnalysis(fixture()));
  repo.put = original;
  assert.deepEqual(await repo.listPromises(), []);
  assert.deepEqual(await repo.listActions(), []);
  assert.deepEqual(await repo.listAuditEvents(), []);
  assert.equal((await repo.saveAnalysis(fixture())).duplicate, false);
});
test('proposeAction validates evidence, deduplicates and cannot approve', async t => {
  const { repo } = repository(t);
  const result = await repo.saveAnalysis(fixture());
  await repo.proposeAction(result.source.id, fixture().analysis.actions[0]);
  assert.equal((await repo.listActions()).length, 1);
  await assert.rejects(repo.proposeAction(result.source.id, { ...fixture().analysis.actions[0], approvalStatus: 'approved' }));
});
async function http(t, getRepo) {
  const app = express(); app.use('/api/review', createReviewRouter(getRepo));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return async (route, method = 'GET', body) => fetch(`http://127.0.0.1:${server.address().port}/api/review${route}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
}
test('HTTP save, duplicate, list, detail, edit and absent execution endpoints', async t => {
  const { repo } = repository(t); const request = await http(t, () => repo);
  const response = await request('/sources', 'POST', fixture()); assert.equal(response.status, 201);
  const data = await response.json(); assert.equal(data.persisted, true);
  assert.equal((await request('/sources', 'POST', fixture())).status, 200);
  const list = await (await request('/promises')).json(); assert.equal(list.promises.length, 1); assert.equal(list.approvalEnabled, false);
  const id = encodeURIComponent(data.promises[0].id);
  assert.equal((await request(`/promises/${id}`)).status, 200);
  assert.equal((await request(`/sources/${encodeURIComponent(data.source.id)}`)).status, 200);
  assert.equal((await request(`/promises/${id}`, 'PATCH', { version: 1, ownerName: 'Jamie', status: 'open' })).status, 200);
  assert.equal((await request(`/promises/${id}`, 'PATCH', { version: 1, title: 'stale' })).status, 409);
  assert.equal((await request('/promises/missing')).status, 404);
  assert.equal((await request('/sources', 'POST', {})).status, 400);
  assert.equal((await request('/sources', 'POST', { ...fixture(), username: 'admin' })).status, 400);
  assert.equal((await request(`/promises/${id}/approve`, 'POST', {})).status, 404);
  assert.equal((await request('/actions/execute', 'POST', {})).status, 404);
  assert.equal((await (await request('/actions')).json()).actions.length, 1);
});
test('HTTP storage failures are sanitized and retryable', async t => {
  const request = await http(t, () => { throw new Error('SECRET path and meeting data'); });
  const response = await request('/promises'); assert.equal(response.status, 503);
  const data = await response.json(); assert.equal(data.code, 'STORAGE_UNAVAILABLE');
  assert.ok(!JSON.stringify(data).includes('SECRET'));
});

test('HTTP rejects malformed JSON and oversized requests without leaking parser details', async t => {
  const { repo } = repository(t);
  const app = express(); app.use('/api/review', createReviewRouter(() => repo));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  for (const body of ['{', JSON.stringify({ content: 'x'.repeat(530000) })]) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/review/sources`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'INVALID_REQUEST');
  }
  assert.deepEqual(await repo.listPromises(), []);
});
