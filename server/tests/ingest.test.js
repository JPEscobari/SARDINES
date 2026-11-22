const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// Replace the IBM boundary before importing the real extractor and route.
// These tests never load .env, call IBM, or connect to MongoDB.
let response;
let calls = 0;
const watson = require('../services/watsonx.service');
const original = watson.sendMessage;
watson.sendMessage = async () => {
  calls++;
  if (response instanceof Error) throw response;
  return response;
};
const { extractPromises } = require('../services/promiseExtractor');
const app = express();
app.use('/api/ingest', require('../routes/ingest'));
app.use(express.json());
let server;
let url;
before(async () => {
  server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  url = `http://127.0.0.1:${server.address().port}/api/ingest`;
});
after(async () => {
  watson.sendMessage = original;
  await new Promise(resolve => server.close(resolve));
});
const input = "Sean: We promised Acme to confirm Thursday delivery.\nJamie: I'll check the warehouse tomorrow.\nAlex: Warehouse confirmation is still pending.";
function valid() {
  return {
    summary: 'Acme delivery confirmation is pending.',
    promises: [{ customerName: 'Acme', title: 'Confirm delivery', ownerName: null,
      dueAt: null, dueText: 'Thursday', sourceQuote: 'We promised Acme to confirm Thursday delivery.' }],
    actions: [{ description: 'Check warehouse', ownerName: 'Jamie', dueAt: null,
      dueText: 'tomorrow', sourceQuote: "I'll check the warehouse tomorrow." }],
    blockers: [{ description: 'Confirmation pending', sourceQuote: 'Warehouse confirmation is still pending.' }]
  };
}
async function post(body, type = 'application/json') {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': type }, body });
}
test('POST returns the validated analysis envelope', async () => {
  response = JSON.stringify(valid());
  const res = await post(JSON.stringify({ sourceType: 'meeting_note', content: input }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { success: true, sourceType: 'meeting_note', analysis: valid(), persisted: false });
});
test('invalid input is rejected before calling IBM', async () => {
  const previous = calls;
  for (const body of [{}, { content: '' }, { content: '  ' }, { content: 42 }, [], null]) {
    assert.equal((await post(JSON.stringify(body))).status, 400);
  }
  assert.equal((await post('{')).status, 400);
  assert.equal((await post('hello', 'text/plain')).status, 415);
  assert.equal((await post(JSON.stringify({ sourceType: 'meeting_note', content: 'a'.repeat(20001) }))).status, 400);
  assert.equal((await post(JSON.stringify({ sourceType: 'meeting_note', content: 'a'.repeat(140000) }))).status, 400);
  assert.equal(calls, previous);
});
test('invalid upstream output and errors are sanitized', async () => {
  const missing = valid(); delete missing.actions;
  const evidence = valid(); evidence.blockers[0].sourceQuote = 'Invented evidence';
  const extra = valid(); extra.promises[0].unexpected = 'field';
  for (const bad of ['not json', JSON.stringify(missing), JSON.stringify(evidence), JSON.stringify(extra), new Error('SECRET upstream details')]) {
    response = bad;
    const res = await post(JSON.stringify({ sourceType: 'meeting_note', content: input }));
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.error, 'Unable to extract a valid analysis');
    assert.equal(typeof body.code, 'string');
    assert.ok(!JSON.stringify(body).includes('SECRET'));
  }
});
test('schema rejects extra fields at every object level and empty evidence', async () => {
  for (const key of ['promises', 'actions', 'blockers']) {
    const extra = valid(); extra[key][0].unexpected = true;
    response = JSON.stringify(extra);
    await assert.rejects(extractPromises(input), /Invalid analysis schema/);
    const empty = valid(); empty[key][0].sourceQuote = '';
    response = JSON.stringify(empty);
    await assert.rejects(extractPromises(input), /Invalid analysis schema/);
  }
  response = JSON.stringify({ ...valid(), extra: true });
  await assert.rejects(extractPromises(input), /Invalid analysis schema/);
});
test('extractor accepts fenced JSON and empty findings', async () => {
  const empty = { summary: '', promises: [], actions: [], blockers: [] };
  response = '```json\n' + JSON.stringify(empty) + '\n```';
  assert.deepEqual(await extractPromises('Nothing committed.'), empty);
  await assert.rejects(extractPromises(' '), /Input text is required/);
});

for (const sourceType of ['meeting_note', 'buyer_email', 'audio_transcript', 'video_transcript', 'slack_message']) {
  test(`${sourceType} accepts empty findings`, async () => {
    const analysis = { summary: 'No commitments.', promises: [], actions: [], blockers: [] };
    response = JSON.stringify(analysis);
    const res = await post(JSON.stringify({ sourceType, content: 'Hello.' }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { success: true, sourceType, analysis, persisted: false });
  });
}
test('missing body and unsupported sources do not call IBM', async () => {
  const previous = calls;
  assert.equal((await post()).status, 400);
  for (const sourceType of [undefined, 'slack', 42]) {
    assert.equal((await post(JSON.stringify({ sourceType, content: input }))).status, 400);
  }
  for (const content of ['', ' ', 42, null]) {
    assert.equal((await post(JSON.stringify({ sourceType: 'buyer_email', content }))).status, 400);
  }
  assert.equal(calls, previous);
});
test('ingestion refuses explicit chat stub mode', async () => {
  const prior = process.env.WATSONX_STUB;
  process.env.WATSONX_STUB = 'true';
  try {
    const res = await post(JSON.stringify({ sourceType: 'meeting_note', content: input }));
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, 'CONFIGURATION_ERROR');
  } finally {
    if (prior === undefined) delete process.env.WATSONX_STUB;
    else process.env.WATSONX_STUB = prior;
  }
});
