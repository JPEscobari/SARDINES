'use strict';
const { randomUUID } = require('node:crypto');
const { transcript } = require('../../../server/operational/slackSource');
// Call only from Bolt's authenticated Socket Mode handlers, never from an HTTP body.
function createSardinesSave({ extract, repository, env = process.env, now = Date.now }) {
  const pending = new Map();
  const allowed = (team, user) => env.NODE_ENV !== 'production' && team === env.SARDINES_SLACK_TEAM_ID &&
    (env.SARDINES_SLACK_SAVE_USERS || '').split(',').map(s => s.trim()).filter(Boolean).includes(user);
  function offer(slack) {
    for (const [key, entry] of pending) if (entry.expires <= now()) pending.delete(key);
    if (!allowed(slack.teamId, slack.requestedBy) || !slack.messages.length || pending.size >= 100) return null;
    const content = transcript(slack);
    if (content.length > 20000) return null;
    const key = randomUUID();
    pending.set(key, { slack: structuredClone(slack), content, expires: now() + 30 * 60 * 1000 });
    return { type: 'actions', elements: [{ type: 'button', action_id: 'sardines_save', text: { type: 'plain_text', text: 'Save to SARDINES' }, value: key }] };
  }
  async function save(key, team, user) {
    const entry = pending.get(key);
    if (!allowed(team, user) || !entry || entry.expires <= now() || entry.slack.teamId !== team || entry.slack.requestedBy !== user) throw new Error('Save unavailable: identity, allowlist or snapshot expiry');
    if (!entry.operation) entry.operation = (async () => {
      const analysis = await extract(entry.content);
      return repository().saveAnalysis({ sourceType: 'slack_thread', content: entry.content, slack: entry.slack, analysis });
    })().catch(error => { entry.operation = null; throw error; });
    return entry.operation;
  }
  return { offer, save };
}
module.exports = { createSardinesSave };
