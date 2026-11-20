const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { LocalRepository } = require('../operational/localRepository');
const { CloudantRepository } = require('../operational/cloudantRepository');
const { FakeCloudant, fixture } = require('./helpers/fakeCloudant');
const { preview, send, receiveReply, checkPreview } = require('../integrations/slackFollowup');
const { inspectRecovery, applyRecovery } = require('../integrations/slackRecovery');
const recipient = { label: 'Synthetic', ownerId: 'owner-test', teamId: 'TTEST', userId: 'UTEST' };
const env = { SARDINES_SLACK_TEAM_ID: 'TTEST', SARDINES_SLACK_RECIPIENTS: JSON.stringify([recipient]), SARDINES_SLACK_SEND_ENABLED: 'true', SARDINES_SLACK_RECOVERY_ENABLED: 'true' };
const channel = 'DTEST', ts = '1700000000.000001';
const confirm = p => ({ kind: 'local_cli', subject: 'local:test', version: p.version, planHash: p.planHash });
for (const backend of ['sqlite', 'mock-cloudant']) {
  async function setup(t) {
    const dir = mkdtempSync(path.join(tmpdir(), 'sardines-recovery-')); const client = new FakeCloudant();
    const repo = backend === 'sqlite' ? new LocalRepository(path.join(dir, 'test.sqlite')) : new CloudantRepository(client);
    t.after(() => { repo.close(); rmSync(dir, { recursive: true, force: true }); });
    const saved = await repo.saveAnalysis(fixture()); const a = await repo.reviewAction(saved.actions[0].id, { version: 1, promiseId: saved.promises[0].id, ownerId: 'owner-test' });
    const p = await preview(repo, a.id, { version: a.version, userId: 'UTEST' }, env);
    assert.equal(checkPreview(p, saved.promises[0], env), true);
    const proof = { botUserId: 'UBOT', messages: [{ ts, user: 'UBOT', client_msg_id: p.slackFollowup.id, text: p.slackFollowup.text },
      { ts: '1700000001.000001', thread_ts: ts, user: 'UTEST', text: 'Synthetic reply after timeout' }] };
    const reader = { readThread: async () => structuredClone(proof) };
    const sender = { verify: async () => {}, send: async () => { throw new Error('ETIMEDOUT after delivery'); } };
    const sendConfirmation = { kind: 'local_cli', subject: 'local:test', version: p.version, payloadHash: p.slackFollowup.payloadHash };
    return { repo, client, p, proof, reader, sender, sendConfirmation, saved,
      timeout: () => assert.rejects(send(repo, p.id, sendConfirmation, sender, env), e => e.code === 'SLACK_SEND_UNCERTAIN'),
      inspect: () => inspectRecovery(repo, p.id, channel, ts, reader, env),
      apply: plan => applyRecovery(repo, p.id, channel, ts, confirm(plan), reader, env) };
  }
  test(`${backend}: read-only recovery plan, timeout reconciliation, atomic replay and duplicate prevention`, async t => {
    const s = await setup(t); await s.timeout();
    const before = await s.repo.listAuditEvents(); const plan = await s.inspect();
    assert.equal(plan.writes, 0); assert.deepEqual(await s.repo.listAuditEvents(), before);
    const recovered = await s.apply(plan); assert.equal(recovered.slackFollowup.status, 'replied'); assert.equal(recovered.slackFollowup.replies.length, 1);
    assert.equal((await s.repo.getPromise(s.saved.promises[0].id)).status, 'needs_review');
    await assert.rejects(send(s.repo, s.p.id, s.sendConfirmation, s.sender, env));
    const again = await s.inspect(); await s.apply(again);
    assert.equal((await s.repo.listAuditEvents()).filter(e => e.event === 'slack_reconciled').length, 1);
    await receiveReply(s.repo, { team_id: 'TTEST', event_id: 'EvDUP', event: { ...s.proof.messages[1], type: 'message', channel } });
    assert.equal((await s.repo.getAction(s.p.id)).slackFollowup.replies.length, 1);
  });
  test(`${backend}: forged root, altered text, edits, changed allowlist and disabled confirmation fail closed`, async t => {
    const s = await setup(t); await s.timeout(); const plan = await s.inspect();
    await assert.rejects(applyRecovery(s.repo, s.p.id, channel, ts, confirm(plan), s.reader, { ...env, SARDINES_SLACK_RECOVERY_ENABLED: 'false' }));
    await assert.rejects(inspectRecovery(s.repo, s.p.id, channel, ts, s.reader, { ...env, NODE_ENV: 'production' }));
    await assert.rejects(inspectRecovery(s.repo, s.p.id, channel, ts, s.reader, { ...env, SARDINES_SLACK_TEAM_ID: 'TOTHER' }));
    for (const patch of [{ user: 'UOTHER' }, { client_msg_id: 'wrong' }, { text: 'different' }, { edited: { ts } }]) {
      const original = s.proof.messages[0]; s.proof.messages[0] = { ...original, ...patch };
      await assert.rejects(s.inspect()); s.proof.messages[0] = original;
    }
    s.proof.messages = []; await assert.rejects(s.inspect());
    assert.equal((await s.repo.getAction(s.p.id)).slackFollowup.status, 'uncertain');
  });
  test(`${backend}: concurrent operator recovery and stale/revised plans`, async t => {
    const s = await setup(t); await s.timeout(); let plan = await s.inspect();
    s.proof.messages[1].text = 'New evidence'; await assert.rejects(s.apply(plan));
    plan = await s.inspect(); const results = await Promise.allSettled([s.apply(plan), s.apply(plan)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal((await s.repo.getAction(s.p.id)).slackFollowup.replies.length, 1);
  });
  test(`${backend}: recovery failure rolls back; repeat inspection recovers after storage returns`, async t => {
    const s = await setup(t); await s.timeout(); const plan = await s.inspect();
    const original = s.repo.mutateAction.bind(s.repo); s.repo.mutateAction = async () => { throw new Error('offline'); };
    await assert.rejects(s.apply(plan)); s.repo.mutateAction = original;
    assert.equal((await s.repo.getAction(s.p.id)).slackFollowup.status, 'uncertain');
    await s.apply(plan); assert.equal((await s.repo.getAction(s.p.id)).slackFollowup.status, 'replied');
  });
  test(`${backend}: offline listener reply is recovered later without resetting sent identity`, async t => {
    const s = await setup(t); s.proof.messages.pop();
    s.sender.send = async () => ({ channel, ts });
    await send(s.repo, s.p.id, s.sendConfirmation, s.sender, env);
    const empty = await s.inspect(); assert.equal(empty.replies.length, 0);
    s.proof.messages.push({ ts: '1700000001.000001', thread_ts: ts, user: 'UTEST', text: 'Reply while listener offline' });
    await assert.rejects(s.apply(empty));
    const recovered = await s.apply(await s.inspect());
    assert.equal(recovered.slackFollowup.status, 'replied'); assert.equal(recovered.slackFollowup.messageTs, ts);
  });
  test(`${backend}: stuck claim from final commit failure reconciles without a second send`, async t => {
    const s = await setup(t); const mutate = s.repo.mutateAction.bind(s.repo); let writes = 0;
    s.repo.mutateAction = async (...args) => { if (++writes === 2) throw new Error('Final persistence offline'); return mutate(...args); };
    s.sender.send = async () => ({ channel, ts });
    await assert.rejects(send(s.repo, s.p.id, s.sendConfirmation, s.sender, env)); s.repo.mutateAction = mutate;
    assert.equal((await s.repo.getAction(s.p.id)).slackFollowup.status, 'sending');
    await s.apply(await s.inspect()); assert.equal((await s.repo.getAction(s.p.id)).slackFollowup.status, 'replied');
  });
  test(`${backend}: delayed sender cannot overwrite operator recovery or recovered replies`, async t => {
    const s = await setup(t);
    s.sender.send = async () => { const plan = await s.inspect(); await s.apply(plan); return { channel, ts }; };
    const result = await send(s.repo, s.p.id, s.sendConfirmation, s.sender, env);
    assert.equal(result.slackFollowup.status, 'replied'); assert.equal(result.slackFollowup.replies.length, 1);
  });
  test(`${backend}: late timeout cannot downgrade an already reconciled send`, async t => {
    const s = await setup(t);
    s.sender.send = async () => { await s.apply(await s.inspect()); throw new Error('late timeout'); };
    await s.timeout(); assert.equal((await s.repo.getAction(s.p.id)).slackFollowup.status, 'replied');
  });
  test(`${backend}: bot, edited, unrelated replies ignored; root identity cannot be replaced`, async t => {
    const s = await setup(t); await s.timeout();
    s.proof.messages.push({ ...s.proof.messages[1], ts: '1700000002.000001', bot_id: 'BBOT' },
      { ...s.proof.messages[1], ts: '1700000003.000001', edited: { ts } },
      { ...s.proof.messages[1], ts: '1700000004.000001', user: 'UOTHER' });
    const plan = await s.inspect(); assert.equal(plan.replies.length, 1); await s.apply(plan);
    await assert.rejects(inspectRecovery(s.repo, s.p.id, 'DOTHER', ts, s.reader, env));
  });
}
