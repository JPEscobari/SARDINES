import { useState } from 'react';
import { Button, Select, SelectItem, TextArea, InlineLoading, InlineNotification, Tile } from '@carbon/react';
import { analyzeText, saveForReview } from '../services/api';
import './IngestionPanel.css';
import AudioUpload from './AudioUpload';

export default function IngestionPanel({ onSaved }) {
  const [transcribing, setTranscribing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  const [saveError, setSaveError] = useState('');
  const [sourceType, setSourceType] = useState('meeting_note');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [analysis, setAnalysis] = useState(null);
  async function analyze(event) {
    event.preventDefault();
    if (loading) return;
    setAnalysis(null);
    setSaved('');
    setSaveError('');
    if (!content.trim() || content.length > 20000) {
      setError('Enter source text between 1 and 20,000 characters.');
      return;
    }
    setError('');
    setLoading(true);
    try { setAnalysis((await analyzeText(sourceType, content)).analysis); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }
  function changeContent(value) { setSaved(''); setSaveError(''); setContent(value); setAnalysis(null); setError(''); }
  async function save() {
    if (saving || !analysis) return;
    setSaving(true); setSaveError('');
    try {
      const result = await saveForReview(sourceType, content, analysis);
      setSaved(result.duplicate ? 'Already saved. Existing review records were preserved.' : 'Saved for review in the Promise Queue.');
      onSaved?.();
    } catch (err) { setSaveError(err.message); }
    finally { setSaving(false); }
  }
  return (
    <section className="ingestion-panel" aria-labelledby="ingestion-title">
      <h2 id="ingestion-title">Analyze meeting notes, buyer email or audio</h2>
      <p>Extract commitments and evidence for review. Analysis is not saved until you choose Save for Review. No messages are sent.</p>
      <form onSubmit={analyze}>
        <Select id="ingestion-source" labelText="Source type" value={sourceType} disabled={loading || saving || transcribing}
          onChange={e => { setSourceType(e.target.value); changeContent(''); }}>
          <SelectItem value="meeting_note" text="Meeting Notes" />
          <SelectItem value="buyer_email" text="Buyer Email" />
          <SelectItem value="audio_transcript" text="Audio / Voice Memo" />
        </Select>
        {sourceType === 'audio_transcript' && <AudioUpload disabled={loading || saving} onBusy={setTranscribing} onTranscript={changeContent} />}
        <TextArea id="ingestion-content" labelText={sourceType === 'audio_transcript' ? 'Editable Transcript' : 'Source text'} rows={6} value={content}
          disabled={loading || saving || transcribing} onChange={e => changeContent(e.target.value)}
          helperText={`${content.length.toLocaleString()} / 20,000 characters`} />
        <Button type="submit" disabled={loading || saving || transcribing}>{sourceType === 'audio_transcript' ? 'Analyze Transcript' : 'Analyze'}</Button>
        {loading && <InlineLoading description="Analyzing with IBM Orchestrate…" />}
      </form>
      {error && <InlineNotification kind="error" title="Analysis failed" subtitle={error} hideCloseButton />}
      {analysis && <div className="analysis-results" aria-live="polite">
        <Button onClick={save} disabled={saving || !!saved}>Save for Review</Button>
        {saving && <InlineLoading description="Saving review records…" />}
        {saved && <InlineNotification kind="success" title="Stored" subtitle={saved} hideCloseButton />}
        {saveError && <InlineNotification kind="error" title="Save failed" subtitle={saveError} hideCloseButton />}
        <h3>Executive Summary</h3><p>{analysis.summary || 'No summary returned.'}</p>
        <p>Extracted fields require review. Date text may refer to a delivery rather than a commitment deadline.</p>
        {[
          ['Customer Promises', analysis.promises], ['Action Items', analysis.actions], ['Blockers', analysis.blockers],
        ].map(([label, items]) => <section key={label}>
          <h3>{label}</h3>
          {!items.length && <p>None identified.</p>}
          {items.map((item, index) => <Tile key={index}>
            <h4>{item.title || item.description}</h4>
            {'customerName' in item && <p>Customer: {item.customerName || 'Unresolved'}</p>}
            {'ownerName' in item && <p>Owner: {item.ownerName ? `${item.ownerName} (identity unverified)` : 'Unresolved'}</p>}
            {'dueText' in item && <>
              <p>Deadline text: {item.dueText || 'Not specified'} (requires review)</p>
              <p>Extracted date: {item.dueAt || 'Unresolved'} — no reminder scheduled</p>
            </>}
            <p>Source evidence</p><blockquote>{item.sourceQuote}</blockquote>
          </Tile>)}
        </section>)}
      </div>}
    </section>
  );
}
