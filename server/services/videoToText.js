const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { SpeechError, limits, inspectWav, createSpeechService } = require('./speechToText');
const fail = (code, status, message) => { throw new SpeechError(code, status, message); };

function videoLimits(env = process.env) {
  const maxBytes = Number(env.VIDEO_MAX_UPLOAD_BYTES || 32 * 1024 * 1024);
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 64 * 1024 * 1024) fail('VIDEO_CONFIGURATION', 503, 'Invalid video upload limit');
  const audio = limits(env);
  return { maxBytes, maxSeconds: Math.min(120, audio.maxSeconds), audio };
}

// Resolve once per operation to an absolute executable. Never search the current directory.
async function executable(name, env = process.env) {
  const configured = env[name.toUpperCase() + '_PATH'];
  const filename = process.platform === 'win32' ? name + '.exe' : name;
  const candidates = configured ? [configured] : (env.PATH || env.Path || '').split(path.delimiter)
    .filter(p => path.isAbsolute(p) && path.resolve(p) !== process.cwd()).map(p => path.join(p, filename));
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate) || path.basename(candidate).toLowerCase() !== filename) continue;
    try { const resolved = await fs.realpath(candidate); if ((await fs.stat(resolved)).isFile()) return resolved; } catch { /* Try the next PATH entry. */ }
  }
  fail('VIDEO_TOOLS_UNAVAILABLE', 503, 'Configure absolute FFMPEG_PATH and FFPROBE_PATH executable paths');
}

function runProcess(file, args, { timeout = 30000, signal } = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { shell: false, windowsHide: true, timeout, killSignal: 'SIGKILL', maxBuffer: 256 * 1024, signal }, (error, stdout) => {
      if (!error) return resolve(stdout);
      // Never return stderr, command lines or raw child-process errors.
      const timeoutFailure = error.killed || error.code === 'ETIMEDOUT';
      reject(new SpeechError(timeoutFailure ? 'VIDEO_TIMEOUT' : 'VIDEO_PROCESS_FAILED', timeoutFailure ? 504 : 422,
        timeoutFailure ? 'Video processing timed out' : 'Unable to process this MP4'));
    });
  });
}

function inspectMp4(buffer, config) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) fail('INVALID_VIDEO', 400, 'Invalid MP4 file');
  if (buffer.length > config.maxBytes) fail('VIDEO_TOO_LARGE', 413, 'Video exceeds the upload limit');
  const size = buffer.readUInt32BE(0);
  if (buffer.toString('ascii', 4, 8) !== 'ftyp' || size < 16 || size > buffer.length || size % 4) fail('INVALID_VIDEO', 400, 'Invalid MP4 container');
  if (!['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1'].includes(buffer.toString('ascii', 8, 12))) fail('UNSUPPORTED_VIDEO', 415, 'Upload an ISO MP4 video');
}

function inspectProbe(data, config) {
  const positive = value => Number.isFinite(Number(value)) && Number(value) > 0;
  if (!data?.format?.format_name?.split(',').includes('mp4') || !Array.isArray(data.streams) || data.streams.length > 16) fail('INVALID_VIDEO', 400, 'Invalid MP4 stream metadata');
  const duration = Number(data.format.duration);
  if (!positive(duration)) fail('INVALID_VIDEO', 400, 'Video duration is unavailable');
  if (duration > config.maxSeconds || data.streams.some(s => positive(s.duration) && Number(s.duration) > config.maxSeconds)) fail('VIDEO_TOO_LONG', 413, 'Video exceeds the short-video duration limit');
  const audio = data.streams.filter(s => s.codec_type === 'audio');
  const video = data.streams.filter(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
  if (!audio.length) fail('VIDEO_NO_AUDIO', 422, 'Video has no audio track');
  if (audio.length !== 1 || video.length !== 1 || !['h264', 'hevc', 'mpeg4', 'av1'].includes(video[0].codec_name) ||
      !['aac', 'mp3', 'alac'].includes(audio[0].codec_name) || !positive(audio[0].sample_rate) || Number(audio[0].sample_rate) > 192000 ||
      !Number.isInteger(audio[0].channels) || audio[0].channels < 1 || audio[0].channels > 8 ||
      !positive(video[0].width) || !positive(video[0].height) || video[0].width > 4096 || video[0].height > 2160) fail('UNSUPPORTED_VIDEO', 415, 'Unsupported video or audio streams');
  return { durationSeconds: duration, mimeType: 'video/mp4' };
}

function createVideoService({ env = process.env, speech = createSpeechService({ env }), run = runProcess, resolveExecutable = executable, tempRoot = os.tmpdir() } = {}) {
  return { async transcribe(buffer, { onStage = () => {}, signal } = {}) {
    const config = videoLimits(env); inspectMp4(buffer, config);
    const ffprobe = await resolveExecutable('ffprobe', env), ffmpeg = await resolveExecutable('ffmpeg', env);
    let dir, wav;
    try {
      dir = await fs.mkdtemp(path.join(tempRoot, 'sardines-video-'));
      await fs.chmod(dir, 0o700);
      const input = path.join(dir, 'input.mp4'), output = path.join(dir, 'audio.wav');
      await fs.writeFile(input, buffer, { mode: 0o600, flag: 'wx' });
      onStage('extracting');
      const inputOptions = ['-protocol_whitelist', 'file', '-f', 'mov', '-enable_drefs', '0', '-use_absolute_path', '0'];
      let probe;
      try { probe = JSON.parse(await run(ffprobe, ['-v', 'error', '-max_alloc', '67108864', ...inputOptions,
        '-show_entries', 'format=format_name,duration:stream=codec_type,codec_name,duration,sample_rate,channels,width,height:stream_disposition=attached_pic', '-of', 'json', input], { timeout: 15000, signal })); }
      catch (e) { if (e instanceof SpeechError) throw e; fail('INVALID_VIDEO', 400, 'Unable to validate MP4 metadata'); }
      const video = inspectProbe(probe, config);
      await run(ffmpeg, ['-nostdin', '-v', 'error', '-max_alloc', '67108864', '-threads', '1', ...inputOptions,
        '-i', input, '-map', '0:a:0', '-vn', '-sn', '-dn', '-map_metadata', '-1', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le',
        // Read one second beyond the limit so dishonest duration metadata cannot silently truncate a meeting.
        '-t', String(config.maxSeconds + 1), '-fs', String(config.audio.maxBytes + 1), '-threads', '1', '-f', 'wav', output], { timeout: 30000, signal });
      if ((await fs.stat(output)).size > config.audio.maxBytes) fail('AUDIO_TOO_LARGE', 413, 'Extracted audio exceeds the speech limit');
      wav = await fs.readFile(output);
      inspectWav(wav, 'audio/wav', { ...config.audio, maxSeconds: config.maxSeconds });
      if (signal?.aborted) fail('VIDEO_CANCELLED', 400, 'Video request cancelled');
      onStage('transcribing');
      return { ...await speech.transcribe(wav, 'audio/wav'), video };
    } finally {
      if (wav) wav.fill(0);
      // dir is exclusively created by mkdtemp under tempRoot, never derived from an upload name.
      if (dir) await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  } };
}
module.exports = { createVideoService, videoLimits, inspectMp4, inspectProbe, executable, runProcess };
