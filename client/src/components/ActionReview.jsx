import { useState } from 'react';
import { Button, Select, SelectItem, TextInput, Tile, Tag, InlineNotification, InlineLoading, Search } from '@carbon/react';
import { listPromises, listProposedActions, reviewAction, listSlackRecipients, getTasks, createTask, updateTaskStatus } from '../services/api';
import SlackFollowup from './SlackFollowup';
import SourceEvidence from './SourceEvidence';
import useResource from '../hooks/useResource';
import { routeHref, readable } from '../app/navigation';
const STATUS_CYCLE = { open: 'in-progress', 'in-progress': 'done', done: 'open' };
const STATUS_TYPE = { open: 'blue', 'in-progress': 'purple', done: 'green' };

export function ActionCard({ action, promises, tasks, onSaved, onTaskCreated }) {
  const directory = useResource(listSlackRecipients);
  const locked = !!action.slackFollowup && action.slackFollowup.status !== 'preview';
  const initial = action.review || { title: action.description, companyId: '', ownerId: '', dueAt: '' };
  const [draft, setDraft] = useState({ ...initial, promiseId: action.promiseId || '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [taskBusy, setTaskBusy] = useState(false);
  const [taskError, setTaskError] = useState('');

  const linkedTask = tasks.find(t => t._id === action.taskId);
  const reviewSaved = !!action.review;

  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await reviewAction(action.id, { version: action.version, promiseId: draft.promiseId || null, title: draft.title,
        companyId: draft.companyId?.trim() || null, ownerId: draft.ownerId?.trim() || null, dueAt: draft.dueAt?.trim() || null });
      onSaved('Action review stored. Any previous approval was invalidated.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function handleCreateTask() {
    setTaskBusy(true); setTaskError('');
    try {
      const task = await createTask({
        title: action.review.title,
        owner: action.review.ownerId || '',
        deadline: action.review.dueAt || undefined,
      });
      await reviewAction(action.id, { version: action.version, taskId: task._id });
      onTaskCreated?.();
      onSaved('Task created and linked to this action.');
    } catch (err) { setTaskError(err.message); }
    finally { setTaskBusy(false); }
  }

  async function handleTaskStatusToggle() {
    if (!linkedTask) return;
    setTaskBusy(true); setTaskError('');
    try {
      await updateTaskStatus(linkedTask._id, STATUS_CYCLE[linkedTask.status]);
      onTaskCreated?.();
    } catch (err) { setTaskError(err.message); }
    finally { setTaskBusy(false); }
  }

  return <Tile className="promise-card">
    <h3>{action.review?.title || action.description}</h3>
    <Tag type="blue">Review: {readable(action.state || 'pending_review')}</Tag>
    <p>Original AI suggestion: {action.description}</p>
    <p>Extracted owner: {action.ownerName || 'Unresolved'} · Date wording: {action.dueText || 'Unresolved'}</p>
    <blockquote>{action.sourceQuote}</blockquote>
    <SourceEvidence sourceId={action.sourceId} />

    <section aria-label="Linked task" className="linked-task-panel">
      <h4>Task</h4>
      {linkedTask ? (
        <div className="linked-task-status">
          <p><strong>{linkedTask.title}</strong>{linkedTask.owner ? ` · ${linkedTask.owner}` : ''}{linkedTask.deadline ? ` · Due ${new Date(linkedTask.deadline).toLocaleDateString()}` : ''}</p>
          <Button kind="ghost" size="sm" disabled={taskBusy} onClick={handleTaskStatusToggle}>
            <Tag type={STATUS_TYPE[linkedTask.status]}>{linkedTask.status}</Tag>
          </Button>
          <span className="muted"> Click to advance status</span>
        </div>
      ) : reviewSaved ? (
        <div>
          <p className="muted">No task linked yet. Create one from the reviewed fields.</p>
          <Button kind="tertiary" size="sm" disabled={taskBusy} onClick={handleCreateTask}>Create Task</Button>
        </div>
      ) : (
        <p className="muted">Save the action review above to enable task creation.</p>
      )}
      {taskBusy && <InlineLoading description="Updating task…" />}
      {taskError && <InlineNotification kind="error" title="Task error" subtitle={taskError} hideCloseButton />}
    </section>

    {locked && <p className="review-boundary">This follow-up has already started. Review edits and resending are unavailable; track the reply below.</p>}
    {locked && <SlackFollowup action={action} onSaved={onSaved} />}
    <details className="review-draft" open={!locked}><summary>{locked ? 'Reviewed fields (read-only)' : 'Review draft'}</summary>
    <form onSubmit={save} className="review-fields">
      <Select id={`${action.id}-promise`} labelText="Associated Task" value={draft.promiseId} disabled={busy || locked}
        onChange={e => setDraft(d => ({ ...d, promiseId: e.target.value }))}>
        <SelectItem value="" text="Unlinked — select explicitly" />
        {promises.filter(p => p.sourceId === action.sourceId).map(p => <SelectItem key={p.id} value={p.id} text={`${p.customerName || 'Customer unresolved'} · ${p.title}`} />)}
      </Select>
      <p className="muted">Select explicitly from this source. Save before choosing another action; unsaved draft edits are not retained.</p>
      <Select id={`${action.id}-owner-mapping`} labelText="Development owner mapping" value={directory.data?.recipients.some(r => r.ownerId === draft.ownerId) ? draft.ownerId : ''} disabled={busy || locked || directory.loading}
        onChange={e => setDraft(d => ({ ...d, ownerId: e.target.value }))}>
        <SelectItem value="" text="Select an allowlisted owner or enter an ID below" />
        {[...new Map((directory.data?.recipients || []).map(r => [r.ownerId, r])).values()].map(r => <SelectItem key={r.ownerId} value={r.ownerId} text={r.label} />)}
      </Select>
      {directory.error && <p>Owner directory unavailable. Existing draft fields remain visible.</p>}
      {[
        ['title', 'Reviewed task title'], ['companyId', 'Customer company ID (unverified draft)'],
        ['ownerId', 'Responsible owner ID (unverified draft)'], ['dueAt', 'Action deadline (UTC ISO, optional)'],
      ].map(([key, label]) => <TextInput key={key} id={`${action.id}-${key}`} labelText={label} value={draft[key] || ''} disabled={busy || locked}
        onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))} />)}
      <details className="field-guidance"><summary>Identity and deadline guidance</summary><p>Deadline format: 2026-11-22T17:00:00.000Z. Leave blank when unresolved. Company and owner IDs are draft values, not verified CRM identities.</p></details>
      <Button type="submit" disabled={busy || locked}>Save action review</Button>
    </form>
    </details>
    {busy && <InlineLoading description="Saving action review…" />}
    {error && <InlineNotification kind="error" title="Action review failed" subtitle={error} hideCloseButton />}

    {!locked && <SlackFollowup action={action} onSaved={onSaved} />}
    <Button disabled kind="secondary">Approve action</Button> <Button disabled kind="danger--tertiary">Reject action</Button>
    <p>Approval and rejection require authenticated authorization. Execution is disabled for every action.</p>
  </Tile>;
}
export default function ActionReview({ refreshKey, onChanged, selectedId = '' }) {
  const [revision, setRevision] = useState(0), [query, setQuery] = useState(''), [status, setStatus] = useState('all'), [notice, setNotice] = useState('');
  const promises = useResource(listPromises, `${refreshKey}:${revision}`);
  const actions = useResource(listProposedActions, `${refreshKey}:${revision}`);
  const tasksResource = useResource(getTasks, `${refreshKey}:${revision}`);
  const tasks = tasksResource.data || [];
  const all = actions.data?.actions || [];
  const statusOf = a => a.slackFollowup?.status || a.state || 'pending_review';
  const linked = a => promises.data?.promises.find(p => p.id === a.promiseId);
  const filtered = all.filter(a => (status === 'all' || statusOf(a) === status) && [a.description, a.review?.title, linked(a)?.customerName, linked(a)?.title].join(' ').toLowerCase().includes(query.toLowerCase()));
  const selected = all.find(a => a.id === selectedId);
  const handleTaskCreated = () => setRevision(r => r + 1);
  return <section aria-label="Action Review">
    <ol className="stage-bar"><li>1 · Review action</li><li>2 · Prepare preview</li><li>3 · Restricted send</li><li>4 · Track reply</li></ol>
    <div className="section-heading"><p className="muted">A saved review is not approval. Send confirmation stays in the restricted local demo workflow.</p><Button kind="ghost" disabled={actions.loading} onClick={() => setRevision(r => r + 1)}>Refresh actions</Button></div>
    {notice && <InlineNotification kind="success" title="Saved" subtitle={notice} onCloseButtonClick={() => setNotice('')} />}
    {actions.loading || promises.loading ? <InlineLoading description="Loading actions and promises…" /> : actions.error || promises.error ? <InlineNotification kind="error" title="Follow-ups unavailable" subtitle={actions.error || promises.error} hideCloseButton /> : <div className="master-detail">
      <aside className="action-list" aria-label="Choose an action"><Search id="action-search" labelText="Search actions" placeholder="Search action or customer" value={query} onChange={e => setQuery(e.target.value)} /><Select id="action-filter" labelText="Action / follow-up status" value={status} onChange={e => setStatus(e.target.value)}><SelectItem value="all" text="All statuses" />{[...new Set(all.map(statusOf))].map(s => <SelectItem key={s} value={s} text={readable(s)} />)}</Select>
        <p className="result-count">{filtered.length} of {all.length} loaded actions</p>{!filtered.length && <p className="empty-state">No actions match. Save a source with an action or change the filter.</p>}
        {filtered.map(a => <a key={a.id} href={routeHref('follow-ups', a.id)} className={`action-option ${selectedId === a.id ? 'selected' : ''}`} aria-current={selectedId === a.id ? 'true' : undefined}><Tag type={statusOf(a) === 'replied' ? 'green' : 'blue'}>{readable(statusOf(a))}</Tag><strong>{a.review?.title || a.description}</strong><span>{linked(a)?.customerName || 'Customer unresolved'}</span><span>{linked(a)?.title || 'No Task linked'}</span></a>)}
      </aside>
      <div className="action-detail">{selected ? <ActionCard key={`${selected.id}:${selected.version}`} action={selected} promises={promises.data.promises} tasks={tasks} onSaved={message => { setNotice(message); setRevision(r => r + 1); onChanged?.(); }} onTaskCreated={handleTaskCreated} /> : <Tile className="empty-detail"><h2>{selectedId ? 'Action not found' : 'Choose an action'}</h2><p>Select an action to inspect its evidence, review ownership and prepare a Slack follow-up.</p><p>Replies record progress. They never complete a Task automatically.</p></Tile>}</div>
    </div>}
  </section>;
}
