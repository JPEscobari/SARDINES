'use strict';

const MAX_MESSAGES = 15;

/**
 * Fetch and filter thread messages within a time window.
 *
 * Uses the User OAuth Token client so the bot can read private channels
 * and threads it has been invited to, mirroring the Python implementation.
 *
 * @param {import('@slack/web-api').WebClient} readerClient  User token client
 * @param {string} channelId
 * @param {string} threadTs  Slack timestamp of the root message
 * @param {number} hours     Look-back window in hours
 * @returns {Promise<Array<{time: string, user: string, text: string}>>}
 */
async function fetchThreadMessages(readerClient, channelId, threadTs, hours) {
  const cutoff = Date.now() / 1000 - hours * 3600;

  const response = await readerClient.conversations.replies({
    channel: channelId,
    ts: threadTs,
    limit: MAX_MESSAGES,
  });

  if (
    response.has_more ||
    (response.response_metadata && response.response_metadata.next_cursor)
  ) {
    throw new Error(
      'Thread is too long for this MVP. Pagination is required.',
    );
  }

  const messages = (response.messages || [])
    .filter((msg) => parseFloat(msg.ts) >= cutoff && msg.text)
    .map((msg) => ({
      time: new Date(parseFloat(msg.ts) * 1000).toISOString(),
      user: msg.user || 'Unknown',
      text: msg.text,
    }));

  return messages.sort((a, b) => (a.time < b.time ? -1 : 1));
}

module.exports = { fetchThreadMessages, MAX_MESSAGES };
