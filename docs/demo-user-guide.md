# SARDINES — short demo guide

## Five-minute narrative

1. **Overview:** Explain that a Promise is a customer commitment and an Action is an internal task or suggested follow-up. Counts come from saved records; unavailable services show Unavailable, not zero. Follow the guide: Analyze → Save → Review → Follow up → Track reply.
2. **Analyze:** Pick Meeting Notes or Buyer Email. Paste an approved synthetic source. Click Analyze, then inspect the summary, suggested commitments, actions, blockers and exact source quotes. Missing owners and deadlines stay unresolved.
3. **Save for Review:** Only save when a new synthetic database record is authorized for the demo. Saving is not approval or external execution. Open Promise Queue; search the customer and select the Promise. Show original evidence, blockers, original extracted fields and audit history.
4. **Follow-ups:** Select the related Action. Explicitly choose a Promise from the same source. Map a permitted development owner, review the draft and save only when review writes are authorized. Choose the matching allowlisted Slack recipient and prepare a preview. No message is sent by this button.
5. **Track a reply:** Prefer an existing sent/replied Action for a read-only demonstration. Show the original message link, reply evidence and received time. Explain that replying does not complete the Promise. Actual send/recovery stays in the existing restricted, separately authorized operator workflow.
6. **Activity and Integrations:** Show stored audit events and the distinction between database read readiness, recipient configuration and historical live verification. HubSpot is pending integration with Will; formal approval is unavailable without authentication.

For this UI development batch, only read-only live inspection was authorized. Do not interpret this guide as permission to create records or send messages.

## Optional media demonstration

In Analyze, choose Audio / Voice Memo (supported PCM WAV; default 8 MiB/two minutes) or Video Upload (supported MP4; default 32 MiB/two minutes). Select an approved short synthetic recording and click Transcribe. MP4 shows extraction and transcription stages. Review/edit the transcript, then Analyze Transcript and explicitly Save for Review only if authorized. Original recognition metadata is not rewritten to match edits. No visual frames are analyzed.

Prefer the mocked browser regression demonstration when live inference or cloud writes are not authorized. Automated test media is intentionally synthetic and its transport is mocked; it is not a real IBM recognition result.

## Practical controls

- Source tabs show one input method. Changing the source/file/text clears old analysis. Navigating between pages preserves the current Analyze workspace; reloading the browser does not.
- Search and status filters operate on loaded records; no server pagination is claimed. On narrow screens the Promise table can be scrolled horizontally inside its container.
- Review forms require Save. Choosing another record/page or refreshing discards unsaved review drafts; save or cancel first.
- A conflict means another update happened. Your draft remains visible after the failed save. Copy any needed edits, refresh, inspect the latest version and reapply deliberately. There is no automatic overwrite/retry.
- Refresh actions to retrieve newly stored replies. There is no live push subscription.
- Legacy Prototype is accessible through Integrations, but requires separate MongoDB configuration and is not needed for the primary demo.
- Stop at the preview unless a specific real Slack send is explicitly authorized. Never resend a sent, replied, sending or uncertain action to demonstrate deduplication.

## If something is unavailable

Show the displayed error rather than substituting a fabricated result. Confirm the local backend and selected repository first. Integration read readiness is not proof of a successful end-to-end run. Do not change credentials or bypass approval controls during the demo.
