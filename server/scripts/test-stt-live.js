// Explicit opt-in. Transcription and model lookup only; no downstream writes.
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });
const { readFileSync, statSync } = require('node:fs');
const { createSpeechService, limits, inspectWav, SpeechError } = require('../services/speechToText');
const codes = new Set(['STT_CONFIGURATION', 'STT_URL_INVALID', 'STT_MODEL_UNAVAILABLE', 'STT_AUTH_FAILED', 'STT_TIMEOUT', 'STT_RATE_LIMITED', 'STT_AUDIO_REJECTED', 'STT_UNAVAILABLE', 'STT_RESPONSE_INVALID', 'TRANSCRIPT_TOO_LONG', 'UNSUPPORTED_AUDIO', 'INVALID_AUDIO', 'AUDIO_TOO_LARGE', 'AUDIO_TOO_LONG', 'LIVE_TEST_OPT_IN_REQUIRED', 'LIVE_TEST_DURATION_INVALID']);
let stage = 'configuration';
function diagnostic(category, code, httpStatus = null) { console.log(JSON.stringify({ category, code, httpStatus, stage })); }
(async () => {
  if (process.env.STT_LIVE_TEST !== 'true' || !process.argv[2]) throw new SpeechError('LIVE_TEST_OPT_IN_REQUIRED', 400, '');
  stage = 'file_read';
  if (statSync(process.argv[2]).size > limits().maxBytes) throw new SpeechError('AUDIO_TOO_LARGE', 413, '');
  const buffer = readFileSync(process.argv[2]);
  try {
    stage = 'wav_validation'; const audio = inspectWav(buffer, 'audio/wav');
    stage = 'live_test_duration';
    if (audio.durationSeconds < 30 || audio.durationSeconds > 60) throw new SpeechError('LIVE_TEST_DURATION_INVALID', 400, '');
    const service = createSpeechService({ onStage: value => { stage = value; } });
    await service.verifyModel('en-US_Multimedia'); diagnostic('success', 'EN_US_MULTIMEDIA_AVAILABLE', 200);
    const result = await service.transcribe(buffer, 'audio/wav');
    diagnostic(result.empty ? 'empty_result' : 'success', result.empty ? 'STT_TRANSCRIPT_EMPTY' : 'STT_TRANSCRIPTION_NONEMPTY', 200);
    if (result.empty) process.exitCode = 1;
  } finally { buffer.fill(0); }
})().catch(error => {
  diagnostic('failure', error instanceof SpeechError && codes.has(error.code) ? error.code : 'STT_TEST_FAILED', stage === 'response_parsing' ? 200 : error instanceof SpeechError ? error.httpStatus : null);
  process.exitCode = 1;
});
