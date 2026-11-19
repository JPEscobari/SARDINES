const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { LocalRepository } = require('../operational/localRepository');
const { CloudantRepository } = require('../operational/cloudantRepository');
const { FakeCloudant, fixture } = require('./helpers/fakeCloudant');
const { preview, send, receiveReply, directory } = require('../integrations/slackFollowup');
const recipient = { label: 'Synthetic Jamie', ownerId: 'owner-test', teamId: 'TTEST', userId: 'UTEST' };
const env = { SARDINES_SLACK_TEAM_ID: 'TTEST', SARDINES_SLACK_RECIPIENTS: JSON.stringify([recipient]), SARDINES_SLACK_SEND_ENABLED: 'true' };
const confirmation = a => ({ kind: 'local_cli', subject: 'local:test', version: a.version, payloadHash: a.slackFollowup.payloadHash });
const reply = () => ({ event_id: 'EvTEST', team_id: 'TTEST', event: { type: 'message', channel: 'DTEST', thread_ts: '1700000000.000001', ts: '1700000001.000001', user: 'UTEST', text: 'Checking stock now' } });
for (const backend of ['sqlite', 'mock-cloudant']) {
  async function setup(t) {
    const dir = mkdtempSync(path.join(tmpdir(), 'sardines-followup-'));
    const client = new FakeCloudant();
    const repo = backend === 'sqlite' ? new LocalRepository(path.join(dir, 'test.sqlite')) : new CloudantRepository(client);
    t.after(() => { repo.close(); rmSync(dir, { recursive: true, force: true }); });
    const saved = await repo.saveAnalysis(fixture());
    const a = await repo.reviewAction(saved.actions[0].id, { version: 1, promiseId: saved.promises[0].id, ownerId: recipient.ownerId });
    let calls = 0;
    const transport = { verify: async () => {}, send: async () => { calls++; return { channel: 'DTEST', ts: '1700000000.000001' }; } };
    return { repo, client, a, saved, transport, calls: () => calls };
  }
  test(`${backend}: preview only, recipient validation, disabled send and exact confirmation`, async t => {
    const { repo, a, transport, calls } = await setup(t);
    await assert.rejects(preview(repo, a.id, { version: a.version, userId: 'UWRONG' }, env));
    const p = await preview(repo, a.id, { version: a.version, userId: 'UTEST' }, env);
    assert.match(p.slackFollowup.text, /Unresolved/); assert.equal(calls(), 0);
    await assert.rejects(send(repo, a.id, confirmation(p), transport, {}));
    await assert.rejects(send(repo, a.id, confirmation(p), transport, { ...env, NODE_ENV: 'production' }));
    await assert.rejects(send(repo, a.id, { ...confirmation(p), payloadHash: 'wrong' }, transport, env));
    assert.equal(calls(), 0);
    assert.equal((await repo.listAuditEvents()).find(e => e.event === 'slack_previewed').followupSnapshot.text, p.slackFollowup.text);
  });
  test(`${backend}: concurrent confirmations send once and persist audit/message identifiers`, async t => {
    const { repo, a, transport, calls } = await setup(t);
    const p = await preview(repo, a.id, { version: a.version, userId: 'UTEST' }, env);
    const results = await Promise.allSettled([send(repo, a.id, confirmation(p), transport, env), send(repo, a.id, confirmation(p), transport, env)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(calls(), 1);
    const sent = await repo.getAction(a.id); assert.equal(sent.slackFollowup.status, 'sent');
    assert.equal(sent.slackFollowup.channelId, 'DTEST');
    await assert.rejects(preview(repo, a.id, { version: sent.version, userId: 'UTEST' }, env));
    await assert.rejects(send(repo, a.id, confirmation(sent), transport, env));
    const events = await repo.listAuditEvents(); assert.equal(events.filter(e => e.event === 'slack_sent').length, 1);
    assert.equal(sent.approvalStatus, 'pending'); await assert.rejects(repo.executeAction(a.id));
  });
  test(`${backend}: action or Promise edits invalidate send confirmation`, async t => {
    const { repo, a, transport, calls, saved } = await setup(t);
    let p = await preview(repo, a.id, { version: a.version, userId: 'UTEST' }, env);
    const edited = await repo.reviewAction(a.id, { version: p.version, title: 'Changed title' });
    await assert.rejects(send(repo, a.id, confirmation(edited), transport, env));
    p = await preview(repo, a.id, { version: edited.version, userId: 'UTEST' }, env);
    await repo.updatePromise(saved.promises[0].id, { version: 1, title: 'Changed promise' });
    await assert.rejects(send(repo, a.id, confirmation(p), transport, env)); assert.equal(calls(), 0);
  });
  test(`${backend}: transport uncertainty prevents retry and locks review edits`, async t => {
    const { repo, a, transport, saved } = await setup(t);
    const p = await preview(repo, a.id, { version: a.version, userId: 'UTEST' }, env);
    transport.send = async () => { throw new Error('response lost'); };
    await assert.rejects(send(repo, a.id, confirmation(p), transport, env), e => e.code === 'SLACK_SEND_UNCERTAIN');
    const uncertain = await repo.getAction(a.id); assert.equal(uncertain.slackFollowup.status, 'uncertain');
    await assert.rejects(send(repo, a.id, confirmation(uncertain), transport, env));
    await assert.rejects(repo.reviewAction(a.id, { version: uncertain.version, title: 'edit' }));
    await assert.rejects(repo.updatePromise(saved.promises[0].id, { version: 1, title: 'edit' }));
  });
  test(`${backend}: Slack identity verification failure does not claim or send`, async t => {
    const { repo, a, transport, calls } = await setup(t);
    const p = await preview(repo, a.id, { version: a.version, userId: 'UTEST' }, env);
    transport.verify = async () => { throw new Error('wrong workspace'); };
    await assert.rejects(send(repo, a.id, confirmation(p), transport, env));
    assert.equal(calls(), 0); assert.equal((await repo.getAction(a.id)).slackFollowup.status, 'preview');
  });
  test(`${backend}: replies correlate, deduplicate, ignore bots/edits/unrelated and preserve Promise status`, async t => {
    const { repo, a, transport, saved } = await setup(t);
    const p = await preview(repo, a.id, { version: a.version, userId: 'UTEST' }, env);
    await send(repo, a.id, confirmation(p), transport, env);
    for (const patch of [{ user: 'UOTHER' }, { channel: 'DOTHER' }, { subtype: 'message_changed' }, { bot_id: 'BTEST' }, { thread_ts: '1700000002.000001' }]) {
      const body = reply(); Object.assign(body.event, patch); assert.equal(await receiveReply(repo, body), false);
    }
    assert.equal(await receiveReply(repo, { ...reply(), team_id: 'TOTHER' }), false);
    await Promise.all([receiveReply(repo, reply()), receiveReply(repo, reply())]);
    const updated = await repo.getAction(a.id); assert.equal(updated.slackFollowup.replies.length, 1); assert.equal(updated.slackFollowup.status, 'replied');
    assert.equal((await repo.getPromise(saved.promises[0].id)).status, 'needs_review');
    assert.equal((await repo.listAuditEvents()).filter(e => e.event === 'slack_reply_received').length, 1);
  });
  test(`${backend}: final persistence failure never allows duplicate send`, async t => {
    const { repo, a, transport, calls } = await setup(t);
    const p = await preview(repo, a.id, { version: a.version, userId: 'UTEST' }, env);
    const original = repo.mutateAction.bind(repo); let mutations = 0;
    repo.mutateAction = async (...args) => { if (++mutations === 2) throw new Error('storage offline'); return original(...args); };
    await assert.rejects(send(repo, a.id, confirmation(p), transport, env));
    assert.equal((await repo.getAction(a.id)).slackFollowup.status, 'sending');
    await assert.rejects(send(repo, a.id, confirmation(p), transport, env)); assert.equal(calls(), 1);
  });
}
test('directory is fail closed for malformed and duplicate owner mappings', () => {
  assert.deepEqual(directory({ SARDINES_SLACK_RECIPIENTS: 'bad' }), []);
  assert.deepEqual(directory({ SARDINES_SLACK_RECIPIENTS: JSON.stringify([recipient, recipient]) }), []);
});
