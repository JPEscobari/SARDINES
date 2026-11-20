# IBM and Slack integration setup

Start with the [SQLite quick start](../README.md). Optional integrations require existing authorized resources; this guide does not authorize creating paid resources, issuing credentials, changing app permissions, or writing shared records. Obtain access from the team owner rather than copying another developer's private `.env`. All secrets stay server-side. The [environment inventory](environment-variables.md) lists every setting and loading rule.

## Orchestrate: structured extraction

Configure `WATSONX_API_KEY`, `WATSONX_INSTANCE_URL` and `WATSONX_AGENT_ID`; keep `WATSONX_STUB=false`. Obtain the existing agent ID and instance API endpoint from the authorized Orchestrate owner and the matching IBM IAM key from the account/service owner. Do not redeploy or change the agent.

The adapter calls `POST <WATSONX_INSTANCE_URL>/v1/orchestrate/<WATSONX_AGENT_ID>/chat/completions`, using IAM at `https://iam.cloud.ibm.com/identity/token`. Supply the instance base URL, not a web console URL or an already-appended completions path. Remove a trailing slash to avoid a doubled separator. The current Orchestrate adapter does not apply the strict hostname validation used by STT; use only the owner's verified HTTPS IBM endpoint. `IBM_API_KEY` is **not** used by this adapter.

Analyze is not a write: `/api/ingest` validates the schema and exact quotes and returns `persisted:false`. Explicit Save for Review validates again and writes to the selected repository. Stub mode does not provide offline structured extraction; use mocked tests for an offline demonstration.

## watsonx.ai / Granite: existing Slack summary

Configure `IBM_API_KEY`, `WATSONX_URL`, `WATSONX_PROJECT_ID`, `WATSONX_MODEL_ID`. These belong to the Slack summarizer's separate integration. Ask the project owner for the regional watsonx.ai API origin (for example `https://us-south.ml.cloud.ibm.com`), approved project ID and an available model. The example's `ibm/granite-4-h-small` is a repository test/example model, not a guarantee that every project has access.

The adapter calls `<WATSONX_URL>/ml/v1/text/chat?version=2023-05-29` after IAM authentication. Do not substitute an Orchestrate instance URL for this origin. The original summary is delivered to Slack; only an explicit Save to SARDINES click runs the separate Orchestrate extraction on original messages.

## Cloudant: optional shared operational storage

1. Ask the owner for access to an **existing non-partitioned** SARDINES development database, its service origin and an authorized IAM API key. A generic new database is not required for SQLite onboarding.
2. Set `OPERATIONAL_STORE=cloudant`, `CLOUDANT_URL`, `CLOUDANT_API_KEY` and `CLOUDANT_DATABASE` in private server configuration. The URL must be HTTPS origin only, with no appended database name/query/credentials. The database name is a separate setting. Invalid Cloudant configuration fails without silently falling back to SQLite.
3. Restart Express and, if enabled, Bolt/CLI processes with the same settings. A terminal `$env:OPERATIONAL_STORE='sqlite'` overrides `.env`; change it deliberately when switching an authorized process.
4. Read `GET /api/ready`. `backend:cloudant, ready:true, scope:database_read` confirms database read access only. Write permission, version conflicts and aggregate-size limits are separate checks.

**Shared `sardines-dev` already contains team records. Do not reset, delete, rename or use existing customer records as test fixtures.** `.env.example` contains no access grant. The adapter neither creates databases/indexes nor migrates data. Switching adapters leaves SQLite and Cloudant separate. Coordinate all reader/writer schema versions and follow the [backup, dry-run, verification and rollback plan](cloudant-design.md) before migration. The Cloudant source aggregate has a 900,000-byte application guard; an authenticated read can succeed while a large or unauthorized write fails.

## Speech to Text and MP4

Use the existing authorized STT instance's API key and URL from Manage/API details or service credentials. IBM's [getting-started documentation](https://cloud.ibm.com/docs/speech-to-text?topic=speech-to-text-gettingStarted) describes those fields. Configure `STT_API_KEY`, `STT_URL` and usually `STT_MODEL=en-US_Multimedia`.

The URL must be exactly `https://api.<region>.speech-to-text.watson.cloud.ibm.com/instances/<instance-id>`. Do not include a copied label, quotation marks inside the value, `/v1/recognize`, a port, query or another service's endpoint. The adapter validates PCM WAV before IAM; malformed local media therefore fails before any cloud request. It reuses IAM/recognition for video and never sends visual frames. `SPEECH_TO_TEXT_IAM_APIKEY` and `SPEECH_TO_TEXT_AUTH_TYPE` are not supported aliases.

For MP4, use the [official FFmpeg download page](https://ffmpeg.org/download.html), which links Windows build providers. A supported development install route is the reviewed WinGet package `winget install --exact --id Gyan.FFmpeg --source winget`; inspect its source before installing. This batch did not download binaries. Restart the terminal after installation, then verify both commands:

```powershell
ffmpeg -version
ffprobe -version
# Optional explicit paths, in the backend terminal. These resolve installed executables.
$env:FFMPEG_PATH = (Get-Command ffmpeg.exe -CommandType Application).Source
$env:FFPROBE_PATH = (Get-Command ffprobe.exe -CommandType Application).Source
```

In `.env`, a path with spaces may use normal dotenv quotes around the complete value, e.g. `FFMPEG_PATH="C:/Program Files/ffmpeg/bin/ffmpeg.exe"`. The parsed value must be an absolute executable path, not a directory, command with options, `.cmd` wrapper or a string retaining quote characters. Blank entries enable PATH discovery; invalid nonempty entries block processing instead of falling back. macOS/Linux use absolute `ffmpeg`/`ffprobe` executable names; those platforms were not verified here.

WAV: 16-bit PCM format 1, ordinary 16-byte fmt chunk, mono/stereo, 16/22.05/24/32/44.1/48 kHz; compressed/extensible/RF64 WAV is unsupported. MP4: one supported video and one compatible audio track; no multi-language-track selection. Defaults: WAV 8 MiB/120 seconds, MP4 32 MiB/min(120, STT duration limit). See [video handoff](video-ingestion-handoff.md) for codecs, dimensions, brand validation, allocation/output caps and cleanup. There is no `VIDEO_MAX_DURATION_SECONDS` setting. The account's temp directory must be private; Windows privacy relies on its inherited ACL. Long-form transcription is not implemented.

## Slack app and Socket Mode

Use the existing Node.js Bolt app (`slack-ai-summarizer/src/app.js`), not a second Python bot. The retained Python scripts are historical prototypes/live utilities, not the integrated save/reply service or offline test suite.

Coordinate with the Slack app owner before changing configuration:

1. Enable Socket Mode and obtain the approved app-level `SLACK_APP_TOKEN` with `connections:write`. Socket Mode connects outbound via WebSockets; no ngrok/public callback URL is required. See Slack's [Socket Mode documentation](https://docs.slack.dev/apis/events-api/using-socket-mode/) and [connections:write scope](https://docs.slack.dev/reference/scopes/connections.write/).
2. Supply the installed app's `SLACK_BOT_TOKEN`. The follow-up readiness code requires **chat:write, users:read, im:write, im:read, im:history**. Configure the existing message shortcut callback **summarize_conversation**, with interactivity enabled; shortcut capability uses the appropriate `commands` permission. Do not change callback IDs to match a newly invented shortcut name.
3. Supply `SLACK_USER_TOKEN` for the current `conversations.replies` reader. It must have access/history scopes for intended conversation types: `channels:history` for public channels, `groups:history` for private channels, and `im:history`/`mpim:history` for applicable DMs. Access is limited by token identity and membership; a bot token is not substituted by this code. Grant only the intended scopes; see Slack's [conversations.replies reference](https://docs.slack.dev/reference/methods/conversations.replies/).
4. For reply tracking, enable Event Subscriptions and subscribe to bot event **message.im**. Verify the bot's Messages tab permits interaction where needed. OAuth scopes do not prove event subscription configuration. See Slack's [message event reference](https://docs.slack.dev/reference/events/message/).
5. After authorized scope changes, reinstall/re-authorize the app to the intended workspace and privately update any issued tokens. Verify the granted scopes with the read-only preflight; do not assume saving settings updates an old token. Restart the single Bolt process.

The app uses Socket Mode transport authentication. There is no `SLACK_SIGNING_SECRET` environment consumer or custom public interaction endpoint in this implementation. Do not add an unauthenticated HTTP forwarding endpoint as an onboarding shortcut.

### Development identities and store consistency

Configure `SARDINES_SLACK_TEAM_ID` and comma-separated `SARDINES_SLACK_SAVE_USERS` for explicit Save access. A development recipient directory is strict JSON; the following is **synthetic format only**, not permission to message a user:

```dotenv
SARDINES_SLACK_RECIPIENTS='[{"label":"Synthetic teammate","ownerId":"owner-test","teamId":"TTEST","userId":"UTEST"}]'
```

Every entry must contain exactly those four fields, owner IDs must be unique, and the maximum is 30 recipients. Replace only with the approved directory; AI-extracted names are not verified identities. The UI's reviewed ownerId must match the intended directory ownerId, and the workspace must match the bot and allowlist. Keep `SARDINES_SLACK_SEND_ENABLED=false` and `SARDINES_SLACK_RECOVERY_ENABLED=false` during setup.

The ordinary summary response is still sent when a user invokes the shortcut; the follow-up send flag does **not** disable summaries. Likewise, the connected Bolt event listener can persist allowlisted replies independently of that flag. Do not start a production/shared-workspace listener merely as a smoke test.

Express and Bolt must use the same `OPERATIONAL_STORE` and credentials or the same absolute SQLite path. The root default SQLite path is stable, but a relative SARDINES_DB_PATH is resolved against different working directories when launching through npm prefixes. Avoid duplicate `.env` files shadowing root settings; see [loading precedence](environment-variables.md#loading-and-precedence).

### Restricted demo and recovery

**Advanced operations only; separate explicit approval is required for any real send or recovery write.** First save/link/review an authorized synthetic Action and prepare a preview in Follow-ups. These two commands are inspection-only (the first prints the preview/replies, so keep its output private):

```powershell
node slack-ai-summarizer/src/confirmFollowup.js '<action-id>'
node slack-ai-summarizer/src/checkFollowup.js '<action-id>'
```

The confirmed send additionally needs an interactive terminal, the current version/payload hash, verified active recipient and workspace, the exact enable flag and explicit demo confirmation. Use the existing [operator runbook](slack-live-readiness.md) for the confirmation command only after authorization. Its earlier scope findings are historical; inspect current app settings rather than assuming those old findings still apply.

Run only one Bolt process so summary handlers/events are not handled by competing copies. After an authorized send, reply **in the original DM thread** so persisted channel/root timestamps can correlate it. Refresh Follow-ups; a root-level unrelated message will not satisfy reply correlation. Stored replies do not complete Promises.

For sending/uncertain states, never reset/re-send as a troubleshooting shortcut. `recoverFollowup.js` with action ID, DM channel and root timestamp inspects history read-only; its optional confirmation writes reconciliation/replies and needs the recovery gate plus current version/plan hash. It does not send a replacement message. See the runbook for limits and authorization procedure. Do not run recovery confirmation as part of onboarding.
