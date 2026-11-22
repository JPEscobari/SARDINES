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

export async function createTask({ title, owner, deadline }) {
  const res = await fetch(`${API_BASE}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, owner, deadline }),
  });
  if (!res.ok) throw new Error('Failed to create task');
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
  if (!response.ok || !data?.success) throw Object.assign(new Error(response.status === 409 ? 'This record changed since you opened it. Your changes were not saved. Refresh the record and reapply your edits.' : data?.error || 'Review request failed'), { status: response.status, code: data?.code });
  return data;
}
export const saveForReview = (sourceType, content, analysis) => reviewRequest('/sources', { method: 'POST', body: JSON.stringify({ sourceType, content, analysis }) });
export const listPromises = () => reviewRequest('/promises');
export const listProposedActions = () => reviewRequest('/actions');
export const listAuditEvents = () => reviewRequest('/audit-events');
export async function getReadiness() {
  const response = await fetch(`${API_BASE}/ready`, { signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  if (!response.ok || !data.ready) throw new Error('Database readiness unavailable');
  return { backend: data.backend, ready: data.ready, scope: data.scope };
}
export const updatePromise = (id, patch) => reviewRequest(`/promises/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
export const reviewAction = (id, patch) => reviewRequest(`/actions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const getReviewSource = id => reviewRequest(`/sources/${encodeURIComponent(id)}`);
export const listSlackRecipients = () => reviewRequest('/slack-recipients');
export const previewSlackFollowup = (id, patch) => reviewRequest(`/actions/${encodeURIComponent(id)}/slack-preview`, { method: 'POST', body: JSON.stringify(patch) });
export const sendSlackViaAgent = id => reviewRequest(`/actions/${encodeURIComponent(id)}/slack-send-agent`, { method: 'POST', body: JSON.stringify({}) });

export async function syncToCRM(analysis, sourceContent) {
  // Collect unique contact names from promises and actions to tell the agent who to sync.
  const contacts = [];
  for (const p of analysis.promises || []) {
    if (p.customerName) contacts.push(p.customerName);
  }
  for (const a of analysis.actions || []) {
    if (a.ownerName) contacts.push(a.ownerName);
  }
  const unique = [...new Set(contacts)];

  if (!unique.length) {
    throw new Error('No contacts were identified in this extraction to sync.');
  }

  // Send the original source text so the agent can extract all available details
  // (email, phone, company, title, etc.) without needing to ask the user again.
  const message = [
    `Please create or update the following contacts in HubSpot CRM using the details available in the source text below. Do not ask for information that is already present in the source.`,
    ``,
    `Contacts to sync: ${unique.join(', ')}`,
    ``,
    `Source text:`,
    `---`,
    sourceContent || '(no source text available)',
    `---`,
  ].join('\n');

  return chatAgent(message);
}

export async function chatAgent(message, history = []) {
  let response;
  try {
    response = await fetch(`${API_BASE}/chat/agent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history }), signal: AbortSignal.timeout(90000),
    });
  } catch {
    throw new Error('Cannot reach the agent or the request timed out. Please try again.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.success) throw new Error(data?.error ? `${data.error}${data.code ? ` (${data.code})` : ''}` : 'Agent is unavailable.');
  if (typeof data.reply !== 'string') throw new Error('The agent returned an invalid response.');
  return data.reply;
}

export async function transcribeAudio(file) {
  // file may be a File (from disk) or a Blob (from mic recorder — no .name)
  if (file.name && !file.name.toLowerCase().endsWith('.wav')) throw new Error('Choose a PCM WAV file. Use Video Upload for MP4.');
  if (!file.size || file.size > 8 * 1024 * 1024) throw new Error('Choose a WAV file between 1 byte and 8 MiB.');
  let response;
  try { response = await fetch(`${API_BASE}/transcribe`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: file, signal: AbortSignal.timeout(115000) }); }
  catch { throw new Error('Speech service could not be reached or timed out. Retry manually.'); }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.success) throw new Error(data?.error || 'Transcription unavailable');
  if (typeof data.transcript !== 'string' || !Array.isArray(data.segments) || !Number.isFinite(data.audio?.durationSeconds)) throw new Error('Invalid speech response');
  return data;
}

export async function transcribeVideo(file, onStage = () => {}) {
  if (!file.name.toLowerCase().endsWith('.mp4')) throw new Error('Choose an MP4 video.');
  if (!file.size || file.size > 32 * 1024 * 1024) throw new Error('Choose an MP4 between 1 byte and 32 MiB.');
  let response;
  try { response = await fetch(`${API_BASE}/transcribe/video`, { method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body: file, signal: AbortSignal.timeout(165000) }); }
  catch { throw new Error('Video service could not be reached or timed out. Retry manually.'); }
  if (!response.ok) { const data = await response.json().catch(() => null); throw new Error(data?.error || 'Video processing unavailable'); }
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = '', result, size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024) throw new Error('Video response exceeds the limit');
      pending += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const event = JSON.parse(pending.slice(0, newline)); pending = pending.slice(newline + 1);
        if (event.success === false) throw new Error(event.error || 'Video transcription failed');
        if (['extracting', 'transcribing'].includes(event.stage)) onStage(event.stage);
        if (event.success === true) result = event;
      }
    }
    if (pending.trim() || !result || typeof result.transcript !== 'string' || !Array.isArray(result.segments) || !Number.isFinite(result.audio?.durationSeconds)) throw new Error('Incomplete video transcription response');
    return result;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
