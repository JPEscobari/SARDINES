# Phase 5B — short MP4 video ingestion

## Status: November 19, 2026

Implemented MP4 audio extraction alongside the existing WAV workflow. No visual-frame analysis. The existing AudioUpload component, editable transcript, Analyze Transcript and explicit Save for Review flow are shared. Changing the selected file, source type or transcript clears previous analysis before saving. Saved sources use the additive `video_transcript` type with the exact edited text and existing evidence validation, deduplication, audit and optimistic concurrency semantics. No binaries, upload names or recognition metadata are stored in Cloudant.

Real verification in this batch: a locally generated synthetic voice and blue video (116,497 bytes, 20.4-second MP4; 14.7668125 seconds of audio) passed installed FFmpeg/ffprobe, real IBM STT, real Orchestrate validation and a new Cloudant aggregate save/read. Orchestrate returned one Promise and one Action. The script appended a unique synthetic reviewer note before analysis and verified exact stored content. This tests the edited-text boundary programmatically, not a manual browser edit.

New source in `sardines-dev`:
`source:f6b0d52d6a393427d9adc1e6d0476d1e1803faecf93b555eee84f374511b5d92`

Only this new synthetic aggregate (source, Promise, Action, initial audits) was written. No existing records were modified; no Slack messages or CRM writes, deployment, commits or pushes occurred. The new Action remains subject to existing fail-closed approval and explicit association rules.

## Supported input and bounds

- Raw `video/mp4` POST to `/api/transcribe/video`; no multipart body or compressed HTTP body.
- ISO MP4 with a conventional leading ftyp brand: isom, iso2, iso4, iso5, iso6, mp41, mp42 or avc1. Actual container and streams are checked with ffprobe; filename/MIME alone are insufficient.
- Exactly one video track (H.264, HEVC, MPEG-4 or AV1), at most 4096×2160; exactly one audio track (AAC, MP3 or ALAC), 1–8 channels and up to 192 kHz. At most 16 streams overall. Attached cover art does not count as video. Multiple audio tracks are rejected rather than choosing a speaker/language silently.
- Defaults: **32 MiB MP4, 120 seconds maximum**. `VIDEO_MAX_UPLOAD_BYTES` may be set from 1 byte through 64 MiB; browser selection remains capped at 32 MiB. Video duration is the smaller of 120 seconds and `STT_MAX_DURATION_SECONDS`. No one-hour support.
- Extraction: PCM s16le mono, 16000 Hz, then the existing strict WAV validator and existing STT adapter. Existing audio upload limits still apply (8 MiB default; 16 MiB ceiling). WAV input route is unchanged.
- Probe wall timeout 15 seconds; extraction 30 seconds; upload inactivity 15 seconds; existing IAM 15 seconds and recognition 90 seconds; browser video request 165 seconds. One active video per process, independent of the existing one-active-WAV limit.
- Child processes use validated absolute executable paths, argument arrays, shell=false, hidden windows, bounded stdout/stderr (256 KiB), allocation cap per allocation (64 MiB), one extraction thread and forced termination on timeout. They only use the MOV demuxer and local-file protocol, with external data references and absolute media references disabled. No uploaded filenames enter command arguments.
- Extraction reads at most limit+1 seconds and enforces output bytes; the resulting WAV duration must fit the actual limit. Dishonest duration metadata cannot silently produce a truncated approved transcript at the limit.

## Temporary data and deployment

Each request creates an unpredictable `sardines-video-*` directory in the service account's OS temp directory. Directory mode is 0700 and input file mode 0600 on POSIX. On Windows, privacy depends on the inherited ACL of the account's private TEMP directory (chmod does not implement POSIX ACLs). Run as a dedicated user with private TEMP; do not point TEMP at a shared writable directory. Extracted WAV and uploaded MP4 are removed in finally on success, probe/FFmpeg/STT errors and cancellation; request/WAV buffers are zeroed. This is not cryptographic secure erasure. Process crashes/power loss can leave temporary directories; operators should remove only confirmed inactive service-owned directories during controlled maintenance, not run an indiscriminate automatic recursive cleanup.

The Windows development installation already provides **FFmpeg/ffprobe 9.0.2** under WinGet's Gyan.FFmpeg package. No executable was downloaded or installed in this batch. Resolution searches absolute PATH directories, excluding the current directory, or uses explicit FFMPEG_PATH/FFPROBE_PATH. Explicit configuration does not silently fall back if invalid.

For another Windows development machine, use a Windows build linked by the [official FFmpeg download page](https://ffmpeg.org/download.html), such as [Gyan's builds](https://www.gyan.dev/ffmpeg/builds/), or the reviewed WinGet package `winget install --exact --id Gyan.FFmpeg --source winget`. Inspect the package source before installation. Restart the terminal/backend after PATH changes, or set explicit server-only paths:

```powershell
$env:FFMPEG_PATH = (Get-Command ffmpeg.exe -CommandType Application).Source
$env:FFPROBE_PATH = (Get-Command ffprobe.exe -CommandType Application).Source
```

Deployments require maintained FFmpeg/ffprobe binaries, private writable scratch space, disk/RAM/CPU quotas, process isolation and authenticated/rate-limited access. The allocation setting is not a total-memory sandbox. Both media routes remain disabled for NODE_ENV=production. Do not publicly expose the local development server. Proxies must allow bounded upload sizes and stream NDJSON without buffering. A response starts with `extracting`/`transcribing` events and ends with success or sanitized error; after headers are sent, failures are terminal NDJSON events under HTTP 200. Clients must inspect the terminal result, not just HTTP status.

Coordinate deployment of all source validators before saving video_transcript records. Older validators may reject the new type; do not roll back readers to older strict schemas after saving new records. No migration/backfill runs automatically. Full authentication, long-form transcription, resumable uploads, visual understanding, speaker identification and multiple-audio-track selection are outside this MVP.

## Verification

Final results: **124 backend tests, 3 client API tests and 39 Slack tests (7 suites) passed**. React production build, lint and git diff --check passed. Build emitted existing Carbon Sass deprecation warnings; Git emitted line-ending notices. All cloud transports in automated suites were mocked; the separately described synthetic CLI integration used real services. Browser automation remains incomplete as described below.

Automated checks (no cloud credentials loaded):

```powershell
node --test server/tests/*.test.js
node --test client/tests/*.test.mjs
npm test --prefix slack-ai-summarizer -- --runInBand
npm run build --prefix client
npm run lint --prefix client
git diff --check
```

Video tests use mocked probe/FFmpeg/STT and SQLite/mocked Cloudant, plus a real local subprocess timeout/failure test. Cases include valid metadata, forged/unsupported files, no audio, size/duration limits, dishonest duration, probe failure, extraction failure, timeout, cancellation, temporary cleanup, buffer release, STT propagation, streamed success/error, concurrency rejection, production boundary, edited evidence, source compatibility and deduplication. Client tests cover fragmented UTF-8 progress/result parsing, incomplete streams, errors, exact edited analyze/save requests and WAV compatibility.

Live CLI (approved synthetic clip only):

```powershell
Set-Location 'E:\Project_git\SARDINES-integration'
$env:VIDEO_LIVE_TEST = 'true'
# Optional: additionally authorizes one NEW synthetic source in sardines-dev.
$env:VIDEO_LIVE_SAVE = 'true'
try {
  node server/scripts/test-video-live.js '<absolute path to short synthetic MP4>'
} finally {
  Remove-Item Env:VIDEO_LIVE_TEST,Env:VIDEO_LIVE_SAVE -ErrorAction SilentlyContinue
}
```

Without VIDEO_LIVE_SAVE the script only transcribes. With it, the script requires Cloudant backend, sardines-dev and non-stub Orchestrate, appends a fresh UUID reviewer note, then creates and reads one new source. Each opt-in run creates a distinct test source; do not use this script for production ingestion or blanket retries after an uncertain write. Output contains safe stage/status/counts and the new source ID, never media, transcript or credentials.

Browser verification **incomplete**: the Windows computer-use tool stopped because it could not confidently determine Chrome's URL. No UI action/upload/save was completed. The two isolated browser harness processes started for this check were stopped. Do not claim a live browser MP4-to-Cloudant workflow from this batch.

Manual browser acceptance: restart the normal local backend; open Dashboard → Video Upload → choose a short synthetic MP4 → Transcribe. Confirm filename, upload/validation, extracting and transcribing states; review editable text and original recognition metadata. Edit the transcript, Analyze Transcript, inspect exact quotes, then explicitly Save for Review only to an authorized new synthetic source. Confirm video_transcript in source evidence and the matching Promise/Action in the queue; changing text afterward must invalidate the old analysis. WAV mode should still work. The live CLI source above can be inspected read-only in the existing queue.

For isolated browser tests, start `node server/scripts/test-speech-browser.js` (real FFmpeg, mocked STT/Orchestrate, separate SQLite); set API_PROXY_TARGET=http://127.0.0.1:5093 and start Vite on 5193 with VITE_API_BASE unset. Use a synthetic clip containing “Synthetic Cedar will send the proposal tomorrow.” Preserve that quote when editing because the mock extractor emits it.

## Changed files in this batch

New: server/services/videoToText.js; server/routes/transcribeVideo.js; server/tests/video.test.js; server/scripts/test-video-live.js; client/tests/media-api.test.mjs; docs/video-ingestion-handoff.md.

Modified: server/index.js; server/operational/validation.js; server/routes/ingest.js; server/routes/review.js; server/tests/ingest.test.js; server/tests/startup.test.js; server/scripts/test-speech-browser.js; client/src/components/AudioUpload.jsx; client/src/components/IngestionPanel.jsx; client/src/services/api.js; docs/speech-ingestion-handoff.md.

Pre-existing STT debug changes preserved: server/services/speechToText.js; server/scripts/test-stt-live.js; server/tests/speech.test.js. No package changes. Synthetic local fixture files are Git-ignored under server/data/phase5b-synthetic; these are operator test artifacts, separate from automatically cleaned request temp files.
