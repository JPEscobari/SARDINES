# Phase 3B HubSpot integration plan (no operations executed)

## Inspection

No HubSpot integration client, account resolver, task writer or session/authentication provider exists in the inspected repository. HUBSPOT_ACCESS_TOKEN was absent in the checked configuration; no credential values were displayed. A teammate may have an unmerged implementation; obtain its contract and sandbox details before selecting an API/auth method. This batch adds only the JavaScript adapter interface in server/integrations/hubspotContract.js, with no HTTP client and no connected HubSpot tool calls.

## Proposed adapter contract

| Operation | Expected behavior |
| --- | --- |
| findCompanies({name,domain,cursor}) | Return candidates and paging cursor; never silently choose ambiguous names. |
| getCompany(companyId) | Verify the selected ID belongs to the intended account/tenant and is active/usable. |
| listContacts(companyId) | Retrieve company-associated contacts for explicit selection; no automatic customer contact. |
| getOwner(ownerId) | Verify an assignable active owner. Do not conflate owner IDs and login/user IDs. |
| createTask(approvedPayload, requestKey) | Future worker-only write; return external taskId. |
| associateTaskToCompany(taskId,companyId) | Associate the existing task with the approved company, with verified association semantics. |
| reconcileTask(requestKey) | Return found/not_found/unknown and taskId if verified. Unknown is not permission to recreate. |

The interface can be replaced by a fake in automated tests; the production implementation is absent. assertHubSpotAdapter validates method presence without calling any operation. The identity resolver seam on repositories is separate: a future implementation should use getCompany/getOwner and authorization checks to return verified=true for the exact IDs only. Client-entered IDs are never proof.

## Lookup and API research

Company lookup should combine normalized name/domain, candidate presentation and explicit selection. HubSpot's official company-object guide discusses company search: https://developers.hubspot.com/blog/a-developers-guide-to-hubspot-crm-objects-company-object . Resolve actual IDs server-side; do not ask the LLM to invent them.

The Owners API is read-only and provides IDs for assigning records/activities; confirm active status and use the owner identifier, not an unrelated user identifier: https://developers.hubspot.com/docs/api-reference/legacy/crm/owners/guide . Contacts require company-association retrieval and account-specific access checks.

Task creation must map the approved title, UTC deadline, owner and evidence into the task schema selected for the team's HubSpot API version. Confirm required task properties, scopes and request validation against the current official API/reference and sandbox before implementing writes. The task guide fetch timed out during this batch; do not treat endpoint/property assumptions as verified integration. No task endpoint was invoked.

Task-to-company association must use the correct object direction and association category/type for the chosen API version; retrieve/verify these rather than inventing numeric IDs. HubSpot documents association operations separately: https://developers.hubspot.com/docs/api-reference/latest/crm/associations/associate-records/guide . A task creation followed by a failed association must be repaired using the saved task ID, not by creating another task.

## Execution and durable state (future, not enabled)

1. Authenticated approval commits a strict immutable payload, payload hash, actor and action revision, as implemented in Phase 3A tests.
2. Worker atomically claims only a current approved action. Compare its payload hash and linked Promise version, verified identities and permitted account scope. Persist execution attempt/idempotency key before external calls.
3. Use a stable application request key derived from action ID and approval payload hash. This is NOT a claim that HubSpot provides idempotency for task creation. Determine a supported correlation/reconciliation strategy in the sandbox. If no reliable reconciliation is possible, require manual resolution after ambiguous outcomes.
4. Persist external task ID, request key, response status, timestamps, association progress and attempt count in the source aggregate. Extend schemas and tests before enabling any worker. These fields are not implemented yet.
5. Retry transient read failures with bounded backoff and rate-limit handling. On a write timeout, reconcile first. Do not automatically retry a task creation whose outcome is unknown. If creation succeeded but association failed, retry only the association.
6. Concurrent workers need lease/claim version checks. Only the holder of the current claim can record execution state. Design changes during executing as a cancellation/reconciliation workflow; do not simply reset to pending_review.
7. Add authenticated synthetic sandbox acceptance tests for company ambiguity, inactive owner, approval scope, 409, duplicate queue delivery, timeout after accepted creation, partial association failure, revocation and no unintended external action.

## Remaining authorization and configuration

Select a real identity/session provider; map team roles and account/tenant access server-side. Obtain approved sandbox access and minimal scopes for company/contact/owner reads and task/association writes. Keep tokens server-side, rotate safely and scrub upstream errors. Confirm retention of source evidence before sending it to CRM. No existing Cloudant or SQLite data should be migrated by the adapter. No CRM writes, Slack sends or public deployment are authorized by Phase 3A.
