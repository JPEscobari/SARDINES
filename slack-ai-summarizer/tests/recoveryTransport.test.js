const { createRecoveryTransport } = require('../src/slack/recoveryTransport');
const { checkSlackReadiness, requiredScopes } = require('../src/slack/readiness');
function setup() {
  const recipient = { teamId: 'TTEST', userId: 'UTEST' };
  const client = { auth: { test: jest.fn().mockResolvedValue({ ok: true, team_id: 'TTEST', user_id: 'UBOT', response_metadata: { scopes: requiredScopes } }) },
    users: { info: jest.fn().mockResolvedValue({ ok: true, user: { id: 'UTEST', team_id: 'TTEST' } }) },
    conversations: { info: jest.fn().mockResolvedValue({ ok: true, channel: { id: 'DTEST', is_im: true, user: 'UTEST' } }),
      replies: jest.fn().mockResolvedValue({ ok: true, messages: [{ ts: '1700000000.000001' }] }) } };
  return { client, recipient, transport: createRecoveryTransport(client) };
}
test('read-only transport validates DM recipient and retrieves all pages', async () => {
  const { client, recipient, transport } = setup();
  client.conversations.replies.mockResolvedValueOnce({ ok: true, messages: [{ ts: '1700000000.000001' }], has_more: true, response_metadata: { next_cursor: 'next' } });
  const result = await transport.readThread(recipient, 'DTEST', '1700000000.000001');
  expect(result.botUserId).toBe('UBOT'); expect(client.conversations.replies).toHaveBeenCalledTimes(2);
  expect(client.conversations.replies.mock.calls[1][0].cursor).toBe('next');
});
test('wrong DM and incomplete pagination fail without mutation methods', async () => {
  const { client, recipient, transport } = setup();
  client.conversations.info.mockResolvedValueOnce({ ok: true, channel: { id: 'DTEST', is_im: true, user: 'UOTHER' } });
  await expect(transport.readThread(recipient, 'DTEST', '1700000000.000001')).rejects.toThrow();
  client.conversations.replies.mockResolvedValue({ ok: true, messages: [], has_more: true });
  await expect(transport.readThread(recipient, 'DTEST', '1700000000.000001')).rejects.toThrow('pagination');
});
test('readiness verifies granted scopes and recipient, never claims subscription is enabled', async () => {
  const { client, recipient } = setup();
  const ready = await checkSlackReadiness(client, recipient, { SARDINES_SLACK_TEAM_ID: 'TTEST' });
  expect(ready.apiReady).toBe(true); expect(ready.writes).toBe(0); expect(ready.eventSubscription).toContain('Verify');
  client.auth.test.mockResolvedValue({ ok: true, team_id: 'TTEST', response_metadata: { scopes: ['chat:write'] } });
  const blocked = await checkSlackReadiness(client, recipient, { SARDINES_SLACK_TEAM_ID: 'TTEST' });
  expect(blocked.apiReady).toBe(false); expect(blocked.missingScopes).toContain('im:history'); expect(blocked.recipientVerified).toBe(false);
});
test('rate limits/timeouts propagate rather than accepting partial reply evidence', async () => {
  const { client, recipient, transport } = setup();
  client.conversations.replies.mockRejectedValue(new Error('rate limited'));
  await expect(transport.readThread(recipient, 'DTEST', '1700000000.000001')).rejects.toThrow('rate limited');
});
