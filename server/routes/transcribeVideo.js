const express = require('express');
const { createVideoService, videoLimits } = require('../services/videoToText');
const { SpeechError } = require('../services/speechToText');

function createVideoRouter({ env = process.env, service = createVideoService({ env }) } = {}) {
  const router = express.Router(); let active = false;
  router.post('/', (req, res, next) => {
    if (env.NODE_ENV === 'production') return res.status(503).json({ success: false, error: 'Video uploads require authenticated access before deployment', code: 'LOCAL_ONLY' });
    if (req.headers['content-type'] !== 'video/mp4' || (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')) return res.status(415).json({ success: false, error: 'Upload an MP4 file', code: 'UNSUPPORTED_VIDEO' });
    if (active) return res.status(429).json({ success: false, error: 'Another video is processing', code: 'VIDEO_BUSY' });
    let config; try { config = videoLimits(env); } catch (e) { return next(e); }
    active = true;
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', abort);
    req.setTimeout(15000, () => req.destroy());
    express.raw({ type: () => true, limit: config.maxBytes, inflate: false })(req, res, async error => {
      try {
        req.setTimeout(0); if (error) throw error;
        const result = await service.transcribe(req.body, { signal: controller.signal, onStage: stage => {
          if (res.destroyed) return;
          if (!res.headersSent) res.type('application/x-ndjson');
          res.write(JSON.stringify({ stage }) + '\n');
        } });
        if (!res.destroyed) { if (!res.headersSent) res.type('application/x-ndjson'); res.end(JSON.stringify({ success: true, ...result }) + '\n'); }
      } catch (e) { next(e); }
      finally { if (Buffer.isBuffer(req.body)) req.body.fill(0); req.body = undefined; active = false; res.off('close', abort); }
    });
  });
  router.use((error, req, res, next) => {
    if (res.destroyed) return;
    const size = error.type === 'entity.too.large', known = error instanceof SpeechError;
    const body = { success: false, code: size ? 'VIDEO_TOO_LARGE' : known ? error.code : 'VIDEO_FAILED', error: size ? 'Video exceeds the upload limit' : known ? error.message : 'Unable to process video' };
    if (res.headersSent) return res.end(JSON.stringify(body) + '\n');
    res.status(size ? 413 : known ? error.status : 400).json(body);
  });
  return router;
}
module.exports = createVideoRouter();
module.exports.createVideoRouter = createVideoRouter;
