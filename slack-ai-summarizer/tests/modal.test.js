'use strict';

const { buildSummaryModal, TIME_OPTIONS, option } = require('../src/slack/modal');

describe('modal', () => {
  test('option() builds a plain_text option object', () => {
    const o = option('Last 24 hours', '24');
    expect(o).toEqual({
      text: { type: 'plain_text', text: 'Last 24 hours' },
      value: '24',
    });
  });

  test('TIME_OPTIONS contains exactly 4 entries', () => {
    expect(TIME_OPTIONS).toHaveLength(4);
  });

  test('TIME_OPTIONS values are 12, 24, 72, 168', () => {
    const values = TIME_OPTIONS.map((o) => o.value);
    expect(values).toEqual(['12', '24', '72', '168']);
  });

  test('buildSummaryModal returns correct callback_id and metadata', () => {
    const modal = buildSummaryModal('C123', '1234567890.123456');

    expect(modal.callback_id).toBe('summary_submit');
    expect(modal.type).toBe('modal');

    const meta = JSON.parse(modal.private_metadata);
    expect(meta).toEqual({ channel_id: 'C123', thread_ts: '1234567890.123456' });
  });

  test('default initial_option is 24 hours', () => {
    const modal = buildSummaryModal('C1', 'ts1');
    const input = modal.blocks.find((b) => b.block_id === 'range_block');
    expect(input.element.initial_option.value).toBe('24');
  });

  test('modal has title "AI Chat Summary"', () => {
    const modal = buildSummaryModal('C1', 'ts1');
    expect(modal.title.text).toBe('AI Chat Summary');
  });

  test('submit button text is "Generate"', () => {
    const modal = buildSummaryModal('C1', 'ts1');
    expect(modal.submit.text).toBe('Generate');
  });
});
