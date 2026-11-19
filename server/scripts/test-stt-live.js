// Explicit opt-in: transcribes only. Never extracts Promises or writes Cloudant.
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });
const { readFileSync, statSync } = require('node:fs');
const { createSpeechService, limits, inspectWav } = require('../services/speechToText');
(async () => {
  if (process.env.STT_LIVE_TEST !== 'true' || !process.argv[2]) throw new Error('Opt-in and synthetic WAV path required');
  if (statSync(process.argv[2]).size > limits().maxBytes) throw new Error('File too large');
  const buffer = readFileSync(process.argv[2]);
  try {
    const audio = inspectWav(buffer, 'audio/wav');
    if (audio.durationSeconds < 30 || audio.durationSeconds > 60) throw new Error('Live test requires a synthetic 30–60 second memo');
    const result = await createSpeechService().transcribe(buffer, 'audio/wav');
    console.log(JSON.stringify({ live: true, provider: result.provider, model: result.model, durationSeconds: audio.durationSeconds, transcriptCharacters: result.transcript.length, empty: result.empty, segments: result.segments.length, persisted: false }));
    if (result.empty) process.exitCode = 1;
  } finally { buffer.fill(0); }
})().catch(() => { console.error('Live STT check did not pass; verify opt-in, configuration, audio and service access. No credentials or transcript logged.'); process.exitCode = 1; });
