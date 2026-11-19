const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { LocalRepository } = require('../operational/localRepository');
const { CloudantRepository } = require('../operational/cloudantRepository');
const { FakeCloudant, fixture } = require('./helpers/fakeCloudant');
const { transcript } = require('../operational/slackSource');
for (const backend of ['sqlite', 'mock-cloudant']) test(`${backend}: Slack evidence, identity, deduplication, legacy compatibility`, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sardines-slack-'));
  const repo = backend === 'sqlite' ? new LocalRepository(path.join(dir, 'test.sqlite')) : new CloudantRepository(new FakeCloudant());
  try {
    const body = fixture();
    await repo.saveAnalysis(body);
    const audio = await repo.saveAnalysis({ ...body, sourceType: 'audio_transcript' });
    assert.equal(audio.source.content, body.content);
    assert.equal((await repo.saveAnalysis({ ...body, sourceType: 'audio_transcript' })).duplicate, true);
    body.sourceType = 'slack_thread';
    body.slack = { teamId: 'TTEST', channelId: 'CTEST', threadTs: '1700000000.000001', requestedBy: 'UTEST', messages: [{ ts: '1700000000.000001', userId: 'UTEST', text: body.content }] };
    body.content = transcript(body.slack);
    body.analysis.decisions = [{ description: 'Quote', sourceQuote: 'Acme promised a quote.' }];
    const saved = await repo.saveAnalysis(body);
    assert.deepEqual((await repo.getSource(saved.source.id)).slack, body.slack);
    assert.equal(saved.actions[0].promiseId, null);
    assert.equal((await repo.saveAnalysis(body)).duplicate, true);
    const other = structuredClone(body); other.slack.channelId = 'COTHER';
    assert.notEqual((await repo.saveAnalysis(other)).source.id, saved.source.id);
    const bad = structuredClone(body); bad.analysis.actions[0].sourceQuote = '[1700000000.000001]';
    await assert.rejects(repo.saveAnalysis(bad), /message evidence/);
    bad.slack.messages[0].text = 'tampered';
    await assert.rejects(repo.saveAnalysis(bad), /snapshot/);
    assert.equal((await repo.proposeAction(saved.source.id, body.analysis.actions[0])).id, saved.actions[0].id);
  } finally { repo.close(); rmSync(dir, { recursive: true, force: true }); }
});
