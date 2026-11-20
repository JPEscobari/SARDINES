const text = { type: 'string', minLength: 1, maxLength: 20000 };
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
const recipient = object({ teamId: text, userId: text, ownerId: text, label: text });
module.exports = object({ id: text, status: { enum: ['preview', 'sending', 'sent', 'uncertain', 'replied'] },
  recipient, text, snapshot: text, payloadHash: text, confirmedBy: text, confirmedAt: text,
  permalink: { type: 'string', pattern: '^https://[a-zA-Z0-9-]+\\.slack\\.com/' }, channelId: text, messageTs: text, sentAt: text,
  replies: { type: 'array', maxItems: 100, items: object({ eventId: text, ts: text, userId: text, text, receivedAt: text }) },
}, ['id', 'status', 'recipient', 'text', 'snapshot', 'payloadHash', 'replies']);
