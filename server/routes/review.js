const express = require('express');
const { getRepository } = require('../operational/repository');
const { ReviewError } = require('../operational/validation');
// Trusted server integration point only; no headers/body usernames are used as identity.
function createReviewRouter(getRepository, { getPrincipal = () => null } = {}) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (process.env.NODE_ENV === 'production') return res.status(503).json({ success: false, code: 'LOCAL_REVIEW_ONLY', error: 'Review storage requires production authentication before deployment' });
    if (['POST', 'PATCH'].includes(req.method) && !req.is('application/json')) return res.status(415).json({ success: false, code: 'INVALID_REQUEST', error: 'Content-Type must be application/json' });
    next();
  });
  router.use(express.json({ limit: '512kb' }));
  const handle = fn => async (req, res, next) => { try { await fn(req, res, getRepository()); } catch (error) { next(error); } };
  const found = record => { if (!record) throw new ReviewError('Record not found', 404, 'NOT_FOUND'); return record; };
  router.post('/sources', handle(async (req, res, repo) => {
    if (!['meeting_note', 'buyer_email', 'audio_transcript', 'video_transcript', 'slack_message'].includes(req.body?.sourceType) || req.body.slack) throw new ReviewError('Slack sources require the verified Bolt integration');
    const result = await repo.saveAnalysis(req.body);
    res.status(result.duplicate ? 200 : 201).json({ success: true, persisted: true, ...result });
  }));
  router.get('/sources/:id', handle(async (req, res, repo) => res.json({ success: true, source: found(await repo.getSource(req.params.id)) })));
  router.get('/promises', handle(async (req, res, repo) => res.json({ success: true, promises: await repo.listPromises(), backend: repo.backend, approvalEnabled: false })));
  router.get('/promises/:id', handle(async (req, res, repo) => res.json({ success: true, promise: found(await repo.getPromise(req.params.id)) })));
  router.patch('/promises/:id', handle(async (req, res, repo) => res.json({ success: true, promise: await repo.updatePromise(req.params.id, req.body) })));
  router.get('/actions', handle(async (req, res, repo) => {
    if (req.query.sourceId !== undefined && (typeof req.query.sourceId !== 'string' || req.query.sourceId.length > 200)) throw new ReviewError('Invalid sourceId');
    res.json({ success: true, actions: await repo.listActions(req.query.sourceId), approvalEnabled: false, executionEnabled: false });
  }));
  router.get('/actions/:id', handle(async (req, res, repo) => res.json({ success: true, action: found(await repo.getAction(req.params.id)) })));
  router.patch('/actions/:id', handle(async (req, res, repo) => res.json({ success: true, action: await repo.reviewAction(req.params.id, req.body) })));
  for (const decision of ['approve', 'reject']) {
    router.post(`/actions/:id/${decision}`, async (req, res, next) => {
      try {
        const principal = await getPrincipal(req);
        if (!principal?.authenticated || !principal.subject) throw new ReviewError('Authentication provider is not configured; approval and rejection are disabled', 401, 'AUTHENTICATION_REQUIRED');
        const repo = getRepository();
        const action = await repo[decision === 'approve' ? 'approveAction' : 'rejectAction'](req.params.id, req.body, principal);
        res.json({ success: true, action, executionEnabled: false });
      } catch (error) { next(error); }
    });
  }
  router.get('/slack-recipients', (req, res) => res.json({ success: true, recipients: require('../integrations/slackFollowup').directory(), sendEnabled: false }));
  router.post('/actions/:id/slack-preview', handle(async (req, res, repo) => res.json({ success: true, action: await require('../integrations/slackFollowup').preview(repo, req.params.id, req.body), sendEnabled: false })));
  router.post('/actions/:id/slack-send-agent', handle(async (req, res, repo) => {
    const action = await repo.getAction(req.params.id);
    if (!action) throw new ReviewError('Action not found', 404, 'NOT_FOUND');
    const f = action.slackFollowup;
    if (!f || f.status !== 'preview') throw new ReviewError('Prepare a preview before sending', 400);
    const { sendMessage } = require('../services/watsonx.service');
    const message = `Send a Slack direct message to the user with Slack user ID ${f.recipient.userId} in workspace ${f.recipient.teamId}. The message content is exactly:\n\n${f.text}\n\nDo not modify the message content. Confirm when sent.`;
    const reply = await sendMessage([
      { role: 'user', content: 'You are the SARDINES orchestrator. Use your Slack tool to send direct messages exactly as instructed.' },
      { role: 'assistant', content: 'Understood. I will send Slack messages exactly as instructed without modification.' },
      { role: 'user', content: message },
    ]);
    res.json({ success: true, reply });
  }));
  router.get('/audit-events', handle(async (req, res, repo) => res.json({ success: true, events: await repo.listAuditEvents() })));
  router.use((req, res) => res.status(404).json({ success: false, code: 'NOT_FOUND', error: 'Review endpoint not found; approval and execution are unavailable' }));
  router.use((error, req, res, next) => {
    const validation = error instanceof ReviewError;
    const parse = ['entity.parse.failed', 'entity.too.large'].includes(error.type);
    const code = validation ? error.code : parse ? 'INVALID_REQUEST' : 'STORAGE_UNAVAILABLE';
    if (!validation && !parse) console.error(JSON.stringify({ event: 'review_storage_failed', code }));
    res.status(validation ? error.status : parse ? 400 : 503).json({ success: false, code, error: validation ? error.message : parse ? 'Invalid or oversized JSON body' : 'Review storage unavailable; retry later' });
  });
  return router;
}
module.exports = createReviewRouter(getRepository);
module.exports.createReviewRouter = createReviewRouter;
