import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
// Load the browser API module with only Vite's build-time constant substituted.
const source = (await readFile(new URL('../src/services/api.js', import.meta.url), 'utf8')).replace("import.meta.env.VITE_API_BASE || '/api'", "'/api'");
const api = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const file = { name: 'synthetic.mp4', size: 100 };
const result = { success: true, transcript: 'Synthetic café.', segments: [], audio: { durationSeconds: 1 } };
function stream(events) {
  const bytes = new TextEncoder().encode(events.map(JSON.stringify).join('\n') + '\n');
  return new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }));
}
test('video client parses split UTF-8/progress frames and submits exact edited transcript explicitly', async t => {
  const requests = [], stages = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return url.endsWith('/video') ? stream([{ stage: 'extracting' }, { stage: 'transcribing' }, result]) : Response.json({ success: true, analysis: { promises: [] } });
  });
  const transcript = await api.transcribeVideo(file, s => stages.push(s));
  assert.equal(transcript.transcript, result.transcript); assert.deepEqual(stages, ['extracting', 'transcribing']);
  assert.equal(requests.length, 1); // Transcription does not analyze or save.
  const edited = transcript.transcript + '\nReviewer correction.';
  const { analysis } = await api.analyzeText('video_transcript', edited);
  await api.saveForReview('video_transcript', edited, analysis);
  for (const request of requests.slice(1)) assert.equal(JSON.parse(request.options.body).content, edited);
  assert.equal(JSON.parse(requests[2].options.body).sourceType, 'video_transcript');
});
test('video client rejects incomplete streams, STT failures and invalid selection', async t => {
  t.mock.method(globalThis, 'fetch', async () => stream([{ stage: 'extracting' }, { success: false, error: 'Speech timed out' }]));
  await assert.rejects(api.transcribeVideo(file), /Speech timed out/);
  globalThis.fetch = async () => stream([{ stage: 'transcribing' }]);
  await assert.rejects(api.transcribeVideo(file), /Incomplete/);
  await assert.rejects(api.transcribeVideo({ ...file, name: 'meeting.mov' }), /MP4/);
  await assert.rejects(api.transcribeVideo({ ...file, size: 32 * 1024 * 1024 + 1 }), /32 MiB/);
});
test('WAV client preserves its existing request and response contract', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => { assert.equal(url, '/api/transcribe'); assert.equal(options.headers['Content-Type'], 'audio/wav'); return Response.json(result); });
  assert.equal((await api.transcribeAudio({ name: 'memo.wav', size: 100 })).transcript, result.transcript);
});
