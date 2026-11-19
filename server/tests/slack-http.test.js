const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createReviewRouter } = require('../routes/review');
test('HTTP cannot forge Slack ingestion or execute follow-ups', async t => {
  let saves = 0;
  const app = express(); app.use('/api/review', createReviewRouter(() => ({ saveAnalysis: () => { saves++; } })));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close()); const base = `http://127.0.0.1:${server.address().port}/api/review`;
  const post = (route, body) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User': 'admin' }, body: JSON.stringify(body) });
  assert.equal((await post('/sources', { sourceType: 'slack_thread', content: 'spoof' })).status, 400);
  assert.equal(saves, 0);
  for (const route of ['/actions/test/slack-send', '/actions/test/execute', '/slack/reply']) assert.equal((await post(route, {})).status, 404);
  assert.equal((await post('/actions/test/approve', { version: 1, username: 'admin' })).status, 401);
});
