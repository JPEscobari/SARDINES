const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  owner: {
    type: String,
    default: '',
  },
  deadline: {
    type: Date,
  },
  status: {
    type: String,
    enum: ['open', 'in-progress', 'done'],
    default: 'open',
  },
  sourceMessageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Task', taskSchema);
