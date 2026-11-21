import { useRef, useState, useCallback } from 'react';

// Maximum recording duration in milliseconds. Matches STT_MAX_DURATION_SECONDS default (120s).
const MAX_DURATION_MS = 120_000;

/**
 * Encodes a Float32Array of PCM samples into a 16-bit mono WAV Blob.
 * AudioContext always gives us Float32 (-1..1); WAV/PCM needs Int16.
 */
function encodeWav(float32, sampleRate) {
  const numSamples = float32.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  function writeStr(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }
  function writeU16(offset, v) { view.setUint16(offset, v, true); }
  function writeU32(offset, v) { view.setUint32(offset, v, true); }

  writeStr(0, 'RIFF');
  writeU32(4, 36 + numSamples * 2);       // ChunkSize
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  writeU32(16, 16);                        // Subchunk1Size (PCM)
  writeU16(20, 1);                         // AudioFormat   (PCM = 1)
  writeU16(22, 1);                         // NumChannels   (mono)
  writeU32(24, sampleRate);                // SampleRate
  writeU32(28, sampleRate * 2);            // ByteRate
  writeU16(32, 2);                         // BlockAlign
  writeU16(34, 16);                        // BitsPerSample
  writeStr(36, 'data');
  writeU32(40, numSamples * 2);            // Subchunk2Size

  // Convert Float32 to Int16
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Merges multiple Float32Array chunks into one.
 */
function mergeChunks(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) { merged.set(c, offset); offset += c.length; }
  return merged;
}

/**
 * useMicRecorder — captures microphone audio, then re-encodes it as a
 * 16-bit mono PCM WAV Blob that the existing /api/transcribe endpoint accepts.
 *
 * Returns: { recording, start, stop, error }
 *   start() → requests mic permission and begins recording
 *   stop()  → stops recording and returns a Promise<Blob> (WAV)
 */
export function useMicRecorder() {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState('');
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);
  const timeoutRef = useRef(null);

  const start = useCallback(async () => {
    setError('');
    let stream;
    try {
      stream = mediaRef.current?.stream;
      if (!stream) stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch {
      setError('Microphone access denied. Allow microphone permission and try again.');
      return false;
    }
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream);
    mediaRef.current = { recorder, stream };
    recorder.ondataavailable = e => { if (e.data?.size > 0) chunksRef.current.push(e.data); };
    recorder.start(100); // collect in 100ms chunks
    setRecording(true);
    // Auto-stop at max duration
    timeoutRef.current = setTimeout(() => recorder.state === 'recording' && recorder.stop(), MAX_DURATION_MS);
    return true;
  }, []);

  const stop = useCallback(() => new Promise(resolve => {
    clearTimeout(timeoutRef.current);
    const ref = mediaRef.current;
    if (!ref?.recorder || ref.recorder.state === 'inactive') { setRecording(false); resolve(null); return; }
    ref.recorder.onstop = async () => {
      setRecording(false);
      // Stop all mic tracks so the browser releases the indicator light
      ref.stream.getTracks().forEach(t => t.stop());
      mediaRef.current = null;
      const blob = new Blob(chunksRef.current, { type: ref.recorder.mimeType });
      chunksRef.current = [];
      try {
        // Decode the browser's native format (WebM/Opus/etc) through AudioContext
        const arrayBuffer = await blob.arrayBuffer();
        const ctx = new AudioContext();
        const decoded = await ctx.decodeAudioData(arrayBuffer);
        await ctx.close();

        // Resample to 16 kHz mono via OfflineAudioContext.
        // This guarantees the output sample rate is in the server's allowlist
        // regardless of what the hardware or OS reports (e.g. 44100, 48000, 96000).
        const TARGET_RATE = 16000;
        const numChannels = decoded.numberOfChannels;
        const targetLength = Math.ceil(decoded.length * TARGET_RATE / decoded.sampleRate);
        const offline = new OfflineAudioContext(1, targetLength, TARGET_RATE);
        const source = offline.createBufferSource();
        // If multichannel, mix down to mono by creating a mono buffer at the original rate
        if (numChannels > 1) {
          const tmpCtx = new AudioContext();
          const mono = tmpCtx.createBuffer(1, decoded.length, decoded.sampleRate);
          await tmpCtx.close();
          const monoData = mono.getChannelData(0);
          for (let ch = 0; ch < numChannels; ch++) {
            const chData = decoded.getChannelData(ch);
            for (let i = 0; i < decoded.length; i++) monoData[i] += chData[i] / numChannels;
          }
          source.buffer = mono;
        } else {
          source.buffer = decoded;
        }
        source.connect(offline.destination);
        source.start(0);
        const resampled = await offline.startRendering();
        resolve(encodeWav(resampled.getChannelData(0), TARGET_RATE));
      } catch {
        setError('Could not encode audio. Try a different browser or use a WAV file instead.');
        resolve(null);
      }
    };
    ref.recorder.stop();
  }), []);

  return { recording, start, stop, error };
}
