class FakeCloudant {
  constructor() { this.docs = new Map(); this.beforePut = null; this.afterPut = null; this.pages = 0; }
  async get(id) { return structuredClone(this.docs.get(id) || null); }
  async put(doc) {
    if (this.beforePut) await this.beforePut(doc);
    const current = this.docs.get(doc._id);
    if (current ? current._rev !== doc._rev : doc._rev !== undefined) throw Object.assign(new Error('conflict'), { status: 409 });
    const rev = String(Number(current?._rev || 0) + 1);
    this.docs.set(doc._id, structuredClone({ ...doc, _rev: rev }));
    if (this.afterPut) await this.afterPut(doc);
    return { ok: true, id: doc._id, rev };
  }
  async page(start, skip, limit) {
    this.pages++;
    const ids = [...this.docs.keys()].filter(id => id >= start && id <= 'source:\uffff').sort().slice(skip, skip + limit);
    return { rows: ids.map(id => ({ id, doc: structuredClone(this.docs.get(id)) })) };
  }
  async health() { return { ready: true, backend: 'cloudant', scope: 'database_read' }; }
}
const fixture = () => ({ sourceType: 'meeting_note', content: 'Acme promised a quote. Jamie will check stock tomorrow.', analysis: { summary: 'Quote', promises: [{ customerName: 'Acme', title: 'Quote', ownerName: null, dueAt: '2026-11-22', dueText: 'Thursday', sourceQuote: 'Acme promised a quote.' }], actions: [{ description: 'Check stock', ownerName: 'Jamie', dueAt: null, dueText: 'tomorrow', sourceQuote: 'Jamie will check stock tomorrow.' }], blockers: [] } });
module.exports = { FakeCloudant, fixture };
