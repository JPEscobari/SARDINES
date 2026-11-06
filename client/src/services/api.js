const API_BASE = 'http://localhost:5000/api';

export async function sendMessage(message) {
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to send message');
  }
  return res.json(); // { reply, messageId }
}

export async function getHistory() {
  const res = await fetch(`${API_BASE}/chat/history`);
  if (!res.ok) throw new Error('Failed to fetch history');
  return res.json(); // [{ role, content, timestamp }]
}

export async function getTasks() {
  const res = await fetch(`${API_BASE}/tasks`);
  if (!res.ok) throw new Error('Failed to fetch tasks');
  return res.json();
}

export async function updateTaskStatus(id, status) {
  const res = await fetch(`${API_BASE}/tasks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error('Failed to update task');
  return res.json();
}

export async function getDecisions() {
  const res = await fetch(`${API_BASE}/decisions`);
  if (!res.ok) throw new Error('Failed to fetch decisions');
  return res.json();
}
