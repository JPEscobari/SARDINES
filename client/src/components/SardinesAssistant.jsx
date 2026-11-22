import { useState, useRef, useEffect } from 'react';
import { Button, TextArea, InlineLoading, InlineNotification, Tile } from '@carbon/react';
import { Send, Attachment, Microphone, Stop } from '@carbon/icons-react';
import { analyzeText, saveForReview, transcribeAudio, chatAgent, syncToCRM } from '../services/api';
import AudioUpload from './AudioUpload';
import { useMicRecorder } from '../hooks/useMicRecorder';
import './SardinesAssistant.css';

const WELCOME = {
  role: 'assistant',
  content: `Hi! I'm SARDINES 🐟 — your Sales AI for tracking customer commitments and follow-ups.

Ask me anything or paste your meeting notes and emails directly — I'll handle the rest 😉.

Here's what I can do:
• Find your next Task or Blockers from meeting notes or buyer emails
• Look up contacts and deals in your customer database.
• Retrieve messages from your Slack workspace

What would you like to work on today?`,
};

const QUICK_STARTS = [
  'Analyze these meeting notes for customer commitments',
  'Show me the 10 most recent contacts in HubSpot',
  'List all the channels in our Slack workspace',
];

function isExtractionResult(text) {
  try {
    const obj = JSON.parse(text);
    return obj && Array.isArray(obj.promises) && Array.isArray(obj.actions) && Array.isArray(obj.blockers);
  } catch { return false; }
}

function ExtractionResult({ analysis, sourceContent, sourceType, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  const [saveError, setSaveError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState('');
  const [syncError, setSyncError] = useState('');

  async function save() {
    if (saving || saved) return;
    setSaving(true); setSaveError('');
    try {
      const result = await saveForReview(sourceType, sourceContent, analysis);
      setSaved(result.duplicate ? 'Already saved. Existing review records were preserved.' : 'Saved for review in the Task Queue.');
      onSaved?.();
    } catch (err) { setSaveError(err.message); }
    finally { setSaving(false); }
  }

  async function syncCRM() {
    if (syncing || syncResult) return;
    setSyncing(true); setSyncError('');
    try {
      const reply = await syncToCRM(analysis, sourceContent);
      setSyncResult(reply);
    } catch (err) { setSyncError(err.message); }
    finally { setSyncing(false); }
  }

  const hasItems = !!(analysis.promises?.length || analysis.actions?.length || analysis.blockers?.length);

  return (
    <div className="sa-extraction">
      <div className="sa-extraction-header">
        <div>
          <strong>Analysis complete.</strong>
          <p>{analysis.summary}</p>
          {hasItems && <p className="sa-muted">Extracted fields require review. Nothing is saved yet.</p>}
        </div>
        {hasItems && (
          <div className="sa-extraction-actions">
            <Button size="sm" kind="secondary" onClick={syncCRM} disabled={syncing || !!syncResult}>👤 Sync Contact to CRM</Button>
            <Button size="sm" onClick={save} disabled={saving || !!saved}>Save for Review</Button>
          </div>
        )}
      </div>
      {saving && <InlineLoading description="Saving review records…" />}
      {saved && <InlineNotification kind="success" title="Stored" subtitle={saved} hideCloseButton />}
      {saved && <a href="#/promises" className="sa-link">Open Task Queue →</a>}
      {saveError && <InlineNotification kind="error" title="Save failed" subtitle={saveError} hideCloseButton />}
      {syncing && <InlineLoading description="Syncing contacts to HubSpot…" />}
      {syncResult && <InlineNotification kind="success" title="CRM sync complete!" subtitle={syncResult} hideCloseButton />}
      {syncError && <InlineNotification kind="error" title="CRM sync failed" subtitle={syncError} hideCloseButton />}
      {(() => {
        const allEmpty = !analysis.promises?.length && !analysis.actions?.length && !analysis.blockers?.length;
        if (allEmpty) return <p className="sa-muted">No actionable tasks were found in these messages.</p>;
        return [['Customer Tasks', analysis.promises], ['Action Items', analysis.actions], ['Blockers', analysis.blockers]].map(([label, items]) => (
          <section key={label}>
            <h4 className="sa-section-label">{label}</h4>
            {!items?.length && <p className="sa-muted">None identified.</p>}
            {items?.map((item, i) => (
              <Tile key={i} className="sa-item-tile">
                <strong>{item.title || item.description}</strong>
                {'customerName' in item && <p>Customer: {item.customerName || 'Unresolved'}</p>}
                {'ownerName' in item && <p>Owner: {item.ownerName ? `${item.ownerName} (identity unverified)` : 'Unresolved'}</p>}
                {'dueText' in item && <p>Deadline: {item.dueText || 'Not specified'}{item.dueAt ? ` · ${item.dueAt}` : ''}</p>}
                <blockquote className="sa-quote">{item.sourceQuote}</blockquote>
              </Tile>
            ))}
          </section>
        ));
      })()}
    </div>
  );
}

function MessageBubble({ msg, sourceContent, sourceType, onSaved, onGenerateTask, generatingTask }) {
  if (msg.role === 'user') {
    return (
      <div className="sa-bubble sa-bubble--user">
        <span className="sa-role">You</span>
        <p className="sa-bubble-text">{msg.content}</p>
      </div>
    );
  }
  if (msg.analysis) {
    return (
      <div className="sa-bubble sa-bubble--assistant">
        <span className="sa-role">SARDINES</span>
        <ExtractionResult
          analysis={msg.analysis}
          sourceContent={msg.sourceContent ?? sourceContent}
          sourceType={msg.sourceType ?? sourceType}
          onSaved={onSaved}
        />
      </div>
    );
  }
  return (
    <div className="sa-bubble sa-bubble--assistant">
      <span className="sa-role">SARDINES</span>
      <p className="sa-bubble-text" style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</p>
      {onGenerateTask && (
        <div className="sa-generate-task-row">
          <Button size="sm" kind="ghost" onClick={onGenerateTask} disabled={generatingTask}>
            {generatingTask ? '⏳ Identifying tasks…' : '🎯 Generate Task'}
          </Button>
        </div>
      )}
    </div>
  );
}

export default function SardinesAssistant({ onSaved }) {
  const [messages, setMessages] = useState([WELCOME]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showAttach, setShowAttach] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [micStage, setMicStage] = useState(''); // '' | 'recording' | 'processing'
  const [sourceType, setSourceType] = useState('meeting_note');
  const [lastContent, setLastContent] = useState('');
  const [generatingTaskIdx, setGeneratingTaskIdx] = useState(null);
  const lastMsgRef = useRef(null);
  const { recording, start: startMic, stop: stopMic, error: micError } = useMicRecorder();

  useEffect(() => {
    lastMsgRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, loading]);

  async function send(text) {
    const trimmed = (text || input).trim();
    if (!trimmed || loading) return;
    setInput('');
    setError('');
    // `messages` is captured from the current render closure — it is already up-to-date.
    // Skip the welcome message (index 0) and serialise analysis bubbles as JSON strings.
    const history = messages.slice(1).map(m => ({
      role: m.role,
      content: m.analysis ? JSON.stringify(m.analysis) : m.content,
    }));
    setMessages(prev => [...prev, { role: 'user', content: trimmed }]);
    sendWithHistory(trimmed, history);
  }

  async function sendWithHistory(trimmed, history) {
    setLoading(true);
    setLastContent(trimmed);
    // Only run structured extraction when the user loaded a transcript via the attach panel.
    // All other messages — including voice queries — go straight to the agent as plain chat.
    const isTranscript = ['audio_transcript', 'video_transcript'].includes(sourceType);
    try {
      if (isTranscript) {
        const data = await analyzeText(sourceType, trimmed);
        setMessages(prev => [...prev, { role: 'assistant', analysis: data.analysis }]);
        // Reset sourceType so follow-up messages go through chat, not extraction
        setSourceType('meeting_note');
      } else {
        const reply = await chatAgent(trimmed, history);
        // The agent may return a JSON extraction when given meeting notes or emails.
        // Detect this and render it as a structured result with a Save button.
        if (isExtractionResult(reply)) {
          const analysis = JSON.parse(reply);
          setMessages(prev => [...prev, { role: 'assistant', analysis }]);
        } else {
          setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
        }
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: err.message }]);
    } finally { setLoading(false); }
  }

  async function handleGenerateTask(idx, content) {
    setGeneratingTaskIdx(idx);
    // Strip markdown decoration so sourceQuote evidence checks pass.
    // The agent wraps names/dates in **bold** and *italic* which aren't in the
    // original Slack text — removing them gives the extractor clean prose to quote from.
    const plain = content
      .replace(/\*\*(.+?)\*\*/g, '$1')   // **bold** → bold
      .replace(/\*(.+?)\*/g, '$1')        // *italic* → italic
      .replace(/`(.+?)`/g, '$1')          // `code` → code
      .replace(/–/g, '-');                // em-dash → hyphen
    try {
      const data = await analyzeText('slack_message', plain);
      // Store plain (stripped) content and sourceType on the message so ExtractionResult
      // uses the correct text for saveForReview and syncToCRM — not the user's chat prompt.
      setMessages(prev => prev.map((m, i) => i === idx
        ? { role: 'assistant', analysis: data.analysis, sourceContent: plain, sourceType: 'slack_message' }
        : m));
    } catch (err) {
      setError(err.message);
    } finally {
      setGeneratingTaskIdx(null);
    }
  }

  function handleTranscript(transcript) {
    setShowAttach(false);
    setInput(transcript);
  }

  async function handleMicClick() {
    if (recording) {
      // Stop and transcribe
      setMicStage('processing');
      const wav = await stopMic();
      if (!wav) { setMicStage(''); return; }
      setTranscribing(true);
      try {
        const data = await transcribeAudio(wav);
        setInput(data.transcript);
      } catch (e) {
        setError(e.message);
      } finally {
        setTranscribing(false);
        setMicStage('');
      }
    } else {
      const ok = await startMic();
      if (ok) setMicStage('recording');
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  return (
    <div className="sardines-assistant">
      <div className="sa-messages">
        {messages.map((msg, i) => (
          <div key={i} ref={i === messages.length - 1 ? lastMsgRef : null}>
            <MessageBubble
              msg={msg}
              sourceContent={lastContent}
              sourceType={sourceType}
              onSaved={onSaved}
              onGenerateTask={msg.role === 'assistant' && !msg.analysis && i > 0 ? () => handleGenerateTask(i, msg.content) : null}
              generatingTask={generatingTaskIdx === i}
            />
          </div>
        ))}
        {loading && <div className="sa-bubble sa-bubble--assistant"><InlineLoading description="SARDINES is thinking…" /></div>}
      </div>

      {messages.length === 1 && (
        <div className="sa-quick-starts">
          {QUICK_STARTS.map(q => (
            <button key={q} className="sa-quick-btn" onClick={() => send(q)}>{q}</button>
          ))}
        </div>
      )}

      {(error || micError) && <InlineNotification kind="error" title="Error" subtitle={error || micError} hideCloseButton onCloseButtonClick={() => setError('')} />}

      {showAttach && (
        <div className="sa-attach-panel">
          <div className="sa-attach-header">
            <strong>Attach audio or video</strong>
            <button className="sa-close-btn" onClick={() => setShowAttach(false)}>✕</button>
          </div>
          <div className="sa-attach-tabs">
            <button className={sourceType === 'audio_transcript' ? 'active' : ''} onClick={() => setSourceType('audio_transcript')}>Voice Memo (WAV)</button>
            <button className={sourceType === 'video_transcript' ? 'active' : ''} onClick={() => setSourceType('video_transcript')}>Video (MP4)</button>
          </div>
          <AudioUpload key={sourceType} video={sourceType === 'video_transcript'} disabled={loading} onBusy={setTranscribing} onTranscript={handleTranscript} />
        </div>
      )}

      <div className="sa-input-row">
        <button className="sa-attach-btn" onClick={() => setShowAttach(v => !v)} title="Attach audio or video" disabled={loading || transcribing || recording}>
          <Attachment size={20} />
        </button>
        <button
          className={`sa-attach-btn sa-mic-btn${recording ? ' sa-mic-btn--recording' : ''}`}
          onClick={handleMicClick}
          title={recording ? 'Stop recording' : micStage === 'processing' ? 'Processing…' : 'Record voice message'}
          disabled={loading || transcribing && !recording || micStage === 'processing'}
          aria-label={recording ? 'Stop recording' : 'Record voice message'}
        >
          {recording ? <Stop size={20} /> : <Microphone size={20} />}
        </button>
        {micStage === 'recording' && <span className="sa-mic-indicator" aria-live="polite">Recording…</span>}
        {micStage === 'processing' && <span className="sa-mic-indicator" aria-live="polite">Transcribing…</span>}
        <TextArea
          id="sa-input"
          labelText=""
          hideLabel
          placeholder="Ask anything or paste meeting notes / emails…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading || transcribing}
          rows={2}
        />
        <Button renderIcon={Send} iconDescription="Send" hasIconOnly onClick={() => send()} disabled={loading || transcribing || !input.trim()} />
      </div>
      <p className="sa-hint">Shift+Enter for new line · Enter to send</p>
    </div>
  );
}
