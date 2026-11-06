import { useState, useEffect } from 'react';
import { Tile } from '@carbon/react';
import { getDecisions } from '../services/api';
import './DecisionsLog.css';

export default function DecisionsLog() {
  const [decisions, setDecisions] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    getDecisions()
      .then(setDecisions)
      .catch(() => setError('Could not load decisions.'));
  }, []);

  return (
    <div className="decisions-panel">
      <h4 className="panel-title">Decisions Log</h4>
      {error && <p className="panel-error">{error}</p>}
      {decisions.length === 0 ? (
        <p className="panel-empty">No decisions logged yet.</p>
      ) : (
        <div className="decisions-list">
          {decisions.map((d) => (
            <Tile key={d._id} className="decision-tile">
              <p className="decision-summary">{d.summary}</p>
              <div className="decision-meta">
                {d.source && <span className="decision-source">Source: {d.source}</span>}
                <span className="decision-time">
                  {new Date(d.timestamp).toLocaleString()}
                </span>
              </div>
            </Tile>
          ))}
        </div>
      )}
    </div>
  );
}
