const axios = require('axios');

const IAM_TOKEN_URL = 'https://iam.cloud.ibm.com/identity/token';

/**
 * Exchange the IBM Cloud API key for a short-lived IAM bearer token.
 * @returns {Promise<string>} access_token
 */
async function getIamToken() {
  const response = await axios.post(
    IAM_TOKEN_URL,
    new URLSearchParams({
      grant_type: 'urn:ibm:params:oauth:grant-type:apikey',
      apikey: process.env.WATSONX_API_KEY,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return response.data.access_token;
}

/**
 * Send a natural-language prompt to WatsonX Orchestrate and return the full reply text.
 * The Orchestrate API streams SSE chunks — we accumulate all message.delta events
 * and join them into a single string before returning.
 * @param {string} prompt - The user's message
 * @returns {Promise<string>} The agent's complete reply
 */
async function sendMessage(prompt) {
  // ── Stub mode ────────────────────────────────────────────────────────────────
  // Set WATSONX_STUB=true in .env to bypass the live API during development.
  if (process.env.WATSONX_STUB === 'true') {
    console.log('[watsonx stub] prompt:', prompt);
    // Realistic demo responses that reflect the Sales Operations Agent use case
    const responses = [
      `Based on your query, I found 3 open action items linked to this account. The last decision was made on October 15th: the team agreed to proceed with the Q4 proposal. Owner: Sarah Chen. Deadline: November 30th.`,
      `I've reviewed the meeting transcripts from the past 30 days. There are 2 unresolved follow-ups: (1) Contract renewal approval pending Legal sign-off, (2) CRM data migration blocked on IT access. Shall I create tasks for these?`,
      `Searching across your connected data sources... The Salesforce record for this account was last updated 4 days ago. The SAP ERP shows an open invoice of $24,500. No decisions logged in the past 7 days.`,
      `I found the decision you're looking for. In the October 8th meeting, the team agreed to postpone the product demo until the integration with SAP is complete. This was noted by JP and assigned to William with no firm deadline set.`,
    ];
    const reply = responses[Math.floor(Math.random() * responses.length)];
    return reply;
  }
  // ─────────────────────────────────────────────────────────────────────────────

  const token = await getIamToken();

  // Official WatsonX Orchestrate Agent Completions API
  // Source: developer.watson-orchestrate.ibm.com/webchat/get_started#agent-completions-api
  // POST {WATSONX_INSTANCE_URL}/v1/orchestrate/{agent_id}/chat/completions
  const url = `${process.env.WATSONX_INSTANCE_URL}/v1/orchestrate/${process.env.WATSONX_AGENT_ID}/chat/completions`;
  console.log('[watsonx] POST', url);

  let response;
  try {
    response = await axios.post(
      url,
      {
        messages: [{ role: 'user', content: prompt }],
        context: {},
        stream: false,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (err) {
    const status = err.response?.status;
    const body = JSON.stringify(err.response?.data);
    console.error(`[watsonx] ${status} error:`, body);
    throw new Error(`WatsonX responded ${status}: ${body}`);
  }

  // Response shape: { choices: [{ message: { content: '...' } }] }
  const reply = response.data?.choices?.[0]?.message?.content;
  if (reply) return reply;

  console.log('[watsonx] unexpected response shape:', JSON.stringify(response.data));
  return JSON.stringify(response.data);
}

module.exports = { sendMessage };
