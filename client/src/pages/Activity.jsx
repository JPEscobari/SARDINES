import { useState } from 'react';
import { Button, InlineLoading, InlineNotification, Tile } from '@carbon/react';
import useResource from '../hooks/useResource';
import { listAuditEvents, listPromises, listProposedActions } from '../services/api';
import ActivityTimeline from '../components/ActivityTimeline';
export default function Activity() {
  const [revision, setRevision] = useState(0);
  const events = useResource(listAuditEvents, revision), promises = useResource(listPromises, revision), actions = useResource(listProposedActions, revision);
  return <Tile><div className="section-heading"><h2>Operational history</h2><Button kind="ghost" disabled={events.loading} onClick={() => setRevision(r => r + 1)}>Refresh activity</Button></div>
    <p className="muted">Stored events, newest first. Review changes do not authorize external execution.</p>
    {events.loading ? <InlineLoading description="Loading audit history…" /> : events.error ? <InlineNotification kind="error" title="Activity unavailable" subtitle={events.error} hideCloseButton /> : <ActivityTimeline events={events.data.events} promises={promises.data?.promises} actions={actions.data?.actions} />}
    {(promises.error || actions.error) && <p>Related-record links are unavailable until records can be loaded.</p>}
  </Tile>;
}
