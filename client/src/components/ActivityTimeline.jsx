import { eventLabels, dateLabel, routeHref } from '../app/navigation';
export default function ActivityTimeline({ events, promises = [], actions = [], limit }) {
  const sorted = [...events].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, limit);
  if (!sorted.length) return <p className="empty-state">No recorded activity yet. Save a source to start the review workflow.</p>;
  return <ol className="activity-timeline">{sorted.map(event => {
    const promise = promises.find(p => p.id === event.entityId), action = actions.find(a => a.id === event.entityId);
    return <li key={event.id}><span className="timeline-dot" /><div><strong>{eventLabels[event.event] || 'Recorded operational event'}</strong>
      <p>{promise ? <a href={routeHref('promises', promise.id)}>{promise.title}</a> : action ? <a href={routeHref('follow-ups', action.id)}>{action.review?.title || action.description}</a> : 'Source or record history'}</p>
      <time dateTime={event.createdAt}>{dateLabel(event.createdAt)}</time>
      <details><summary>Audit details</summary><p>Event: {event.event} · Actor: {event.actorType === 'unauthenticated_local' ? 'Local review (identity not verified)' : event.actorType}</p>
        <p>Changed fields: {event.changedFields?.join(', ') || 'None recorded'}</p></details>
    </div></li>;
  })}</ol>;
}
