const Ajv = require('ajv');
const analysisSchema = require('../schemas/analysis.schema.json');
const ajv = new Ajv({ allErrors: true });
const analysisValid = ajv.compile(analysisSchema);
class ReviewError extends Error {
  constructor(message, status = 400, code = 'INVALID_REQUEST') { super(message); this.status = status; this.code = code; }
}
const nullableText = { type: ['string', 'null'], maxLength: 20000 };
const text = { type: 'string', minLength: 1, maxLength: 20000 };
const states = ['needs_review', 'open', 'blocked', 'completed'];
const transitions = { needs_review: ['open', 'blocked'], open: ['needs_review', 'blocked', 'completed'], blocked: ['needs_review', 'open', 'completed'], completed: ['open'] };
const common = { id: text, createdAt: text, updatedAt: text, version: { type: 'integer', minimum: 1 } };
const fields = {
  source: { ...common, type: { const: 'source' }, sourceType: { enum: ['meeting_note', 'buyer_email', 'audio_transcript', 'slack_thread'] }, content: text, contentHash: text, analysis: analysisSchema, provenance: { const: 'submitted_for_review' } },
  promise: { ...common, type: { const: 'promise' }, sourceId: text, customerName: nullableText, title: text, ownerName: nullableText, dueText: nullableText, extractedDueAt: nullableText, dueAt: nullableText, deadlineState: { enum: ['unresolved', 'reviewed'] }, status: { enum: states }, sourceQuote: text },
  action: { ...common, type: { const: 'action' }, sourceId: text, promiseId: nullableText, description: text, ownerName: nullableText, dueText: nullableText, extractedDueAt: nullableText, sourceQuote: text, approvalStatus: { enum: ['pending', 'approved', 'rejected'] }, executionStatus: { const: 'disabled' } },
  audit: { ...common, type: { const: 'audit' }, entityId: text, event: { enum: ['source_saved', 'promise_updated', 'action_proposed', 'action_reviewed', 'action_approved', 'action_rejected', 'approval_invalidated', 'slack_previewed', 'slack_send_claimed', 'slack_send_uncertain', 'slack_sent', 'slack_reply_received', 'slack_reconciled'] }, actorId: nullableText, actorType: { enum: ['unauthenticated_local', 'authenticated', 'system'] }, changedFields: { type: 'array', items: text } },
};
const actionSchemas = require('./actionSchemas');
const optional = {
  source: { slack: require('./slackSource').schema },
  action: { slackFollowup: require('./slackFollowupSchema'), state: { enum: ['pending_review', 'approved', 'rejected'] }, review: actionSchemas.review, approval: { anyOf: [actionSchemas.approval, { type: 'null' }] } },
  audit: { followupSnapshot: require('./slackFollowupSchema'), approvalSnapshot: actionSchemas.approval, reason: text },
};
const validators = Object.fromEntries(Object.entries(fields).map(([type, properties]) => [type, ajv.compile({ type: 'object', additionalProperties: false, properties: { ...properties, ...optional[type] }, required: Object.keys(properties) })]));
function validateEntity(value) {
  if (!validators[value.type]?.(value)) throw new ReviewError('Invalid operational record');
  if (value.type === 'action' && value.approvalStatus === 'approved' && (!value.approval || value.state !== 'approved')) throw new ReviewError('Approval snapshot is required');
  return value;
}
function validateSave(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['sourceType', 'content', 'analysis', 'slack'].includes(k))) throw new ReviewError('Expected sourceType, content and analysis');
  if (!['meeting_note', 'buyer_email', 'audio_transcript', 'slack_thread'].includes(body.sourceType)) throw new ReviewError('Unsupported source type');
  if (typeof body.content !== 'string' || !body.content.trim() || body.content.length > 20000) throw new ReviewError('Content must contain 1 to 20000 characters');
  require('./slackSource').validate(body, ReviewError);
  if (!analysisValid(body.analysis)) throw new ReviewError('Invalid analysis schema');
  for (const item of [...body.analysis.promises, ...body.analysis.actions, ...body.analysis.blockers, ...(body.analysis.decisions || [])]) {
    if (body.slack && !body.slack.messages.some(m => m.text.includes(item.sourceQuote))) throw new ReviewError('Slack message evidence mismatch');
    if (!body.content.includes(item.sourceQuote)) throw new ReviewError('Source evidence mismatch');
  }
}
function applyReview(record, patch) {
  const allowed = ['version', 'customerName', 'title', 'ownerName', 'dueText', 'dueAt', 'status'];
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(k => !allowed.includes(k)) || Object.keys(patch).length < 2) throw new ReviewError('Invalid review fields');
  if (!Number.isInteger(patch.version) || patch.version < 1) throw new ReviewError('version is required');
  if (patch.version !== record.version) throw new ReviewError('Record changed; reload before saving', 409, 'VERSION_CONFLICT');
  if (patch.status !== undefined && patch.status !== record.status && !transitions[record.status].includes(patch.status)) throw new ReviewError('Invalid status transition');
  if (patch.dueAt !== undefined && patch.dueAt !== null) {
    // Canonical UTC ISO string only: rejects invalid calendar dates and ambiguous local times.
    if (typeof patch.dueAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(patch.dueAt) || !Number.isFinite(Date.parse(patch.dueAt)) || new Date(patch.dueAt).toISOString() !== patch.dueAt) throw new ReviewError('Deadline must be a valid UTC ISO timestamp or null');
  }
  const result = { ...record, ...patch, version: record.version + 1, updatedAt: new Date().toISOString() };
  if ('dueAt' in patch) result.deadlineState = patch.dueAt ? 'reviewed' : 'unresolved';
  // Changing relative date wording invalidates any previously resolved deadline unless explicitly supplied again.
  if ('dueText' in patch && patch.dueText !== record.dueText && !('dueAt' in patch)) { result.dueAt = null; result.deadlineState = 'unresolved'; }
  return validateEntity(result);
}
module.exports = { ReviewError, validateEntity, validateSave, applyReview, states };
