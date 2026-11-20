const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const express = require('express');
const { LocalRepository } = require('../operational/localRepository');
const { CloudantRepository } = require('../operational/cloudantRepository');
const { FakeCloudant, fixture } = require('./helpers/fakeCloudant');
const { hashPayload } = require('../operational/actionWorkflow');
const { createReviewRouter } = require('../routes/review');
const resolver = async ({ companyId, ownerId }) => ({ companyId, ownerId, verified: companyId === 'company-test' && ownerId === 'owner-test' });
for (const backend of ['sqlite', 'cloudant-mock']) {
  async function setup(t, options = {}) {
    const client = new FakeCloudant();
    const repo = backend === 'sqlite' ? new LocalRepository(path.join(mkdtempSync(path.join(tmpdir(), 'sardines-actions-')), 'test.sqlite'), { resolveIdentities: resolver, ...options }) : new CloudantRepository(client, { resolveIdentities: resolver, ...options });
    t.after(() => repo.close());
    const input = fixture(); input.analysis.promises.push({ ...input.analysis.promises[0], title: 'Second promise' });
    const saved = await repo.saveAnalysis(input);
    const principal = { authenticated: true, subject: 'test-reviewer', permissions: ['actions:approve'], sourceIds: [saved.source.id] };
    return { repo, saved, principal, client };
  }
  async function reviewed(repo, saved) {
    const a = saved.actions[0];
    return repo.reviewAction(a.id, { version: a.version, promiseId: saved.promises[1].id, title: 'Review stock', companyId: 'company-test', ownerId: 'owner-test', dueAt: '2026-11-22T17:00:00.000Z' });
  }
  test(`${backend}: explicit association, legacy compatibility and original evidence preserved`, async t => {
    const { repo, saved } = await setup(t);
    assert.equal(saved.actions[0].promiseId, null);
    const action = await reviewed(repo, saved);
    assert.equal(action.promiseId, saved.promises[1].id); assert.equal(action.state, 'pending_review');
    assert.equal(action.sourceQuote, saved.actions[0].sourceQuote); assert.equal(action.description, saved.actions[0].description);
    assert.deepEqual((await repo.getSource(saved.source.id)).analysis, saved.source.analysis);
    await assert.rejects(repo.reviewAction(action.id, { version: action.version, promiseId: 'unknown' }));
    await assert.rejects(repo.reviewAction(action.id, { version: action.version, sourceQuote: 'invented' }));
    await assert.rejects(repo.reviewAction(action.id, { version: action.version, dueAt: 'tomorrow' }));
    await assert.rejects(repo.reviewAction(action.id, { version: action.version, state: 'approved' }));
  });
  test(`${backend}: approval requires principal, source authorization and verified identities`, async t => {
    const { repo, saved, principal } = await setup(t); const a = await reviewed(repo, saved);
    await assert.rejects(repo.approveAction(a.id, { version: a.version }, null), { status: 401 });
    await assert.rejects(repo.approveAction(a.id, { version: a.version }, { ...principal, sourceIds: [] }), { status: 403 });
    await assert.rejects(repo.approveAction(a.id, { version: a.version }, { ...principal, permissions: [] }), { status: 403 });
    repo.resolveIdentities = undefined;
    await assert.rejects(repo.approveAction(a.id, { version: a.version }, principal), { code: 'IDENTITY_RESOLUTION_UNAVAILABLE' });
    repo.resolveIdentities = async () => ({ verified: false });
    await assert.rejects(repo.approveAction(a.id, { version: a.version }, principal), { code: 'UNRESOLVED_IDENTITY' });
    assert.equal((await repo.getAction(a.id)).approval, null);
  });
  test(`${backend}: approved immutable snapshot, audit and duplicate approval`, async t => {
    const { repo, saved, principal } = await setup(t); const a = await reviewed(repo, saved);
    const approved = await repo.approveAction(a.id, { version: a.version }, principal);
    assert.equal(approved.state, 'approved'); assert.equal(approved.executionStatus, 'disabled');
    assert.equal(approved.approval.payloadHash, hashPayload(approved.approval.payload));
    const events = await repo.listAuditEvents(); const event = events.find(e => e.event === 'action_approved');
    assert.equal(event.actorId, principal.subject); assert.equal(event.actorType, 'authenticated'); assert.deepEqual(event.approvalSnapshot, approved.approval);
    await repo.approveAction(a.id, { version: approved.version }, principal);
    assert.equal((await repo.listAuditEvents()).length, events.length);
    await assert.rejects(repo.approveAction(a.id, { version: a.version }, principal), { status: 409 });
    approved.approval.payload.title = 'tampered client copy';
    assert.equal((await repo.getAction(a.id)).approval.payload.title, 'Review stock');
    await assert.rejects(repo.executeAction(a.id), { code: 'EXECUTION_DISABLED' });
  });
  test(`${backend}: payload edit and Promise edit each invalidate approval atomically`, async t => {
    const { repo, saved, principal } = await setup(t); const a = await reviewed(repo, saved);
    const approved = await repo.approveAction(a.id, { version: a.version }, principal);
    const changed = await repo.reviewAction(a.id, { version: approved.version, title: 'New title' });
    assert.equal(changed.state, 'pending_review'); assert.equal(changed.approval, null);
    const again = await repo.approveAction(a.id, { version: changed.version }, principal);
    const p = saved.promises[1]; await repo.updatePromise(p.id, { version: p.version, ownerName: 'Reviewed owner' });
    const invalidated = await repo.getAction(a.id); assert.equal(invalidated.approval, null); assert.equal(invalidated.version, again.version + 1);
    assert.equal((await repo.listAuditEvents()).filter(e => e.event === 'approval_invalidated').length, 2);
  });
  test(`${backend}: rejection authorization and re-review state machine`, async t => {
    const { repo, saved, principal } = await setup(t); const a = saved.actions[0];
    await assert.rejects(repo.rejectAction(a.id, { version: 1, reason: 'Not relevant' }, null), { status: 401 });
    await assert.rejects(repo.rejectAction(a.id, { version: 1 }, principal));
    const rejected = await repo.rejectAction(a.id, { version: 1, reason: 'Not a business action' }, principal);
    assert.equal(rejected.state, 'rejected');
    const edited = await repo.reviewAction(a.id, { version: rejected.version, title: 'Reconsidered' });
    assert.equal(edited.state, 'pending_review');
    await assert.rejects(repo.executeAction(a.id), { code: 'EXECUTION_DISABLED' });
    assert.ok((await repo.listAuditEvents()).some(e => e.event === 'action_rejected' && e.reason === 'Not a business action'));
  });
  test(`${backend}: concurrent approval and edit cannot retain stale approval`, async t => {
    const { repo, saved, principal } = await setup(t); const a = await reviewed(repo, saved);
    const results = await Promise.allSettled([repo.approveAction(a.id, { version: a.version }, principal), repo.reviewAction(a.id, { version: a.version, title: 'Concurrent edit' })]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
    const final = await repo.getAction(a.id);
    if (final.state === 'approved') assert.equal(final.approval.payload.title, final.review.title);
    else assert.equal(final.approval, null);
  });
  test(`${backend}: approval persistence failures leave state and audit consistent`, async t => {
    const { repo, saved, principal, client } = await setup(t); const a = await reviewed(repo, saved);
    if (backend === 'sqlite') { const original = repo.put; repo.put = function(record) { if (record.event === 'action_approved') throw new Error('test disk failure'); return original.call(this, record); }; }
    else client.beforePut = () => { throw new Error('test network failure'); };
    await assert.rejects(repo.approveAction(a.id, { version: a.version }, principal));
    assert.equal((await repo.getAction(a.id)).state, 'pending_review');
    assert.equal((await repo.listAuditEvents()).filter(e => e.event === 'action_approved').length, 0);
  });
}
test('HTTP approval fails closed and ignores forged identity in headers/body', async t => {
  let accessed = false; const app = express(); app.use('/review', createReviewRouter(() => { accessed = true; throw new Error('must not access storage'); }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  for (const decision of ['approve', 'reject']) {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/review/actions/test/${decision}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User': 'admin', Authorization: 'Bearer fake' }, body: JSON.stringify({ version: 1, username: 'admin', principal: { authenticated: true } }) });
    assert.equal(res.status, 401); assert.equal((await res.json()).code, 'AUTHENTICATION_REQUIRED');
  }
  assert.equal(accessed, false);
});

test('Cloudant mocked approval lost-response reconciliation adds exactly one audit', async () => {
  const client = new FakeCloudant(); const repo = new CloudantRepository(client, { resolveIdentities: resolver });
  const saved = await repo.saveAnalysis(fixture());
  const principal = { authenticated: true, subject: 'test-reviewer', permissions: ['actions:approve'], sourceIds: [saved.source.id] };
  const a = await repo.reviewAction(saved.actions[0].id, { version: 1, promiseId: saved.promises[0].id, companyId: 'company-test', ownerId: 'owner-test', dueAt: '2026-11-22T17:00:00.000Z' });
  client.afterPut = () => { throw new Error('response lost'); };
  const result = await repo.approveAction(a.id, { version: a.version }, principal);
  assert.equal(result.state, 'approved'); assert.equal((await repo.listAuditEvents()).filter(e => e.event === 'action_approved').length, 1);
});
test('HTTP test-only principal can approve; client username still rejected; execution absent', async t => {
  const repo = new CloudantRepository(new FakeCloudant(), { resolveIdentities: resolver }); const saved = await repo.saveAnalysis(fixture());
  const principal = { authenticated: true, subject: 'test-only-user', permissions: ['actions:approve'], sourceIds: [saved.source.id] };
  const a = await repo.reviewAction(saved.actions[0].id, { version: 1, promiseId: saved.promises[0].id, companyId: 'company-test', ownerId: 'owner-test', dueAt: '2026-11-22T17:00:00.000Z' });
  const app = express(); app.use('/review', createReviewRouter(() => repo, { getPrincipal: () => principal }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); }); t.after(() => new Promise(resolve => server.close(resolve)));
  const send = (operation, body) => fetch(`http://127.0.0.1:${server.address().port}/review/actions/${encodeURIComponent(a.id)}/${operation}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await send('approve', { version: a.version, username: 'forged' })).status, 400);
  assert.equal((await send('approve', { version: a.version })).status, 200);
  assert.equal((await send('execute', {})).status, 404);
  assert.equal((await repo.getAction(a.id)).approval.approvedBy, 'test-only-user');
});
