# Phase 5A — IBM Speech to Text adapter and audio transcript ingestion

## Status — November 19, 2026

Implemented the server adapter and Carbon upload/transcript interface with mocked verification. **Live IBM STT is not connected or verified.** No `STT_*`, `SPEECH_*` or `IBM_STT_*` configuration was found in repository `.env` or the current process environment. A filename-only search found no other repository environment file. The existing team resource `watsonx-Hackathon STT` is user-reported; its instance models and credentials have not been queried by this implementation. No service, credential or paid resource was created.

The existing Orchestrate and Cloudant application remains configured as before. No live extraction, Slack send or Cloudant write was run in this batch. A read-only check of the protected Action `action:1d3c4508-bd2d-4df7-bec1-23e7dd861c14` observed **version7, replied, one reply**. This differs from the user-reported version6; this batch did not reset, resend or edit it.

## Implementation and supported audio

`POST /api/transcribe` accepts a raw audio request body with Content-Type `audio/wav`, `audio/x-wav` or `audio/wave`. The browser sends the selected File directly, not multipart/form-data. It returns `{success, transcript, segments, empty, audio, model, provider, persisted:false}`. Transcription does not call extraction or storage.

Phase5A supports **RIFF WAV, PCM format1, 16-bit, mono/stereo**, sample rates **16000, 22050, 24000, 32000, 44100 or 48000 Hz**, with a conventional 16-byte fmt chunk. The parser checks RIFF size, chunk boundaries, one fmt/data chunk, byte rate, block alignment and sample-derived duration. It accepts JUNK/LIST/bext metadata chunks; compressed WAV, extensible WAV, unusual chunks, RF64, MP3, WebM and video are rejected. A `.wav` filename or MIME claim alone cannot pass validation. Non-WAV encodings were deliberately not added without a trusted decoder/duration validator.

Default bounds: **8 MiB, 120 seconds**, one active transcription per server process. Server settings may lower/increase limits within hard ceilings of 16 MiB and 300 seconds. Browser selection remains capped at 8 MiB. Upload socket inactivity timeout is 15 seconds; IAM is 15 seconds; recognition is 90 seconds; frontend request timeout is 115 seconds. Service calls have no redirect following or automatic retries; IBM response size is capped at 2 MiB. A concurrent request receives429. Transcription is disabled when NODE_ENV=production; existing loopback binding is preserved.

Audio is held in a bounded memory buffer and zeroed/released after successful or failed processing. **No temporary audio files are created**, so disk-file cleanup is unnecessary. This is not a guarantee of secure erasure of all runtime/HTTP-library copies. A deliberately generated silent browser-test WAV was placed in Git-ignored server/data and removed after verification; it was not a production upload. No raw audio is put in Cloudant or application logs.

The adapter exchanges STT_API_KEY for an IAM bearer token and calls the configured instance's POST /v1/recognize. Only HTTPS IBM regional Speech to Text instance URLs are accepted; user-supplied URLs, redirects and embedded credentials are rejected. `X-Watson-Learning-Opt-Out:true` is sent. Errors are normalized without logging upstream bodies, audio, transcript or credentials. 400 invalid local audio, 413 size/duration, 415 unsupported format, 422 IBM audio/model rejection, 429 busy/rate limit, 503 configuration/authentication, 504 timeout, and 502 upstream/invalid response are distinguished.

IBM results are checked for final alternatives, text, optional bounded confidence and valid timestamp tuples. Empty results are successful empty transcripts and do not trigger extraction. The frontend shows recognition metadata separately from editable text. No speaker labels or identity inference are requested. Word-confidence options are not requested because support depends on model generation; available alternative confidence is returned when present.

## Transcript and existing pipeline

The Dashboard offers Audio / Voice Memo, file selection/name/size, explicit Transcribe, error/loading states, an editable transcript and explicit Analyze Transcript. Browser recording is not included: typical MediaRecorder WebM output is outside this strictly validated WAV slice.

The existing /api/ingest and Save for Review APIs gain the additive sourceType `audio_transcript`; other request/response behavior is unchanged. The exact edited transcript sent for analysis becomes immutable source.content on explicit save. SourceType identifies audio-derived text; the application does not certify whether edits faithfully reproduce the audio. Original extraction, exact-quote checks, explicit Action linking, audit, Cloudant aggregate atomicity and source deduplication remain authoritative. Editing the transcript, changing source mode or selecting a new file invalidates previous analysis before save. No automatic transcription, analysis or save occurs.

The stored record contains the reviewed transcript and analysis, not the binary audio or the original STT result. STT timing/confidence is available in the current browser session and marked as original recognition metadata, not updated to match user edits. File names and unverified speaker names are not promoted to identities.

## Configure the existing team service privately

1. In IBM Cloud, choose the authorized shared account, then Resource list → AI / Machine Learning → **watsonx-Hackathon STT**. Confirm the resource is the intended Speech to Text development instance and that usage is permitted by the team.
2. On Manage / API details, locate that instance's service URL. Under existing Service credentials, an authorized owner can obtain the matching service API key. If access/credentials are unavailable, request them from the owner; do not create another service or new credentials silently.
3. Set these names in the server's existing Git-ignored repository-root `.env`, never a VITE_* variable or client bundle:

```text
STT_URL=https://api.<region>.speech-to-text.watson.cloud.ibm.com/instances/<instance-id>
STT_API_KEY=<existing authorized service key>
STT_MODEL=en-US_Multimedia
STT_MAX_UPLOAD_BYTES=8388608
STT_MAX_DURATION_SECONDS=120
```

4. Restart the local backend. Confirm service access and model availability on the actual instance before a live test. IAM endpoint: https://iam.cloud.ibm.com/identity/token . `GET /v1/models` lists instance-available models and minimum sample rates; this was **not called** without credentials. English model families documented by IBM include Multimedia and Telephony; this adapter defaults to en-US_Multimedia and permits configured en-US/en-GB/en-AU Multimedia names, subject to the actual instance supporting them. It does not silently switch model/language on failure.
5. IBM supports more encodings (including MP3/WebM) and a synchronous limit of100MB, but this MVP intentionally accepts the smaller validated WAV subset. Do not increase application limits to the IBM maximum without resource review.

Official references: [API, authentication, models, recognize and response schema](https://cloud.ibm.com/docs/apis/speech-to-text), [audio encodings](https://cloud.ibm.com/docs/speech-to-text?topic=speech-to-text-audio-formats), [service limits](https://cloud.ibm.com/docs/speech-to-text?topic=speech-to-text-faq-usage), [recognition metadata](https://cloud.ibm.com/docs/speech-to-text?topic=speech-to-text-metadata), [request logging opt-out](https://cloud.ibm.com/docs/speech-to-text?topic=speech-to-text-summary). Actual account/plan/model access remains unverified.

## Live validation procedure — not executed

After credentials and service usage are approved, record a synthetic 30–60-second English memo as supported PCM WAV. Example content: “This is a synthetic SARDINES test meeting. Cedar Test Company requested a revised proposal. Jamie will review the pricing tomorrow. The team promised to send the revised proposal after legal approval. Legal approval is still pending. No customer message should be sent from this test. We have not resolved the exact calendar deadline. The next step is to review the extracted promises and actions before anyone approves operational work.”

Opt-in single live transcription only (no Orchestrate or Cloudant write):

```powershell
Set-Location 'E:\Project_git\SARDINES-integration'
$env:STT_LIVE_TEST='true'
try {
  node server/scripts/test-stt-live.js '<absolute path to approved synthetic 30–60-second PCM WAV>'
} finally {
  Remove-Item Env:STT_LIVE_TEST -ErrorAction SilentlyContinue
}
```

The script validates duration/format, prints only provider/model, duration, character/segment counts and persisted=false, and fails on an empty result. It does not prove transcript accuracy from counts alone. To validate content and the full path, use the Dashboard: select audio, Transcribe, inspect/edit recognized text, Analyze Transcript (real Orchestrate), review extraction, then explicitly Save for Review to a designated new synthetic source if authorized. Verify the exact edited transcript in Cloudant/Promise Queue. Keep STT, Orchestrate and Cloudant outcomes separately labelled; none of these live Phase5A stages ran in this batch.

## Verification and browser limits

Final results: **106 backend tests passed**, **39 Slack tests passed** (7 suites), React production build passed, React lint passed, git diff check passed. Existing Carbon Sass warnings and the CRLF notice remain. Browser test servers started in this batch were stopped after verification; existing app processes were not stopped. Live STT, live Orchestrate analysis and live Cloudant saves were not run.

Baseline:93 backend tests,39 Slack tests, frontend build/lint passed before changes. Tracked-file filename and credential-pattern scans found no environment/database files or credential-pattern matches. This is a heuristic scan, not proof that every possible secret is absent.

New tests cover valid/invalid WAV, unsupported audio, size/duration limits, empty transcript, IAM failure, service authentication, timeout, rate limit, bad response/timing, privacy/timeout options, token reuse, HTTP uploads, buffer release after success/failure, single-request admission and production fail-closed behavior. SQLite and mocked Cloudant contracts cover audio_transcript source identity, evidence preservation and deduplication. No test loads real STT/Cloudant credentials for writes.

Browser harness `server/scripts/test-speech-browser.js` uses mocked STT and Orchestrate with isolated `server/data/phase5a-browser.sqlite`, backend5093 and frontend5193. Browser verified Audio / Voice Memo mode, empty-upload disabled Transcribe control, editable transcript, Analyze Transcript loading/result, explicit Save for Review, Promise Queue display and exact edited text in Original audio_transcript evidence.

**Browser file selection/transcription UI was not verified end-to-end:** the extension refused file selection because Allow access to file URLs is disabled; normal-picker fallback did not expose a usable chooser. No permissions were changed. Upload/adapter behavior was tested through local HTTP, and browser checks continued using manually entered synthetic transcript text. Do not describe this as a successful browser audio transcription. No actual speech audio was sent to IBM.

## Checkpoint, rollout, limitations and next phase

Recommended local checkpoint: inspect all tracked changes and earlier untracked Phase1–4 files, run the regression commands, then request approval for a descriptive checkpoint commit. A git diff alone omits untracked source files. Stage reviewed source/docs/tests explicitly; exclude .env, credentials, node_modules, server/data and build output. No commit, push, merge or backup/migration operation was executed here.

Coordinate all reader/writer restarts before saving audio_transcript records: older strict schemas will reject the new sourceType. Preserve backups using the existing Cloudant/SQLite procedures; do not roll back to validators that cannot read newly saved records. Existing sources and Slack Actions are untouched. Full authentication and public deployment remain postponed; the local cost-bearing API is not a production endpoint. Memory/concurrency limits are per process, not a global quota. Retain team controls over paid STT usage.

Next phase: assess a trusted FFmpeg/ffprobe installation for bounded MP3/WebM and MP4 audio extraction, reject video bombs/oversized duration, use private temporary directories with finally cleanup and process timeouts, and preview the transcript before analysis. Do not store raw media in Cloudant. Deployment preparation must add authenticated access, request/rate quotas, origin policy, secret management and resource limits before any public exposure. HubSpot remains delegated to Will.

## Files changed in Phase5A

Added:
- server/services/speechToText.js
- server/routes/transcribe.js
- server/tests/speech.test.js
- server/scripts/test-stt-live.js
- server/scripts/test-speech-browser.js
- client/src/components/AudioUpload.jsx
- docs/speech-ingestion-handoff.md

Modified:
- server/index.js
- server/routes/ingest.js
- server/routes/review.js
- server/operational/validation.js
- server/tests/slack-source.test.js (shared storage audio compatibility assertions)
- client/src/components/IngestionPanel.jsx
- client/src/services/api.js

No package dependency changes. Branch remains feature/slack-ai-summarizer, dirty with earlier work plus this batch. No staging, commit, push, merge or deployment.
