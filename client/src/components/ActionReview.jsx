import { useEffect, useState } from 'react';
import { Button, Select, SelectItem, TextInput, Tile, Tag, InlineNotification, InlineLoading } from '@carbon/react';
import { listPromises, listProposedActions, reviewAction } from '../services/api';
import SlackFollowup from './SlackFollowup';
import SourceEvidence from './SourceEvidence';
function ActionCard({ action, promises, onSaved }) {
  const initial = action.review || { title: action.description, companyId: '', ownerId: '', dueAt: '' };
  const [draft, setDraft] = useState({ ...initial, promiseId: action.promiseId || '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await reviewAction(action.id, { version: action.version, promiseId: draft.promiseId || null, title: draft.title,
        companyId: draft.companyId?.trim() || null, ownerId: draft.ownerId?.trim() || null, dueAt: draft.dueAt?.trim() || null });
      onSaved('Action review stored. Any previous approval was invalidated.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <Tile className="promise-card">
    <h3>{action.review?.title || action.description}</h3>
    <Tag type="blue">{action.state || 'pending_review'}</Tag>
    <p>Original AI suggestion: {action.description}</p>
    <p>Extracted owner: {action.ownerName || 'Unresolved'} · Date wording: {action.dueText || 'Unresolved'}</p>
    <blockquote>{action.sourceQuote}</blockquote>
    <SourceEvidence sourceId={action.sourceId} />
    <form onSubmit={save}>
      <Select id={`${action.id}-promise`} labelText="Associated Promise" value={draft.promiseId} disabled={busy}
        onChange={e => setDraft(d => ({ ...d, promiseId: e.target.value }))}>
        <SelectItem value="" text="Unlinked — select explicitly" />
        {promises.filter(p => p.sourceId === action.sourceId).map(p => <SelectItem key={p.id} value={p.id} text={`${p.customerName || 'Customer unresolved'} · ${p.title}`} />)}
      </Select>
      <p>Choose a Promise from this source. Cross-source linking is not supported in this batch.</p>
      {[
        ['title', 'Reviewed task title'], ['companyId', 'Customer company ID (unverified draft)'],
        ['ownerId', 'Responsible owner ID (unverified draft)'], ['dueAt', 'Action deadline (UTC ISO, optional)'],
      ].map(([key, label]) => <TextInput key={key} id={`${action.id}-${key}`} labelText={label} value={draft[key] || ''} disabled={busy}
        onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))} />)}
      <p>Deadline example: 2026-11-22T17:00:00.000Z. Leave unresolved if its meaning is uncertain. Company and owner IDs must later be verified by a server-side directory/CRM lookup.</p>
      <Button type="submit" disabled={busy}>Save action review</Button>
    </form>
    {busy && <InlineLoading description="Saving action review…" />}
    {error && <InlineNotification kind="error" title="Action review failed" subtitle={error} hideCloseButton />}
    {action.approval && <p>Approval payload hash: {action.approval.payloadHash}. Execution remains disabled.</p>}
    <SlackFollowup action={action} onSaved={onSaved} />
    <Button disabled kind="secondary">Approve action</Button> <Button disabled kind="danger--tertiary">Reject action</Button>
    <p>Approval and rejection require authenticated authorization. Execution is disabled for every action.</p>
  </Tile>;
}
export default function ActionReview({ refreshKey, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return null;
      setLoading(true); setError('');
      return Promise.all([listPromises(), listProposedActions()]);
    }).then(result => { if (active && result) setData({ promises: result[0].promises, actions: result[1].actions }); })
      .catch(err => { if (active) setError(err.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshKey, reload]);
  return <section className="promise-queue" aria-labelledby="action-review-title">
    <h2 id="action-review-title">Action Review</h2>
    <p>Link each suggestion explicitly and resolve its draft fields. Saving a review does not approve or execute it.</p>
    <p>Authentication and verified identity lookup are not configured. Actual approval is unavailable.</p>
    <Button kind="ghost" disabled={loading} onClick={() => setReload(v => v + 1)}>Refresh actions</Button>
    {notice && <InlineNotification kind="success" title="Review saved" subtitle={notice} hideCloseButton />}
    {loading && <InlineLoading description="Loading action reviews…" />}
    {error && <InlineNotification kind="error" title="Actions unavailable" subtitle={error} hideCloseButton />}
    {!loading && !error && !data?.actions.length && <p>No saved actions to review.</p>}
    {!loading && !error && data?.actions.map(action => <ActionCard key={`${action.id}:${action.version}`} action={action} promises={data.promises}
      onSaved={message => { setNotice(message); onChanged(); }} />)}
  </section>;
}
