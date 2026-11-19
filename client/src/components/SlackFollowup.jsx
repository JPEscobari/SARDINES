import { useEffect, useState } from 'react';
import { Button, Select, SelectItem, InlineNotification } from '@carbon/react';
import { listSlackRecipients, previewSlackFollowup } from '../services/api';
export default function SlackFollowup({ action, onSaved }) {
  const [recipients, setRecipients] = useState([]);
  const [userId, setUserId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    listSlackRecipients().then(d => { if (active) setRecipients(d.recipients); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  async function preview() {
    setBusy(true); setError('');
    try { await previewSlackFollowup(action.id, { version: action.version, userId }); onSaved('Slack preview stored. No message was sent.'); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const f = action.slackFollowup;
  return <section aria-label="Slack follow-up">
    <h4>Slack follow-up</h4>
    <p>Prepare a preview after saving your review. Sending requires separate confirmation in the restricted local demo terminal. Slack identity is verified before sending.</p>
    <Select id={`${action.id}-recipient`} labelText="Allowlisted recipient" value={userId} disabled={busy || (f && f.status !== 'preview')}
      onChange={e => setUserId(e.target.value)}>
      <SelectItem value="" text="Select a configured recipient" />
      {recipients.filter(r => r.ownerId === action.review?.ownerId).map(r => <SelectItem key={r.userId} value={r.userId} text={`${r.label} (${r.userId})`} />)}
    </Select>
    {!recipients.length && <p>No development recipient directory configured.</p>}
    <Button kind="tertiary" disabled={busy || !userId || !action.promiseId || (f && f.status !== 'preview')} onClick={preview}>Prepare Slack preview</Button>
    {error && <InlineNotification kind="error" title="Follow-up unavailable" subtitle={error} hideCloseButton />}
    {f && <div>
      <p>Status: {f.status} · Recipient: {f.recipient.label} ({f.recipient.userId})</p>
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{f.text}</pre>
      <p>Review changes require a new preview before sending.</p>
      {f.permalink && <p><a href={f.permalink} target="_blank" rel="noreferrer">Open Slack message</a></p>}
      {f.channelId && <p>Slack channel: {f.channelId} · Message: {f.messageTs} · Sent: {f.sentAt}</p>}
      {['sending', 'uncertain'].includes(f.status) && <p>Do not resend. Reconcile the existing attempt with Slack before making changes.</p>}
      {f.replies.map(r => <blockquote key={r.eventId}>{r.text}<p>Reply from {r.userId} · Received {r.receivedAt} · Slack timestamp {r.ts}</p></blockquote>)}
      <p>Replies do not mark the Promise completed. Refresh actions to retrieve updates.</p>
    </div>}
  </section>;
}
