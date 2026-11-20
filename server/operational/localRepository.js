const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const workflow = require('./actionWorkflow');
const { validateEntity, validateSave, applyReview, ReviewError } = require('./validation');

// OperationalRepository contract: all public data operations return Promises.
// Adapters must preserve atomic saves/audits, idempotency, and optimistic version checks.
// No approval or execution operation is part of this interface.
class LocalRepository {
  constructor(filename, { resolveIdentities } = {}) {
    this.resolveIdentities = resolveIdentities;
    mkdirSync(path.dirname(filename), { recursive: true });
    this.backend = 'sqlite';
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, type TEXT NOT NULL, source_id TEXT, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS records_type_source ON records(type, source_id);`);
  }
  async health() { this.db.prepare('SELECT 1').get(); return { ready: true, backend: 'sqlite', scope: 'database_read' }; }
  close() { this.db.close(); }
  transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = work(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  read(id, type) {
    const row = this.db.prepare('SELECT data FROM records WHERE id=? AND type=?').get(id, type);
    return row ? validateEntity(JSON.parse(row.data)) : null;
  }
  list(type, sourceId) {
    const rows = sourceId ? this.db.prepare('SELECT data FROM records WHERE type=? AND source_id=? ORDER BY id').all(type, sourceId) : this.db.prepare('SELECT data FROM records WHERE type=? ORDER BY id').all(type);
    return rows.map(row => validateEntity(JSON.parse(row.data)));
  }
  put(record) {
    validateEntity(record);
    this.db.prepare('INSERT INTO records(id,type,source_id,data) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(record.id, record.type, record.sourceId || null, JSON.stringify(record));
    return record;
  }
  base(type, id = `${type}:${randomUUID()}`) { const now = new Date().toISOString(); return { id, type, createdAt: now, updatedAt: now, version: 1 }; }
  audit(entityId, event, changedFields = []) {
    this.put({ ...this.base('audit'), entityId, event, actorId: null, actorType: 'unauthenticated_local', changedFields });
  }
  async saveAnalysis(body) {
    validateSave(body);
    const { sourceType, content, analysis } = body;
    const contentHash = createHash('sha256').update(content).digest('hex');
    const sourceId = `source:${require('./slackSource').identity(body)}`;
    return this.transaction(() => {
      const existing = this.read(sourceId, 'source');
      if (existing) return { source: existing, promises: this.list('promise', sourceId), actions: this.list('action', sourceId), duplicate: true };
      const source = this.put({ ...this.base('source', sourceId), sourceType, content, contentHash, analysis, provenance: 'submitted_for_review', ...(body.slack ? { slack: structuredClone(body.slack) } : {}) });
      const promises = analysis.promises.map(item => this.put({ ...this.base('promise'), sourceId, ...item, extractedDueAt: item.dueAt, dueAt: null, deadlineState: 'unresolved', status: 'needs_review' }));
      const actions = analysis.actions.map(item => this.makeAction(sourceId, item));
      this.audit(sourceId, 'source_saved');
      return { source, promises, actions, duplicate: false };
    });
  }
  makeAction(sourceId, item) {
    const action = this.put({ ...this.base('action'), sourceId, promiseId: null, description: item.description, ownerName: item.ownerName, dueText: item.dueText, extractedDueAt: item.dueAt, sourceQuote: item.sourceQuote, approvalStatus: 'pending', executionStatus: 'disabled' });
    this.audit(action.id, 'action_proposed');
    return action;
  }
  async proposeAction(sourceId, item) {
    const source = await this.getSource(sourceId);
    if (!source) throw new ReviewError('Source not found', 404, 'NOT_FOUND');
    validateSave({ sourceType: source.sourceType, ...(source.slack ? { slack: source.slack } : {}), content: source.content, analysis: { summary: '', promises: [], actions: [item], blockers: [] } });
    return this.transaction(() => {
      const existing = this.list('action', sourceId).find(a => a.description === item.description && a.sourceQuote === item.sourceQuote);
      return existing || this.makeAction(sourceId, item);
    });
  }
  async getSource(id) { return this.read(id, 'source'); }
  async listPromises() { return this.list('promise'); }
  async getPromise(id) { return this.read(id, 'promise'); }
  async updatePromise(id, patch) {
    return this.transaction(() => {
      const record = this.read(id, 'promise');
      if (!record) throw new ReviewError('Promise not found', 404, 'NOT_FOUND');
      if (this.list('action', record.sourceId).some(a => a.promiseId === id && ['sending', 'uncertain'].includes(a.slackFollowup?.status))) throw new ReviewError('Reconcile pending Slack send before editing', 409);
      const updated = applyReview(record, patch);
      this.put(updated);
      for (const action of this.list('action', record.sourceId).filter(a => a.promiseId === id)) {
        const invalidated = workflow.invalidate(action, 'Linked Promise changed');
        if (invalidated.events.length) { this.put(invalidated.action); invalidated.events.forEach(e => this.put(e)); }
      }
      this.audit(id, 'promise_updated', Object.keys(patch).filter(k => k !== 'version'));
      return updated;
    });
  }
  async getAction(id) { return this.read(id, 'action'); }
  async mutateAction(id, change) {
    return this.transaction(() => {
      const current = this.read(id, 'action');
      if (!current) throw new ReviewError('Action not found', 404, 'NOT_FOUND');
      const result = change(current, this.list('promise', current.sourceId));
      if (result.events.length) { this.put(result.action); result.events.forEach(e => this.put(e)); }
      return result.action;
    });
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
  async listActions(sourceId) { return this.list('action', sourceId); }
  async listAuditEvents() { return this.list('audit'); }
}
module.exports = { LocalRepository };
