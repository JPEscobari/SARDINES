const mockHandlers = {};
const mockStart = jest.fn();
jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('@slack/bolt', () => ({ App: jest.fn().mockImplementation(() => ({
  shortcut: (name, handler) => { mockHandlers[name] = handler; },
  view: (name, handler) => { mockHandlers[name] = handler; },
  action: (name, handler) => { mockHandlers[name] = handler; },
  event: (name, handler) => { mockHandlers[name] = handler; }, start: mockStart,
})) }));
jest.mock('@slack/web-api', () => ({ WebClient: jest.fn() }));
jest.mock('../src/slack/threadReader', () => ({ fetchThreadMessages: jest.fn() }));
jest.mock('../src/services/watsonx', () => ({ summarizeSlackMessages: jest.fn() }));
jest.mock('../../server/services/promiseExtractor', () => ({ extractPromises: jest.fn() }));
jest.mock('../../server/operational/repository', () => ({ getRepository: jest.fn() }));
const { fetchThreadMessages } = require('../src/slack/threadReader');
const { summarizeSlackMessages } = require('../src/services/watsonx');
const { extractPromises } = require('../../server/services/promiseExtractor');
const { getRepository } = require('../../server/operational/repository');
require('../src/app');
test('existing shortcut/modal/summary preserved; save only after explicit verified callback', async () => {
  process.env.SARDINES_SLACK_TEAM_ID = 'TTEST'; process.env.SARDINES_SLACK_SAVE_USERS = 'UTEST';
  const ack = jest.fn(); const client = { views: { open: jest.fn() }, chat: { postMessage: jest.fn().mockResolvedValue({ ok: true }) } };
  await mockHandlers.summarize_conversation({ ack, body: { channel: { id: 'CTEST' }, message: { ts: '1700000000.000001' }, trigger_id: 'trigger' }, client });
  expect(client.views.open.mock.calls[0][0].view.callback_id).toBe('summary_submit');
  fetchThreadMessages.mockResolvedValue([{ time: '2023-11-14T22:13:20.000Z', ts: '1700000000.000001', user: 'UTEST', text: 'Original evidence' }]);
  summarizeSlackMessages.mockResolvedValue('AI summary');
  await mockHandlers.summary_submit({ ack, body: { user: { id: 'UTEST' }, team: { id: 'TTEST' } }, view: {
    private_metadata: JSON.stringify({ channel_id: 'CTEST', thread_ts: '1700000000.000001' }),
    state: { values: { range_block: { time_range: { selected_option: { value: '24' } } } } },
  }, client });
  await new Promise(resolve => setImmediate(resolve));
  expect(client.chat.postMessage.mock.calls[0][0].text).toContain('AI summary');
  expect(extractPromises).not.toHaveBeenCalled(); expect(mockStart).not.toHaveBeenCalled();
  const action = client.chat.postMessage.mock.calls[0][0].blocks.at(-1).elements[0];
  const respond = jest.fn();
  await mockHandlers.sardines_save({ ack, body: { user: { id: 'UOTHER' }, team: { id: 'TTEST' } }, action, respond });
  expect(extractPromises).not.toHaveBeenCalled();
  extractPromises.mockResolvedValue({ summary: '', promises: [], actions: [], blockers: [] });
  const saveAnalysis = jest.fn().mockResolvedValue({ duplicate: false, promises: [], actions: [] }); getRepository.mockReturnValue({ saveAnalysis });
  await mockHandlers.sardines_save({ ack, body: { user: { id: 'UTEST' }, team: { id: 'TTEST' } }, action, respond });
  expect(extractPromises.mock.calls[0][0]).toContain('Original evidence');
  expect(extractPromises.mock.calls[0][0]).not.toContain('AI summary');
  expect(saveAnalysis).toHaveBeenCalledTimes(1);
  delete process.env.SARDINES_SLACK_TEAM_ID; delete process.env.SARDINES_SLACK_SAVE_USERS;
});
