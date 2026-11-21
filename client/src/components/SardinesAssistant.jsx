import { useState, useRef, useEffect } from 'react';
import { Button, TextArea, InlineLoading, InlineNotification, Tile } from '@carbon/react';
import { Send, Attachment } from '@carbon/icons-react';
import { analyzeText, saveForReview } from '../services/api';
import AudioUpload from './AudioUpload';
import './SardinesAssistant.css';

const WELCOME = {
  role: 'assistant',
  content: `Hi! I'm SARDINES — your Sales AI for tracking customer commitments and follow-ups.

You can talk to me in natural language or paste your meeting notes and emails directly — I'll handle the rest.

Here's what I can do:
• Extract Promises, Actions, and Blockers from meeting notes or buyer emails
• Look up contacts and deals in your HubSpot CRM
• Retrieve message history and users from your Slack workspace
• Save extracted commitments to your review queue

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

  async function save() {
    if (saving || saved) return;
    setSaving(true); setSaveError('');
    try {
      const result = await saveForReview(sourceType, sourceContent, analysis);
      setSaved(result.duplicate ? 'Already saved. Existing review records were preserved.' : 'Saved for review in the Promise Queue.');
      onSaved?.();
    } catch (err) { setSaveError(err.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="sa-extraction">
      <div className="sa-extraction-header">
        <div>
          <strong>Extraction complete</strong>
          <p>{analysis.summary}</p>
          <p className="sa-muted">Extracted fields require review. Nothing is saved yet.</p>
        </div>
        <Button size="sm" onClick={save} disabled={saving || !!saved}>Save for Review</Button>
      </div>
      {saving && <InlineLoading description="Saving review records…" />}
      {saved && <InlineNotification kind="success" title="Stored" subtitle={saved} hideCloseButton />}
      {saved && <a href="#/promises" className="sa-link">Open Promise Queue →</a>}
      {saveError && <InlineNotification kind="error" title="Save failed" subtitle={saveError} hideCloseButton />}
      {[['Customer Promises', analysis.promises], ['Action Items', analysis.actions], ['Blockers', analysis.blockers]].map(([label, items]) => (
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
      ))}
    </div>
  );
}

function MessageBubble({ msg, sourceContent, sourceType, onSaved }) {
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
        <ExtractionResult analysis={msg.analysis} sourceContent={sourceContent} sourceType={sourceType} onSaved={onSaved} />
      </div>
    );
  }
  return (
    <div className="sa-bubble sa-bubble--assistant">
      <span className="sa-role">SARDINES</span>
      <p className="sa-bubble-text" style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</p>
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
  const [sourceType, setSourceType] = useState('meeting_note');
  const [lastContent, setLastContent] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  async function send(text) {
    const trimmed = (text || input).trim();
    if (!trimmed || loading) return;
    setInput('');
    setError('');
    setMessages(prev => [...prev, { role: 'user', content: trimmed }]);
    setLoading(true);
    setLastContent(trimmed);
    try {
      const data = await analyzeText(sourceType, trimmed);
      const analysis = data.analysis;
      setMessages(prev => [...prev, { role: 'assistant', analysis }]);
    } catch (err) {
      // If structured extraction fails (e.g. plain question), show error as chat bubble
      setMessages(prev => [...prev, { role: 'assistant', content: err.message }]);
    } finally { setLoading(false); }
  }

  function handleTranscript(transcript) {
    setShowAttach(false);
    setInput(transcript);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  return (
    <div className="sardines-assistant">
      <div className="sa-messages">
        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} sourceContent={lastContent} sourceType={sourceType} onSaved={onSaved} />
        ))}
        {loading && <div className="sa-bubble sa-bubble--assistant"><InlineLoading description="SARDINES is thinking…" /></div>}
        <div ref={bottomRef} />
      </div>

      {messages.length === 1 && (
        <div className="sa-quick-starts">
          {QUICK_STARTS.map(q => (
            <button key={q} className="sa-quick-btn" onClick={() => send(q)}>{q}</button>
          ))}
        </div>
      )}

      {error && <InlineNotification kind="error" title="Error" subtitle={error} hideCloseButton onCloseButtonClick={() => setError('')} />}

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
        <button className="sa-attach-btn" onClick={() => setShowAttach(v => !v)} title="Attach audio or video" disabled={loading || transcribing}>
          <Attachment size={20} />
        </button>
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
