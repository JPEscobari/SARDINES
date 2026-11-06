const mongoose = require('mongoose');

const decisionSchema = new mongoose.Schema({
  summary: {
    type: String,
    required: true,
  },
  source: {
    type: String,
    default: '',
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
  sourceMessageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
  },
});

module.exports = mongoose.model('Decision', decisionSchema);
