const path = require('node:path');
function createRepository(env = process.env) {
  const backend = env.OPERATIONAL_STORE || 'sqlite';
  if (backend === 'sqlite') {
    const { LocalRepository } = require('./localRepository');
    return new LocalRepository(env.SARDINES_DB_PATH || path.resolve(__dirname, '../data/operational.sqlite'));
  }
  if (backend === 'cloudant') {
    const { CloudantClient } = require('./cloudantClient');
    const { CloudantRepository } = require('./cloudantRepository');
    return new CloudantRepository(new CloudantClient({ url: env.CLOUDANT_URL, apiKey: env.CLOUDANT_API_KEY, database: env.CLOUDANT_DATABASE }));
  }
  throw new Error('Unsupported operational storage backend');
}
let repository;
function getRepository() { if (!repository) repository = createRepository(); return repository; }
module.exports = { createRepository, getRepository };
