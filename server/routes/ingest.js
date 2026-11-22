const express = require('express');
const { extractPromises } = require('../services/promiseExtractor');
const router = express.Router();
const safeCodes = new Set(['CONFIGURATION_ERROR', 'IBM_AUTH_FAILED', 'IBM_REQUEST_FAILED',
  'IBM_RESPONSE_INVALID', 'INVALID_ANALYSIS_JSON', 'INVALID_ANALYSIS_SCHEMA', 'EVIDENCE_MISMATCH']);

// Mounted before the general parser so byte limits and malformed JSON are handled here.
router.post('/', express.json({ limit: '128kb' }), async (req, res) => {
  if (!req.is('application/json')) {
    return res.status(415).json({ error: 'Content-Type must be application/json' });
  }
  const { content, sourceType } = req.body || {};
  if (!['meeting_note', 'buyer_email', 'audio_transcript', 'video_transcript', 'slack_message'].includes(sourceType)) {
    return res.status(400).json({ error: 'sourceType must be meeting_note, buyer_email, audio_transcript, video_transcript or slack_message' });
  }
  if (typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'content must be a non-empty string' });
  }
  if (content.length > 20000) {
    return res.status(400).json({ error: 'content exceeds 20000 characters' });
  }
  try {
    const analysis = await extractPromises(content);
    return res.json({ success: true, sourceType, analysis, persisted: false });
  } catch (err) {
    const code = safeCodes.has(err.code) ? err.code : 'EXTRACTION_FAILED';
    // Never log exception messages, source text, response bodies, or axios configs.
    console.error(JSON.stringify({ event: 'ingest_failed', code }));
    return res.status(code === 'CONFIGURATION_ERROR' ? 503 : 502).json({
      error: 'Unable to extract a valid analysis', code,
    });
  }
});
router.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(400).json({ error: 'Request body exceeds 128kb' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  return res.status(400).json({ error: 'Unable to read JSON body' });
});
module.exports = router;
