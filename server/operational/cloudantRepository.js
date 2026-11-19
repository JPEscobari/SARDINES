const { createHash, randomUUID } = require('node:crypto');
const workflow = require('./actionWorkflow');
const { validateSave, validateEntity, applyReview, ReviewError } = require('./validation');
const base = (type, id = `${type}:${randomUUID()}`) => { const now = new Date().toISOString(); return { id, type, createdAt: now, updatedAt: now, version: 1 }; };
const audit = (entityId, event, changedFields = []) => ({ ...base('audit'), entityId, event, changedFields, actorId: null, actorType: 'unauthenticated_local' });
const conflict = () => new ReviewError('Record changed; reload before saving', 409, 'VERSION_CONFLICT');
const sorted = records => records.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
class CloudantRepository {
  constructor(client, { maxBytes = 900000, pageSize = 10, resolveIdentities } = {}) { this.resolveIdentities = resolveIdentities; this.backend = 'cloudant'; this.client = client; this.maxBytes = maxBytes; this.pageSize = pageSize; }
  check(doc) {
    if (!doc || doc.kind !== 'sardines_source_aggregate' || doc.schemaVersion !== 1 || doc._id !== doc.source?.id || !Array.isArray(doc.promises) || !Array.isArray(doc.actions) || !Array.isArray(doc.events)) throw new Error('Invalid Cloudant aggregate');
    if (doc._conflicts?.length) throw conflict();
    validateEntity(doc.source);
    validateSave({ sourceType: doc.source.sourceType, ...(doc.source.slack ? { slack: doc.source.slack } : {}), content: doc.source.content, analysis: doc.source.analysis });
    const ids = new Set([doc.source.id]);
    for (const [records, type] of [[doc.promises, 'promise'], [doc.actions, 'action'], [doc.events, 'audit']]) {
      for (const record of records) {
        validateEntity(record);
        if (record.type !== type || ids.has(record.id)) throw new Error('Invalid aggregate relation');
        ids.add(record.id);
        if (type !== 'audit' && (record.sourceId !== doc._id || !doc.source.content.includes(record.sourceQuote))) throw new Error('Invalid aggregate evidence');
      }
    }
    if (doc.events.some(e => !ids.has(e.entityId))) throw new Error('Invalid audit relation');
    return doc;
  }
  async read(id) { const doc = await this.client.get(id); return doc ? this.check(doc) : null; }
  async all() {
    const result = []; let start = 'source:'; let skip = 0;
    while (true) {
      const page = await this.client.page(start, skip, this.pageSize);
      if (!Array.isArray(page.rows)) throw new Error('Invalid Cloudant page');
      for (const row of page.rows) { if (row.doc && !row.doc._deleted) result.push(this.check(row.doc)); }
      if (page.rows.length < this.pageSize) break;
      const next = page.rows.at(-1).id;
      if (typeof next !== 'string' || (skip && next <= start)) throw new Error('Invalid Cloudant cursor');
      start = next; skip = 1;
    }
    return result;
  }
  async write(doc) {
    this.check(doc);
    if (Buffer.byteLength(JSON.stringify(doc), 'utf8') > this.maxBytes) throw new ReviewError('Source history exceeds Cloudant aggregate capacity; no records changed', 413, 'AGGREGATE_TOO_LARGE');
    await this.client.put(doc);
  }
  result(doc, duplicate) { return { source: doc.source, promises: sorted(doc.promises), actions: sorted(doc.actions), duplicate }; }
  action(sourceId, item) { return { ...base('action'), sourceId, promiseId: null, description: item.description, ownerName: item.ownerName, dueText: item.dueText, extractedDueAt: item.dueAt, sourceQuote: item.sourceQuote, approvalStatus: 'pending', executionStatus: 'disabled' }; }
  async saveAnalysis(body) {
    validateSave(body);
    const { sourceType, content, analysis } = body;
    const id = `source:${require('./slackSource').identity(body)}`;
    const existing = await this.read(id); if (existing) return this.result(existing, true);
    const source = { ...base('source', id), sourceType, content, analysis: structuredClone(analysis), contentHash: createHash('sha256').update(content).digest('hex'), provenance: 'submitted_for_review', ...(body.slack ? { slack: structuredClone(body.slack) } : {}) };
    const promises = analysis.promises.map(item => ({ ...base('promise'), sourceId: id, ...item, extractedDueAt: item.dueAt, dueAt: null, deadlineState: 'unresolved', status: 'needs_review' }));
    const actions = analysis.actions.map(item => this.action(id, item));
    const doc = { _id: id, kind: 'sardines_source_aggregate', schemaVersion: 1, source, promises, actions, events: [...actions.map(a => audit(a.id, 'action_proposed')), audit(id, 'source_saved')] };
    try { await this.write(doc); return this.result(doc, false); }
    catch (error) {
      if (error instanceof ReviewError || error.status === 202) throw error;
      // A lost response may hide a successful commit. Deterministic identity reconciles it.
      const committed = await this.read(id);
      if (committed) return this.result(committed, true);
      throw error;
    }
  }
  async getSource(id) { return (await this.read(id))?.source || null; }
  async listPromises() { return sorted((await this.all()).flatMap(d => d.promises)); }
  async getPromise(id) { return (await this.listPromises()).find(p => p.id === id) || null; }
  async listActions(sourceId) { return sorted(sourceId ? (await this.read(sourceId))?.actions || [] : (await this.all()).flatMap(d => d.actions)); }
  async listAuditEvents() { return sorted((await this.all()).flatMap(d => d.events)); }
  async updatePromise(id, patch) {
    const p = await this.getPromise(id);
    if (!p) throw new ReviewError('Promise not found', 404, 'NOT_FOUND');
    const event = audit(id, 'promise_updated', Object.keys(patch || {}).filter(k => k !== 'version'));
    for (let attempt = 0; attempt < 3; attempt++) {
      const doc = await this.read(p.sourceId);
      if (!doc) throw new ReviewError('Promise not found', 404, 'NOT_FOUND');
      const index = doc.promises.findIndex(record => record.id === id);
      if (index < 0) throw new Error('Missing aggregate promise');
      if (doc.actions.some(a => a.promiseId === id && ['sending', 'uncertain'].includes(a.slackFollowup?.status))) throw new ReviewError('Reconcile pending Slack send before editing', 409);
      const updated = applyReview(doc.promises[index], patch);
      doc.promises[index] = updated; doc.events.push(event);
      doc.actions = doc.actions.map(a => {
        if (a.promiseId !== id) return a;
        const invalidated = workflow.invalidate(a, 'Linked Promise changed');
        doc.events.push(...invalidated.events); return invalidated.action;
      });
      try { await this.write(doc); return updated; }
      catch (error) {
        if (error instanceof ReviewError || error.status === 202) throw error;
        const latest = await this.read(p.sourceId);
        if (latest?.events.some(e => e.id === event.id)) return latest.promises.find(record => record.id === id);
        if (error.status !== 409) throw error;
        // Retry only a definite revision conflict; applyReview rechecks the caller's version.
      }
    }
    throw conflict();
  }
  async proposeAction(sourceId, item) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const doc = await this.read(sourceId);
      if (!doc) throw new ReviewError('Source not found', 404, 'NOT_FOUND');
      validateSave({ sourceType: doc.source.sourceType, ...(doc.source.slack ? { slack: doc.source.slack } : {}), content: doc.source.content, analysis: { summary: '', promises: [], actions: [item], blockers: [] } });
      const duplicate = doc.actions.find(a => a.description === item.description && a.sourceQuote === item.sourceQuote);
      if (duplicate) return duplicate;
      const action = this.action(sourceId, item); doc.actions.push(action); doc.events.push(audit(action.id, 'action_proposed'));
      try { await this.write(doc); return action; }
      catch (error) {
        if (error instanceof ReviewError || error.status === 202) throw error;
        const latest = await this.read(sourceId);
        const committed = latest?.actions.find(a => a.description === item.description && a.sourceQuote === item.sourceQuote);
        if (committed) return committed;
        if (error.status !== 409) throw error;
      }
    }
    throw conflict();
  }
  async getAction(id) { return (await this.listActions()).find(a => a.id === id) || null; }
  async mutateAction(id, change) {
    const current = await this.getAction(id);
    if (!current) throw new ReviewError('Action not found', 404, 'NOT_FOUND');
    const operationId = `audit:${randomUUID()}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const doc = await this.read(current.sourceId);
      if (!doc) throw new ReviewError('Action not found', 404, 'NOT_FOUND');
      const index = doc.actions.findIndex(a => a.id === id);
      if (index < 0) throw new ReviewError('Action not found', 404, 'NOT_FOUND');
      const result = change(doc.actions[index], doc.promises);
      if (!result.events.length) return result.action;
      result.events[0].id = operationId;
      doc.actions[index] = result.action; doc.events.push(...result.events);
      try { await this.write(doc); return result.action; }
      catch (error) {
        if (error instanceof ReviewError || error.status === 202) throw error;
        const latest = await this.read(current.sourceId);
        if (latest?.events.some(e => e.id === operationId)) return latest.actions.find(a => a.id === id);
        if (error.status !== 409) throw error;
      }
    }
    throw conflict();
  }
  async reviewAction(id, patch) { return this.mutateAction(id, (a, promises) => workflow.reviewAction(a, patch, promises)); }
  async approveAction(id, input, principal) {
    const current = await this.getAction(id);
    if (!current) throw new ReviewError('Action not found', 404, 'NOT_FOUND');
    const resolved = workflow.stateOf(current) === 'approved' ? null : await workflow.resolveApproval(current, principal, this.resolveIdentities);
    return this.mutateAction(id, (a, promises) => workflow.decideAction(a, input, promises, principal, 'approve', resolved));
  }
  async rejectAction(id, input, principal) { return this.mutateAction(id, (a, promises) => workflow.decideAction(a, input, promises, principal, 'reject')); }
  async executeAction() { workflow.executionDisabled(); }
  async health() { return this.client.health(); }
  close() {}
}
module.exports = { CloudantRepository };
