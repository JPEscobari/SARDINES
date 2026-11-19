import { useState } from 'react';
import { Button, InlineLoading, InlineNotification } from '@carbon/react';
import { transcribeAudio } from '../services/api';
export default function AudioUpload({ disabled, onTranscript, onBusy }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  async function transcribe() {
    if (!file || busy) return;
    setBusy(true); onBusy(true); setError(''); setResult(null); onTranscript('');
    try { const data = await transcribeAudio(file); setResult(data); onTranscript(data.transcript); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); onBusy(false); }
  }
  return <div>
    <p>Upload a 16-bit PCM WAV voice memo, mono or stereo, 16–48 kHz. Default limits: 8 MiB and two minutes. No audio is stored. Transcription sends audio to IBM only when you click Transcribe.</p>
    <label htmlFor="audio-upload">Audio file</label>
    <input id="audio-upload" type="file" accept=".wav,audio/wav,audio/x-wav" disabled={disabled || busy}
      onChange={e => { setFile(e.target.files?.[0] || null); setError(''); setResult(null); onTranscript(''); }} />
    {file && <p>Selected: {file.name} ({Math.ceil(file.size / 1024)} KiB)</p>}
    <Button type="button" disabled={!file || disabled || busy} onClick={transcribe}>Transcribe</Button>
    {busy && <InlineLoading description="Transcribing with IBM Speech to Text…" />}
    {error && <InlineNotification kind="error" title="Transcription failed" subtitle={error} hideCloseButton />}
    {result && <div>
      <p>{result.empty ? 'No speech recognized. Try a clearer recording or enter a transcript below.' : 'Review and edit the transcript before analysis. Speaker identities are not verified.'}</p>
      <p>Audio duration: {result.audio.durationSeconds.toFixed(1)} seconds · Model: {result.model}</p>
      <details><summary>Original recognition metadata (not updated by transcript edits)</summary>
        {result.segments.map((s, i) => <p key={i}>{s.text} · Confidence: {s.confidence === undefined ? 'Unavailable' : s.confidence.toFixed(2)}
          {s.timestamps?.length ? ` · Timing: ${s.timestamps[0][1]}–${s.timestamps.at(-1)[2]} seconds` : ''}</p>)}
      </details>
    </div>}
  </div>;
}
