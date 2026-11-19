import { useState } from 'react';
import { Button, InlineLoading, InlineNotification } from '@carbon/react';
import { transcribeAudio, transcribeVideo } from '../services/api';
export default function AudioUpload({ disabled, onTranscript, onBusy, video = false }) {
  const [stage, setStage] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  async function transcribe() {
    if (!file || busy) return;
    setBusy(true); onBusy(true); setStage(video ? 'Uploading and validating video...' : 'Transcribing with IBM Speech to Text...'); setError(''); setResult(null); onTranscript('');
    try { const data = await (video ? transcribeVideo(file, stage => setStage(stage === 'extracting' ? 'Extracting audio...' : 'Transcribing with IBM Speech to Text...')) : transcribeAudio(file)); setResult(data); onTranscript(data.transcript); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); onBusy(false); }
  }
  return <div>
    {video ? <p>Upload a short MP4 with one audio track. Default limits: 32 MiB and two minutes. Only audio is analyzed. Media is temporarily processed locally; extracted audio is sent to IBM when you click Transcribe.</p> : <p>Upload a 16-bit PCM WAV voice memo, mono or stereo, 16–48 kHz. Default limits: 8 MiB and two minutes. No audio is stored. Transcription sends audio to IBM only when you click Transcribe.</p>}
    <label htmlFor="audio-upload">{video ? 'Video file' : 'Audio file'}</label>
    <input id="audio-upload" type="file" accept={video ? '.mp4,video/mp4' : '.wav,audio/wav,audio/x-wav'} disabled={disabled || busy}
      onChange={e => { setFile(e.target.files?.[0] || null); setError(''); setResult(null); onTranscript(''); }} />
    {file && <p>Selected: {file.name} ({Math.ceil(file.size / 1024)} KiB)</p>}
    <Button type="button" disabled={!file || disabled || busy} onClick={transcribe}>Transcribe</Button>
    {busy && <InlineLoading description={stage} />}
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
