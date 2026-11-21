import { useState } from 'react';
import { Button, Tabs, TabList, Tab, TabPanels, TabPanel, TextArea, InlineLoading, InlineNotification, Tile } from '@carbon/react';
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
  const isTranscript = ['audio_transcript', 'video_transcript'].includes(sourceType);
  const methods = [['meeting_note', 'Meeting Notes'], ['buyer_email', 'Buyer Email'], ['audio_transcript', 'Audio / Voice Memo'], ['video_transcript', 'Video Upload']];
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
      setSaved(result.duplicate ? 'Already saved. Existing review records were preserved.' : 'Saved for review in the Task Queue.');
      onSaved?.();
    } catch (err) { setSaveError(err.message); }
    finally { setSaving(false); }
  }
  return (
    <section className="ingestion-panel" aria-labelledby="ingestion-title">
      <h2 id="ingestion-title">Start with a source</h2>
      <p className="muted">A source is the original conversation, note or recording behind a commitment.</p>
      <ol className="stage-bar" aria-label="Analysis progress"><li className={!analysis ? 'current' : ''}>1 · Input</li><li className={loading ? 'current' : ''}>2 · Analyze</li><li className={analysis ? 'current' : ''}>3 · Review &amp; save</li></ol>
      <Tabs selectedIndex={methods.findIndex(m => m[0] === sourceType)} onChange={({ selectedIndex }) => { setSourceType(methods[selectedIndex][0]); changeContent(''); }}>
        <TabList aria-label="Source input method" contained>{methods.map(([value, label]) => <Tab key={value} disabled={loading || saving || transcribing}>{label}</Tab>)}</TabList>
        <TabPanels>{methods.map(([value]) => <TabPanel key={value}>{sourceType === value && <form onSubmit={analyze}>
        {isTranscript && <AudioUpload key={sourceType} video={sourceType === 'video_transcript'} disabled={loading || saving} onBusy={setTranscribing} onTranscript={changeContent} />}
        <TextArea id="ingestion-content" labelText={isTranscript ? 'Editable Transcript' : sourceType === 'buyer_email' ? 'Buyer email' : 'Meeting notes'} placeholder="Include the original wording so every suggestion can be checked against its evidence." rows={8} value={content}
          disabled={loading || saving || transcribing} onChange={e => changeContent(e.target.value)}
          helperText={`${content.length.toLocaleString()} / 20,000 characters`} />
        <Button type="submit" disabled={loading || saving || transcribing || !content.trim()}>{isTranscript ? 'Analyze Transcript' : 'Analyze'}</Button>
        {loading && <InlineLoading description="Analyzing with IBM Orchestrate…" />}
      </form>}</TabPanel>)}</TabPanels>
      </Tabs>
      {error && <InlineNotification kind="error" title="Analysis failed" subtitle={error} hideCloseButton />}
      {analysis && <div className="analysis-results" aria-live="polite">
        <div className="section-heading"><div><h2>Review the suggestions</h2><p>{saved ? 'Saved for review. Continue in the Task Queue.' : 'Check evidence and unresolved fields. Nothing is saved yet.'}</p></div><Button onClick={save} disabled={saving || !!saved}>💾 Save to Tasks</Button></div>
        {saving && <InlineLoading description="Saving review records…" />}
        {saved && <InlineNotification kind="success" title="Stored" subtitle={saved} hideCloseButton />}
        {saved && <a href="#/promises">Open Task Queue →</a>}
        {saveError && <InlineNotification kind="error" title="Save failed" subtitle={saveError} hideCloseButton />}
        <h3>Executive Summary</h3><p>{analysis.summary || 'No summary returned.'}</p>
        <p>Extracted fields require review. Date text may refer to a delivery rather than a commitment deadline.</p>
        {[
          ['Customer Tasks', analysis.promises], ['Action Items', analysis.actions], ['Blockers', analysis.blockers],
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
