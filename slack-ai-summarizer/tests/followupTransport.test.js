const { createFollowupTransport } = require('../src/slack/followupTransport');
function setup() {
  const client = { auth: { test: jest.fn().mockResolvedValue({ ok: true, team_id: 'TTEST' }) },
    users: { info: jest.fn().mockResolvedValue({ ok: true, user: { id: 'UTEST', team_id: 'TTEST' } }) },
    conversations: { open: jest.fn().mockResolvedValue({ ok: true, channel: { id: 'DTEST' } }) },
    chat: { postMessage: jest.fn().mockResolvedValue({ ok: true, channel: 'DTEST', ts: '1700000000.000001' }) } };
  return { client, transport: createFollowupTransport(client), recipient: { teamId: 'TTEST', userId: 'UTEST' } };
}
test('verified workspace/person; explicit DM; plain message without mention parsing', async () => {
  const { client, transport, recipient } = setup();
  await transport.verify(recipient); expect(client.chat.postMessage).not.toHaveBeenCalled();
  await transport.send(recipient, 'Exact preview', 'test-id');
  expect(client.chat.postMessage).toHaveBeenCalledWith({ channel: 'DTEST', text: 'Exact preview', client_msg_id: 'test-id', mrkdwn: false, parse: 'none', unfurl_links: false, unfurl_media: false });
});
test.each([{ deleted: true }, { is_bot: true }, { is_restricted: true }, { team_id: 'TOTHER' }, { id: 'UOTHER' }])('reject unsafe recipient %j', async patch => {
  const { client, transport, recipient } = setup();
  client.users.info.mockResolvedValue({ ok: true, user: { id: 'UTEST', team_id: 'TTEST', ...patch } });
  await expect(transport.verify(recipient)).rejects.toThrow(); expect(client.chat.postMessage).not.toHaveBeenCalled();
});
