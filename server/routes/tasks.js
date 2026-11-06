const express = require('express');
const router = express.Router();
const Task = require('../models/Task');

// GET /api/tasks — return all tasks sorted by createdAt
router.get('/', async (req, res) => {
  try {
    const tasks = await Task.find().sort({ createdAt: -1 });
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks — create a new task
router.post('/', async (req, res) => {
  const { title, owner, deadline, sourceMessageId } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });

  try {
    const task = await Task.create({ title, owner, deadline, sourceMessageId });
    res.status(201).json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/tasks/:id — update task status
router.patch('/:id', async (req, res) => {
  const { status } = req.body;
  const allowed = ['open', 'in-progress', 'done'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
  }

  try {
    const task = await Task.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
