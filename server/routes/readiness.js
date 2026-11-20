const express = require('express');
const { getRepository } = require('../operational/repository');
function createReadinessRouter(getRepo = getRepository) {
  const router = express.Router();
  router.get('/', async (req, res) => {
    try { res.json({ success: true, ...(await getRepo().health()) }); }
    catch { res.status(503).json({ success: false, ready: false, code: 'STORAGE_UNAVAILABLE' }); }
  });
  return router;
}
module.exports = createReadinessRouter();
module.exports.createReadinessRouter = createReadinessRouter;
