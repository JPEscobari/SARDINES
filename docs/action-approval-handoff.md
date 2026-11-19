# Phase 3A: action review and approval foundation

## Current verified storage status

The user reports real Cloudant read/write/edit/deduplication/audit verification and a Bluebird Realty source saved from the Dashboard into sardines-dev. That supersedes earlier Phase 2C notes about missing credentials. This batch independently confirmed configured Cloudant readiness and read validation of 2 promises, 1 action and 4 audit events. It made **zero Cloudant writes**. No Bluebird records or original SQLite records were edited.

## Exact files changed in this batch

Modified:
- server/operational/validation.js: additive action review/approval schema, expanded audit events and authenticated/system actor types; legacy records still accepted.
- server/operational/localRepository.js: action read/review/approval/rejection methods; transactional audit and linked-Promise approval invalidation; injectable trusted identity resolver.
- server/operational/cloudantRepository.js: equivalent aggregate operations with revision retries, stale-version checks and lost-response reconciliation.
- server/routes/review.js: action detail/edit and fail-closed decision routes with a server-only principal integration point.
- client/src/services/api.js: action review API method.
- client/src/pages/Dashboard.jsx: Action Review panel, preserving all existing panels.
- client/src/components/PromiseQueue.jsx: show explicit links rather than assuming all same-source actions are unlinked.
- docs/cloudant-adapter-handoff.md and docs/cloudant-design.md: current live-status clarification and Phase 3A link.

Added:
- server/operational/actionSchemas.js: strict draft, payload and approval-snapshot schemas.
- server/operational/actionWorkflow.js: shared review/decision authorization, state transitions, payload hashing, invalidation and execution denial.
- client/src/components/ActionReview.jsx: Carbon review form, explicit Promise selection, validation/loading/error feedback and disabled decisions.
- server/integrations/hubspotContract.js: mockable interface only; no network client.
- server/tests/action-workflow.test.js: SQLite and mocked Cloudant review/approval contracts, concurrency/failure/HTTP authorization tests.
- server/tests/hubspot-contract.test.js: interface check without executing operations.
- server/scripts/test-action-readonly.js: read-only configured-store readiness and schema validation, logging counts only.
- docs/action-approval-handoff.md and docs/hubspot-integration-plan.md.

No .env files, packages, deployed agents, legacy Mongo models or Slack code were changed in this batch. No commit, merge or push.

## What works

Existing extracted Actions remain immutable evidence-bearing suggestions: description, ownerName, dueText, extractedDueAt and sourceQuote are not editable. Original source.analysis remains unchanged. New review drafts are separate fields: title, companyId, ownerId and dueAt. Missing values may remain null during review. Company/owner IDs typed by a reviewer are explicitly unverified; they are not trusted resolved identities.

A reviewer explicitly selects promiseId (or clears it). The backend checks that it references an existing Promise in the same source. Cross-source association is rejected in this batch to keep Promise changes and approval invalidation within one atomic Cloudant aggregate. The UI states this restriction. Same-source proximity never assigns a link automatically.

Actual new repository methods: getAction, reviewAction, approveAction, rejectAction and executeAction. executeAction always throws EXECUTION_DISABLED, including for approved records. There is no execution HTTP endpoint, HubSpot client or Slack sender.

## State machine and immutable approvals

Legacy actions without state are interpreted as pending_review without a read-time migration/write. New review writes persist state. Supported transitions:

- pending_review -> approved, only by an authorized authenticated principal, with verified identities and an explicit absolute deadline.
- pending_review/approved -> rejected, only by an authorized principal with a rejection reason.
- rejected -> pending_review through review edits before approval can be reconsidered.
- approved -> pending_review on any review edit, including no-op saves (conservative invalidation).
- Editing the linked Promise also atomically invalidates its approved actions and increments their versions.
- executing/completed/failed are reserved for Phase 3B; no transition to them is implemented or accepted now.

An approval snapshot contains a strict hubspot_task payload: actionId, promiseId, sourceId, promiseVersion, title, companyId, ownerId, dueAt, evidence. Snapshot metadata contains SHA-256 payloadHash, approvedBy, approvedAt and actionVersion. The payload is constructed in a fixed field order on the server and persisted alongside an approval audit snapshot. It cannot be supplied or patched by clients. Edits clear the active approval while the historical audit snapshot stays intact. A future executor must revalidate payload hash, current action/Promise versions and identity authorization before use; no executor exists yet.

Approval requires a configured trusted identity resolver to verify the exact company and owner IDs for the principal. Default repositories have no resolver, so this independently fails closed. Tests inject a resolver with synthetic known IDs; no production fake identity directory was added. An approved record with the current version can be approved again idempotently without another audit event. Retrying the previous version yields 409 and requires reload. Reject behaves similarly for the current rejected version.

SQLite writes action plus audit/invalidation in one transaction. Cloudant writes them in one source aggregate revision. Definite _rev conflicts retry up to three times while rechecking domain versions. A stable operation audit ID reconciles a lost success response without duplicating approval. Atomicity and concurrency are tested for both adapters. Existing document-size limits remain.

## HTTP and authentication status

- GET /api/review/actions/:id reads an action.
- PATCH /api/review/actions/:id accepts version plus allowlisted draft/link fields.
- POST /api/review/actions/:id/approve accepts version only.
- POST /api/review/actions/:id/reject accepts version and reason.

Default approve/reject routes return 401 AUTHENTICATION_REQUIRED before accessing storage. They ignore Authorization/X-User headers and body usernames as identity. No provider, session middleware, OIDC issuer, or session secret was found. The route factory accepts a getPrincipal integration function solely for trusted server wiring; automated tests inject principals. The actual exported router uses the default null principal. Production review routes remain disabled. The UI always disables approve/reject until a future authenticated integration is implemented.

Repository authorization expects authenticated=true, a stable subject, actions:approve permission and explicit sourceIds access. This is an internal adapter shape, not an authentication mechanism. A future provider must derive these values server-side from verified identity and account/tenant authorization; clients must never populate them. Draft editing remains unauthenticated local development functionality, as in Phase 2. Protect all review/read endpoints before public deployment.

Available provider approaches:
1. Integrate the team's existing OIDC identity provider, if one is available, with an Express server session and issuer/audience/signature/expiry validation; add CSRF protection for cookie-authenticated mutations.
2. Use IBM App ID if already provisioned and approved. IBM documents its OIDC discovery and identity-provider options: https://cloud.ibm.com/docs/appid?topic=appid-discovery and https://cloud.ibm.com/docs/appid?topic=appid-managing-idp . No service was provisioned here.
3. Use a local self-hosted OIDC provider for development with real accounts and sessions. Do not substitute a username field, test principal or arbitrary reverse-proxy header for authentication.

Team decision needed later: provider/tenant, redirect URLs, session store, role mapping, source/account authorization, allowed origins and verified directory ownership. None of these requires changing the deployed Orchestrate agent.

## Verification

- `node --test server/tests/*.test.js`: 57 passed, including all earlier backend/Cloudant contracts. IBM inference is mocked in existing extraction tests. Cloudant write behavior is mocked. SQLite tests use real temporary files. Authenticated principals and verified identity resolver appear only in automated tests.
- `npm test --prefix slack-ai-summarizer`: 25 passed, 3 suites, mocked; no outbound messages.
- `npm run build --prefix client`: passed; existing Carbon Sass warnings remain.
- `npm run lint --prefix client`: passed.
- `git diff --check`: passed, with existing line-ending notices.
- `node server/scripts/test-action-readonly.js`: LIVE Cloudant ready=true, 2 promises/1 action/4 audit events validated, writes=0. Does not log source bodies or secret values.
- Browser http://127.0.0.1:5190: explicit link, edited title/company/owner drafts, invalid relative-deadline rejection, valid UTC deadline save, reload persistence, original evidence display and disabled approve/reject verified.

The browser used backend 5090 with process-only OPERATIONAL_STORE=sqlite and SARDINES_DB_PATH pointing to server/data/phase3a-synthetic-browser.sqlite. That separate Git-ignored file contains synthetic test data; it does not change the real application's configured store. Ports 5004/5176 were occupied, so their processes were left untouched. No live Cloudant approval/write test was run and no Orchestrate inference was needed for this batch.

## Rollout and next step

Restart the configured backend before using the new UI against Cloudant. Avoid mixed old/new backend writers: new code reads old records, but old strict validators do not understand the additive review/approval fields after the first new action review write. No bulk migration is necessary or automatic. Keep a backup before adopting new writes and plan rollback with schema compatibility in mind.

Next implement the selected authenticated provider and source/account authorization plus trusted company/owner lookup. Then verify decisions with real authorized users on designated synthetic development records. Only after that add the Phase 3B execution worker and sandbox HubSpot adapter described in the separate plan. Existing approval/execution remains disabled until those integrations are deliberately wired.
