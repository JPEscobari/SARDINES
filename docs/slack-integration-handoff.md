# Phase 4 Slack integration — November 18, 2026

## Status and boundaries

Phase 4A, 4B and 4C are implemented and tested with synthetic records and mocked external transports. The existing shortcut, scope modal, IBM summary generation and summary DM remain intact. No live Slack app was started, no Slack messages were sent, no IBM inference was called, and no Cloudant records were modified in this batch. HubSpot remains separate for Will. No deployment, commit, merge or push occurred.

Cloudant configuration and Slack app/bot/user token names were present; values were neither printed nor edited. New development allowlists were not configured in `.env`. The live read-only check returned backend=cloudant, ready=true, 2 promises, 1 action and 4 audit events; writes=0. The application's configured store remains Cloudant. Browser verification used only a separate synthetic SQLite file, not the application's existing SQLite database.

## 4A: summary to saved evidence

The Bolt app uses its existing authenticated Socket Mode connection. Slack documents that Socket Mode delivers payloads over a pre-authenticated WebSocket: https://api.slack.com/apis/socket-mode . There is no new public Slack interaction endpoint. Do not route unverified HTTP bodies directly into these handlers. An HTTP deployment would require Bolt's signing-secret verification plus timestamp/replay checks.

The summary response offers Save to SARDINES only to an allowlisted development user in the configured workspace. Clicking saves the exact original message snapshot used for summarization. No summary triggers automatic ingestion. Snapshots are bound to the requester and workspace, expire after 30 minutes, and are capped at 100 pending entries and 20,000 transcript characters. Restarting Bolt discards unsaved snapshots; summarize again. The existing 15-message/pagination rejection remains. Unknown/bot author IDs that cannot satisfy the source schema cause saving to fail safely.

Explicit saving invokes the existing server `extractPromises` service and repository directly within the Bolt process; no unauthenticated ingestion bridge was added. Install dependencies in both `server` and `slack-ai-summarizer`, and run on Node 24. Root `.env` is loaded by absolute path as fallback; preexisting process/Slack configuration wins. Both processes must select the same repository configuration for results to appear in the Dashboard.

Slack source records retain workspace, channel, root thread timestamp, requester, each message timestamp/author and exact text. Evidence quotes must occur within an original message, not just a generated transcript header. Summary text is never source evidence. Optional extracted decisions are stored inside original analysis and displayed with source evidence; old analysis without decisions remains valid. Promises and Actions appear in the existing queue/review UI after refresh. Action-to-Promise association remains explicitly reviewed.

Identity is SHA-256 of type + workspace/channel/thread + exact canonical transcript. Same snapshot across users or repeated button clicks deduplicates, including repository races and retries. Different channels never collide merely because text matches. Changed message content or a different selected message window is a new immutable source; this is snapshot deduplication, not semantic deduplication across overlapping windows. Meeting/email source identities are unchanged. The web Save for Review endpoint rejects Slack source submissions to prevent forged provenance.

## 4B: preview and explicitly confirmed demo follow-up

Configure an administrator-maintained directory mapping reviewed owner IDs to known workspace/user IDs. A reviewer selects an allowlisted recipient after saving an explicit Promise association and action review. The generated message includes the reviewed title, Promise, deadline or Unresolved, extracted blockers, source reference/evidence and progress request. It is persisted with a payload hash and audit snapshot. Preparing a preview sends nothing.

No web Slack-send endpoint exists. The only live caller is a local terminal command. It requires OS access to the repository and credentials, an interactive terminal, `SARDINES_SLACK_SEND_ENABLED=true`, a non-production environment, the exact current action version and preview hash, and `--confirm-demo-send`. This is a restricted local demo confirmation, **not** formal production Action approval. Formal approval and CRM execution remain fail closed.

Configuration names (no real identities are supplied here):

```text
SARDINES_SLACK_TEAM_ID=<approved workspace ID>
SARDINES_SLACK_SAVE_USERS=<comma-separated approved development user IDs>
SARDINES_SLACK_RECIPIENTS=[{"label":"Approved demo person","ownerId":"reviewed-owner-id","teamId":"approved-workspace-id","userId":"approved-user-id"}]
SARDINES_SLACK_SEND_ENABLED=false
```

Keep these server-side. Do not configure or enable real sending until a specific recipient/message demo is authorized. The directory rejects malformed entries and duplicate owner mappings. It does not infer identities from names or AI output.

Inspect a saved preview locally, without sending:

```powershell
node slack-ai-summarizer/src/confirmFollowup.js <action-id>
```

Only after authorization, using the displayed current version/hash in an interactive terminal:

```powershell
$env:SARDINES_SLACK_SEND_ENABLED='true'
node slack-ai-summarizer/src/confirmFollowup.js <action-id> <version> <payload-hash> --confirm-demo-send
```

The command displays private preview content locally; do not copy its output into shared logs. No command above was used to send in this batch.

Before claiming the send, the transport verifies the bot workspace with `auth.test` and the exact active, non-bot, non-guest recipient with `users.info`. It opens a DM and posts the exact preview with mention parsing and link unfurling disabled. The dedicated WebClient has automatic retries disabled. Required capabilities must be checked before a live demo: `users:read`, `im:write`, `chat:write`, existing thread-read permissions, and reply subscription `message.im` with the corresponding history scope. No Slack scopes/subscriptions were changed here. Official method/event references: https://docs.slack.dev/reference/methods/chat.postMessage/ and https://docs.slack.dev/reference/events/message/ .

`preview -> sending -> sent -> replied`; transport failure after claim becomes `uncertain`. Claim, status and audit are atomic within the source aggregate (Cloudant) or transaction (SQLite). Changed Action/Promise content makes confirmation stale. Claiming locks Action and linked-Promise edits while sending/uncertain. Concurrent confirmations cannot both send. One follow-up attempt per Action is supported in this MVP.

`sending` after a crash/final-storage failure and `uncertain` both prohibit resend. `client_msg_id` is additional correlation, not an exactly-once guarantee. There is intentionally no automatic retry/release of an uncertain attempt. Read Slack history and identify the exact message, then perform an explicitly reviewed reconciliation using the existing source revision and audit semantics. A reconciliation UI/command is not yet implemented; do not clear the claim or use a new Action as a retry shortcut. Definitive failures such as rate limiting are conservatively held for reconciliation too.

## 4C: replies

The existing Bolt app listens for message events. Replies must match persisted workspace, DM channel, root message timestamp and exact recipient user. Bot events, edits/subtypes, unrelated messages and duplicate event IDs/timestamps are ignored. Message evidence, author, timestamp, receive time and audit are saved; status becomes replied. Promise completion is never changed. The Dashboard shows status, persisted Slack IDs, optional permalink and reply evidence after Refresh actions.

Limits: 100 replies per follow-up and the existing aggregate byte guard. Full conversation reconciliation, a durable inbound event queue, and replay tooling are not implemented. A reply received while the send is still being finalized or while storage is unavailable can require manual retrieval/replay. This is not a production-grade guaranteed-delivery inbox. Handler errors are sanitized. Before a live pilot, add durable event receipt/recovery and an operator reconciliation workflow.

## Verification

- `node --test server/tests/*.test.js`: **75 passed**. Real temporary SQLite; mocked Cloudant/IBM/Slack. Includes preserved 57-test baseline, Slack source evidence/deduplication, preview/authorization boundary, stale versions, concurrent confirmations, uncertain send handling, final persistence failure, reply correlation/deduplication and forbidden HTTP execution.
- `npm test --prefix slack-ai-summarizer -- --silent`: **35 passed**, 6 suites. Mocked Bolt/WebClient/IBM; existing 25 tests preserved. Existing shortcut/modal/summary and explicit save callbacks tested without starting Socket Mode.
- `npm run build --prefix client`: passed. Existing Carbon Sass dependency deprecation warnings remain.
- `npm run lint --prefix client`: passed.
- `git diff --check`: passed (existing CRLF notice only).
- `node server/scripts/test-action-readonly.js`: **LIVE Cloudant READ ONLY**, ready=true; counts 2/1/4, writes=0.
- Browser at `http://127.0.0.1:5192`: selected synthetic recipient, saved preview, reloaded and verified persistence; opened original Slack evidence/decision; verified stored mock reply and disabled production approvals; Promise remains needs_review.
- Browser fixture: `server/scripts/seed-slack-browser-demo.js`, isolated `server/data/phase4-synthetic-browser.sqlite`. All send/receive fixture transport is in-process mock data. Test backend 5092; frontend 5192. Initial sandbox-only ports5091/5191 were unreachable from the browser. All four test processes started in this batch were stopped after verification; existing application processes were left alone.

Not run: live Slack summarization/save/send/reply, new live Orchestrate decision extraction, Cloudant Phase4 writes, CRM writes, media transcription, deployment. New Cloudant behavior is contract-tested with a mock; the read-only check does not prove live Phase4 write integration.

## Compatibility and rollout

No automatic migrations, source edits or bulk writes. Both adapters accept old records. New additive fields require coordinated restart/update of all writers: old strict validators will reject new Slack/decision/follow-up records. Back up before enabling new writes; rollback must retain a reader supporting these fields. Existing Cloudant migration/backup documentation still applies. Do not dual-write SQLite/Cloudant.

Source and reply text may contain private business information; protect the repository, process environment, Cloudant and local fixture files. The local web review surface still lacks full authentication and must not be publicly exposed. The user-token reader retains its existing wider channel-access behavior; restrict development users and audit the Slack app's permissions before enabling saves. Keep HubSpot untouched for Will and use `hubspot-integration-plan.md` as its separate contract.

Next: configure approved development identities and verify required Slack scopes/event subscriptions without widening permissions silently; add recovery/reconciliation tooling before a live pilot; request authorization for a specific synthetic live Slack/Cloudant demo. Phase5 media ingestion and Phase6 deployment have not been implemented or deployed in this batch. Phase4 mocked regression is green, but live integration is still a separate gate.

## Exact files changed in this Phase4 batch

Modified existing working files (some were already untracked from earlier phases):
- `slack-ai-summarizer/src/app.js`
- `slack-ai-summarizer/src/slack/threadReader.js`
- `server/schemas/analysis.schema.json`
- `server/services/promiseExtractor.js`
- `server/operational/validation.js`
- `server/operational/localRepository.js`
- `server/operational/cloudantRepository.js`
- `server/operational/actionWorkflow.js`
- `server/routes/review.js`
- `client/src/services/api.js`
- `client/src/components/ActionReview.jsx`
- `client/src/components/PromiseQueue.jsx`

Added:
- `slack-ai-summarizer/src/slack/sardinesSave.js`
- `slack-ai-summarizer/src/slack/followupTransport.js`
- `slack-ai-summarizer/src/confirmFollowup.js`
- `slack-ai-summarizer/tests/sardinesSave.test.js`
- `slack-ai-summarizer/tests/followupTransport.test.js`
- `slack-ai-summarizer/tests/app.test.js`
- `server/operational/slackSource.js`
- `server/operational/slackFollowupSchema.js`
- `server/integrations/slackFollowup.js`
- `server/tests/slack-source.test.js`
- `server/tests/slack-followup.test.js`
- `server/tests/slack-http.test.js`
- `server/scripts/seed-slack-browser-demo.js`
- `client/src/components/SourceEvidence.jsx`
- `client/src/components/SlackFollowup.jsx`
- `docs/slack-integration-handoff.md`

Git remains on `feature/slack-ai-summarizer`, dirty with earlier Phase1–3 changes plus this batch. No staging, commit, merge or push. `.env`, package manifests/locks and deployed agents were not changed by this batch.

## Phase4D update — November 19, 2026

The earlier reconciliation-tool limitation is superseded by [Live Slack readiness and operator runbook](slack-live-readiness.md). Controlled history replay and verified sent-message reconciliation are now implemented; there is still no automatic resend or durable local inbox. Current live preflight is blocked by missing users:read/im:write/im:read/im:history scopes and disabled Event Subscriptions. The Cedar preview was read without modification.
