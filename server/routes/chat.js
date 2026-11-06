const express = require('express');
const router = express.Router();
const Conversation = require('../models/Conversation');
const { sendMessage } = require('../services/watsonx.service');

// POST /api/chat — send a message to WatsonX and persist both turns
router.post('/', async (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    // Persist user message
    const userDoc = await Conversation.create({ role: 'user', content: message.trim() });

    // Call WatsonX Orchestrate
    const reply = await sendMessage(message.trim());

    // Persist assistant response
    const assistantDoc = await Conversation.create({ role: 'assistant', content: reply });

    res.json({ reply, messageId: assistantDoc._id });
  } catch (err) {
    console.error('Chat route error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// GET /api/chat/history — return full conversation ordered by timestamp
router.get('/history', async (req, res) => {
  try {
    const history = await Conversation.find().sort({ timestamp: 1 });
    res.json(history);
  } catch (err) {
    console.error('History route error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
