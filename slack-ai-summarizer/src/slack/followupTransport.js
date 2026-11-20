// Never use Bolt's retrying client for non-idempotent follow-up sends.
function createFollowupTransport(client) {
  return {
    async verify(recipient) {
      const auth = await client.auth.test();
      const result = await client.users.info({ user: recipient.userId });
      const user = result.user;
      if (!auth.ok || auth.team_id !== recipient.teamId || !result.ok || user?.id !== recipient.userId || user.team_id !== recipient.teamId || user.deleted || user.is_bot || user.is_app_user || user.is_restricted || user.is_ultra_restricted) throw new Error('Recipient verification failed');
    },
    async send(recipient, text, id) {
      const dm = await client.conversations.open({ users: recipient.userId });
      if (!dm.ok || !dm.channel?.id?.startsWith('D')) throw new Error('DM unavailable');
      const result = await client.chat.postMessage({ channel: dm.channel.id, text, client_msg_id: id, mrkdwn: false, parse: 'none', unfurl_links: false, unfurl_media: false });
      if (!result.ok) throw new Error('Send unconfirmed');
      try {
        const link = await client.chat.getPermalink({ channel: result.channel, message_ts: result.ts });
        const url = new URL(link.permalink);
        if (url.protocol === 'https:' && url.hostname.endsWith('.slack.com')) result.permalink = url.href;
      } catch { /* Message succeeded; a missing optional permalink never triggers resend. */ }
      return result;
    },
  };
}
module.exports = { createFollowupTransport };
