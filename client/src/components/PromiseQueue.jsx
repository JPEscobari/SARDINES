import SourceEvidence from './SourceEvidence';
import { useEffect, useState } from 'react';
import { Button, TextInput, Select, SelectItem, Tile, InlineLoading, InlineNotification, Tag } from '@carbon/react';
import { listPromises, listProposedActions, updatePromise } from '../services/api';
import './PromiseQueue.css';
const transitions = { needs_review: ['open', 'blocked'], open: ['needs_review', 'blocked', 'completed'], blocked: ['needs_review', 'open', 'completed'], completed: ['open'] };
function PromiseCard({ promise, actions, onUpdated }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(promise);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await updatePromise(promise.id, { version: promise.version, title: draft.title,
        customerName: draft.customerName?.trim() || null, ownerName: draft.ownerName?.trim() || null,
        dueText: draft.dueText?.trim() || null, dueAt: draft.dueAt?.trim() || null, status: draft.status });
      setEditing(false); onUpdated();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <Tile className="promise-card">
    <h3>{promise.title}</h3><Tag type="blue">Stored · {promise.status}</Tag>
    <p>Customer: {promise.customerName || 'Unresolved'}</p>
    <p>Owner: {promise.ownerName || 'Unresolved'}{promise.ownerName && ' (identity unverified)'}</p>
    <p>Date text: {promise.dueText || 'Not specified'}</p>
    <p>Reviewed deadline: {promise.dueAt || 'Unresolved'} · No reminder scheduled</p>
    {promise.extractedDueAt && <p>AI-suggested date (unverified): {promise.extractedDueAt}</p>}
    <p>Source evidence</p><blockquote>{promise.sourceQuote}</blockquote>
    <SourceEvidence sourceId={promise.sourceId} />
    <p className="source-reference">Source: {promise.sourceId}</p>
    <h4>Proposed actions from the same source</h4>
    <p>Same-source suggestions are listed below. Association requires explicit action review.</p>
    {actions.length ? actions.map(action => <div key={action.id} className="proposed-action">
      <p>{action.promiseId === promise.id ? 'Explicitly linked to this Promise' : action.promiseId ? 'Linked to another Promise' : 'Unlinked suggestion'} · {action.state || 'pending_review'}</p>
      <p>{action.description} · {action.ownerName || 'Owner unresolved'} · {action.dueText || 'Date unresolved'}</p>
      <blockquote>{action.sourceQuote}</blockquote>
      <Tag type="gray">Approval: {action.approvalStatus} · Execution disabled</Tag>
    </div>) : <p>No proposed actions.</p>}
    {!editing && <Button kind="tertiary" onClick={() => { setDraft(promise); setEditing(true); setError(''); }}>Review fields</Button>}
    {editing && <form onSubmit={save}>
      {[
        ['title', 'Promise title'], ['customerName', 'Customer'], ['ownerName', 'Owner'], ['dueText', 'Deadline wording'], ['dueAt', 'Reviewed deadline (UTC ISO, optional)'],
      ].map(([key, label]) => <TextInput key={key} id={`${promise.id}-${key}`} labelText={label} value={draft[key] || ''} disabled={busy}
        onChange={e => setDraft(d => ({ ...d, [key]: e.target.value, ...(key === 'dueText' ? { dueAt: null } : {}) }))} />)}
      <p>Only enter a deadline after confirming its meaning. Format: 2026-11-22T17:00:00.000Z. Leave blank when unresolved.</p>
      <Select id={`${promise.id}-status`} labelText="Review status" value={draft.status} disabled={busy} onChange={e => setDraft(d => ({ ...d, status: e.target.value }))}>
        {[promise.status, ...transitions[promise.status]].map(status => <SelectItem key={status} value={status} text={status} />)}
      </Select>
      <div><Button type="submit" disabled={busy}>Save changes</Button> <Button kind="ghost" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button></div>
    </form>}
    {busy && <InlineLoading description="Saving changes…" />}
    {error && <InlineNotification kind="error" title="Review failed" subtitle={error} hideCloseButton />}
  </Tile>;
}
export default function PromiseQueue({ refreshKey }) {
  const [backend, setBackend] = useState('');
  const [promises, setPromises] = useState([]);
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return null;
      setLoading(true); setError('');
      return Promise.all([listPromises(), listProposedActions()]);
    }).then(result => {
      if (!result) return;
      const [p, a] = result;
      if (active) { setBackend(p.backend || ''); setPromises(p.promises); setActions(a.actions); }
    }).catch(err => { if (active) setError(err.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshKey, revision]);
  return <section className="promise-queue" aria-labelledby="promise-queue-title">
    <h2 id="promise-queue-title">Promise Queue</h2>
    <p>Saved review records · {backend === 'cloudant' ? 'IBM Cloudant' : backend === 'sqlite' ? 'Local SQLite storage' : 'Storage status unavailable'}</p>
    <p>Authentication is not configured. Approval and execution are unavailable. Editing a status does not authorize a business action.</p>
    <Button kind="ghost" disabled={loading} onClick={() => setRevision(v => v + 1)}>Refresh queue</Button>
    {loading && <InlineLoading description="Loading saved promises…" />}
    {error && <InlineNotification kind="error" title="Queue unavailable" subtitle={error} hideCloseButton />}
    {!loading && !error && !promises.length && <p>No saved promises. Analyze text and choose Save for Review.</p>}
    {!loading && !error && promises.map(promise => <PromiseCard key={`${promise.id}:${promise.version}`} promise={promise}
      actions={actions.filter(a => a.sourceId === promise.sourceId)} onUpdated={() => setRevision(v => v + 1)} />)}
    {!loading && !error && actions.filter(a => !promises.some(p => p.sourceId === a.sourceId)).map(a => <Tile key={a.id}><h3>Unlinked suggestion</h3><p>{a.description}</p><blockquote>{a.sourceQuote}</blockquote><p>Pending review · execution disabled</p></Tile>)}
  </section>;
}
