import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, routeHref, safeSlackLink, metrics } from '../src/app/navigation.js';
test('deep links round-trip typed IDs; malformed and unknown routes recover safely', () => {
  assert.deepEqual(parseRoute(routeHref('promises', 'promise:a/b')), { page: 'promises', id: 'promise:a/b' });
  assert.equal(parseRoute('#/unknown').page, 'overview');
  assert.equal(parseRoute('#/promises/%ZZ').id, '');
  assert.equal(parseRoute('').page, 'overview');
});
test('unavailable metrics remain distinct from genuine zeros', () => {
  assert.deepEqual(metrics(null, null), { saved: null, review: null, actions: null, replies: null });
  assert.deepEqual(metrics([], []), { saved: 0, review: 0, actions: 0, replies: 0 });
  assert.deepEqual(metrics([{ status: 'needs_review' }], [{ slackFollowup: { replies: [{}, {}] } }]), { saved: 1, review: 1, actions: 1, replies: 2 });
});
test('Slack links reject executable URLs, lookalike hosts and embedded credentials', () => {
  for (const url of ['javascript:alert(1)', 'https://slack.com.evil.test/a', 'http://slack.com/a', 'https://secret@slack.com/a', 'garbage']) assert.equal(safeSlackLink(url), null);
  assert.equal(safeSlackLink('https://demo.slack.com/archives/D/p1'), 'https://demo.slack.com/archives/D/p1');
});
