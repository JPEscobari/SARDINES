import { test, expect } from '@playwright/test';
const quote = 'Synthetic Cedar will send the proposal tomorrow.';
const analysis = { summary: 'Synthetic proposal review.', promises: [{ title: 'Send proposal', customerName: 'Synthetic Cedar', ownerName: null, dueAt: null, dueText: 'tomorrow', sourceQuote: quote }], actions: [{ description: 'Check proposal', ownerName: null, dueAt: null, dueText: null, sourceQuote: quote }], blockers: [{ description: 'Review pending', sourceQuote: quote }] };
async function mockApi(page, { unavailable = false, conflict = false } = {}) {
  const calls = [];
  const source = { id: 'source:synthetic', sourceType: 'meeting_note', content: quote, analysis };
  const promise = { id: 'promise:synthetic', sourceId: source.id, title: 'Send proposal', customerName: 'Synthetic Cedar', ownerName: null, dueText: 'tomorrow', dueAt: null, status: 'needs_review', sourceQuote: quote, version: 1, updatedAt: '2026-11-19T12:00:00.000Z' };
  const action = { id: 'action:synthetic', sourceId: source.id, description: 'Check proposal', ownerName: null, dueText: null, sourceQuote: quote, promiseId: null, state: 'pending_review', version: 1 };
  const replied = { ...action, id: 'action:replied', description: 'Check delivery', promiseId: promise.id, review: { title: 'Check delivery', ownerId: 'owner-test', companyId: null, dueAt: null }, slackFollowup: { status: 'replied', text: 'Synthetic follow-up', recipient: { label: 'Synthetic Jamie', userId: 'UTEST' }, sentAt: '2026-11-19T12:00:00.000Z', permalink: 'https://synthetic.slack.com/archives/DTEST/p1700000000000001', replies: [{ eventId: 'EvTEST', text: 'Checking stock; not complete.', userId: 'UTEST', receivedAt: '2026-11-19T12:30:00.000Z' }] } };
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    let body; try { body = request.postDataJSON(); } catch { /* Binary media. */ }
    calls.push({ path, method, body });
    const json = (data, status = 200) => route.fulfill({ status, json: { success: status < 400, ...data } });
    if (unavailable && ['/api/review/promises', '/api/review/actions', '/api/review/audit-events', '/api/ready'].includes(path)) return json({ error: 'Synthetic service unavailable' }, 503);
    if (path === '/api/ready') return json({ backend: 'cloudant', ready: true, scope: 'database_read' });
    if (path === '/api/review/promises') return json({ backend: 'cloudant', promises: [promise], approvalEnabled: false });
    if (path === '/api/review/actions') return json({ actions: [action, replied], approvalEnabled: false, executionEnabled: false });
    if (path === '/api/review/audit-events') return json({ events: [{ id: 'event:1', entityId: promise.id, event: 'promise_updated', createdAt: '2026-11-19T12:00:00.000Z', actorType: 'unauthenticated_local', changedFields: ['title'] }, { id: 'event:2', entityId: replied.id, event: 'slack_reply_received', createdAt: '2026-11-19T12:30:00.000Z', actorType: 'system', changedFields: [] }] });
    if (path === '/api/review/slack-recipients') return json({ recipients: [{ userId: 'UTEST', ownerId: 'owner-test', label: 'Synthetic Jamie' }], sendEnabled: false });
    if (path.startsWith('/api/review/sources/')) return json({ source });
    if (path === '/api/ingest') return json({ analysis, persisted: false });
    if (path === '/api/review/sources' && method === 'POST') { Object.assign(source, { content: body.content, sourceType: body.sourceType }); return json({ source, promises: [promise], actions: [action], persisted: true, duplicate: false }, 201); }
    if (path.startsWith('/api/review/promises/') && method === 'PATCH') {
      if (conflict) return json({ code: 'VERSION_CONFLICT', error: 'stale' }, 409);
      Object.assign(promise, body, { version: promise.version + 1 }); return json({ promise });
    }
    if (path.endsWith('/slack-preview')) { action.version++; action.slackFollowup = { status: 'preview', text: 'Synthetic preview only.', recipient: { label: 'Synthetic Jamie', userId: 'UTEST' }, replies: [] }; return json({ action }); }
    if (path.startsWith('/api/review/actions/') && method === 'PATCH') { action.promiseId = body.promiseId; action.review = body; action.version++; return json({ action }); }
    if (path.startsWith('/api/transcribe')) {
      const data = { success: true, transcript: quote, empty: false, segments: [{ text: quote }], audio: { durationSeconds: 15 }, model: 'Mock STT', persisted: false };
      return path.endsWith('/video') ? route.fulfill({ contentType: 'application/x-ndjson', body: [{ stage: 'extracting' }, { stage: 'transcribing' }, data].map(JSON.stringify).join('\n') + '\n' }) : json(data);
    }
    return json({ error: 'Unexpected test request' }, 404);
  });
  return calls;
}

test('overview, six-page navigation, deep links, history and read-only activity', async ({ page }) => {
  const calls = await mockApi(page); await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page.locator('.metric strong')).toHaveText(['1', '1', '2', '1']);
  await page.getByRole('link', { name: 'Promises', exact: true }).click();
  await page.getByRole('link', { name: 'Send proposal', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Promise detail' })).toBeVisible();
  await page.goBack(); await expect(page.getByRole('heading', { name: 'Promise detail' })).toHaveCount(0);
  await page.goForward(); await expect(page.getByRole('heading', { name: 'Promise detail' })).toBeVisible();
  await page.getByRole('link', { name: 'Activity', exact: true }).click();
  await expect(page.getByText('Slack reply received', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Check delivery', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Check delivery', exact: true })).toBeVisible();
  expect(calls.every(c => c.method === 'GET')).toBeTruthy();
  expect(calls.some(c => /\/api\/(chat|tasks|decisions)/.test(c.path))).toBeFalsy();
});

for (const [tab, type, media] of [['Meeting Notes', 'meeting_note'], ['Buyer Email', 'buyer_email'], ['Audio / Voice Memo', 'audio_transcript', 'wav'], ['Video Upload', 'video_transcript', 'mp4']]) {
  test(`${tab}: explicit analysis/save, exact edited text and stale result invalidation`, async ({ page }) => {
    const calls = await mockApi(page); await page.goto('/#/analyze');
    await page.getByRole('tab', { name: tab, exact: true }).click();
    const editor = page.getByRole('textbox', { name: media ? 'Editable Transcript' : tab === 'Buyer Email' ? 'Buyer email' : 'Meeting notes', exact: true });
    if (media) {
      await page.locator('input[type=file]').setInputFiles({ name: `synthetic.${media}`, mimeType: media === 'mp4' ? 'video/mp4' : 'audio/wav', buffer: Buffer.from('synthetic fixture; transport mocked') });
      await expect(page.getByText(`Selected: synthetic.${media}`, { exact: false })).toBeVisible();
      await page.getByRole('button', { name: 'Transcribe', exact: true }).click();
      await expect(editor).toHaveValue(quote);
    }
    await editor.fill(quote + '\nReviewed wording.');
    await page.getByRole('link', { name: 'Overview', exact: true }).click();
    await page.getByRole('link', { name: 'Analyze', exact: true }).click();
    await expect(editor).toHaveValue(quote + '\nReviewed wording.');
    await page.getByRole('button', { name: media ? 'Analyze Transcript' : 'Analyze', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save for Review' })).toBeEnabled();
    expect(calls.some(c => c.path === '/api/review/sources' && c.method === 'POST')).toBeFalsy();
    await page.getByRole('button', { name: 'Save for Review' }).click();
    await expect(page.getByText('Saved for review in the Promise Queue.')).toBeVisible();
    expect(calls.find(c => c.path === '/api/review/sources' && c.method === 'POST').body).toMatchObject({ sourceType: type, content: quote + '\nReviewed wording.' });
    await editor.fill(quote + ' Changed again.');
    await expect(page.getByRole('button', { name: 'Save for Review' })).toHaveCount(0);
    await page.getByRole('tab', { name: tab === 'Buyer Email' ? 'Meeting Notes' : 'Buyer Email', exact: true }).click();
    await expect(page.locator('#ingestion-content')).toHaveValue('');
  });
}

test('Promise review conflicts keep edits visible and never retry automatically', async ({ page }) => {
  const calls = await mockApi(page, { conflict: true }); await page.goto('/#/promises/promise%3Asynthetic');
  await page.getByRole('button', { name: 'Review fields' }).click();
  await page.getByRole('textbox', { name: 'Promise title', exact: true }).fill('Edited proposal');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('This record changed since you opened it.', { exact: false })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Promise title', exact: true })).toHaveValue('Edited proposal');
  expect(calls.filter(c => c.method === 'PATCH')).toHaveLength(1);
  expect(calls.find(c => c.method === 'PATCH').body.version).toBe(1);
});

test('Action association, owner mapping, persisted review and preview; approval remains disabled', async ({ page }) => {
  const calls = await mockApi(page); await page.goto('/#/follow-ups/action%3Asynthetic');
  await page.getByLabel('Associated Promise', { exact: true }).selectOption('promise:synthetic');
  await page.getByLabel('Development owner mapping').selectOption('owner-test');
  await page.getByLabel('Reviewed task title').fill('Reviewed proposal action');
  await page.getByRole('button', { name: 'Save action review' }).click();
  await expect(page.getByLabel('Reviewed task title')).toHaveValue('Reviewed proposal action');
  await page.getByLabel('Allowlisted recipient').selectOption('UTEST');
  await page.getByRole('button', { name: 'Prepare Slack preview' }).click();
  await expect(page.getByText('Synthetic preview only.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve action', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Reject action', exact: true })).toBeDisabled();
  expect(calls.filter(c => c.method === 'POST').map(c => c.path)).toEqual(['/api/review/actions/action%3Asynthetic/slack-preview']);
});

test('replied Action shows evidence and safe Slack link, cannot resend or edit', async ({ page }) => {
  await mockApi(page); await page.goto('/#/follow-ups/action%3Areplied');
  await expect(page.getByText('Checking stock; not complete.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Prepare Slack preview' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save action review' })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Open Slack message' })).toHaveAttribute('href', 'https://synthetic.slack.com/archives/DTEST/p1700000000000001');
  await expect(page.getByText('Replies do not mark the Promise completed.', { exact: false })).toBeVisible();
});

test('unavailable metrics are not zero; integration readiness is scoped', async ({ page }) => {
  await mockApi(page, { unavailable: true }); await page.goto('/');
  await expect(page.locator('.metric strong')).toHaveText(['Unavailable', 'Unavailable', 'Unavailable', 'Unavailable']);
  await page.getByRole('link', { name: 'Integrations', exact: true }).click();
  await expect(page.getByText('Pending integration', { exact: true })).toBeVisible();
  await expect(page.getByText('Readiness does not prove write access or a complete workflow.')).toBeVisible();
});

test('desktop and narrow layouts; synthetic screenshots', async ({ page }) => {
  await mockApi(page); await page.goto('/'); await expect(page.locator('.metric strong').first()).toHaveText('1');
  await page.screenshot({ path: 'test-results/overview-desktop.png', fullPage: true, animations: 'disabled' });
  await page.goto('/#/follow-ups/action%3Areplied');
  await expect(page.getByRole('heading', { name: 'Check delivery', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/follow-ups-desktop.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Toggle navigation' })).toBeVisible();
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.getByRole('link', { name: 'Promises', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Promises', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await expect(page.getByRole('button', { name: 'Toggle navigation' })).toHaveAttribute('aria-expanded', 'false');
  await page.screenshot({ path: 'test-results/promises-mobile.png', fullPage: true, animations: 'disabled' });
  await page.goto('/#/follow-ups/action%3Areplied');
  await expect(page.getByRole('heading', { name: 'Check delivery', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});
