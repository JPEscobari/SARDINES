const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createSpeechService, inspectWav, parseResponse } = require('../services/speechToText');
const { createTranscribeRouter } = require('../routes/transcribe');
const env = { STT_URL: 'https://api.us-south.speech-to-text.watson.cloud.ibm.com/instances/synthetic', STT_API_KEY: 'test-only' };
function wav(seconds = 1) {
  const data = 32000 * seconds; const b = Buffer.alloc(44 + data);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(data, 40); return b;
}
const result = () => ({ results: [{ final: true, alternatives: [{ transcript: 'Synthetic memo.', confidence: 0.9, timestamps: [['Synthetic', 0, 0.4], ['memo', 0.4, 0.8]] }] }] });
function mockHttp(error) {
  const calls = []; return { calls, async post(url, body, options) { calls.push({ url, body, options }); if (url.includes('iam.cloud')) return { data: { access_token: 'synthetic-token', expires_in: 3600 } }; if (error) throw error; return { data: result() }; } };
}
test('WAV checks bytes, PCM properties, duration and limits rather than filename/header claims', () => {
  assert.equal(inspectWav(wav(), 'audio/wav').durationSeconds, 1);
  for (const b of [Buffer.from('not audio'), wav().subarray(0, 100), Buffer.alloc(100)]) assert.throws(() => inspectWav(b, 'audio/wav'));
  const bad = wav(); bad.writeUInt32LE(1, 28); assert.throws(() => inspectWav(bad, 'audio/wav'));
  assert.throws(() => inspectWav(wav(), 'audio/mp3'), e => e.status === 415);
  assert.throws(() => inspectWav(wav(), 'audio/wav', { maxBytes: 100, maxSeconds: 120 }), e => e.code === 'AUDIO_TOO_LARGE');
  assert.throws(() => inspectWav(wav(121), 'audio/wav'), e => e.code === 'AUDIO_TOO_LONG');
});
test('IBM adapter uses IAM, fixed recognize endpoint, timeout, privacy header and validated metadata', async () => {
  const http = mockHttp(); const speech = createSpeechService({ env, http });
  const output = await speech.transcribe(wav(), 'audio/wav');
  assert.equal(output.transcript, 'Synthetic memo.'); assert.equal(output.persisted, false); assert.equal(output.segments[0].confidence, 0.9);
  assert.equal(http.calls[1].url, env.STT_URL + '/v1/recognize'); assert.equal(http.calls[1].options.timeout, 90000);
  assert.equal(http.calls[1].options.headers['X-Watson-Learning-Opt-Out'], 'true'); assert.equal(http.calls[1].options.maxRedirects, 0);
  await speech.transcribe(wav(), 'audio/wav'); assert.equal(http.calls.filter(c => c.url.includes('iam.cloud')).length, 1);
});
for (const [error, code, status] of [[{ response: { status: 401 } }, 'STT_AUTH_FAILED', 503], [{ response: { status: 403 } }, 'STT_AUTH_FAILED', 503], [{ code: 'ECONNABORTED' }, 'STT_TIMEOUT', 504], [{ response: { status: 429 } }, 'STT_RATE_LIMITED', 429], [{ response: { status: 400 } }, 'STT_AUDIO_REJECTED', 422], [{ response: { status: 500 } }, 'STT_UNAVAILABLE', 502]]) {
  test(`IBM error ${code}/${status} is sanitized and not retried`, async () => {
    const http = mockHttp({ ...error, message: 'SECRET upstream text' });
    await assert.rejects(createSpeechService({ env, http }).transcribe(wav(), 'audio/wav'), e => e.code === code && e.status === status && !e.message.includes('SECRET'));
    assert.equal(http.calls.length, 2);
  });
}
test('empty transcripts allowed; malformed recognition and timing rejected', () => {
  assert.deepEqual(parseResponse({ results: [] }), { transcript: '', segments: [], empty: true });
  for (const data of [{}, { results: [{}] }, { results: [{ final: false, alternatives: [{ transcript: 'bad' }] }] }]) assert.throws(() => parseResponse(data));
  const bad = result(); bad.results[0].alternatives[0].timestamps[0][2] = -1; assert.throws(() => parseResponse(bad));
});
test('missing credentials, URL spoof and IAM failures fail closed', async () => {
  const http = mockHttp();
  for (const config of [{}, { ...env, STT_URL: 'https://attacker.example/instances/x' }]) await assert.rejects(createSpeechService({ env: config, http }).transcribe(wav(), 'audio/wav'), e => ['STT_CONFIGURATION', 'STT_URL_INVALID'].includes(e.code));
  assert.equal(http.calls.length, 0);
  await assert.rejects(createSpeechService({ env, http: { post: async () => { throw new Error('IAM secret'); } } }).transcribe(wav(), 'audio/wav'), e => e.code === 'STT_AUTH_FAILED');
});
test('HTTP raw upload works, rejects format/size, zeroes buffer and never writes temporary files', async t => {
  const http = mockHttp(); const app = express(); app.use('/api/transcribe', createTranscribeRouter({ env, service: createSpeechService({ env, http }) }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/api/transcribe`;
  const post = (body, type = 'audio/wav') => fetch(url, { method: 'POST', headers: { 'Content-Type': type }, body });
  const response = await post(wav()); assert.equal(response.status, 200); assert.equal((await response.json()).transcript, 'Synthetic memo.');
  assert.equal(http.calls[1].body.every(byte => byte === 0), true);
  assert.equal((await post(wav(), 'audio/webm')).status, 415);
  assert.equal((await post(Buffer.alloc(9 * 1024 * 1024))).status, 413);
  assert.equal((await post(Buffer.from('invalid'))).status, 400);
  assert.equal((await post(wav())).status, 200); // gate released after parser failures
});
test('HTTP failure also clears audio buffer and releases concurrency gate', async t => {
  const http = mockHttp({ code: 'ETIMEDOUT' }); const app = express(); app.use(createTranscribeRouter({ env, service: createSpeechService({ env, http }) }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); t.after(() => server.close());
  for (let i = 0; i < 2; i++) {
    const r = await fetch(`http://127.0.0.1:${server.address().port}`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav() });
    assert.equal(r.status, 504);
  }
  assert.ok(http.calls.filter(c => Buffer.isBuffer(c.body)).every(c => c.body.every(byte => byte === 0)));
});
test('HTTP permits one active transcription and fails closed in production', async t => {
  let release, entered;
  const started = new Promise(r => { entered = r; });
  const service = { transcribe: async () => { entered(); await new Promise(r => { release = r; }); return { transcript: '', segments: [], empty: true, persisted: false }; } };
  const app = express(); app.use('/dev', createTranscribeRouter({ env, service })); app.use('/production', createTranscribeRouter({ env: { NODE_ENV: 'production' }, service }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); t.after(() => server.close());
  const post = route => fetch(`http://127.0.0.1:${server.address().port}/${route}`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav() });
  const first = post('dev'); await started;
  try { assert.equal((await post('dev')).status, 429); assert.equal((await post('production')).status, 503); }
  finally { release(); }
  assert.equal((await first).status, 200);
});
module.exports = { wav };

test('model availability and diagnostics distinguish configuration, IAM, lookup, recognition and parsing', async () => {
  const http = mockHttp(); const stages = [];
  http.get = async (url, options) => { assert.equal(url, env.STT_URL + '/v1/models'); assert.equal(options.maxRedirects, 0); return { data: { models: [{ name: 'en-US_Multimedia' }] } }; };
  const service = createSpeechService({ env, http, onStage: s => stages.push(s) });
  assert.equal((await service.verifyModel('en-US_Multimedia')).available, true);
  await service.transcribe(wav(), 'audio/wav');
  assert.deepEqual(stages, ['configuration','iam_authentication','model_availability','wav_validation','configuration','iam_authentication','http_recognition','response_parsing']);
  await assert.rejects(service.verifyModel('absent'), e => e.code === 'STT_MODEL_UNAVAILABLE' && e.httpStatus === 200);
  http.get = async () => { throw { response: { status: 403, data: 'secret' } }; };
  await assert.rejects(service.verifyModel(), e => e.code === 'STT_AUTH_FAILED' && e.httpStatus === 403 && !e.message.includes('secret'));
});
test('malformed configured URL fails before any IAM or audio request', async () => {
  const http = mockHttp(); const stages = [];
  await assert.rejects(createSpeechService({ env: { ...env, STT_URL: 'copied label ' + env.STT_URL }, http, onStage: s => stages.push(s) }).transcribe(wav(), 'audio/wav'), e => e.code === 'STT_URL_INVALID' && e.httpStatus === null);
  assert.equal(http.calls.length, 0); assert.deepEqual(stages, ['wav_validation', 'configuration']);
});
