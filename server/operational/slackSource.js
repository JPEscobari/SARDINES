const { createHash } = require('node:crypto');
const Ajv = require('ajv');
const id = { type: 'string', pattern: '^[A-Z][A-Z0-9]{1,40}$' };
const ts = { type: 'string', pattern: '^\\d{10,}\\.\\d{6}$' };
const schema = { type: 'object', additionalProperties: false,
  required: ['teamId', 'channelId', 'threadTs', 'requestedBy', 'messages'],
  properties: { teamId: id, channelId: id, threadTs: ts, requestedBy: id,
    messages: { type: 'array', minItems: 1, maxItems: 15, items: {
      type: 'object', additionalProperties: false, required: ['ts', 'userId', 'text'],
      properties: { ts, userId: id, text: { type: 'string', minLength: 1, maxLength: 20000 } },
    } },
  } };
const check = new Ajv().compile(schema);
const transcript = slack => slack.messages.map(m => `[${m.ts}] ${m.userId}: ${m.text}`).join('\n');
function validate(body, ErrorType) {
  if (body.sourceType !== 'slack_thread') {
    if (body.slack) throw new ErrorType('Slack metadata requires a Slack source');
    return;
  }
  if (!check(body.slack) || transcript(body.slack) !== body.content || new Set(body.slack.messages.map(m => m.ts)).size !== body.slack.messages.length) throw new ErrorType('Invalid Slack source snapshot');
}
function identity(body) {
  // Requester and time-range labels do not alter identity; exact message snapshot does.
  const scope = body.slack ? JSON.stringify([body.slack.teamId, body.slack.channelId, body.slack.threadTs]) + '\0' : '';
  return createHash('sha256').update(body.sourceType + '\0' + scope + body.content).digest('hex');
}
module.exports = { schema, transcript, validate, identity };
