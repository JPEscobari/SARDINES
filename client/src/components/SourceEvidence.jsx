import { useState } from 'react';
import { Button, InlineNotification } from '@carbon/react';
import { getReviewSource } from '../services/api';
export default function SourceEvidence({ sourceId }) {
  const [source, setSource] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true); setError('');
    try { setSource((await getReviewSource(sourceId)).source); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <div>
    <Button kind="ghost" disabled={busy} onClick={load}>View original source</Button>
    {error && <InlineNotification kind="error" title="Source unavailable" subtitle={error} hideCloseButton />}
    {source && <details open><summary>Original {source.sourceType} source</summary>
      {source.slack && <p>Workspace {source.slack.teamId} · Channel {source.slack.channelId} · Thread {source.slack.threadTs}</p>}
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{source.content}</pre>
      <details><summary>Original extracted fields (before review)</summary>{[...(source.analysis.promises || []), ...(source.analysis.actions || [])].map((item, index) => <div key={index}><p>{item.title || item.description}</p><p>Customer: {item.customerName || 'Unresolved'} · Owner: {item.ownerName || 'Unresolved'} · Deadline wording: {item.dueText || 'Unresolved'}</p>{item.dueAt && <p>Suggested date, unverified: {item.dueAt}</p>}<blockquote>{item.sourceQuote}</blockquote></div>)}</details>
      {(source.analysis.decisions || []).map((d, i) => <div key={i}><p>Extracted decision: {d.description}</p><blockquote>{d.sourceQuote}</blockquote></div>)}
      {source.analysis.blockers.map((d, i) => <div key={i}><p>Extracted blocker: {d.description}</p><blockquote>{d.sourceQuote}</blockquote></div>)}
    </details>}
  </div>;
}
