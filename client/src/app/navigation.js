export const pages = ['overview', 'analyze', 'promises', 'follow-ups', 'activity', 'integrations', 'legacy'];
export function parseRoute(hash = '') {
  const [page = 'overview', encoded = ''] = hash.replace(/^#\/?/, '').split('/');
  let id = ''; try { id = decodeURIComponent(encoded); } catch { /* Invalid links show the list. */ }
  return { page: pages.includes(page) ? page : 'overview', id };
}
export const routeHref = (page, id = '') => `#/${pages.includes(page) ? page : 'overview'}${id ? '/' + encodeURIComponent(id) : ''}`;
export const sourceLabels = { meeting_note: 'Meeting notes', buyer_email: 'Buyer email', audio_transcript: 'Audio', video_transcript: 'Video', slack_thread: 'Slack' };
export const readable = value => (value || 'Unresolved').replaceAll('_', ' ');
export const dateLabel = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Unresolved';
export function safeSlackLink(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && (u.hostname === 'slack.com' || u.hostname.endsWith('.slack.com')) ? u.href : null; } catch { return null; }
}
export function metrics(promises, actions) {
  return { saved: promises?.length ?? null, review: promises ? promises.filter(p => p.status === 'needs_review').length : null,
    actions: actions ? actions.filter(a => (a.state || 'pending_review') === 'pending_review').length : null,
    replies: actions ? actions.reduce((n, a) => n + (a.slackFollowup?.replies?.length || 0), 0) : null };
}
export const eventLabels = { source_saved: 'Source saved for review', promise_updated: 'Promise reviewed', action_proposed: 'Action suggested', action_reviewed: 'Action review updated', action_approved: 'Action approved', action_rejected: 'Action rejected', approval_invalidated: 'Approval invalidated', slack_previewed: 'Slack preview prepared', slack_send_claimed: 'Slack send started', slack_send_uncertain: 'Slack send needs reconciliation', slack_sent: 'Slack message sent', slack_reply_received: 'Slack reply received', slack_reconciled: 'Slack send reconciled' };
