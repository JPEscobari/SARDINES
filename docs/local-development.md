# Local development and onboarding validation

## Process layout and environment

Follow the [root quick start](../README.md) from the repository root. Dependencies are four separate installs: root tools, Express server, Vite client and optional Slack app. A server-only install does not install Slack, and the original `install:all` script omits it. Lockfiles exist for all four packages; use `npm ci` for reproducibility.

Express defaults to port 5000 and binds 127.0.0.1. Vite defaults to port 5173 but can increment if busy; the documented `--strictPort` avoids silently choosing another port. `API_PROXY_TARGET` is a frontend **process** setting, not automatically read from root `.env`. Prefer `VITE_API_BASE=/api` and the Vite same-origin proxy; direct cross-origin fetches are limited by the backend's existing fixed CORS origin (`http://localhost:5173`).

Stop your own server/Bolt terminals with Ctrl+C before restarting; do not blindly kill all Node processes. To identify a busy Windows port without terminating another developer's process:

```powershell
Get-NetTCPConnection -LocalPort 5000,5173 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalAddress,LocalPort,OwningProcess
# Inspect a returned PID with Get-Process -Id <pid>; coordinate ownership before stopping it.
```

Alternate isolated local ports, in separate terminals:

```powershell
# Backend
$env:NODE_ENV='development'
$env:OPERATIONAL_STORE='sqlite'
$env:SARDINES_DB_PATH = Join-Path (Get-Location) 'server/data/onboarding.sqlite'
$env:PORT='5088'
node server/index.js
```

```powershell
# Frontend
$env:API_PROXY_TARGET='http://127.0.0.1:5088'
$env:VITE_API_BASE='/api'
npm run dev --prefix client -- --host 127.0.0.1 --port 5188 --strictPort
```

Readiness: `Invoke-RestMethod http://127.0.0.1:5088/api/ready`. It should explicitly say sqlite. Never assume a terminal override carried into another terminal. Existing process variables override dotenv; review only intended names, not a full environment dump. Restart after changing settings. SQLite creates its private local schema automatically; this does not contact Cloudant.

## macOS/Linux equivalents (not tested in this batch)

Use Node 24 and the same clone, branch and four npm ci commands. `test -e .env || cp .env.example .env` preserves an existing file. Obtain trusted FFmpeg/ffprobe through your approved package manager and check `ffmpeg -version` / `ffprobe -version`; no platform-specific minimum is asserted.

```sh
# Terminal 1, repository root
NODE_ENV=development OPERATIONAL_STORE=sqlite PORT=5000 \
  SARDINES_SLACK_SEND_ENABLED=false SARDINES_SLACK_RECOVERY_ENABLED=false node server/index.js
# Terminal 2, repository root
API_PROXY_TARGET=http://127.0.0.1:5000 VITE_API_BASE=/api \
  npm run dev --prefix client -- --host 127.0.0.1 --port 5173 --strictPort
# Terminal 3
curl http://127.0.0.1:5000/api/health
curl http://127.0.0.1:5000/api/ready
```

## Offline fixtures and regression tests

The empty SQLite Dashboard can start without IBM credentials, but real Analyze is unavailable until configured. `WATSONX_STUB=true` is not an offline extraction mode; it intentionally fails structured ingestion. Use `npm run test:browser --prefix client` for a synthetic end-to-end UI test. It uses Chrome, an isolated profile, port 5194 and mocked HTTP responses, not real media bytes/IBM services. No server or Bolt needs to be running for that suite.

For an interactive fixture workspace, `node server/scripts/test-speech-browser.js` runs the existing mock STT/Orchestrate harness on 5093 with separate ignored SQLite `server/data/phase5a-browser.sqlite`. Set the frontend proxy to `http://127.0.0.1:5093` and start Vite on another free loopback port. It does not load root `.env`; MP4 still uses installed FFmpeg. Its extractor emits the exact quote “Synthetic Cedar will send the proposal tomorrow.”, so retain that wording for evidence validation. Its readiness endpoint is not mounted; do not mistake this isolated harness for the full backend. Do not run `seed-slack-browser-demo.js` against shared records; it is a separate mocked SQLite fixture utility.

The exact automated commands and scopes are in the root README. `node server/scripts/test-review-restart.js` additionally checks local SQLite persistence using separate processes. Legacy Python test scripts read live tokens and are not part of `npm test --prefix slack-ai-summarizer`.

## Opt-in live tests

Run only with authorized service usage and approved synthetic input. They may consume IBM resources. These are not installation steps, and setting a flag does not grant permission. Use a separate terminal and reset flags afterward.

### Orchestrate, without storage writes

After starting a backend configured for real Orchestrate:

```powershell
$env:TEST_API_BASE='http://127.0.0.1:5000'
try { node server/scripts/test-ingest-live.js }
finally { Remove-Item Env:TEST_API_BASE -ErrorAction SilentlyContinue }
```

The script uses synthetic Acme text, checks HTTP/schema/evidence and prints the synthetic analysis. It has no boolean opt-in gate: **invoking it is the live call**. `node server/scripts/test-extract.js` and `node server/scripts/test-orchestrate.js` also call IBM immediately, load root configuration and print synthetic responses. They require WATSONX_STUB not true; do not run them as part of an offline test glob. The legacy adapter logs the instance URL (not its key); keep diagnostic output internal.

### Cloudant read-only

```powershell
$env:CLOUDANT_LIVE_TEST='true'
try { node server/scripts/test-cloudant-live.js }
finally { Remove-Item Env:CLOUDANT_LIVE_TEST -ErrorAction SilentlyContinue }
```

This test explicitly selects Cloudant regardless of OPERATIONAL_STORE and needs the three Cloudant settings. Without `--write` it checks read connectivity only. `node server/scripts/test-action-readonly.js` reads/validates Promise, Action and audit records in the **selected** store and prints counts; it does not require a boolean opt-in.

Only after a separate approval for a designated development database, `test-cloudant-live.js --write` additionally requires `CLOUDANT_TEST_ALLOW_WRITE=development`. It creates and retains a unique synthetic source, tests deduplication, edits its Promise and verifies stale-version/audit behavior. The flag is not a database-name guard; inspect the configured target with the owner before any authorized run. Do not execute this write variant during onboarding or delete its records afterward automatically.

### STT, without extraction/storage

```powershell
$env:STT_LIVE_TEST='true'
try { node server/scripts/test-stt-live.js '<absolute path to approved synthetic 30-60 second PCM WAV>' }
finally { Remove-Item Env:STT_LIVE_TEST -ErrorAction SilentlyContinue }
```

This script validates WAV, verifies en-US_Multimedia availability and performs real recognition. It prints safe category/code/status/stage diagnostics rather than audio/transcript. The script's 30–60-second fixture requirement is narrower than the application's normal 120-second default.

### Video transcription only

```powershell
$env:VIDEO_LIVE_TEST='true'
$env:VIDEO_LIVE_SAVE='false'
try { node server/scripts/test-video-live.js '<absolute path to approved short synthetic MP4>' }
finally { Remove-Item Env:VIDEO_LIVE_TEST,Env:VIDEO_LIVE_SAVE -ErrorAction SilentlyContinue }
```

This uses real FFmpeg/STT, with no Orchestrate or storage write. The optional `VIDEO_LIVE_SAVE=true` variant calls Orchestrate, appends a unique synthetic reviewer note, then creates/reads a new source; it explicitly requires Cloudant, sardines-dev and non-stub Orchestrate. That variant requires separate permission to write the shared database. Never enable it as a default. See [video handoff](video-ingestion-handoff.md) for exact behavior and previous live evidence.

Real Slack sending/recovery is separately restricted; follow [integration setup](integration-setup.md#restricted-demo-and-recovery) and the operator runbook. No real send is part of setup or this documentation validation.

## Troubleshooting

| Symptom | Check and safe resolution |
| --- | --- |
| Root .env appears ignored | Current Express resolves root .env from __dirname. Verify the intended checkout/entry point and variable names. Existing process values override it. Bolt may load a package-local .env first; Vite uses client/process settings separately. Restart the relevant process. Do not print keys. |
| Missing IBM configuration | Orchestrate needs WATSONX_API_KEY, WATSONX_INSTANCE_URL, WATSONX_AGENT_ID. IBM_API_KEY belongs to Granite; no alias fallback. SQLite startup alone does not supply inference. |
| Wrong Orchestrate URL/key | Use the authorized instance base and matching key/agent, not watsonx.ai WATSONX_URL or a web-console/completions URL. Check IAM/agent access with the owner. Do not rotate keys or redeploy agents automatically. |
| Cloudant IAM authorization failure | Verify service/account ownership and least-privilege database access with the owner; check URL origin, selected existing database and key presence. Root/process overrides can select a different store. No fallback to SQLite occurs on bad Cloudant config. |
| Cloudant readiness succeeds, write fails | Read readiness is not write authorization. Check IAM write roles, 900,000-byte aggregate guard, revision conflicts, replication conflicts and unconfirmed responses. Refresh/reconcile before retry; do not reset the database. |
| Stale Vite proxy / browser cannot reach API | Set API_PROXY_TARGET in Vite's launching terminal and restart Vite; root .env alone does not configure it. Use VITE_API_BASE=/api. Confirm backend port and loopback binding; avoid cross-origin overrides/CORS mismatch. |
| Port already in use / duplicate replies | Identify the owning process and stop only your obsolete terminal. Use explicit alternate port/proxy pairs for HTTP; run one Bolt app instance. Do not terminate every Node process. |
| FFmpeg / ffprobe unavailable | Check both Get-Command results/version commands; restart terminal after trusted install. Ensure both are in absolute PATH directories or configure absolute executable paths. |
| Incorrect executable path | Use an actual ffmpeg.exe/ffprobe.exe file on Windows, not a directory, command arguments, wrapper or embedded literal quotes. A nonempty invalid explicit setting blocks PATH fallback. Leave blank to use PATH. |
| STT_URL_INVALID or malformed STT URL | Copy only the instance HTTPS URL. Remove pasted labels/extra text and appended recognition paths; use the regional speech-to-text hostname and /instances/id path. Do not substitute SDK alias variables. |
| Unsupported WAV | An extension is insufficient. Use 16-bit PCM format 1 with ordinary fmt chunk, accepted rate and mono/stereo. Windows recordings may use unsupported extensible/compressed WAV; export a supported copy using an approved audio tool, preserving the original. |
| MP4 missing/unsupported audio | Video needs one compatible audio track and one supported video track. No audio, multiple audio tracks, unsupported codecs/container, oversized dimensions/file or excessive duration are rejected. Consult video handoff; do not raise limits to accept hour-long recordings. |
| Slack missing scopes after settings change | Coordinate approved scopes, reinstall/re-authorize to the intended workspace, privately update issued tokens and restart Bolt. Inspect granted scopes with checkFollowup.js; do not assume the UI's requested scopes were granted. |
| Slack reply not received | Enable Event Subscriptions + message.im; Socket Mode alone is insufficient. Verify im:history, allowlisted workspace/user, active bot and that the reply is under the original DM thread. Refresh UI; scopes do not prove subscriptions. Use read-only recovery inspection for a missed event. |
| Socket Mode not connected | Verify approved app token with connections:write, Socket Mode enabled, matching app/bot workspace, outbound WebSocket access and only one instance. No public Request URL is needed. Avoid restarting/sending blindly on uncertain outcomes. |
| Save to SARDINES absent / expired | Only allowlisted users/workspace receive offers. They expire after 30 minutes and are held in process memory; restart invalidates offers. Re-summarizing sends another summary, so do it only intentionally. Original messages—not generated summary text—are the evidence. |
| Legacy Mongo panels fail | MONGO_URI is optional. Main operational features use SQLite/Cloudant. Keep Legacy Prototype closed unless its separate authorized MongoDB is configured; do not redirect the Promise Queue to Mongo. |
| No approval/send button | Expected safety boundary. Saving a review/preview is not formal approval; authentication and unrestricted external execution are not implemented. Do not bypass it. |

## Security and verification record

See the final validation notes below for this onboarding batch. Secret inspection was name/presence-only. `.env` was not changed. `.env.example` uses blank credentials, SQLite and disabled operational/live gates. Git ignore rules cover private environment variants, SQLite files/journals and raw media outside the already-ignored server/data directory. Ignoring is not retroactive removal from Git history; a credential-pattern scan is not a guarantee that every possible secret is absent. No credentials were rotated.

Validation on Windows, 2026-11-19:

- Installed all four packages with `npm ci` in an isolated copy of the current working-tree source under ignored `server/data/`. Only the safe example configuration was copied into its `.env`; the private configuration was not copied. All installs succeeded and npm reported zero audit vulnerabilities at installation time. This was **not a fresh GitHub clone**.
- In that copy, backend tests passed **124/124**, client API tests **6/6**, Slack tests **39/39** across seven suites, and Chrome browser tests **12/12**. Cloudant, IBM and Slack transports were mocked; SQLite and local HTTP were real.
- React production build passed in the isolated copy. The standard `npm run lint --prefix client` passed in the main working tree. Lint discovery in the nested copy found no files because it sits under an ignored parent directory; that attempt is not counted as a successful lint run.
- Started the isolated backend on 5089 and Vite on 5189 using SQLite and blank service credentials. Verified HTTP 200 for health, direct and proxied readiness (`backend: sqlite`, `ready: true`), the empty Promise Queue and the frontend page. Initially sandboxed processes were unreachable; restarting the test processes with local networking permission resolved the smoke check. Both test processes were then stopped.
- Compared all **43** supported application/script environment settings with the example and inventory: no missing, extra or duplicate example declarations. Checked local documentation targets, package commands and `git diff --check`. Checked ignore rules for private environment files, database files and raw media; `.env.example` remains trackable.
- A credential-pattern scan of tracked and new source/documentation found no matching live-token/private-key patterns. This is a limited scan, not a full security or Git-history audit. No private credentials were emitted, and no secret setting was added to the Vite environment.
- Existing dependency warnings remain: Carbon Sass deprecations, Vite's large bundle warning and deprecated transitive Slack install packages. These did not fail the build/tests. Node also reports its built-in SQLite experimental warning.
- No live IBM/Slack integration tests, Cloudant reads/writes, migrations, deployments or remote Git mutations were performed. macOS/Linux and clean remote-clone onboarding remain unverified. Previously verified live integrations are historical results, not results of this documentation batch.
