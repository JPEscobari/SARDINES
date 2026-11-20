# Phase 4D: live Slack follow-up readiness — November 19, 2026

## Decision: NOT ready for the live self-DM yet

Implementation and mocked recovery are ready for a controlled development test, but the current Slack installation is not ready. No real Slack message was sent and no existing Cloudant record was modified during this batch. No .env, Slack settings, credentials, agent deployment or Git history were changed.

Read-only findings:

- Configured repository: Cloudant. Cedar Demo Realty preview can be read by `confirmFollowup.js`.
- Action `action:1d3c4508-bd2d-4df7-bec1-23e7dd861c14`, version **3**, status **preview**, title **Review the pricing**, recipient **Yudian Test**.
- Recipient directory: owner `reviewed-test-owner`, workspace `T0CFS3Z08AG` (AI Summarizer Dev), Slack user `U0CFG5ZQGD9`.
- Preview hash: `0886c830d09e2998bab18d89d94476b07c93682e10728a38991d7481bf733788`.
- Read-only preflight: `previewValid=true`, `workspaceVerified=true`, `apiReady=false`, `recipientVerified=false`, `sendingEnabled=false`, `recoveryEnabled=false`, `writes=0`.
- Bot token's live granted scopes: `channels:history`, `chat:write`, `commands`.
- Missing for this workflow: **users:read**, **im:write**, **im:read**, **im:history**. `users:read` is needed to verify the actual recipient; the configured label alone is not identity verification.
- Browser inspection of AI Chat Summarizer in AI Summarizer Dev, app `A0CGGRB8472`: **Socket Mode on**, **Event Subscriptions / Enable Events off**. Therefore `message.im` delivery is not enabled. No settings were changed.

The send CLI now checks all five required bot scopes and actual recipient identity before claiming a send. Its preflight cannot infer event subscriptions from OAuth scopes; app settings must be checked separately. The local recovery CLI is separately disabled by default. The implementation never treats a read-only readiness result as authorization to send.

## Operator reconciliation and controlled replay

`recoverFollowup.js` is a local-only tool. With three arguments it performs read-only inspection of one exact DM thread and prints a plan; it never opens a DM or posts a message. With an explicit confirmation flag, interactive terminal, recovery enable flag, current action version and plan hash, it re-reads Slack evidence and atomically reconciles the Action plus audit/replies.

Checks before recovery:

- Current configured workspace and recipient directory still match the saved follow-up.
- Saved payload hash is valid, and state is sending/uncertain/sent/replied.
- `auth.test` and `users.info` verify bot workspace and active non-bot/non-guest recipient.
- `conversations.info` proves the supplied channel is the bot's DM with that recipient.
- Paginated `conversations.replies` proves the exact root timestamp, bot author, `client_msg_id` matching the stored follow-up UUID, unchanged exact preview text, and no edited root.
- Existing sent identity cannot be replaced with a different channel/root. Missing or ambiguous evidence leaves the claim locked. No negative search result is treated as proof that a send did not happen.
- Replies must be unedited, non-bot, non-subtype messages from the exact recipient under the verified root. Message timestamps deduplicate against ordinary event delivery and prior replay.

Controlled replay is the recovery mechanism chosen instead of a new durable local inbox. Slack history is the upstream record; replayed replies are durably stored in the existing Cloudant aggregate or SQLite transaction. Replay event IDs use a clearly labelled `replay:<team>:<channel>:<timestamp>` namespace because history does not supply the original event ID. Original reply text, author, Slack timestamp and recovery receive time are preserved. The operator audit records the plan hash, verified root hash and replay count. Promise status never changes.

Each confirmed recovery is one repository mutation, so partial reply commits are avoided. Existing `_rev` conflict handling and operation-audit reconciliation apply. Concurrent operators or an event arriving after inspection produce a stale-plan/version failure; re-inspect. Re-running an empty plan after successful recovery is a no-op. A late sender success/timeout cannot downgrade recovered replies or overwrite their Slack message identity.

Limits: maximum 10 history pages and 100 persisted replies. Rate limits, incomplete pagination, unavailable history, missing client message IDs, edited/deleted roots or retention expiry block recovery without writes. There is no automatic reset-to-preview, resend, negative-result retry, background poller, public recovery endpoint or promise-completion transition. If no matching sent message can be proven, retain sending/uncertain and investigate; do not create a replacement Action to bypass duplicate protection.

## Exact next commands: safe read-only checks now

Run from PowerShell:

```powershell
Set-Location 'E:\Project_git\SARDINES-integration'
$actionId = 'action:1d3c4508-bd2d-4df7-bec1-23e7dd861c14'
node slack-ai-summarizer/src/confirmFollowup.js $actionId
node slack-ai-summarizer/src/checkFollowup.js $actionId
```

First command prints the stored source/Promise IDs, version, recipient, exact message, payload hash, state and replies. Second command currently exits **1** with the four missing scopes above, previewValid=true and writes=0. This is the expected fail-closed result, not a storage failure. No token values are printed by these scripts.

## Preconditions before authorizing the one-DM test

An authorized app administrator must deliberately review/add the four missing **bot** scopes, enable events with the **bot event `message.im`**, and reinstall/re-authorize the development app as required. Preserve the existing shortcut and scopes. Verify the Messages tab allows the recipient to reply to the app. Do not add public HTTP endpoints. Settings: https://api.slack.com/apps/A0CGGRB8472/event-subscriptions and https://api.slack.com/apps/A0CGGRB8472/oauth . These are instructions for a later authorized setup action; no permission changes were made in this batch.

Re-run `checkFollowup.js`: require previewValid=true, workspaceVerified=true, recipientVerified=true, missingScopes=[], apiReady=true. Independently confirm Enable Events is on and message.im is listed for the same app/workspace. Confirm the token/app installation belongs to this development app, including the verified recipient identity. A label of Yudian Test is not a substitute.

Restart the local backend and Bolt process with updated code and the same Cloudant configuration; old strict validators do not recognize the new `slack_reconciled` audit event. Keep the backend loopback-only. In a dedicated terminal, after authorizing the listener to persist replies for the synthetic test:

```powershell
Set-Location 'E:\Project_git\SARDINES-integration'
$env:SARDINES_SLACK_SEND_ENABLED='false'
node slack-ai-summarizer/src/app.js
```

Expected `Starting Slack AI Summarizer...`. This starts the existing summarizer too; do not trigger unrelated shortcuts during the one-message test. Starting a listener is not proof of event delivery. The controlled replay path can recover a reply if the listener was offline or its database write failed.

Obtain explicit authorization for **one bot DM to U0CFG5ZQGD9 in T0CFS3Z08AG using this exact saved preview**, and for the corresponding synthetic source's claim, send, audit and reply/recovery Cloudant writes. This implementation request did not grant that authorization.

## One explicitly authorized send — do not run yet

Inspect again immediately before sending. These are the exact arguments for the current version/hash; if either has changed, stop and review the new preview instead of substituting blindly.

```powershell
Set-Location 'E:\Project_git\SARDINES-integration'
$actionId = 'action:1d3c4508-bd2d-4df7-bec1-23e7dd861c14'
node slack-ai-summarizer/src/confirmFollowup.js $actionId
node slack-ai-summarizer/src/checkFollowup.js $actionId
if ($LASTEXITCODE -ne 0) { throw 'Readiness blocked; do not send' }
$env:SARDINES_SLACK_SEND_ENABLED='true'
try {
  node slack-ai-summarizer/src/confirmFollowup.js $actionId 3 0886c830d09e2998bab18d89d94476b07c93682e10728a38991d7481bf733788 --confirm-demo-send
} finally {
  $env:SARDINES_SLACK_SEND_ENABLED='false'
}
```

Run in an interactive local terminal, not a scheduled job or piped input. Expected preview contains Action Review the pricing, Promise updated proposal, Deadline Unresolved, blocker Legal approval is still pending, and the original pricing-review quote. It asks the recipient to reply in the thread and explicitly says a reply does not complete the Promise.

On success the CLI prints a second JSON object: `sent:true`, the action ID, status sent, actual DM `channelId` and `messageTs`, and current version (normally 5 from preview version3, claim4, sent5). Record these two Slack identifiers. No retry loop. On any error, read the persisted state before doing anything else. sending/uncertain means possible delivery, not permission to repeat the send.

## Reply, Cloudant and Dashboard checks

1. As Yudian Test, open the bot DM and verify exactly one new message with the reviewed text. This is a bot-to-self-demo-user DM, not a message authored as the human user.
2. Reply **in that message's thread**: `Synthetic test: pricing review is underway; legal approval remains pending.` A top-level DM is deliberately ignored.
3. Refresh Action Review. Expect status replied, the same Slack channel/root identifiers, exact reply text/author/time, and the Promise's prior status unchanged. No CRM task or production approval should appear.
4. Read the record again:

```powershell
node slack-ai-summarizer/src/confirmFollowup.js $actionId
node server/scripts/test-action-readonly.js
```

5. Use the returned sourceId to inspect that source aggregate in Cloudant read-only. Verify one claimed follow-up UUID, one root Slack message identity, one reply timestamp, and the relevant `slack_send_claimed`, `slack_sent`, `slack_reply_received` events (or `slack_reconciled` for controlled recovery). Other sources must be unchanged. The readiness script verifies schema/read access only, not the one-message count in Slack.

## If sending is stuck or the reply is missing

Obtain the actual DM channel/root timestamp from the successful CLI output, persisted Action, or Slack's Copy link for the exact bot message. A Slack link `/archives/D.../p<digits>` encodes the timestamp by putting a decimal before the last six digits; do not guess an ID or choose a similarly worded message.

Read-only plan (works for sending/uncertain to reconcile delivery and sent/replied to recover missed replies):

```powershell
$dmChannel = '<actual D-prefixed channel>'
$rootTs = '<actual root timestamp with six decimal places>'
node slack-ai-summarizer/src/recoverFollowup.js $actionId $dmChannel $rootTs
```

Review the displayed actionId, previousStatus, version, exact replies, rootHash and planHash. A no-match/error does not permit resend. After explicit authorization for the displayed recovery write, capture a fresh plan and confirm its exact version/hash:

```powershell
$planJson = node slack-ai-summarizer/src/recoverFollowup.js $actionId $dmChannel $rootTs
if ($LASTEXITCODE -ne 0) { throw 'Recovery inspection blocked' }
$plan = $planJson | ConvertFrom-Json
$plan | ConvertTo-Json -Depth 8
# Inspect this exact plan before the next block.
$env:SARDINES_SLACK_RECOVERY_ENABLED='true'
try {
  node slack-ai-summarizer/src/recoverFollowup.js $actionId $dmChannel $rootTs $plan.version $plan.planHash --confirm-recovery
} finally {
  $env:SARDINES_SLACK_RECOVERY_ENABLED='false'
}
```

Expected confirmation output: recovered=true, actionId, new version, status sent or replied, reply count, messagesSent=0. The command re-fetches Slack evidence; if the plan changed, it refuses and requires re-inspection. Inspect again after success: no additional replies should be proposed. Do not execute a second send to test deduplication against real Slack; duplicate prevention is covered by mocks.

## Verification and files

Final results:

- `node --test server/tests/*.test.js`: **93 passed**, including SQLite and mocked Cloudant contracts.
- `npm test --prefix slack-ai-summarizer -- --silent`: **39 passed**, 7 suites; Slack and IBM mocked.
- `npm run build --prefix client`: passed; existing Carbon Sass warnings remain.
- `npm run lint --prefix client`: passed.
- `git diff --check`: passed, with the existing CRLF notice.
- Live read-only `confirmFollowup.js`: Cedar remains version3/preview, replies=[] after all work.
- Live read-only `checkFollowup.js`: expected exit1, valid preview, missing four scopes, writes=0.
- Live Slack app-settings inspection: Socket Mode on, Event Subscriptions off; settings unchanged.
- Not run: real Slack send/reply/recovery, Cloudant mutations, CRM operations or deployment. No frontend browser workflow rerun was needed because no UI code changed.

Automated tests use temporary SQLite and mocked Cloudant/Slack. New cases cover timeouts, stuck final commits, no-match proof, forged/edited roots, stale plans, concurrent recovery, persistence failure, offline replies, duplicate event/replay delivery, and late sender responses. Slack transport tests cover pagination, recipient mismatch, missing scopes and rate limits. Frontend implementation was unchanged; build/lint regression was run.

Phase4D modified: `server/integrations/slackFollowup.js`, `server/operational/validation.js`, `server/tests/slack-followup.test.js`, `server/scripts/seed-slack-browser-demo.js`, `slack-ai-summarizer/src/app.js`, `slack-ai-summarizer/src/confirmFollowup.js`, and `docs/slack-integration-handoff.md`.

Added: `server/integrations/slackRecovery.js`, `server/tests/slack-recovery.test.js`, `slack-ai-summarizer/src/recoverFollowup.js`, `slack-ai-summarizer/src/checkFollowup.js`, `slack-ai-summarizer/src/slack/recoveryTransport.js`, `slack-ai-summarizer/src/slack/readiness.js`, `slack-ai-summarizer/tests/recoveryTransport.test.js`, and this document.

Git remains dirty on feature/slack-ai-summarizer with prior work preserved. No staging, commit or push. Live send/recovery writes remain untested and prohibited in this batch; current Cloudant preview stays version3/preview.

References: Slack's [thread history method](https://docs.slack.dev/reference/methods/conversations.replies/), [message events](https://docs.slack.dev/reference/events/message/), and [App Home Messages tab](https://docs.slack.dev/surfaces/app-home/). Bot scopes and event subscriptions are separate configuration checks.
