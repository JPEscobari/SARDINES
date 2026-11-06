const express = require('express');
const router = express.Router();
const Decision = require('../models/Decision');

// GET /api/decisions — return all decisions sorted by timestamp
router.get('/', async (req, res) => {
  try {
    const decisions = await Decision.find().sort({ timestamp: -1 });
    res.json(decisions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/decisions — create a new decision
router.post('/', async (req, res) => {
  const { summary, source, sourceMessageId } = req.body;
  if (!summary) return res.status(400).json({ error: 'summary is required' });

  try {
    const decision = await Decision.create({ summary, source, sourceMessageId });
    res.status(201).json(decision);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
