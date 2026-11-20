const { createSardinesSave } = require('../src/slack/sardinesSave');
const slack = { teamId: 'TTEST', channelId: 'CTEST', threadTs: '1700000000.000001', requestedBy: 'UTEST', messages: [{ ts: '1700000000.000001', userId: 'UTEST', text: 'Original promise' }] };
function setup() {
  const extract = jest.fn().mockResolvedValue({ summary: 'AI summary' });
  const saveAnalysis = jest.fn().mockResolvedValue({ duplicate: false });
  const env = { SARDINES_SLACK_TEAM_ID: 'TTEST', SARDINES_SLACK_SAVE_USERS: 'UTEST' };
  let time = 0;
  return { extract, saveAnalysis, env, advance: () => { time += 1800001; }, saver: createSardinesSave({ extract, repository: () => ({ saveAnalysis }), env, now: () => time }) };
}
test('explicit save only; original snapshot; concurrent clicks coalesce', async () => {
  const { saver, extract, saveAnalysis } = setup();
  const source = structuredClone(slack);
  const key = saver.offer(source).elements[0].value;
  source.messages[0].text = 'changed later';
  expect(extract).not.toHaveBeenCalled();
  await Promise.all([saver.save(key, 'TTEST', 'UTEST'), saver.save(key, 'TTEST', 'UTEST')]);
  expect(extract).toHaveBeenCalledTimes(1);
  expect(extract.mock.calls[0][0]).toContain('Original promise');
  expect(saveAnalysis).toHaveBeenCalledTimes(1);
  expect(saveAnalysis.mock.calls[0][0].slack.messages[0].text).toBe('Original promise');
});
test('allowlist, workspace, requester, expiry, production fail closed', async () => {
  const { saver, extract, env, advance } = setup();
  expect(saver.offer({ ...slack, requestedBy: 'UOTHER' })).toBeNull();
  const key = saver.offer(slack).elements[0].value;
  await expect(saver.save(key, 'TOTHER', 'UTEST')).rejects.toThrow();
  await expect(saver.save(key, 'TTEST', 'UOTHER')).rejects.toThrow();
  advance(); await expect(saver.save(key, 'TTEST', 'UTEST')).rejects.toThrow();
  env.NODE_ENV = 'production'; expect(saver.offer(slack)).toBeNull();
  expect(extract).not.toHaveBeenCalled();
});
test('failed extraction can be retried without premature save', async () => {
  const { saver, extract, saveAnalysis } = setup();
  extract.mockRejectedValueOnce(new Error('offline'));
  const key = saver.offer(slack).elements[0].value;
  await expect(saver.save(key, 'TTEST', 'UTEST')).rejects.toThrow('offline');
  expect(saveAnalysis).not.toHaveBeenCalled();
  await saver.save(key, 'TTEST', 'UTEST'); expect(saveAnalysis).toHaveBeenCalledTimes(1);
});
