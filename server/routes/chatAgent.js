const express = require('express');
const { sendMessage } = require('../services/watsonx.service');

const router = express.Router();

// Conversational chat with the Orchestrate agent — no extraction wrapper.
// Returns the agent's raw reply as plain text so the assistant UI can display it directly.
router.post('/', express.json({ limit: '32kb' }), async (req, res) => {
  if (!req.is('application/json')) {
    return res.status(415).json({ error: 'Content-Type must be application/json' });
  }
  const { message } = req.body || {};
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message must be a non-empty string' });
  }
  if (message.length > 20000) {
    return res.status(400).json({ error: 'message exceeds 20000 characters' });
  }
  try {
    const reply = await sendMessage(message);
    return res.json({ success: true, reply });
  } catch (err) {
    const safe = ['CONFIGURATION_ERROR', 'IBM_AUTH_FAILED', 'IBM_REQUEST_FAILED', 'IBM_RESPONSE_INVALID'];
    const code = safe.includes(err.code) ? err.code : 'AGENT_FAILED';
    console.error(JSON.stringify({ event: 'chat_agent_failed', code }));
    return res.status(code === 'CONFIGURATION_ERROR' ? 503 : 502).json({
      error: 'The agent could not respond', code,
    });
  }
});

router.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(400).json({ error: 'Request body exceeds 32kb' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  return res.status(400).json({ error: 'Unable to read JSON body' });
});

module.exports = router;
