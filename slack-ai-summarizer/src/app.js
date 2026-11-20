'use strict';

require('dotenv').config();
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });

const { App } = require('@slack/bolt');
const { WebClient } = require('@slack/web-api');
const { buildSummaryModal } = require('./slack/modal');
const { fetchThreadMessages } = require('./slack/threadReader');
const { summarizeSlackMessages } = require('./services/watsonx');

const { createSardinesSave } = require('./slack/sardinesSave');
const { extractPromises } = require('../../server/services/promiseExtractor');
const { getRepository } = require('../../server/operational/repository');
const saver = createSardinesSave({ extract: extractPromises, repository: getRepository });

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
  generateAndSendSummary(client, metadata.channel_id, metadata.thread_ts, userId, hours, body.team?.id).catch(
    () => console.error('Summary task failed'),
  );
});

// ---------------------------------------------------------------------------
// Core: fetch messages → call Granite → deliver DM to the requesting user
// ---------------------------------------------------------------------------
async function generateAndSendSummary(client, channelId, threadTs, userId, hours, teamId) {
  try {
    console.log('1. Fetching Slack messages...');

    const messages = await fetchThreadMessages(readerClient, channelId, threadTs, hours, true);

    console.log(`2. Retrieved ${messages.length} messages.`);

    let summary;
    if (messages.length === 0) {
      summary = 'No messages found in the selected time range.';
    } else {
      console.log('3. Calling IBM Granite...');
      summary = await summarizeSlackMessages(messages);
      console.log('4. IBM summary generated!');
    }

    const text = ':sparkles: *AI Conversation Summary*\n' +
      `*Time range:* Last ${hours} hours\n*Messages analyzed:* ${messages.length}\n\n` + summary;
    const offer = saver.offer({ teamId, channelId, threadTs, requestedBy: userId,
      messages: messages.map(m => ({ ts: m.ts, userId: m.user, text: m.text })) });
    const blocks = offer ? [
      ...Array.from({ length: Math.ceil(text.length / 2900) }, (_, i) => ({ type: 'section', text: { type: 'mrkdwn', text: text.slice(i * 2900, (i + 1) * 2900) } })),
      { type: 'context', elements: [{ type: 'plain_text', text: 'Save original messages to the development review queue. Nothing is saved automatically. Available for 30 minutes.' }] }, offer,
    ] : undefined;
    await client.chat.postMessage({ channel: userId, text, ...(blocks ? { blocks } : {}) });

    console.log('5. Summary sent to Slack!');
  } catch (err) {
    console.error('Summary generation failed');

    try {
      await client.chat.postMessage({
        channel: userId,
        text:
          ':warning: *AI Summary failed*\n' +
          'Check the local application logs. No summary was generated.',
      });
    } catch (notifyErr) {
      console.error('Unable to send error notification');
    }
  }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.action('sardines_save', async ({ ack, body, action, respond }) => {
  await ack();
  try {
    const result = await saver.save(action.value, body.team?.id, body.user?.id);
    await respond({ response_type: 'ephemeral', replace_original: false,
      text: `${result.duplicate ? 'Already saved' : 'Saved'} to SARDINES (${result.promises.length} promises, ${result.actions.length} actions). Refresh Promise Queue and Action Review.` });
  } catch {
    await respond({ response_type: 'ephemeral', replace_original: false, text: 'Save failed or unavailable. Check development access and snapshot expiry; retry is safe.' });
  }
});

app.event('message', async ({ body }) => {
  if (process.env.NODE_ENV === 'production' || body.team_id !== process.env.SARDINES_SLACK_TEAM_ID) return;
  const followup = require('../../server/integrations/slackFollowup');
  if (!followup.directory().some(r => r.teamId === body.team_id && r.userId === body.event?.user)) return;
  try { await followup.receiveReply(getRepository(), body); }
  catch { console.error('Slack reply storage failed; use recoverFollowup.js to inspect and confirm replay from Slack history'); }
});

if (require.main === module) (async () => {
  await app.start();
  console.log('Starting Slack AI Summarizer...');
})();
