import { Button, Tile, Tag, InlineLoading } from '@carbon/react';
import { listPromises, listProposedActions, listAuditEvents } from '../services/api';
import useResource from '../hooks/useResource';
import ActivityTimeline from '../components/ActivityTimeline';
import { metrics, routeHref } from '../app/navigation';
export default function Overview() {
  const p = useResource(listPromises), a = useResource(listProposedActions), e = useResource(listAuditEvents);
  const values = metrics(p.data?.promises, a.data?.actions);
  return <>
    <div className="overview-intro"><div><p className="eyebrow">FROM CONVERSATION TO FOLLOW-THROUGH</p><h2>Keep every commitment in view.</h2><p>Bring your sources together, review what matters, and track the next conversation.</p></div><Button href={routeHref('analyze')}>Analyze new source →</Button></div>
    <div className="metric-grid">{[['Saved tasks', values.saved, p, 'promises'], ['Tasks needing review', values.review, p, 'promises'], ['Actions awaiting review', values.actions, a, 'follow-ups'], ['Slack replies received', values.replies, a, 'follow-ups']].map(([label, value, state, page]) => <Tile key={label} className="metric"><p>{label}</p>{state.loading ? <InlineLoading description="Loading…" /> : <strong>{value ?? 'Unavailable'}</strong>}<a href={routeHref(page)}>View {page === 'follow-ups' ? 'follow-ups' : 'tasks'} →</a>{state.error && <p role="status">Records could not be loaded.</p>}</Tile>)}</div>
    <div className="overview-columns"><Tile><div className="section-heading"><h2>Recent activity</h2><a href={routeHref('activity')}>View all</a></div>{e.loading ? <InlineLoading description="Loading activity…" /> : e.error ? <p role="status">Activity unavailable. Open Activity to retry.</p> : <ActivityTimeline events={e.data.events} promises={p.data?.promises} actions={a.data?.actions} limit={5} />}</Tile>
      <Tile><p className="eyebrow">YOUR WORKFLOW</p><h2>A clear next step, every time.</h2><ol className="workflow-guide">{[['Analyze', 'Turn a source into suggested promises and actions.'], ['Save', 'Keep the reviewed text and its evidence.'], ['Review', 'Correct details and link each action explicitly.'], ['Follow up', 'Prepare a Slack message for restricted, confirmed sending.'], ['Track reply', 'A reply is progress, not automatic completion.']].map(([title, text], i) => <li key={title}><span>{i + 1}</span><div><strong>{title}</strong><p>{text}</p></div></li>)}</ol><Tag type="gray">Human review required</Tag></Tile></div>
  </>;
}
