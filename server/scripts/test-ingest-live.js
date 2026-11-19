const assert = require('node:assert/strict');
const Ajv = require('ajv');
const validate = new Ajv().compile(require('../schemas/analysis.schema.json'));
const base = process.env.TEST_API_BASE || 'http://localhost:5001';
const content = "Sean: We promised Acme to confirm Thursday delivery.\nJamie: I'll check the warehouse tomorrow.\nAlex: Warehouse confirmation is still pending.";
(async () => {
  const res = await fetch(`${base}/api/ingest`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceType: 'meeting_note', content }), signal: AbortSignal.timeout(90000),
  });
  const body = await res.json();
  assert.equal(res.status, 200, `HTTP ${res.status}; ${body.code || 'unexpected response'}`);
  assert.equal(body.success, true);
  assert.equal(body.sourceType, 'meeting_note');
  assert.equal(body.persisted, false);
  assert.ok(validate(body.analysis));
  for (const item of [...body.analysis.promises, ...body.analysis.actions, ...body.analysis.blockers]) {
    assert.ok(content.includes(item.sourceQuote));
  }
  console.log('Live HTTP 200; schema and evidence validation passed.');
  console.log(JSON.stringify(body, null, 2));
})().catch(() => { console.error('Live HTTP verification failed; inspect sanitized server diagnostics.'); process.exitCode = 1; });
