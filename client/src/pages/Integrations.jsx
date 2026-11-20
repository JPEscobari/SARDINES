import { useState } from 'react';
import { Button, Tile, Tag, InlineLoading } from '@carbon/react';
import { getReadiness, listSlackRecipients } from '../services/api';
import useResource from '../hooks/useResource';
export default function Integrations() {
  const [revision, setRevision] = useState(0);
  const database = useResource(getReadiness, revision), slack = useResource(listSlackRecipients, revision);
  const cloudant = database.data?.backend === 'cloudant' && database.data.ready;
  return <><div className="section-heading"><p>Current read checks and prior demo evidence are shown separately.</p><Button kind="tertiary" onClick={() => setRevision(r => r + 1)} disabled={database.loading || slack.loading}>Refresh status</Button></div>
    <div className="integration-grid">
      <Tile><h2>IBM Cloudant</h2>{database.loading ? <InlineLoading description="Checking database…" /> : <Tag type={cloudant ? 'green' : 'gray'}>{cloudant ? 'Readiness verified' : database.error ? 'Unavailable' : 'Not selected'}</Tag>}<p>{cloudant ? 'The selected Cloudant database accepts read requests.' : database.data?.backend === 'sqlite' ? 'This server uses local SQLite. It is separate from Cloudant.' : 'Database readiness could not be established.'}</p><p className="muted">Readiness does not prove write access or a complete workflow.</p></Tile>
      <Tile><h2>watsonx Orchestrate</h2><Tag type="gray">Current availability not checked</Tag><p>Analyzes text into evidence-backed suggestions. Analysis runs only when requested.</p><p className="muted">Live workflow verified in the November 19 demo handoff; this is historical evidence, not current health.</p></Tile>
      <Tile><h2>IBM Speech to Text</h2><Tag type="gray">Current availability not checked</Tag><p>Transcribes WAV and audio extracted from short MP4 videos.</p><p className="muted">Live audio/video transcription verified in the November 19 handoff. No paid transcription is triggered by this page.</p></Tile>
      <Tile><h2>Slack</h2>{slack.loading ? <InlineLoading description="Checking recipient configuration…" /> : <Tag type={slack.data?.recipients.length ? 'blue' : 'gray'}>{slack.error ? 'Unavailable' : slack.data.recipients.length ? 'Recipient directory configured' : 'No recipients configured'}</Tag>}<p>Summarize in Slack, explicitly save to SARDINES, then prepare follow-ups here.</p><p className="muted">Directory configuration is not Slack connectivity. Live DM/reply flow was previously verified by the team. Sending stays in the restricted local workflow.</p></Tile>
      <Tile><h2>HubSpot</h2><Tag type="gray">Integration Complete✅</Tag><p>CRM Agent is connected to WatsonX on the Cloud.</p></Tile>
      <Tile><h2>Access &amp; approvals</h2><Tag type="gray">Local development only</Tag><p>Formal approval requires authentication and remains disabled. Saving a review does not approve a business action.</p><a href="#/legacy">Open Legacy Prototype →</a></Tile>
    </div></>;
}
