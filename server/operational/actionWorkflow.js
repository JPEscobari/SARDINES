const { randomUUID, createHash } = require('node:crypto');
const { ReviewError, validateEntity } = require('./validation');
const fail = (message, status = 400, code = 'INVALID_REQUEST') => { throw new ReviewError(message, status, code); };
const hashPayload = payload => createHash('sha256').update(JSON.stringify(payload)).digest('hex');
const stateOf = a => a.state || 'pending_review';
const draftOf = a => a.review || { title: a.description, companyId: null, ownerId: null, dueAt: null };
function principalCheck(principal, sourceId) {
  if (!principal?.subject || principal.authenticated !== true) fail('Authenticated principal required', 401, 'AUTHENTICATION_REQUIRED');
  if (!principal.permissions?.includes('actions:approve') || !principal.sourceIds?.includes(sourceId)) fail('Action approval is not authorized for this source', 403, 'FORBIDDEN');
}
function versionCheck(a, input, keys) {
  if (['sending', 'uncertain'].includes(a.slackFollowup?.status)) fail('Reconcile pending Slack send before editing', 409, 'VERSION_CONFLICT');
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !keys.includes(k)) || !Number.isInteger(input.version)) fail('Invalid action request');
  if (input.version !== a.version) fail('Action changed; reload before saving', 409, 'VERSION_CONFLICT');
}
function dateCheck(value) {
  if (value !== null && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)) fail('Deadline must be a calendar-valid UTC ISO timestamp');
}
function event(a, kind, principal, fields = [], extra = {}) {
  const now = new Date().toISOString();
  return { id: `audit:${randomUUID()}`, type: 'audit', createdAt: now, updatedAt: now, version: 1, entityId: a.id, event: kind, actorId: principal?.subject || null, actorType: principal ? 'authenticated' : 'unauthenticated_local', changedFields: fields, ...extra };
}
function invalidate(a, reason) {
  if (stateOf(a) !== 'approved') return { action: a, events: [] };
  const next = { ...a, state: 'pending_review', approvalStatus: 'pending', approval: null, version: a.version + 1, updatedAt: new Date().toISOString() };
  return { action: next, events: [{ ...event(a, 'approval_invalidated', null, [], { reason, approvalSnapshot: a.approval }), actorType: 'system' }] };
}
function reviewAction(a, patch, promises) {
  versionCheck(a, patch, ['version', 'promiseId', 'title', 'companyId', 'ownerId', 'dueAt']);
  if (Object.keys(patch).length < 2) fail('Review fields required');
  const promiseId = 'promiseId' in patch ? patch.promiseId : a.promiseId;
  if (promiseId !== null && !promises.some(p => p.id === promiseId && p.sourceId === a.sourceId)) fail('Select a Promise from this source; cross-source linking is not supported');
  const review = { ...draftOf(a) };
  for (const k of ['title', 'companyId', 'ownerId', 'dueAt']) if (k in patch) review[k] = patch[k];
  if (typeof review.title !== 'string' || !review.title.trim()) fail('Task title is required');
  dateCheck(review.dueAt);
  const next = validateEntity({ ...a, promiseId, review, state: 'pending_review', approvalStatus: 'pending', approval: null, version: a.version + 1, updatedAt: new Date().toISOString() });
  const events = [event(a, 'action_reviewed', null, Object.keys(patch).filter(k => k !== 'version'))];
  if (stateOf(a) === 'approved') events.push(event(a, 'approval_invalidated', null, [], { reason: 'Action review changed', approvalSnapshot: a.approval }));
  return { action: next, events };
}
async function resolveApproval(a, principal, resolveIdentities) {
  principalCheck(principal, a.sourceId);
  const review = draftOf(a);
  if (!a.promiseId || !review.companyId || !review.ownerId || !review.dueAt) fail('Resolve Promise, company, owner and absolute deadline before approval');
  dateCheck(review.dueAt);
  if (!resolveIdentities) fail('Verified identity resolver is not configured', 503, 'IDENTITY_RESOLUTION_UNAVAILABLE');
  const resolved = await resolveIdentities({ companyId: review.companyId, ownerId: review.ownerId, principal });
  if (!resolved || resolved.companyId !== review.companyId || resolved.ownerId !== review.ownerId || resolved.verified !== true) fail('Company or owner could not be verified', 400, 'UNRESOLVED_IDENTITY');
  return { companyId: review.companyId, ownerId: review.ownerId, version: a.version };
}
function decideAction(a, input, promises, principal, decision, resolved) {
  principalCheck(principal, a.sourceId);
  versionCheck(a, input, decision === 'approve' ? ['version'] : ['version', 'reason']);
  if (decision === 'approve' && stateOf(a) === 'approved') return { action: a, events: [] };
  if (decision === 'reject' && stateOf(a) === 'rejected') return { action: a, events: [] };
  if (decision === 'approve' && stateOf(a) !== 'pending_review') fail('Review a rejected action before approving it');
  const now = new Date().toISOString();
  let approval = null;
  if (decision === 'approve') {
    const promise = promises.find(p => p.id === a.promiseId && p.sourceId === a.sourceId);
    if (!promise || promise.status === 'completed') fail('Select an active Promise');
    const r = draftOf(a);
    if (!resolved || resolved.version !== a.version || resolved.companyId !== r.companyId || resolved.ownerId !== r.ownerId) fail('Identity resolution is stale', 409, 'VERSION_CONFLICT');
    dateCheck(r.dueAt);
    const payload = { kind: 'hubspot_task', actionId: a.id, promiseId: a.promiseId, sourceId: a.sourceId, promiseVersion: promise.version, title: r.title, companyId: r.companyId, ownerId: r.ownerId, dueAt: r.dueAt, evidence: a.sourceQuote };
    approval = { payload, payloadHash: hashPayload(payload), approvedBy: principal.subject, approvedAt: now, actionVersion: a.version + 1 };
  } else if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 2000) fail('Rejection reason is required (maximum 2000 characters)');
  const next = validateEntity({ ...a, state: decision === 'approve' ? 'approved' : 'rejected', approvalStatus: decision === 'approve' ? 'approved' : 'rejected', approval, version: a.version + 1, updatedAt: now });
  const extra = approval ? { approvalSnapshot: structuredClone(approval) } : { reason: input.reason };
  const events = [event(a, decision === 'approve' ? 'action_approved' : 'action_rejected', principal, [], extra)];
  if (decision === 'reject' && a.approval) events.push(event(a, 'approval_invalidated', principal, [], { reason: 'Action rejected', approvalSnapshot: a.approval }));
  return { action: next, events };
}
function executionDisabled() { fail('Outbound action execution is disabled in Phase 3A', 403, 'EXECUTION_DISABLED'); }
module.exports = { stateOf, draftOf, reviewAction, resolveApproval, decideAction, invalidate, executionDisabled, hashPayload, principalCheck };
