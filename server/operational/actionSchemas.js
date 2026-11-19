const text = { type: 'string', minLength: 1, maxLength: 20000 };
const nullable = { type: ['string', 'null'], maxLength: 20000 };
function object(properties) { return { type: 'object', additionalProperties: false, properties, required: Object.keys(properties) }; }
const payload = object({ kind: { const: 'hubspot_task' }, actionId: text, promiseId: text, sourceId: text, promiseVersion: { type: 'integer', minimum: 1 }, title: text, companyId: text, ownerId: text, dueAt: text, evidence: text });
const review = object({ title: text, companyId: nullable, ownerId: nullable, dueAt: nullable });
const approval = object({ payload, payloadHash: text, approvedBy: text, approvedAt: text, actionVersion: { type: 'integer', minimum: 1 } });
module.exports = { payload, review, approval };
