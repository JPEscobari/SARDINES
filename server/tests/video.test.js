const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const { createVideoService, videoLimits, inspectMp4, inspectProbe, runProcess, executable } = require('../services/videoToText');
const { inspectWav, SpeechError } = require('../services/speechToText');
const { createVideoRouter } = require('../routes/transcribeVideo');
const { createReviewRouter } = require('../routes/review');
const { LocalRepository } = require('../operational/localRepository');
const { CloudantRepository } = require('../operational/cloudantRepository');
const { FakeCloudant, fixture } = require('./helpers/fakeCloudant');
function mp4() { const b = Buffer.alloc(24); b.writeUInt32BE(24); b.write('ftypisom', 4); return b; }
function wav() {
  const b = Buffer.alloc(32044); b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(32000, 40); return b;
}
const metadata = () => ({ format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '1' }, streams: [
  { codec_type: 'video', codec_name: 'h264', width: 320, height: 240 }, { codec_type: 'audio', codec_name: 'aac', channels: 1, sample_rate: '16000' },
] });
test('MP4 validation rejects forged, unsupported, oversized, no-audio and excessive-duration inputs', () => {
  const config = videoLimits({}); inspectMp4(mp4(), config); inspectProbe(metadata(), config);
  assert.throws(() => inspectMp4(Buffer.alloc(24), config), { code: 'INVALID_VIDEO' });
  const mov = mp4(); mov.write('qt  ', 8); assert.throws(() => inspectMp4(mov, config), { code: 'UNSUPPORTED_VIDEO' });
  assert.throws(() => inspectMp4(mp4(), { ...config, maxBytes: 23 }), { code: 'VIDEO_TOO_LARGE' });
  const noAudio = metadata(); noAudio.streams.pop(); assert.throws(() => inspectProbe(noAudio, config), { code: 'VIDEO_NO_AUDIO' });
  const long = metadata(); long.format.duration = '121'; assert.throws(() => inspectProbe(long, config), { code: 'VIDEO_TOO_LONG' });
  const bad = metadata(); bad.streams[0].width = 8000; assert.throws(() => inspectProbe(bad, config), { code: 'UNSUPPORTED_VIDEO' });
  assert.throws(() => inspectProbe({}, config), { code: 'INVALID_VIDEO' });
  assert.equal(videoLimits({ STT_MAX_DURATION_SECONDS: '300' }).maxSeconds, 120);
  assert.equal(videoLimits({ STT_MAX_DURATION_SECONDS: '30' }).maxSeconds, 30);
});
for (const mode of ['success', 'probe-invalid', 'no-audio', 'ffmpeg-failure', 'timeout', 'stt-failure', 'dishonest-duration', 'cancelled']) {
  test(`mock video pipeline: ${mode}; bounded arguments, buffer zeroing and temporary cleanup`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'video-test-')); let audio, called = false;
    const stages = [], controller = new AbortController();
    const service = createVideoService({ env: mode === 'dishonest-duration' ? { STT_MAX_DURATION_SECONDS: '1' } : {}, tempRoot: root,
      resolveExecutable: async name => name,
      run: async (file, args, options) => {
        assert.ok(options.timeout <= 30000); assert.ok(args.includes('-enable_drefs')); assert.ok(args.includes('file'));
        if (file === 'ffprobe') {
          if (mode === 'probe-invalid') return 'invalid';
          const data = metadata(); if (mode === 'no-audio') data.streams.pop(); return JSON.stringify(data);
        }
        assert.ok(args.includes('pcm_s16le')); assert.ok(args.includes('16000')); assert.ok(args.includes('-nostdin'));
        if (mode === 'ffmpeg-failure') throw new SpeechError('VIDEO_PROCESS_FAILED', 422, 'Safe failure');
        if (mode === 'timeout') throw new SpeechError('VIDEO_TIMEOUT', 504, 'Safe timeout');
        let b = wav();
        if (mode === 'dishonest-duration') { b = Buffer.concat([b, Buffer.alloc(32000)]); b.writeUInt32LE(b.length - 8, 4); b.writeUInt32LE(64000, 40); }
        await fs.writeFile(args.at(-1), b);
        if (mode === 'cancelled') controller.abort();
      }, speech: { transcribe: async (buffer, mime) => {
        called = true; audio = buffer; const info = inspectWav(buffer, mime);
        if (mode === 'stt-failure') throw new SpeechError('STT_AUTH_FAILED', 503, 'Safe speech failure');
        return { transcript: 'Synthetic transcript.', segments: [], audio: info, persisted: false };
      } },
    });
    try {
      const request = service.transcribe(mp4(), { onStage: s => stages.push(s), signal: controller.signal });
      if (mode === 'success') { const result = await request; assert.equal(result.transcript, 'Synthetic transcript.'); assert.deepEqual(stages, ['extracting', 'transcribing']); }
      else await assert.rejects(request, { code: { 'probe-invalid': 'INVALID_VIDEO', 'no-audio': 'VIDEO_NO_AUDIO', 'ffmpeg-failure': 'VIDEO_PROCESS_FAILED', timeout: 'VIDEO_TIMEOUT', 'stt-failure': 'STT_AUTH_FAILED', 'dishonest-duration': 'AUDIO_TOO_LONG', cancelled: 'VIDEO_CANCELLED' }[mode] });
      assert.deepEqual(await fs.readdir(root), []);
      assert.equal(called, ['success', 'stt-failure'].includes(mode));
      if (audio) assert.ok(audio.every(byte => byte === 0));
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
}
test('real subprocess timeout and failure redact stderr; explicit tool paths fail closed', async () => {
  await assert.rejects(runProcess(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { timeout: 50 }), { code: 'VIDEO_TIMEOUT' });
  await assert.rejects(runProcess(process.execPath, ['-e', 'process.stderr.write("private");process.exit(1)']), e => e.code === 'VIDEO_PROCESS_FAILED' && !e.message.includes('private'));
  await assert.rejects(executable('ffmpeg', { FFMPEG_PATH: 'ffmpeg.cmd' }), { code: 'VIDEO_TOOLS_UNAVAILABLE' });
});
test('video HTTP streaming stages, safe failure, size/MIME guards, concurrent requests, production boundary', async () => {
  let release, body;
  const service = { transcribe: async (buffer, { onStage }) => { body = buffer; onStage('extracting'); await new Promise(r => { release = r; }); onStage('transcribing'); throw new SpeechError('STT_TIMEOUT', 504, 'Speech timed out'); } };
  const app = express(); app.use('/video', createVideoRouter({ env: { VIDEO_MAX_UPLOAD_BYTES: '100' }, service }));
  app.use('/prod', createVideoRouter({ env: { NODE_ENV: 'production' }, service }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (route, data = mp4(), type = 'video/mp4') => fetch(url + route, { method: 'POST', headers: { 'Content-Type': type }, body: data });
  try {
    assert.equal((await post('/prod')).status, 503);
    assert.equal((await post('/video', mp4(), 'video/webm')).status, 415);
    assert.equal((await post('/video', Buffer.alloc(101))).status, 413);
    const first = await post('/video'); assert.equal((await post('/video')).status, 429); release();
    const events = (await first.text()).trim().split('\n').map(JSON.parse);
    assert.deepEqual(events.map(e => e.stage || e.code), ['extracting', 'transcribing', 'STT_TIMEOUT']);
    assert.ok(body.every(b => b === 0));
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});
for (const backend of ['sqlite', 'mock-cloudant']) test(`${backend}: edited video transcript evidence, deduplication and WAV compatibility`, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-storage-'));
  const repo = backend === 'sqlite' ? new LocalRepository(path.join(dir, 'test.sqlite')) : new CloudantRepository(new FakeCloudant());
  try {
    const body = { ...fixture(), sourceType: 'video_transcript' }; body.content += '\nReviewer correction: internal check only.';
    const saved = await repo.saveAnalysis(body);
    assert.equal((await repo.getSource(saved.source.id)).content, body.content);
    assert.equal(saved.source.sourceType, 'video_transcript');
    assert.equal((await repo.saveAnalysis(body)).duplicate, true);
    const audio = await repo.saveAnalysis({ ...body, sourceType: 'audio_transcript' }); assert.notEqual(audio.source.id, saved.source.id);
    body.analysis.actions[0].sourceQuote = 'Not present in edited transcript';
    await assert.rejects(repo.saveAnalysis(body));
  } finally { repo.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
test('HTTP video success and explicit Save for Review preserve edited source text', async () => {
  const repo = new CloudantRepository(new FakeCloudant()), app = express(); let released;
  app.use('/video', createVideoRouter({ env: {}, service: { transcribe: async (buffer, { onStage }) => {
    released = buffer; onStage('extracting'); onStage('transcribing');
    return { transcript: fixture().content, segments: [], audio: { durationSeconds: 1 }, persisted: false };
  } } }));
  app.use('/review', createReviewRouter(() => repo));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(url + '/video', { method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body: mp4() });
    const events = (await response.text()).trim().split('\n').map(JSON.parse);
    assert.equal(events.at(-1).success, true); assert.equal(events.at(-1).persisted, false);
    assert.ok(released.every(b => b === 0)); assert.deepEqual(await repo.listPromises(), []);
    const body = { ...fixture(), sourceType: 'video_transcript', content: events.at(-1).transcript + '\nEdited by reviewer.' };
    const saved = await fetch(url + '/review/sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(saved.status, 201); const data = await saved.json();
    assert.equal((await repo.getSource(data.source.id)).content, body.content);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); repo.close(); }
});
