'use strict';

const { fetchThreadMessages } = require('../src/slack/threadReader');

function makeMsg(tsSeconds, text, user = 'U1') {
  return { ts: String(tsSeconds), text, user };
}

describe('fetchThreadMessages', () => {
  const now = Math.floor(Date.now() / 1000);

  test('returns messages within the time window in chronological order', async () => {
    const recentTs = now - 3600; // 1 hour ago
    const oldTs = now - 90000;   // ~25 hours ago

    const mockClient = {
      conversations: {
        replies: jest.fn().mockResolvedValue({
          messages: [
            makeMsg(recentTs, 'Recent message', 'U1'),
            makeMsg(oldTs, 'Old message', 'U2'),
          ],
          has_more: false,
        }),
      },
    };

    const result = await fetchThreadMessages(mockClient, 'C1', 'ts', 24);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Recent message');
    expect(result[0].user).toBe('U1');
  });

  test('filters out messages without text', async () => {
    const recentTs = now - 100;

    const mockClient = {
      conversations: {
        replies: jest.fn().mockResolvedValue({
          messages: [
            makeMsg(recentTs, '', 'U1'),
            makeMsg(recentTs, null, 'U2'),
            makeMsg(recentTs, 'Valid message', 'U3'),
          ],
          has_more: false,
        }),
      },
    };

    const result = await fetchThreadMessages(mockClient, 'C1', 'ts', 24);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Valid message');
  });

  test('returns messages sorted chronologically', async () => {
    const t1 = now - 7200;
    const t2 = now - 3600;
    const t3 = now - 1800;

    const mockClient = {
      conversations: {
        replies: jest.fn().mockResolvedValue({
          messages: [
            makeMsg(t3, 'Third', 'U3'),
            makeMsg(t1, 'First', 'U1'),
            makeMsg(t2, 'Second', 'U2'),
          ],
          has_more: false,
        }),
      },
    };

    const result = await fetchThreadMessages(mockClient, 'C1', 'ts', 24);
    expect(result.map((m) => m.text)).toEqual(['First', 'Second', 'Third']);
  });

  test('throws when thread has more messages (pagination required)', async () => {
    const mockClient = {
      conversations: {
        replies: jest.fn().mockResolvedValue({
          messages: [],
          has_more: true,
        }),
      },
    };

    await expect(fetchThreadMessages(mockClient, 'C1', 'ts', 24)).rejects.toThrow(
      'Pagination is required',
    );
  });

  test('uses Unknown when msg.user is missing', async () => {
    const recentTs = now - 100;

    const mockClient = {
      conversations: {
        replies: jest.fn().mockResolvedValue({
          messages: [{ ts: String(recentTs), text: 'Hi' }],
          has_more: false,
        }),
      },
    };

    const result = await fetchThreadMessages(mockClient, 'C1', 'ts', 24);
    expect(result[0].user).toBe('Unknown');
  });

  test('time field is an ISO 8601 string', async () => {
    const recentTs = now - 100;

    const mockClient = {
      conversations: {
        replies: jest.fn().mockResolvedValue({
          messages: [makeMsg(recentTs, 'Hello', 'U1')],
          has_more: false,
        }),
      },
    };

    const result = await fetchThreadMessages(mockClient, 'C1', 'ts', 24);
    expect(result[0].time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
