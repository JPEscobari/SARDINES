# Phase 2C: Cloudant adapter and verification handoff

## Provisioning and actual storage

Checked process environment and repository-root .env by name/presence only: OPERATIONAL_STORE, CLOUDANT_URL, CLOUDANT_API_KEY and CLOUDANT_DATABASE are absent. No secrets were printed or modified. This proves configuration is unavailable here, not that the team has no provisioned instance elsewhere.

SQLite remains the default and current operational authority at server/data/operational.sqlite. Existing Acme records are unchanged. No records were migrated, deleted or written to Cloudant; no cloud resources were created. Cloudant is implemented and mock-tested, but live service access is not verified.

## Files in this batch

Added:
- server/operational/cloudantClient.js: bounded HTTPS/IAM transport; no database creation or deletion methods.
- server/operational/cloudantRepository.js: single-source aggregate repository with optimistic revisions and outcome reconciliation.
- server/operational/repository.js: explicit factory, default SQLite; invalid/missing Cloudant configuration fails without fallback.
- server/routes/readiness.js: sanitized operational database readiness.
- server/scripts/test-cloudant-live.js: opt-in read test and separately gated synthetic write verification.
- server/tests/helpers/fakeCloudant.js: in-process Cloudant revision/atomic-write simulation, synthetic fixture.
- server/tests/repository-contract.test.js: same public contract checks for SQLite and mocked Cloudant; failure/concurrency tests.
- server/tests/cloudant-transport.test.js: IAM/transport, factory, readiness and Cloudant-backed HTTP tests with mocks.
- docs/cloudant-adapter-handoff.md: this handoff.

Modified:
- server/operational/localRepository.js: backend label and read-health operation only; storage/write behavior preserved.
- server/routes/review.js: use repository factory; report backend in Promise list envelope.
- server/index.js: mount /api/ready.
- client/src/components/PromiseQueue.jsx: display actual selected backend rather than always saying local storage.
- docs/cloudant-design.md: current implementation, limitations and controlled migration procedure.
- docs/promise-review-handoff.md: link to Phase 2C status.

No dependencies, environment files, legacy Mongo models, Slack code or approval endpoints changed.

## Contract and consistency

All existing asynchronous repository operations remain available: saveAnalysis, getSource, listPromises, getPromise, updatePromise, listActions, proposeAction and listAuditEvents. health is additive. Domain validators, null ownership/customer fields, exact evidence matching, original extraction dates vs resolved deadlines, operational status transitions and pending/disabled action semantics are preserved. Source IDs use the existing exact-content hash algorithm. Internal entity IDs remain typed UUIDs; public records contain no Cloudant _rev.

Each Cloudant document has _id=source ID, _rev, kind=sardines_source_aggregate, schemaVersion=1, source, promises[], actions[], events[]. A single PUT commits source data and audit history together. No bulk-write transaction assumption or eventually consistent projection is used. Local Promise versions protect stale review submissions; aggregate _rev protects concurrent source edits. On a definite 409, reload and reapply only if the caller's Promise version still matches, up to three attempts. Concurrent edits to different promises can succeed; same-promise stale updates return 409.

A lost response may hide a successful write. Save reconciles using deterministic source identity; review updates reconcile using a unique audit event ID retained across retries; proposals reconcile by source+description+evidence. Unknown failures are not blindly retried. If reconciliation itself cannot read, return unavailable and require reload before retry. A retried caller with an old version may receive 409 after a successful-but-unacknowledged edit; this is intentional. HTTP 202 (write quorum not confirmed) is not reported as success. Replicated conflicting leaves are rejected for manual resolution.

Lists use key-based _all_docs pagination over source: IDs, reading ten aggregates at a time and sorting public results by ID. Promise lookup currently scans aggregates. Pagination is not a database-wide snapshot, and sequential API calls can observe different revisions under concurrent updates. This is a small-development-dataset implementation, not a production-scale query design. A shared database must reserve the source: prefix for this application; unrelated documents in that range fail validation.

A 900,000-byte serialized aggregate guard fails with 413 before writing. It leaves room below IBM's documented 1 MB limit, but source history grows with every edit. No events are dropped or silently split. Large analyses/long histories accepted by SQLite can exceed Cloudant capacity: this is an explicit compatibility limitation and a migration dry-run check. The schemaVersion is checked on reads; there is no automatic schema upgrade.

## Configuration and health

To explicitly select a provisioned development database, supply server-side process variables:
- OPERATIONAL_STORE=cloudant
- CLOUDANT_URL: HTTPS service origin only, no embedded credentials/path/query.
- CLOUDANT_API_KEY: IAM key.
- CLOUDANT_DATABASE: existing database name.

Prefer a dedicated non-partitioned development database for this aggregate model. No database or index is created by the application. Setting credentials alone does not select Cloudant. No environment edits were made. The factory is process-scoped: restart to change storage; switching does not migrate or merge records.

GET /api/health remains liveness. GET /api/ready returns success, ready, backend and scope=database_read, or sanitized 503 STORAGE_UNAVAILABLE. Readiness confirms connectivity/read access, not write authority, complete data integrity, IAM role suitability, MongoDB or IBM inference health. It never returns URL, database name, tokens or keys.

IAM tokens are cached until near expiry. Requests have 15-second timeouts and redirects disabled. Reads retry once after a 200ms delay on network/401/429/5xx failures, refreshing the token after 401; no write retry is performed by the transport. It does not yet implement adaptive Retry-After scheduling or a circuit breaker. Raw Axios errors are replaced before leaving the transport.

## Exact tests and results

- `node --test server/tests/*.test.js`: 39 passed, including all original 19 tests. Cloudant transport/storage tests are mocked. SQLite contract tests use real temporary files; HTTP tests use real loopback sockets. IBM inference is mocked in regression tests.
- `npm test --prefix slack-ai-summarizer`: 25 passed across 3 suites, mocked Slack/Granite; no messages sent.
- `npm run build --prefix client`: passed; existing Carbon Sass deprecation warnings remain.
- `npm run lint --prefix client`: passed.
- `git diff --check`: passed; Git reports existing line-ending normalization notices.
- Running updated backend on port 5003: real local HTTP readiness reported sqlite; Save for Review of the existing stored source returned persisted=true/duplicate=true; subsequent GET returned byte-equivalent Promise records. No original records changed.
- `$env:CLOUDANT_LIVE_TEST='true'; node server/scripts/test-cloudant-live.js`: BLOCKED by absent configuration; no Cloudant network request or write occurred. This is not a passed live integration test.

For later read-only connectivity verification, configure the three Cloudant variables, then opt in:

```powershell
$env:CLOUDANT_LIVE_TEST='true'
node server/scripts/test-cloudant-live.js
```

Only for an explicitly designated development database, a separate opt-in permits a synthetic save/read/edit/deduplication/stale-version/audit test:

```powershell
$env:CLOUDANT_TEST_ALLOW_WRITE='development'
node server/scripts/test-cloudant-live.js --write
```

This writes and retains one synthetic source aggregate and prints its generated source ID. It does not create a database, delete the fixture, or migrate data. A read-only pass must not be described as write integration verified. No live inference rerun was needed for this storage-only batch. Browser interaction was not repeated; SQLite Save for Review was verified through actual application HTTP, with frontend build/lint validation.

## Security and next steps

Review remains local-development-only and unauthenticated. Production review routes remain disabled; no approvals, execution, CRM writes or Slack sends were added. Cloudant selection does not make deployment safe. Protect IAM keys, enforce least privilege, and add authenticated tenant/account authorization before approval endpoints. A future approval must bind authenticated actor, immutable payload hash and expected revision; execution needs reconciliation and idempotency against HubSpot.

Next: provision/identify an approved development database outside this task, configure credentials privately, run read then explicitly approved synthetic write verification, and execute the documented migration dry run before any cutover. Benchmark aggregate size and scan costs before production. Existing uncommitted work and branch feature/slack-ai-summarizer are preserved. Nothing committed or pushed.

## Phase 3A status update

The earlier missing-configuration statement above is historical. The user subsequently verified live Cloudant persistence, and Phase 3A independently read readiness and validated existing records with zero writes. See [action approval handoff](action-approval-handoff.md) for current verification and additive schema rollout requirements.
