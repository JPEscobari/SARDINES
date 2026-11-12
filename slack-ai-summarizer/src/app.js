'use strict';

require('dotenv').config();

const { App } = require('@slack/bolt');
const { WebClient } = require('@slack/web-api');
const { buildSummaryModal } = require('./slack/modal');
const { fetchThreadMessages } = require('./slack/threadReader');
const { summarizeSlackMessages } = require('./services/watsonx');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

// User token client — used to read threads the bot may not have access to.
const readerClient = new WebClient(process.env.SLACK_USER_TOKEN);

// ---------------------------------------------------------------------------
// Shortcut: open the time-range picker modal
// ---------------------------------------------------------------------------
app.shortcut('summarize_conversation', async ({ ack, body, client }) => {
  await ack();

  const channelId = body.channel.id;
  const message = body.message;
  const threadTs = message.thread_ts || message.ts;

  await client.views.open({
    trigger_id: body.trigger_id,
    view: buildSummaryModal(channelId, threadTs),
  });
});

// ---------------------------------------------------------------------------
// Modal submission: generate the summary asynchronously
// ---------------------------------------------------------------------------
app.view('summary_submit', async ({ ack, body, view, client }) => {
  const hours = parseInt(
    view.state.values.range_block.time_range.selected_option.value,
    10,
  );

  const metadata = JSON.parse(view.private_metadata);

  // Slack requires acknowledgment within 3 seconds.
  await ack();

  const userId = body.user.id;

  console.log(
    `Summary requested: channel=${metadata.channel_id} thread=${metadata.thread_ts} hours=${hours}`,
  );

  // Fire-and-forget — do not await so the handler returns quickly.
  generateAndSendSummary(client, metadata.channel_id, metadata.thread_ts, userId, hours).catch(
    (err) => console.error('Unhandled error in generateAndSendSummary:', err),
  );
});

// ---------------------------------------------------------------------------
// Core: fetch messages → call Granite → deliver DM to the requesting user
// ---------------------------------------------------------------------------
async function generateAndSendSummary(client, channelId, threadTs, userId, hours) {
  try {
    console.log('1. Fetching Slack messages...');

    const messages = await fetchThreadMessages(readerClient, channelId, threadTs, hours);

    console.log(`2. Retrieved ${messages.length} messages.`);

    let summary;
    if (messages.length === 0) {
      summary = 'No messages found in the selected time range.';
    } else {
      console.log('3. Calling IBM Granite...');
      summary = await summarizeSlackMessages(messages);
      console.log('4. IBM summary generated!');
    }

    await client.chat.postMessage({
      channel: userId,
      text:
        ':sparkles: *AI Conversation Summary*\n' +
        `*Time range:* Last ${hours} hours\n` +
        `*Messages analyzed:* ${messages.length}\n\n` +
        summary,
    });

    console.log('5. Summary sent to Slack!');
  } catch (err) {
    console.error('Summary generation failed:', err);

    try {
      await client.chat.postMessage({
        channel: userId,
        text:
          ':warning: *AI Summary failed*\n' +
          'Check the local application logs. No summary was generated.',
      });
    } catch (notifyErr) {
      console.error('Unable to send error notification:', notifyErr);
    }
  }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
(async () => {
  await app.start();
  console.log('Starting Slack AI Summarizer...');
})();
