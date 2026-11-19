import ChatInterface from '../components/ChatInterface';
import TaskTracker from '../components/TaskTracker';
import DecisionsLog from '../components/DecisionsLog';
export default function Legacy() {
  return <><p className="legacy-notice">Original prototype by the team. These panels require a separate MongoDB connection and do not represent the operational Promise Queue.</p><div className="legacy-grid"><section className="legacy-panel"><ChatInterface /></section><section className="legacy-panel"><TaskTracker /></section><section className="legacy-panel"><DecisionsLog /></section></div></>;
}
