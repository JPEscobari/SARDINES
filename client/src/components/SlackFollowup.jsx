import { useEffect, useState } from 'react';
import { Button, Select, SelectItem, InlineNotification, InlineLoading } from '@carbon/react';
import { listSlackRecipients, previewSlackFollowup, sendSlackViaAgent } from '../services/api';
import { safeSlackLink, dateLabel, readable } from '../app/navigation';
export default function SlackFollowup({ action, onSaved }) {
  const [recipients, setRecipients] = useState([]);
  const [userId, setUserId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [agentReply, setAgentReply] = useState('');
  useEffect(() => {
    let active = true;
    listSlackRecipients().then(d => { if (active) setRecipients(d.recipients); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  async function preview() {
    setBusy(true); setError(''); setAgentReply('');
    try { await previewSlackFollowup(action.id, { version: action.version, userId }); onSaved('Slack preview stored. No message was sent.'); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function sendViaAgent() {
    setBusy(true); setError(''); setAgentReply('');
    try {
      const result = await sendSlackViaAgent(action.id);
      setAgentReply(result.reply);
    }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const f = action.slackFollowup;
  const permalink = safeSlackLink(f?.permalink);
  const locked = f && f.status !== 'preview';
  return <section aria-label="Slack follow-up">
    <h4>Slack follow-up</h4>
    {!locked && <p className="muted">Select a recipient and preview the message before sending.</p>}
    <details open={!locked}><summary>{locked ? 'Preview controls (sending already started)' : 'Prepare a preview'}</summary>
    <Select id={`${action.id}-recipient`} labelText="Recipient" value={userId} disabled={busy || (f && f.status !== 'preview')}
      onChange={e => setUserId(e.target.value)}>
      <SelectItem value="" text="Select a recipient" />
      {recipients.filter(r => r.ownerId === action.review?.ownerId).map(r => <SelectItem key={r.userId} value={r.userId} text={r.label} />)}
    </Select>
    {!recipients.length && <p className="muted">No recipients configured for this owner.</p>}
    <Button kind="tertiary" disabled={busy || !userId || !action.promiseId || (f && f.status !== 'preview')} onClick={preview}>Prepare preview</Button>
    </details>
    {error && <InlineNotification kind="error" title="Follow-up unavailable" subtitle={error} hideCloseButton />}
    {f && <div>
      <p>Status: {readable(f.status)} · Recipient: {f.recipient.label}</p>
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{f.text}</pre>
      {f.status === 'preview' && <>
        <Button kind="primary" disabled={busy} onClick={sendViaAgent}>Send via SARDINES</Button>
        {busy && <InlineLoading description="SARDINES is sending the message…" />}
        {agentReply && <div><p><strong>SARDINES:</strong></p><p className="muted">{agentReply}</p></div>}
        <p className="muted" style={{ marginTop: '0.5rem' }}>Review changes require a new preview before sending.</p>
      </>}
      {permalink && <p><a href={permalink} target="_blank" rel="noreferrer">Open Slack message ↗</a></p>}
      {f.sentAt && <p>Sent: {dateLabel(f.sentAt)}</p>}
      {['sending', 'uncertain'].includes(f.status) && <p>Do not resend. Reconcile the existing attempt with Slack before making changes.</p>}
      {(f.replies || []).map(r => <blockquote key={r.eventId}>{r.text}<p>Reply from {r.userId} · Received {dateLabel(r.receivedAt)}</p></blockquote>)}
    </div>}
  </section>;
}
