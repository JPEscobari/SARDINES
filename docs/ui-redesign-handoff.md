# Phase 6A — Dashboard UI/UX handoff

## Outcome and boundaries

Replaced the stacked Dashboard with a Carbon application shell and six primary pages. The existing operational APIs, media/STT adapters, Orchestrate extraction, Cloudant repository and Slack transport remain authoritative. No backend service or deployed agent was rewritten. No live Cloudant writes, Slack sends, CRM operations, environment edits, merges, pushes or deployment occurred in this UI batch.

The task resumed against existing checkpoint `5ef3b45` (`UI UX improved, video summary`) on `feature/slack-ai-summarizer`. That checkpoint was already present at resume and includes earlier video/STT work and most UI implementation. The assistant did not create it. Resume verified the actual files, completed browser assertions, reran regressions and supplied the missing documentation/screenshots. Do not attribute every file in that checkpoint to this UI phase.

## Before → after architecture and migration plan

Before: one Dashboard mounted ingestion, every Promise card, every Action form and three MongoDB prototype panels together. Every section competed for attention; legacy Mongo outages dominated the page. Source selection was a dropdown; review forms and lists required extensive vertical scrolling.

Migration sequence used: (1) map repository versus Mongo endpoints and preserve files; (2) introduce shell, route helpers and independent pages; (3) retain the working Analyze component with Carbon tabs and stable mounted state; (4) replace the Promise list with a table and one selected detail; (5) replace the Action list with master/detail and move completed-send controls into collapsed read-only sections; (6) add real audit/readiness consumers; (7) verify with isolated browser fixtures and existing regressions.

| Page / hash route | Current implementation | Existing endpoints |
| --- | --- | --- |
| Overview `#/overview` | Saved Promise count, needs-review count, pending-review Action count, stored reply count, recent events and workflow guide | GET review/promises, review/actions, review/audit-events |
| Analyze `#/analyze` | Four tabs; selected input only; Input → Analyze → Review & Save; exact evidence and explicit save | POST ingest, transcribe, transcribe/video, review/sources |
| Promises `#/promises[/id]` | Carbon DataTable; local search/status filter; source type; selected review, associated actions, original source/extracted fields, blockers and audit | GET review/promises, review/actions, review/sources/:id, review/audit-events; PATCH review/promises/:id |
| Follow-ups `#/follow-ups[/id]` | Master/detail; explicit same-source Promise association; owner directory; editable draft; preview; sent/replied evidence | GET review/promises, review/actions, review/slack-recipients; PATCH review/actions/:id; POST review/actions/:id/slack-preview |
| Activity `#/activity` | Actual stored event names mapped to readable labels, timestamps, changed field names and valid related-record links | GET review/audit-events, review/promises, review/actions |
| Integrations `#/integrations` | Readiness and recipient configuration; historical workflow evidence distinctly labelled; HubSpot pending | GET ready, review/slack-recipients |
| Legacy `#/legacy` | Original ChatInterface, TaskTracker, DecisionsLog, mounted only on this page | Existing Mongo-backed chat/history, chat, tasks, decisions |

All endpoint paths above are under `/api/`. Source-type lookup reads each unique source at most once per Promise load, four requests at a time. Original source content is never rendered as executable HTML. Activity omits raw payloads/approval snapshots. The list endpoints remain unpaginated; tables explicitly say “loaded” and “filtered locally.”

## State, accessibility and safety

- A small hash router preserves deep links and browser back/forward without a state-management dependency. Separate page components own the page layouts. Analyze stays mounted while hidden, preserving input and in-flight results across page navigation. Selecting a different source or file invalidates previous analysis.
- Carbon tabs have associated TabPanels and keyboard selection. The header has a skip link and menu expanded-state/controls attributes. Route changes focus the page title. Record titles are real links; table rows also accept pointer selection. The mobile menu closes on navigation. Desktop and 390px layouts were exercised.
- Failed data reads do not become empty success/zero metrics. Counts use actual returned arrays; pending review includes Actions whose formal state is pending_review, even if a demo follow-up has a reply. Reply count is the number of stored reply events, not completed promises.
- Exact edited text remains the source sent to analysis and save. WAV and NDJSON video methods, validation, timeout handling and terminal failure interpretation are preserved. Empty or failed transcription never automatically analyzes or saves.
- Updates still submit the version originally read. HTTP 409 explains that changes were not saved and requires deliberate refresh/reapplication; there is no silent overwrite or automatic retry. Draft values remain visible after a conflict.
- Only explicitly linked Actions appear under a Promise; same-source proximity does not imply association. Follow-ups permits only same-source linking because that is the existing backend contract.
- Development owner mappings come from the existing allowlisted directory. Typed company/owner IDs remain unverified drafts, not fabricated CRM identities. No approved state is simulated.
- Formal approve/reject controls remain disabled. No send endpoint/button was introduced. Sent/replied/sending/uncertain follow-ups cannot be re-previewed or edited from this UI. Their existing fields are available in a collapsed read-only section. Replies do not mark a Promise complete.
- Slack message links require HTTPS and a slack.com hostname/subdomain, with no embedded credentials. They open separately with noreferrer. Tests check the safe link target; a real Slack destination was not opened in this batch.
- No polling, public authentication, pagination, external executor or new integration-health backend was added. Orchestrate and STT configuration/current reachability cannot be inferred from available APIs, so the page explicitly says current availability is not checked. Historical live verification is labelled as such. Cloudant readiness proves read access only; recipient configuration is not Slack reachability. HubSpot is Pending integration, assigned to Will.

## Verification results

| Check | Result and scope |
| --- | --- |
| `node --test server/tests/*.test.js` | 124 passed; real temporary SQLite/local HTTP, mocked Cloudant/IBM transport and existing contract/security tests |
| `npm run test:api --prefix client` | 6 passed; existing media API tests plus route round-trips, null-versus-zero metrics and safe Slack links |
| `npm run test:browser --prefix client` | 12 passed in installed Chrome, isolated profile, local Vite, synthetic mocked API responses |
| `npm test --prefix slack-ai-summarizer -- --runInBand` | 39 passed across 7 suites; Slack/IBM transports mocked |
| `npm run build --prefix client` | Passed; Carbon Sass deprecation warnings and a roughly 513 kB JS chunk warning remain |
| `npm run lint --prefix client` | Passed |
| `git diff --check` | Passed at final verification |
| `node server/scripts/test-action-readonly.js` | **Live read-only Cloudant:** backend=cloudant, ready=true, 6 Promises, 5 Actions and 18 audit records validated; writes=0 |

Browser coverage includes Overview, hash navigation/back/forward, meeting/email analysis, WAV/MP4 selection and mocked transcription, exact edited-text save payloads, no implicit saving, stale-result invalidation, conflict drafts without retry, explicit Action association/owner mapping, review reload and preview, approval disabled, replied evidence with disabled resend/edit, NDJSON terminal failure, source/blocker/extracted-field display, local search, keyboard source tabs, unavailable metrics and narrow viewport overflow. These are browser workflow tests, **not new live STT/Orchestrate/Cloudant-write tests**. Synthetic media bytes are intercepted at the transport boundary; real media parsing remains covered by the backend suite and earlier Phase 5 live evidence.

Screenshots were visually inspected. Header contrast was corrected, the mobile menu expanded-state attribute was added, and sent/replied forms were collapsed so reply evidence is visible without traversing disabled fields. All screenshots below contain test fixtures only, never live business records:

- [Overview, desktop](ui-screenshots/overview-desktop.png)
- [Follow-ups, desktop](ui-screenshots/follow-ups-desktop.png)
- [Promises, narrow viewport](ui-screenshots/promises-mobile.png)

The browser tests run headless Chrome. Manual live acceptance of all four ingestion methods, actual Slack-link destination access and a complete live demo were **not repeated**. No interactive user browser or authentication state was changed. Test Vite/Chrome processes shut down after the suite.

## Feature completion matrix

| Feature | Status |
| --- | --- |
| Six-page shell, responsive navigation and history | Implemented; browser verified |
| Overview using real API records, unavailable states | Implemented; mocked browser + live repository read verified |
| Four-source Analyze workspace and exact edit/save semantics | Implemented; API and browser regressions passed |
| Promise table/search/status filter/detail/evidence/audit | Implemented; browser verified |
| Follow-up master/detail, mapping/review/preview/replies | Implemented; browser verified with mocks |
| Formal approval/public sends | Intentionally disabled; existing safeguards preserved |
| Read-only Activity timeline | Implemented; actual event schema, mocked browser verified |
| Integration status without secret disclosure | Implemented within existing endpoint capabilities |
| Original Mongo prototype | Preserved, removed from primary workflow; no live Mongo verification |
| Live inference or new cloud writes in UI batch | Not run; separate authorization required for writes/sends |
| HubSpot/full auth/public deployment/long recordings | Not implemented in this phase |

## Exact Phase 6A files

Modified existing files during the overall UI phase (most already present in checkpoint 5ef3b45):

- `.gitignore` — ignore transient browser results.
- `client/package.json`, `client/package-lock.json` — Playwright test-only dependency and test scripts; no runtime dependency added.
- `client/src/pages/Dashboard.jsx`, `client/src/pages/Dashboard.css` — shell, routing, responsive layout.
- `client/src/components/IngestionPanel.jsx`, `client/src/components/IngestionPanel.css` — selected-source tabs/stages and compact workspace.
- `client/src/components/PromiseQueue.jsx`, `client/src/components/PromiseQueue.css` — searchable table and selected detail, preserved editor.
- `client/src/components/ActionReview.jsx` — selected Action draft, owner mapping, locked follow-ups.
- `client/src/components/SlackFollowup.jsx` — safe links, human-readable dates, collapsed locked controls.
- `client/src/components/SourceEvidence.jsx` — original extracted fields alongside source/blocker evidence.
- `client/src/services/api.js` — audit/readiness readers and explicit 409 messages; existing media methods retained.

Added for the UI phase:

- `client/src/app/navigation.js`
- `client/src/hooks/useResource.js`
- `client/src/components/ActivityTimeline.jsx`
- `client/src/pages/Overview.jsx`
- `client/src/pages/Activity.jsx`
- `client/src/pages/Integrations.jsx`
- `client/src/pages/Legacy.jsx`
- `client/playwright.config.js`
- `client/tests/browser/dashboard.spec.js`
- `client/tests/navigation.test.mjs`
- `README.md`
- `docs/ui-redesign-handoff.md`
- `docs/demo-user-guide.md`
- `docs/ui-screenshots/overview-desktop.png`
- `docs/ui-screenshots/follow-ups-desktop.png`
- `docs/ui-screenshots/promises-mobile.png`

The resumed completion specifically modifies `client/tests/browser/dashboard.spec.js` and adds README, the two guides and three screenshots. Other checkpoint changes—including `.env.example`, video/STT services and tests—are preserved and are not new modifications by this resumed task. ChatInterface, TaskTracker, DecisionsLog and their source files were not deleted or rewritten.

## Known limitations and next step

All lists are loaded client-side; large datasets need backend pagination and more efficient source-type projection. Source detail reads are bounded in concurrency, not cached across page remounts. There is no polling for new replies. Integration configuration/readiness is incomplete where no safe endpoint exists. Historical verification labels are handoff evidence, not continuous monitoring.

Review drafts reset when selecting another record, changing page or refreshing; guidance says to save/cancel first. Analyze input survives in-app navigation but not a browser reload. Narrow Promise tables scroll within their container. JavaScript/CSS bundle sizes and Carbon Sass deprecations deserve a separate optimization pass; they do not block the local demo. Comprehensive screen-reader testing and a manual live end-to-end acceptance pass remain outstanding.

Recommended demo sequence: Overview → Analyze synthetic notes → inspect suggestions → explicitly authorized Save → Promises/evidence → Follow-ups/review/preview → existing replied Action → Activity → Integrations. See [short demo user guide](demo-user-guide.md). Use the isolated mocked browser suite when no cloud-write/send authorization is available. Do not enable auth-less formal approval or public deployment to make the demo appear complete.
