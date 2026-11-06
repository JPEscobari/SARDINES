import { Theme } from '@carbon/react';
import ChatInterface from '../components/ChatInterface';
import TaskTracker from '../components/TaskTracker';
import DecisionsLog from '../components/DecisionsLog';
import './Dashboard.css';

export default function Dashboard() {
  return (
    <Theme theme="g10">
      <div className="dashboard">
        <header className="dashboard-header">
          <h1 className="dashboard-title">Sales Operations Agent</h1>
          <p className="dashboard-subtitle">AI-powered cross-platform operational intelligence</p>
        </header>
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
