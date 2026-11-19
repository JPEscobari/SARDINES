const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { LocalRepository } = require('../operational/localRepository');
const { CloudantRepository } = require('../operational/cloudantRepository');
const { FakeCloudant, fixture } = require('./helpers/fakeCloudant');
for (const backend of ['sqlite', 'cloudant-mock']) {
  function setup(t) {
    const filename = path.join(mkdtempSync(path.join(tmpdir(), 'sardines-contract-')), 'db.sqlite');
    const client = new FakeCloudant();
    const make = () => backend === 'sqlite' ? new LocalRepository(filename) : new CloudantRepository(client, { pageSize: 1 });
    const repo = make(); t.after(() => repo.close()); return { repo, make };
  }
  test(`${backend}: save, read, deduplication, audit and reopen contract`, async t => {
    const { repo, make } = setup(t); const input = fixture(); const saved = await repo.saveAnalysis(input);
    assert.equal(saved.duplicate, false); assert.equal(saved.promises[0].ownerName, null); assert.equal(saved.promises[0].dueAt, null);
    assert.equal(saved.promises[0].extractedDueAt, '2026-11-22'); assert.equal(saved.actions[0].executionStatus, 'disabled');
    assert.deepEqual(await repo.getSource(saved.source.id), saved.source);
    assert.deepEqual(await repo.getPromise(saved.promises[0].id), saved.promises[0]);
    assert.equal((await repo.saveAnalysis(input)).duplicate, true);
    assert.equal((await repo.listPromises()).length, 1); assert.equal((await repo.listActions(saved.source.id)).length, 1);
    assert.equal((await repo.listAuditEvents()).length, 2);
    const other = make(); try { assert.deepEqual(await other.getSource(saved.source.id), saved.source); } finally { other.close(); }
  });
  test(`${backend}: review versions, immutable evidence and deadline rules`, async t => {
    const { repo } = setup(t); const p = (await repo.saveAnalysis(fixture())).promises[0];
    for (const patch of [{ status: 'completed' }, { sourceQuote: 'changed' }, { dueAt: '2026-02-30T00:00:00.000Z' }, { actorId: 'admin' }]) await assert.rejects(repo.updatePromise(p.id, { version: 1, ...patch }));
    const edited = await repo.updatePromise(p.id, { version: 1, status: 'open', dueAt: '2026-11-22T17:00:00.000Z' });
    assert.equal(edited.version, 2); assert.equal(edited.deadlineState, 'reviewed');
    await assert.rejects(repo.updatePromise(p.id, { version: 1, status: 'blocked' }), { code: 'VERSION_CONFLICT' });
    assert.equal((await repo.updatePromise(p.id, { version: 2, dueText: 'next week' })).dueAt, null);
    assert.equal((await repo.saveAnalysis(fixture())).promises[0].status, 'open');
    assert.equal((await repo.listAuditEvents()).length, 4);
  });
  test(`${backend}: validation, empty findings and proposed action contract`, async t => {
    const { repo } = setup(t);
    for (const mutate of [b => delete b.analysis.actions, b => b.analysis.promises[0].sourceQuote = 'invented', b => b.analysis.promises[0].id = 'invented', b => b.analysis.promises[0].title = '']) {
      const b = fixture(); mutate(b); await assert.rejects(repo.saveAnalysis(b));
    }
    assert.equal((await repo.listPromises()).length, 0);
    const b = fixture(); b.analysis.promises = []; b.analysis.actions = [];
    const saved = await repo.saveAnalysis(b); assert.equal(saved.promises.length, 0);
    const action = await repo.proposeAction(saved.source.id, fixture().analysis.actions[0]);
    assert.equal(action.promiseId, null); assert.equal(action.approvalStatus, 'pending');
    await repo.proposeAction(saved.source.id, fixture().analysis.actions[0]); assert.equal((await repo.listActions()).length, 1);
    await assert.rejects(repo.proposeAction(saved.source.id, { ...fixture().analysis.actions[0], approvalStatus: 'approved' }));
    assert.equal(await repo.getPromise('missing'), null); assert.equal(await repo.getSource('missing'), null);
    assert.equal((await repo.health()).ready, true);
  });
}
test('Cloudant mock: atomic failure and safe save retry', async () => {
  const client = new FakeCloudant(); const repo = new CloudantRepository(client);
  client.beforePut = () => { throw new Error('network unavailable'); };
  await assert.rejects(repo.saveAnalysis(fixture())); assert.equal(client.docs.size, 0);
  client.beforePut = null; await repo.saveAnalysis(fixture()); assert.equal(client.docs.size, 1);
  assert.equal((await repo.listAuditEvents()).length, 2);
});
test('Cloudant mock: lost write responses reconcile without duplicate records/audits', async () => {
  const client = new FakeCloudant(); const repo = new CloudantRepository(client);
  client.afterPut = () => { throw new Error('response lost'); };
  const saved = await repo.saveAnalysis(fixture());
  const edited = await repo.updatePromise(saved.promises[0].id, { version: 1, status: 'open' });
  assert.equal(edited.version, 2); assert.equal((await repo.listAuditEvents()).length, 3);
  const b = fixture().analysis.actions[0]; b.description = 'Review stock';
  await repo.proposeAction(saved.source.id, b); await repo.proposeAction(saved.source.id, b);
  assert.equal((await repo.listActions()).length, 2); assert.equal((await repo.listAuditEvents()).length, 4);
});
test('Cloudant mock: concurrent same-promise writes produce one success and one 409', async () => {
  const client = new FakeCloudant(); const a = new CloudantRepository(client); const b = new CloudantRepository(client);
  const p = (await a.saveAnalysis(fixture())).promises[0];
  const results = await Promise.allSettled([a.updatePromise(p.id, { version: 1, status: 'open' }), b.updatePromise(p.id, { version: 1, status: 'blocked' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
  assert.equal((await a.listAuditEvents()).length, 3);
});
test('Cloudant mock: concurrent unrelated promise edits retry aggregate revision safely', async () => {
  const client = new FakeCloudant(); const repo = new CloudantRepository(client); const input = fixture(); input.analysis.promises.push({ ...input.analysis.promises[0], title: 'Second' });
  const saved = await repo.saveAnalysis(input);
  await Promise.all(saved.promises.map(p => repo.updatePromise(p.id, { version: 1, status: 'open' })));
  assert.ok((await repo.listPromises()).every(p => p.version === 2)); assert.equal((await repo.listAuditEvents()).length, 4);
});
test('Cloudant mock: paginated scans, aggregate limit and replication conflicts fail safely', async () => {
  const client = new FakeCloudant(); const repo = new CloudantRepository(client, { pageSize: 1 });
  for (let i = 0; i < 3; i++) { const input = fixture(); input.content += i; await repo.saveAnalysis(input); }
  assert.equal((await repo.listPromises()).length, 3); assert.ok(client.pages >= 4);
  const small = new CloudantRepository(client, { maxBytes: 100 }); const input = fixture(); input.content += 'new';
  await assert.rejects(small.saveAnalysis(input), { code: 'AGGREGATE_TOO_LARGE' }); assert.equal(client.docs.size, 3);
  client.docs.values().next().value._conflicts = ['other-rev'];
  await assert.rejects(repo.listPromises(), { status: 409 });
});
test('Cloudant mock: no audit-only commit when update fails; 202 is not success', async () => {
  const client = new FakeCloudant(); const repo = new CloudantRepository(client); const p = (await repo.saveAnalysis(fixture())).promises[0];
  client.beforePut = () => { throw Object.assign(new Error('no quorum'), { status: 202 }); };
  await assert.rejects(repo.updatePromise(p.id, { version: 1, status: 'open' }));
  assert.equal((await repo.getPromise(p.id)).version, 1); assert.equal((await repo.listAuditEvents()).length, 2);
});

test('Cloudant mock: concurrent saves and proposals deduplicate across clients', async () => {
  const client = new FakeCloudant(); const a = new CloudantRepository(client); const b = new CloudantRepository(client);
  const results = await Promise.all([a.saveAnalysis(fixture()), b.saveAnalysis(fixture())]);
  assert.equal(client.docs.size, 1); assert.equal(results.filter(r => r.duplicate).length, 1);
  const item = { ...fixture().analysis.actions[0], description: 'Another stock review' };
  const actions = await Promise.all([a.proposeAction(results[0].source.id, item), b.proposeAction(results[0].source.id, item)]);
  assert.equal(actions[0].id, actions[1].id); assert.equal((await a.listAuditEvents()).length, 3);
});
test('Cloudant mock: persistent revision conflicts are bounded and never acknowledged', async () => {
  const client = new FakeCloudant(); const repo = new CloudantRepository(client); const saved = await repo.saveAnalysis(fixture());
  let attempts = 0;
  client.beforePut = () => { attempts++; throw Object.assign(new Error('conflict'), { status: 409 }); };
  await assert.rejects(repo.updatePromise(saved.promises[0].id, { version: 1, status: 'open' }), { status: 409 });
  assert.equal(attempts, 3); assert.equal((await repo.getPromise(saved.promises[0].id)).version, 1);
  assert.equal((await repo.listAuditEvents()).length, 2);
});
