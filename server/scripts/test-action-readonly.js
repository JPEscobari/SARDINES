require('dotenv').config({path:require('node:path').resolve(__dirname, '../../.env')});
const {createRepository}=require('../operational/repository');
(async()=>{
const repo=createRepository(); const health=await repo.health();
const promises=await repo.listPromises();const actions=await repo.listActions();const events=await repo.listAuditEvents();
console.log(JSON.stringify({readOnly:true,backend:health.backend,ready:health.ready,promisesValidated:promises.length,actionsValidated:actions.length,auditsValidated:events.length,writes:0}));repo.close();
})().catch(()=>{console.error('Read-only compatibility check failed; no service details logged.');process.exitCode=1});
