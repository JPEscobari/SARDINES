// Explicit opt-in: real STT; optional Orchestrate + one NEW synthetic Cloudant aggregate.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
const { createVideoService, videoLimits } = require('../services/videoToText');
const { createRepository } = require('../operational/repository');
const { extractPromises } = require('../services/promiseExtractor');
let stage = 'configuration';
async function main() {
  if (process.env.VIDEO_LIVE_TEST !== 'true' || !process.argv[2]) throw new Error('opt-in required');
  const save = process.env.VIDEO_LIVE_SAVE === 'true';
  if (save && (process.env.OPERATIONAL_STORE !== 'cloudant' || process.env.CLOUDANT_DATABASE !== 'sardines-dev' || process.env.WATSONX_STUB === 'true')) throw new Error('development configuration required');
  stage = 'input_validation';
  if ((await fs.stat(process.argv[2])).size > videoLimits().maxBytes) throw new Error('size');
  const buffer = await fs.readFile(process.argv[2]);
  let result;
  try { result = await createVideoService().transcribe(buffer, { onStage: value => { stage = value; } }); }
  finally { buffer.fill(0); }
  if (result.empty || !result.transcript.trim()) throw new Error('empty transcript');
  console.log(JSON.stringify({ stage: 'stt', live: true, nonempty: true, durationSeconds: result.audio.durationSeconds, persisted: false }));
  if (!save) return;
  // Models the editable-transcript boundary; UUID prevents collision with existing sources.
  const content = result.transcript + '\nReviewer note: synthetic video validation ' + randomUUID() + '. No external action authorized.';
  stage = 'orchestrate';
  // The legacy adapter logs its instance URL; keep live test output restricted to safe diagnostics.
  const originalLog = console.log; let analysis;
  try { console.log = () => {}; analysis = await extractPromises(content); } finally { console.log = originalLog; }
  console.log(JSON.stringify({ stage, live: true, validated: true, promises: analysis.promises.length, actions: analysis.actions.length }));
  stage = 'cloudant'; const repo = createRepository();
  try {
    const saved = await repo.saveAnalysis({ sourceType: 'video_transcript', content, analysis });
    const stored = await repo.getSource(saved.source.id);
    if (saved.duplicate || stored.content !== content || stored.sourceType !== 'video_transcript') throw new Error('verification');
    console.log(JSON.stringify({ stage, live: true, newSourceId: saved.source.id, exactEditedEvidence: true, promises: saved.promises.length, actions: saved.actions.length }));
  } finally { repo.close(); }
}
main().catch(error => {
  const safe = new Set(['VIDEO_TOOLS_UNAVAILABLE', 'INVALID_VIDEO', 'VIDEO_TOO_LONG', 'VIDEO_TOO_LARGE', 'VIDEO_PROCESS_FAILED', 'VIDEO_TIMEOUT', 'STT_AUTH_FAILED', 'STT_TIMEOUT', 'STT_UNAVAILABLE', 'IBM_AUTH_FAILED', 'IBM_REQUEST_FAILED', 'EVIDENCE_MISMATCH', 'INVALID_ANALYSIS_SCHEMA']);
  console.error(JSON.stringify({ stage, code: safe.has(error.code) ? error.code : 'VIDEO_LIVE_TEST_FAILED', status: Number.isInteger(error.status) ? error.status : null })); process.exitCode = 1;
});
