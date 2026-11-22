import SourceEvidence from './SourceEvidence';
import { useEffect, useState } from 'react';
import { Button, TextInput, Select, SelectItem, Tile, InlineLoading, InlineNotification, Tag, DataTable, Table, TableHead, TableRow, TableHeader, TableBody, TableCell, TableContainer, Search } from '@carbon/react';
import { listPromises, listProposedActions, updatePromise } from '../services/api';
import TaskTracker from './TaskTracker';
import './PromiseQueue.css';
import { routeHref, sourceLabels, dateLabel, readable } from '../app/navigation';
import { getReviewSource, listAuditEvents } from '../services/api';
import useResource from '../hooks/useResource';
import ActivityTimeline from './ActivityTimeline';
const transitions = { needs_review: ['open', 'blocked'], open: ['needs_review', 'blocked', 'completed'], blocked: ['needs_review', 'open', 'completed'], completed: ['open'] };
export function PromiseCard({ promise, actions, onUpdated }) {
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
    <p>Source</p><blockquote>{promise.sourceQuote}</blockquote>
    <SourceEvidence sourceId={promise.sourceId} />
    <p className="source-reference">Updated {dateLabel(promise.updatedAt)} · Revision {promise.version}</p>
    <h4>Associated actions</h4>
    <p>Only explicitly linked actions appear here. <a href="#/follow-ups">Review other suggestions</a>.</p>
    {actions.length ? actions.map(action => <div key={action.id} className="proposed-action">
      <p>{action.promiseId === promise.id ? 'Explicitly linked to this Task' : action.promiseId ? 'Linked to another Task' : 'Unlinked suggestion'} · {action.state || 'pending_review'}</p>
      <p><a href={routeHref('follow-ups', action.id)}>{action.description}</a> · {action.ownerName || 'Owner unresolved'} · {action.dueText || 'Date unresolved'}</p>
      <blockquote>{action.sourceQuote}</blockquote>
      <Tag type="gray">Approval: {action.approvalStatus} · Execution disabled</Tag>
    </div>) : <p>No proposed actions.</p>}
    {!editing && <Button kind="tertiary" onClick={() => { setDraft(promise); setEditing(true); setError(''); }}>Review fields</Button>}
    {editing && <form onSubmit={save}>
      <p className="muted">Save or cancel before choosing another record. Refreshing reloads the latest version and discards this unsaved draft.</p>
      {[
        ['title', 'Task title'], ['customerName', 'Customer'], ['ownerName', 'Owner'], ['dueText', 'Deadline wording'], ['dueAt', 'Reviewed deadline (UTC ISO, optional)'],
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
const SORT_COLS = new Set(['customer', 'owner', 'due', 'status', 'source', 'updated']);

function sortRows(rows, key, dir) {
  if (!key || dir === 'NONE') return rows;
  const asc = dir === 'ASC' ? 1 : -1;
  return [...rows].sort((a, b) => {
    // For date columns use the raw ISO value stored in dueRaw / updatedRaw
    const av = (key === 'due' ? a.dueRaw : key === 'updated' ? a.updatedRaw : a[key]) ?? '';
    const bv = (key === 'due' ? b.dueRaw : key === 'updated' ? b.updatedRaw : b[key]) ?? '';
    return av.toString().localeCompare(bv.toString(), undefined, { numeric: true }) * asc;
  });
}

export default function PromiseQueue({ refreshKey, selectedId = '' }) {
  const [query, setQuery] = useState(''), [status, setStatus] = useState('all');
  const [revision, setRevision] = useState(0);
  const [sortKey, setSortKey] = useState(''), [sortDir, setSortDir] = useState('NONE');
  const promises = useResource(listPromises, `${refreshKey}:${revision}`), actions = useResource(listProposedActions, `${refreshKey}:${revision}`), audit = useResource(listAuditEvents, `${refreshKey}:${revision}`);
  const [sources, setSources] = useState({});
  useEffect(() => {
    let active = true;
    const ids = [...new Set((promises.data?.promises || []).map(p => p.sourceId))];
    // Small unpaginated MVP dataset; one read per unique source, four at a time.
    (async () => {
      const next = {};
      for (let i = 0; i < ids.length && active; i += 4) {
        await Promise.all(ids.slice(i, i + 4).map(async id => { try { next[id] = (await getReviewSource(id)).source.sourceType; } catch { next[id] = 'unavailable'; } }));
      }
      if (active) setSources(next);
    })();
    return () => { active = false; };
  }, [promises.data]);
  const allActions = actions.data?.actions || [];
  // A Promise is considered "tasked" when at least one action explicitly linked to it has a taskId.
  const taskedPromiseIds = new Set(allActions.filter(a => a.promiseId && a.taskId).map(a => a.promiseId));
  const all = (promises.data?.promises || []).filter(p => !taskedPromiseIds.has(p.id));
  const selected = (promises.data?.promises || []).find(p => p.id === selectedId);
  const filtered = all.filter(p => (status === 'all' || p.status === status) && [p.customerName, p.title, p.ownerName].join(' ').toLowerCase().includes(query.toLowerCase()));
  const headers = [{ key: 'customer', header: 'Customer' }, { key: 'title', header: 'Task' }, { key: 'owner', header: 'Owner' }, { key: 'due', header: 'Due date' }, { key: 'status', header: 'Status' }, { key: 'source', header: 'Source' }, { key: 'updated', header: 'Updated' }];
  const baseRows = filtered.map(p => ({ id: p.id, customer: p.customerName || 'Unresolved', title: p.title, owner: p.ownerName || 'Unresolved', due: dateLabel(p.dueAt), dueRaw: p.dueAt ?? '', status: readable(p.status), source: sourceLabels[sources[p.sourceId]] || (sources[p.sourceId] === 'unavailable' ? 'Unavailable' : 'Loading…'), updated: dateLabel(p.updatedAt), updatedRaw: p.updatedAt ?? '' }));
  const rows = sortRows(baseRows, sortKey, sortDir);
  return <section className="promise-queue" aria-label="Task Queue">
    <TaskTracker />
    <div className="section-heading" style={{ marginTop: '2rem' }}><h2>Task Queue</h2><p className="muted">(Tasks extracted from analyzed sources and saved for review.)</p></div>
    <div className="section-heading"><Button kind="ghost" disabled={promises.loading} onClick={() => setRevision(r => r + 1)}>Refresh queue</Button></div>
    <div className="list-toolbar"><Search id="promise-search" labelText="Search tasks" placeholder="Search customer, task or owner" value={query} onChange={e => setQuery(e.target.value)} /><Select id="promise-filter" labelText="Status" value={status} onChange={e => setStatus(e.target.value)}><SelectItem value="all" text="All statuses" />{Object.keys(transitions).map(s => <SelectItem key={s} value={s} text={readable(s)} />)}</Select></div>
    {promises.loading ? <InlineLoading description="Loading saved tasks…" /> : promises.error ? <InlineNotification kind="error" title="Tasks unavailable" subtitle={promises.error} hideCloseButton /> : <>
      <p className="result-count">{filtered.length} of {all.length} loaded tasks · Filtered locally</p>
      {!rows.length ? <p className="empty-state">{all.length ? 'No tasks match your filters.' : 'No saved tasks yet. Analyze a source and choose Save for Review.'}</p> : <DataTable rows={rows} headers={headers}>{({ rows: tableRows, headers: tableHeaders, getTableProps, getHeaderProps, getRowProps }) => <TableContainer className="promise-table"><Table {...getTableProps()} size="md" aria-label="Saved tasks"><TableHead><TableRow>{tableHeaders.map(header => SORT_COLS.has(header.key) ? <TableHeader {...getHeaderProps({ header })} key={header.key} isSortable isSortHeader={sortKey === header.key} sortDirection={sortKey === header.key ? sortDir : 'NONE'} onClick={() => { const next = sortKey === header.key ? (sortDir === 'NONE' ? 'ASC' : sortDir === 'ASC' ? 'DESC' : 'NONE') : 'ASC'; setSortKey(header.key); setSortDir(next); }}>{header.header}</TableHeader> : <TableHeader {...getHeaderProps({ header })} key={header.key}>{header.header}</TableHeader>)}</TableRow></TableHead><TableBody>{tableRows.map(row => <TableRow {...getRowProps({ row })} key={row.id} onClick={() => { window.location.hash = routeHref('promises', row.id); }} className={row.id === selectedId ? 'selected-row' : ''}>{row.cells.map(cell => <TableCell key={cell.id}>{cell.info.header === 'title' ? <a href={routeHref('promises', row.id)}>{cell.value}</a> : cell.info.header === 'status' ? <Tag type="blue">{cell.value}</Tag> : cell.value}</TableCell>)}</TableRow>)}</TableBody></Table></TableContainer>}</DataTable>}
      {selectedId && !selected && <p role="status">This Task is not in the loaded records. Refresh or choose another record.</p>}
      {selected && <div className="record-detail"><div className="section-heading"><h2>Task detail</h2><a href={routeHref('promises')}>Close detail</a></div><PromiseCard key={`${selected.id}:${selected.version}`} promise={selected} actions={(actions.data?.actions || []).filter(a => a.promiseId === selected.id)} onUpdated={() => setRevision(r => r + 1)} />
        {actions.error && <p>Associated actions unavailable.</p>}<details><summary>Task audit history</summary>{audit.loading ? <p>Loading history…</p> : audit.error ? <p>Audit history unavailable.</p> : <ActivityTimeline events={audit.data.events.filter(e => e.entityId === selected.id)} promises={all} />}</details>
      </div>}
    </>}
  </section>;
}
