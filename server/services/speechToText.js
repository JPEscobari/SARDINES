const axios = require('axios');
class SpeechError extends Error {
  constructor(code, status, message, httpStatus = null) { super(message); this.code = code; this.status = status; this.httpStatus = httpStatus; }
}
const fail = (code, status, message, httpStatus = null) => { throw new SpeechError(code, status, message, httpStatus); };
function limits(env = process.env) {
  const number = (key, fallback, max) => { const n = Number(env[key] || fallback); if (!Number.isInteger(n) || n < 1 || n > max) fail('STT_CONFIGURATION', 503, 'Invalid speech limits'); return n; };
  return { maxBytes: number('STT_MAX_UPLOAD_BYTES', 8 * 1024 * 1024, 16 * 1024 * 1024), maxSeconds: number('STT_MAX_DURATION_SECONDS', 120, 300) };
}
function inspectWav(buffer, mime, config = limits()) {
  if (!['audio/wav', 'audio/x-wav', 'audio/wave'].includes(mime)) fail('UNSUPPORTED_AUDIO', 415, 'Upload a PCM WAV file');
  if (!Buffer.isBuffer(buffer) || buffer.length < 100) fail('INVALID_AUDIO', 400, 'Audio is empty or too short');
  if (buffer.length > config.maxBytes) fail('AUDIO_TOO_LARGE', 413, 'Audio exceeds the upload limit');
  const invalid = () => fail('INVALID_AUDIO', 400, 'Invalid or unsupported PCM WAV structure');
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE' || buffer.readUInt32LE(4) + 8 !== buffer.length) invalid();
  let format, dataBytes; let pos = 12;
  while (pos < buffer.length) {
    if (pos + 8 > buffer.length) invalid();
    const tag = buffer.toString('ascii', pos, pos + 4), size = buffer.readUInt32LE(pos + 4), start = pos + 8;
    if (start + size + (size % 2) > buffer.length) invalid();
    if (tag === 'fmt ') {
      if (format || size !== 16 || buffer.readUInt16LE(start) !== 1) invalid();
      format = { channels: buffer.readUInt16LE(start + 2), sampleRate: buffer.readUInt32LE(start + 4), byteRate: buffer.readUInt32LE(start + 8), blockAlign: buffer.readUInt16LE(start + 12), bits: buffer.readUInt16LE(start + 14) };
    } else if (tag === 'data') { if (dataBytes !== undefined) invalid(); dataBytes = size; }
    else if (!['JUNK', 'LIST', 'bext'].includes(tag)) invalid();
    pos = start + size + (size % 2);
  }
  if (!format || !dataBytes || ![1, 2].includes(format.channels) || format.bits !== 16 || ![16000, 22050, 24000, 32000, 44100, 48000].includes(format.sampleRate) || format.blockAlign !== format.channels * 2 || format.byteRate !== format.sampleRate * format.blockAlign || dataBytes % format.blockAlign) invalid();
  const durationSeconds = dataBytes / format.byteRate;
  if (durationSeconds > config.maxSeconds) fail('AUDIO_TOO_LONG', 413, 'Audio exceeds the duration limit');
  return { mimeType: 'audio/wav', channels: format.channels, sampleRate: format.sampleRate, durationSeconds, bytes: buffer.length };
}
function parseResponse(data) {
  const invalid = () => fail('STT_RESPONSE_INVALID', 502, 'Speech service returned an invalid response');
  if (!data || !Array.isArray(data.results) || data.results.length > 10000) invalid();
  const segments = data.results.map(result => {
    const a = result.alternatives?.[0];
    if (result.final !== true || !a || typeof a.transcript !== 'string') invalid();
    const segment = { text: a.transcript };
    if (a.confidence !== undefined) { if (!Number.isFinite(a.confidence) || a.confidence < 0 || a.confidence > 1) invalid(); segment.confidence = a.confidence; }
    if (a.timestamps !== undefined) {
      if (!Array.isArray(a.timestamps) || a.timestamps.some(t => !Array.isArray(t) || t.length !== 3 || typeof t[0] !== 'string' || !Number.isFinite(t[1]) || !Number.isFinite(t[2]) || t[1] < 0 || t[2] < t[1])) invalid();
      segment.timestamps = a.timestamps;
    }
    return segment;
  });
  const transcript = segments.map(s => s.text.trim()).filter(Boolean).join(' ');
  if (transcript.length > 20000) fail('TRANSCRIPT_TOO_LONG', 502, 'Transcript exceeds the ingestion limit');
  return { transcript, segments, empty: !transcript };
}
function createSpeechService({ env = process.env, http = axios, onStage = () => {} } = {}) {
  let token, expires = 0;
  function settings() {
    let url; try { url = new URL(env.STT_URL); } catch { fail('STT_URL_INVALID', 503, 'Configure a valid IBM Speech to Text instance URL'); }
    if (!env.STT_API_KEY || url.protocol !== 'https:' || !/^api\.[a-z0-9-]+\.speech-to-text\.watson\.cloud\.ibm\.com$/.test(url.hostname) || url.port || url.username || url.password || url.search || url.hash || !/^\/instances\/[a-zA-Z0-9-]+\/?$/.test(url.pathname)) fail('STT_CONFIGURATION', 503, 'Use the IBM Cloud Speech to Text instance URL and service API key');
    const model = env.STT_MODEL || 'en-US_Multimedia';
    if (!/^en-(US|GB|AU)_Multimedia$/.test(model)) fail('STT_CONFIGURATION', 503, 'Configure an English Multimedia recognition model');
    return { url: url.href.replace(/\/$/, ''), model };
  }
  async function accessToken() {
    onStage('iam_authentication');
    if (token && Date.now() < expires) return token;
    let response;
    try { response = await http.post('https://iam.cloud.ibm.com/identity/token', new URLSearchParams({ grant_type: 'urn:ibm:params:oauth:grant-type:apikey', apikey: env.STT_API_KEY }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000, maxRedirects: 0, maxContentLength: 65536 }); }
    catch (e) { mapError(e, true); }
    const d = response.data;
    if (typeof d?.access_token !== 'string' || !d.access_token || !Number.isFinite(d.expires_in) || d.expires_in <= 0) fail('STT_AUTH_FAILED', 503, 'Speech authentication failed');
    token = d.access_token; expires = Date.now() + Math.max(0, d.expires_in - 60) * 1000; return token;
  }
  function mapError(e, auth = false) {
    const status = Number.isInteger(e.response?.status) ? e.response.status : null;
    const reject = (code, mappedStatus, message) => fail(code, mappedStatus, message, status);
    if (['ECONNABORTED', 'ETIMEDOUT'].includes(e.code)) reject('STT_TIMEOUT', 504, 'Speech service timed out; retry manually');
    if (e.response?.status === 429) reject('STT_RATE_LIMITED', 429, 'Speech service is rate limited; wait before retrying');
    if (auth || [401, 403].includes(e.response?.status)) { token = null; reject('STT_AUTH_FAILED', 503, 'Speech credentials or service access need attention'); }
    if ([400, 415, 422].includes(e.response?.status)) reject('STT_AUDIO_REJECTED', 422, 'Speech service rejected the audio or configured model');
    reject('STT_UNAVAILABLE', 502, 'Speech service unavailable; retry manually');
  }
  return {
    async verifyModel(modelName) {
      onStage('configuration'); const config = settings(); const model = modelName || config.model;
      const bearer = await accessToken(); onStage('model_availability'); let response;
      try { response = await http.get(`${config.url}/v1/models`, { headers: { Authorization: `Bearer ${bearer}` }, timeout: 15000, maxRedirects: 0, maxContentLength: 2 * 1024 * 1024 }); }
      catch (e) { mapError(e); }
      if (!Array.isArray(response.data?.models)) fail('STT_RESPONSE_INVALID', 502, 'Invalid model list', 200);
      if (!response.data.models.some(m => m.name === model)) fail('STT_MODEL_UNAVAILABLE', 503, 'Requested model is unavailable on this instance', 200);
      return { available: true, model };
    },
    async transcribe(buffer, mime) {
      onStage('wav_validation'); const audio = inspectWav(buffer, mime, limits(env));
      onStage('configuration'); const config = settings();
      const bearer = await accessToken(); onStage('http_recognition'); let response;
      try { response = await http.post(`${config.url}/v1/recognize`, buffer, { headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'audio/wav', 'X-Watson-Learning-Opt-Out': 'true' },
        params: { model: config.model, timestamps: true }, timeout: 90000, maxRedirects: 0, maxBodyLength: limits(env).maxBytes, maxContentLength: 2 * 1024 * 1024 }); }
      catch (e) { mapError(e); }
      onStage('response_parsing');
      return { ...parseResponse(response.data), audio, model: config.model, provider: 'ibm-speech-to-text', persisted: false };
    },
  };
}
module.exports = { SpeechError, limits, inspectWav, parseResponse, createSpeechService };
