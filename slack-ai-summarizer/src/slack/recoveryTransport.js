const { createFollowupTransport } = require('./followupTransport');
function createRecoveryTransport(client) {
  return {
    async readThread(recipient, channelId, messageTs) {
      if (!/^D[A-Z0-9]+$/.test(channelId) || !/^\d{10,}\.\d{6}$/.test(messageTs)) throw new Error('Exact DM channel and root timestamp required');
      await createFollowupTransport(client).verify(recipient);
      const auth = await client.auth.test();
      const info = await client.conversations.info({ channel: channelId });
      if (!auth.ok || auth.team_id !== recipient.teamId || !auth.user_id || !info.ok || info.channel?.id !== channelId || !info.channel.is_im || info.channel.user !== recipient.userId) throw new Error('DM identity mismatch');
      const messages = []; const seen = new Set(); let cursor;
      for (let page = 0; page < 10; page++) {
        const result = await client.conversations.replies({ channel: channelId, ts: messageTs, limit: 100, ...(cursor ? { cursor } : {}) });
        if (!result.ok || !Array.isArray(result.messages)) throw new Error('Slack thread unavailable');
        messages.push(...result.messages);
        const next = result.response_metadata?.next_cursor;
        if (!next && !result.has_more) return { botUserId: auth.user_id, messages };
        if (!next || seen.has(next)) throw new Error('Incomplete Slack pagination');
        seen.add(next); cursor = next;
      }
      throw new Error('Thread exceeds controlled recovery limit');
    },
  };
}
module.exports = { createRecoveryTransport };
