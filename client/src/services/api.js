const API_BASE = import.meta.env.VITE_API_BASE || '/api';

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

export async function analyzeText(sourceType, content) {
  let res;
  try {
    res = await fetch(`${API_BASE}/ingest`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceType, content }), signal: AbortSignal.timeout(90000),
    });
  } catch {
    throw new Error('Cannot reach the analysis service or the request timed out. Please try again.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ? `${data.error}${data.code ? ` (${data.code})` : ''}` : 'Analysis service is unavailable.');
  if (!data?.success || !data.analysis) throw new Error('The analysis service returned an invalid response.');
  return data;
}
async function reviewRequest(path, options = {}) {
  let response;
  try { response = await fetch(`${API_BASE}/review${path}`, { ...options, headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000) }); }
  catch { throw new Error('Review storage cannot be reached. Retry or refresh the queue.'); }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.success) throw new Error(data?.error || 'Review request failed');
  return data;
}
export const saveForReview = (sourceType, content, analysis) => reviewRequest('/sources', { method: 'POST', body: JSON.stringify({ sourceType, content, analysis }) });
export const listPromises = () => reviewRequest('/promises');
export const listProposedActions = () => reviewRequest('/actions');
export const updatePromise = (id, patch) => reviewRequest(`/promises/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
export const reviewAction = (id, patch) => reviewRequest(`/actions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const getReviewSource = id => reviewRequest(`/sources/${encodeURIComponent(id)}`);
export const listSlackRecipients = () => reviewRequest('/slack-recipients');
export const previewSlackFollowup = (id, patch) => reviewRequest(`/actions/${encodeURIComponent(id)}/slack-preview`, { method: 'POST', body: JSON.stringify(patch) });

export async function transcribeAudio(file) {
  if (!file.name.toLowerCase().endsWith('.wav')) throw new Error('Choose a PCM WAV file. MP3, WebM and video are not supported in this batch.');
  if (!file.size || file.size > 8 * 1024 * 1024) throw new Error('Choose a WAV file between 1 byte and 8 MiB.');
  let response;
  try { response = await fetch(`${API_BASE}/transcribe`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: file, signal: AbortSignal.timeout(115000) }); }
  catch { throw new Error('Speech service could not be reached or timed out. Retry manually.'); }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.success) throw new Error(data?.error || 'Transcription unavailable');
  if (typeof data.transcript !== 'string' || !Array.isArray(data.segments) || !Number.isFinite(data.audio?.durationSeconds)) throw new Error('Invalid speech response');
  return data;
}
