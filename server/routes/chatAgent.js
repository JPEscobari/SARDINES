const express = require('express');
const { sendMessage } = require('../services/watsonx.service');

const router = express.Router();

// Conversational chat with the Orchestrate agent — no extraction wrapper.
// Returns the agent's raw reply as plain text so the assistant UI can display it directly.
router.post('/', express.json({ limit: '128kb' }), async (req, res) => {
  if (!req.is('application/json')) {
    return res.status(415).json({ error: 'Content-Type must be application/json' });
  }
  const { message, history = [] } = req.body || {};
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message must be a non-empty string' });
  }
  if (message.length > 20000) {
    return res.status(400).json({ error: 'message exceeds 20000 characters' });
  }
  if (!Array.isArray(history)) {
    return res.status(400).json({ error: 'history must be an array' });
  }
  // Validate each history entry — only user/assistant text messages are forwarded.
  // Drop any turn whose content looks like an extraction prompt (sent by promiseExtractor)
  // so it never contaminates the agent's conversational context.
  const EXTRACTION_MARKER = 'You are a structured information extraction engine';
  const validRoles = new Set(['user', 'assistant']);
  const sanitised = history
    .filter(m => m && validRoles.has(m.role) && typeof m.content === 'string' && m.content.trim())
    .filter(m => !m.content.includes(EXTRACTION_MARKER))
    .map(m => ({ role: m.role, content: m.content.trim() }))
    .slice(-20); // cap at 20 turns to stay within context limits
  const messages = [
    // System framing prepended to every request so the agent always operates as an
    // orchestrator with access to its configured tools, regardless of prior context.
    {
      role: 'user',
      content: 'You are the orchestrator agent with access to HubSpot CRM (Create, Read, Update, Delete), Slack, and other connected agents capabilities.  Use your available agents to fulfil requests directly. Do not ask the user to perform actions you can do yourself.',
    },
    {
      role: 'assistant',
      content: 'Understood. I will use my available agents to fulfil requests directly.',
    },
    ...sanitised,
    { role: 'user', content: message.trim() },
  ];
  try {
    const reply = await sendMessage(messages);
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
