const express = require('express');
const { createSpeechService, SpeechError, limits } = require('../services/speechToText');
function createTranscribeRouter({ service = createSpeechService(), env = process.env } = {}) {
  const router = express.Router(); let active = false;
  router.post('/', (req, res, next) => {
    if (env.NODE_ENV === 'production') return res.status(503).json({ success: false, code: 'LOCAL_ONLY', error: 'Speech uploads require authenticated access before deployment' });
    if (!['audio/wav', 'audio/x-wav', 'audio/wave'].includes(req.headers['content-type']?.toLowerCase())) return res.status(415).json({ success: false, code: 'UNSUPPORTED_AUDIO', error: 'Upload a PCM WAV file' });
    if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') return res.status(415).json({ success: false, code: 'UNSUPPORTED_AUDIO', error: 'Compressed HTTP bodies are unsupported' });
    if (active) return res.status(429).json({ success: false, code: 'STT_BUSY', error: 'Another transcription is in progress' });
    let config; try { config = limits(env); } catch (e) { return next(e); }
    active = true;
    req.setTimeout(15000, () => req.destroy());
    // Only one bounded buffer exists per router. No temporary files or filenames are used.
    express.raw({ type: () => true, limit: config.maxBytes, inflate: false })(req, res, async error => {
      try {
        req.setTimeout(0);
        if (error) throw error;
        const result = await service.transcribe(req.body, req.headers['content-type'].toLowerCase());
        res.json({ success: true, ...result });
      } catch (e) { next(e); }
      finally { if (Buffer.isBuffer(req.body)) req.body.fill(0); req.body = undefined; active = false; }
    });
  });
  router.use((error, req, res, next) => {
    const size = error.type === 'entity.too.large'; const known = error instanceof SpeechError;
    res.status(size ? 413 : known ? error.status : 400).json({ success: false, code: size ? 'AUDIO_TOO_LARGE' : known ? error.code : 'TRANSCRIPTION_FAILED', error: size ? 'Audio exceeds the upload limit' : known ? error.message : 'Unable to transcribe audio' });
  });
  return router;
}
module.exports = createTranscribeRouter();
module.exports.createTranscribeRouter = createTranscribeRouter;
