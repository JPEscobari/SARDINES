# Ingestion implementation handoff - November 18, 2026

## A. What was wrong

The standalone script loads repository-root .env using __dirname. The backend loaded ../.env relative to process.cwd(). Starting with the documented root command (npm run server) therefore looked at E:/Project_git/.env, which does not exist. The actual repository .env has the three required Orchestrate settings. Only presence was inspected; no values were disclosed or edited.

The original route's extractor argument is correct (content string). Its generic catch hid configuration errors. Reproducing its original environment loading returned HTTP 502; the independent live extractor passed. This establishes a reproducible launch-path root cause, not proof of the working directory of the historical user process. No historical logs were available. A subsequent attempt to bind port 5000 returned EADDRINUSE; the existing service was left untouched, and the newly launched source was verified on port 5001.

Other contract gaps: sourceType was ignored; oversized input returned 413 instead of requested 400; success lacked the response envelope; ingest was mounted twice; ingestion could enter the prose chat stub; external requests lacked timeouts and could log upstream response bodies.

## B. What changed

- server/index.js: absolute environment path, single ingest mount, explicit missing-Mongo warning and sanitized connection error.
- server/routes/ingest.js: supported source types, 20,000-character and 128 KiB byte limits, 400 validation responses, consistent success envelope, allowlisted error codes. Configuration errors return 503; inference/validation failures return 502. Unsupported media type remains 415. No persistence or outbound actions.
- server/services/promiseExtractor.js: refuse chat stub mode; categorized schema/JSON/evidence errors; prompt clarifies untrusted inputs and delivery-versus-confirmation dates. Schema and exact evidence checks remain enabled. No deployed agent configuration changed.
- server/services/watsonx.service.js: verify required configuration, 15-second IAM and 60-second inference timeouts, remove unsafe response/prompt logging; preserve original endpoint and payload/authentication flow.
- server/tests/ingest.test.js: expanded existing untracked tests for request/response contracts and failure cases, with mocked IBM boundary.
- server/tests/startup.test.js: environment path and route-registration regression test.
- server/scripts/test-ingest-live.js: opt-in real HTTP verification with schema and evidence assertions.
- client/src/components/IngestionPanel.jsx and .css: Carbon form, pending/error/empty states, structured results and evidence, explicit unresolved identities and dates; clear old results on edits.
- client/src/pages/Dashboard.jsx: add panel while retaining existing Chat, Tasks and Decisions.
- client/src/services/api.js: analyzeText with bounded request and safe error handling; VITE_API_BASE override or same-origin /api.
- client/src/main.jsx: load previously missing Carbon styles.
- client/vite.config.js: development API proxy and Carbon font alias.

Existing modified server package files, extraction schema, standalone scripts, and slack-ai-summarizer/server/package-lock.json were preserved. No .env edits, database migration, Git branch changes, commits, pushes, CRM writes, Slack messages or deployment.

## C. Verification

Passed:

- `node --test server/tests/*.test.js`: 10 tests; real local HTTP with mocked IBM inference, plus startup regression. No database or IBM calls.
- `npm test --prefix slack-ai-summarizer`: 25 tests across 3 suites, mocked Slack/Granite integrations.
- `npm run build --prefix client`: production build succeeds. Carbon emits dependency Sass deprecation warnings; font assets now resolve.
- `npm run lint --prefix client`: passes.
- `git diff --check`: passes.
- `node server/scripts/test-extract.js`: live IBM extraction succeeded on Acme fixture.
- `node server/scripts/test-ingest-live.js`: real backend on port 5001 returned HTTP 200, validated analysis and matching source quotes, persisted=false.
- Browser at http://127.0.0.1:5174: real Acme meeting analysis and synthetic buyer-email analysis displayed. Observed disabled controls and loading indicator, empty-input validation, and unavailable-backend error (temporarily stopped only our own backend, then restored it).

Local network/IBM calls initially failed under the execution sandbox; the authorized tests passed when run with network access. Installed locked client and Slack dependencies with npm ci. Installation reported 6 high frontend and 34 high Slack audit findings. These counts need dependency triage; no blanket npm audit fix was applied.

Not verified: real MongoDB, Cloudant, HubSpot, outbound Slack, transcription or deployment. No Cloudant/HubSpot/STT-prefixed configuration was present in repository .env. This does not establish whether the team has provisioned those services elsewhere.

## D. Running the verified flow

From repository root, in separate PowerShell terminals (ports chosen to avoid the existing 5000 listener):

```powershell
$env:PORT='5001'
node server/index.js
```

```powershell
$env:API_PROXY_TARGET='http://localhost:5001'
npm run dev --prefix client -- --host 127.0.0.1 --port 5174
```

Open http://127.0.0.1:5174. Choose Meeting Notes and paste:

```text
Sean: We promised Acme to confirm Thursday delivery.
Jamie: I'll check the warehouse tomorrow.
Alex: Warehouse confirmation is still pending.
```

Click Analyze. To repeat the live HTTP test: `node server/scripts/test-ingest-live.js`. TEST_API_BASE overrides its default http://localhost:5001. Each valid live analysis uses IBM inference. The normal root npm run dev remains configured for backend 5000 and Vite's normal port when available.

Phase 1C and Phase 1D are verified. This is an analysis MVP slice, not the full operational follow-through product.

## E. Architecture and remaining risks

Existing Express routes chat/history, tasks and decisions all depend on Mongoose. Chat persists both conversation turns, while tasks/decisions are separate manually managed records. No automatic structured Promise persistence exists. MONGO_URI is missing locally, so the preserved panels report load failures; ingestion is database-independent.

Slack remains a separate Bolt Socket Mode service, using a user-token reader and Granite. It reads threads, caps at 15 messages and explicitly rejects longer/paginated results. It has no shared backend ingestion or reply-correlation workflow. No HubSpot or Cloudant implementation was found.

LLM output can still fail validation or be semantically inaccurate despite matching source quotes. dueAt currently accepts schema strings and is not a scheduling authority. No reminders should use it before strict date validation and human resolution. Production authentication, authorization, rate limits, production CORS and approval auditing remain required. Current health endpoint is liveness, not integration readiness. Carbon styling adds a substantial CSS/font bundle that can be narrowed later.

## F. Next batch: storage boundary before CRM writes

Keep /api/ingest analysis-only. Add an explicit save/review operation using a single operational repository interface, initially a clearly labelled local development adapter. Suggested methods: ingestSource, listPromises, resolvePromise, proposeAction, approveAction, claimAction, completeAction, recordReply. Keep old Mongo Task/Decision data separate and unchanged until a migration is approved.

Cloudant design (not yet implemented/verified):

- source:{hash}: type, sourceType/system, externalSourceId, occurredAt/ingestedAt, contentHash, evidence references and ingestion status. Deduplicate by stable source identity plus hash; define revisions when source content changes.
- promise:{id}: accountId, title/description, nullable owner identity, dueAt/dueText plus resolution state, status, sourceRefs and related actions.
- action:{idempotencyKey}: promiseId, type, proposedPayload, approval actor/time, state pending/approved/executing/completed/failed, external IDs, attempt state and audit events. Use revision compare-and-swap to claim execution. Unknown external write outcomes must reconcile before retrying.
- directory:{id}: known person identities and Slack/HubSpot IDs, active state. Resolve IDs from records, never from model invention.
- Indexes: type+status+dueAt, type+accountId+updatedAt, type+approvalStatus+createdAt, type+externalSourceId, type+promiseId. Use deterministic IDs for uniqueness rather than assuming a secondary index enforces it.

Confirm Cloudant availability and team ownership before selecting it as the operational authority. Migration must have explicit inventory, mapping, dry run, verification and rollback; never dual-write conflicting operational stores. Build repository contract tests against the local adapter without cloud credentials. Then add authenticated review/approval before HubSpot and Slack write adapters. Audio/STT and reminders follow these dependencies.

## G. Git

Branch remains feature/slack-ai-summarizer. Original dirty/untracked work preserved. Consult git status --short --branch for the exact current list. No push performed.

## Phase 2 follow-up

Persistent local Promise storage and the review queue are implemented in the next batch. See [Promise review handoff](promise-review-handoff.md) for the current storage/API contract, tests, browser verification and limitations, and [Cloudant design](cloudant-design.md) for the future migration boundary.
