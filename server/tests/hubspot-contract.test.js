const {test}=require('node:test');
const assert=require('node:assert/strict');
const {assertHubSpotAdapter}=require('../integrations/hubspotContract');
test('HubSpot contract is mockable without executing any operation',()=>{
 let calls=0; const adapter=Object.fromEntries(['findCompanies','listContacts','getOwner','getCompany','createTask','associateTaskToCompany','reconcileTask'].map(name=>[name,async()=>{calls++;}]));
 assert.equal(assertHubSpotAdapter(adapter),adapter);assert.equal(calls,0);assert.throws(()=>assertHubSpotAdapter({}));
});
