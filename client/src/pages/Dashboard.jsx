import { useState } from 'react';
import ActionReview from '../components/ActionReview';
import PromiseQueue from '../components/PromiseQueue';
import { Theme } from '@carbon/react';
import IngestionPanel from '../components/IngestionPanel';
import ChatInterface from '../components/ChatInterface';
import TaskTracker from '../components/TaskTracker';
import DecisionsLog from '../components/DecisionsLog';
import './Dashboard.css';

export default function Dashboard() {
  const [queueVersion, setQueueVersion] = useState(0);
  return (
    <Theme theme="g10">
      <div className="dashboard">
        <header className="dashboard-header">
          <h1 className="dashboard-title">Sales Operations Agent</h1>
          <p className="dashboard-subtitle">AI-powered cross-platform operational intelligence</p>
        </header>
        <IngestionPanel onSaved={() => setQueueVersion(v => v + 1)} />
        <PromiseQueue refreshKey={queueVersion} />
        <ActionReview refreshKey={queueVersion} onChanged={() => setQueueVersion(v => v + 1)} />
        <main className="dashboard-grid">
          <section className="panel panel-chat">
            <ChatInterface />
          </section>
          <section className="panel panel-tasks">
            <TaskTracker />
          </section>
          <section className="panel panel-decisions">
            <DecisionsLog />
          </section>
        </main>
      </div>
    </Theme>
  );
}
