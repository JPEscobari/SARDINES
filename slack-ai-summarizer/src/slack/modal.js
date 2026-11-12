'use strict';

/**
 * Build a single static_select option object.
 * @param {string} label  Display text
 * @param {string} value  Option value
 */
function option(label, value) {
  return {
    text: { type: 'plain_text', text: label },
    value,
  };
}

const TIME_OPTIONS = [
  option('Last 12 hours', '12'),
  option('Last 24 hours', '24'),
  option('Last 72 hours', '72'),
  option('Last 7 days', '168'),
];

/**
 * Build the summary modal view payload.
 * @param {string} channelId
 * @param {string} threadTs
 * @returns {object} Slack view payload
 */
function buildSummaryModal(channelId, threadTs) {
  return {
    type: 'modal',
    callback_id: 'summary_submit',
    title: { type: 'plain_text', text: 'AI Chat Summary' },
    submit: { type: 'plain_text', text: 'Generate' },
    close: { type: 'plain_text', text: 'Cancel' },
    private_metadata: JSON.stringify({ channel_id: channelId, thread_ts: threadTs }),
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '*Summarize current thread*' },
      },
      {
        type: 'input',
        block_id: 'range_block',
        label: { type: 'plain_text', text: 'Time range' },
        element: {
          type: 'static_select',
          action_id: 'time_range',
          options: TIME_OPTIONS,
          initial_option: TIME_OPTIONS[1], // 24 hours default
        },
      },
    ],
  };
}

module.exports = { buildSummaryModal, TIME_OPTIONS, option };
