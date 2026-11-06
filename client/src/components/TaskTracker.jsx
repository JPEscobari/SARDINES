import { useState, useEffect } from 'react';
import {
  StructuredListWrapper,
  StructuredListHead,
  StructuredListRow,
  StructuredListCell,
  StructuredListBody,
  Tag,
  Button,
} from '@carbon/react';
import { getTasks, updateTaskStatus } from '../services/api';
import './TaskTracker.css';

const STATUS_CYCLE = { open: 'in-progress', 'in-progress': 'done', done: 'open' };
const STATUS_TYPE = { open: 'blue', 'in-progress': 'purple', done: 'green' };

export default function TaskTracker() {
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    getTasks()
      .then(setTasks)
      .catch(() => setError('Could not load tasks.'));
  }, []);

  async function handleStatusToggle(task) {
    const next = STATUS_CYCLE[task.status];
    try {
      const updated = await updateTaskStatus(task._id, next);
      setTasks((prev) => prev.map((t) => (t._id === updated._id ? updated : t)));
    } catch {
      setError('Could not update task.');
    }
  }

  return (
    <div className="task-panel">
      <h4 className="panel-title">Task Tracker</h4>
      {error && <p className="panel-error">{error}</p>}
      {tasks.length === 0 ? (
        <p className="panel-empty">No tasks yet. They'll appear here when the agent creates them.</p>
      ) : (
        <StructuredListWrapper>
          <StructuredListHead>
            <StructuredListRow head>
              <StructuredListCell head>Task</StructuredListCell>
              <StructuredListCell head>Owner</StructuredListCell>
              <StructuredListCell head>Deadline</StructuredListCell>
              <StructuredListCell head>Status</StructuredListCell>
            </StructuredListRow>
          </StructuredListHead>
          <StructuredListBody>
            {tasks.map((task) => (
              <StructuredListRow key={task._id}>
                <StructuredListCell>{task.title}</StructuredListCell>
                <StructuredListCell>{task.owner || '—'}</StructuredListCell>
                <StructuredListCell>
                  {task.deadline
                    ? new Date(task.deadline).toLocaleDateString()
                    : '—'}
                </StructuredListCell>
                <StructuredListCell>
                  <Button
                    kind="ghost"
                    size="sm"
                    onClick={() => handleStatusToggle(task)}
                  >
                    <Tag type={STATUS_TYPE[task.status]}>{task.status}</Tag>
                  </Button>
                </StructuredListCell>
              </StructuredListRow>
            ))}
          </StructuredListBody>
        </StructuredListWrapper>
      )}
    </div>
  );
}
