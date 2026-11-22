import ChatInterface from '../components/ChatInterface';
import DecisionsLog from '../components/DecisionsLog';
export default function Legacy() {
  return <><p className="legacy-notice">Original prototype by the team. These panels require a separate MongoDB connection and do not represent the operational Task Queue.</p><div className="legacy-grid"><section className="legacy-panel"><ChatInterface /></section><section className="legacy-panel"><DecisionsLog /></section></div></>;
}
