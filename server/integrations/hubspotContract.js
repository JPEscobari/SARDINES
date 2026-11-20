/**
 * Phase 3B boundary. Implementations are injected; no HTTP client or credentials here.
 * Lookup returns candidates, never silently picks an ambiguous company/contact.
 * createTask/associate must only be called by a future authorized execution worker.
 * A requestKey is an application reconciliation key, NOT a claim of HubSpot idempotency.
 *
 * @typedef {Object} HubSpotAdapter
 * @property {(query: {name?: string, domain?: string, cursor?: string}) => Promise<{companies: Array<{id:string,name:string,domain?:string}>, nextCursor?:string}>} findCompanies
 * @property {(companyId:string) => Promise<Array<{id:string,name:string}>>} listContacts
 * @property {(ownerId:string) => Promise<{id:string,active:boolean}|null>} getOwner
 * @property {(companyId:string) => Promise<{id:string,name:string}|null>} getCompany
 * @property {(payload:object, requestKey:string) => Promise<{taskId:string}>} createTask
 * @property {(taskId:string, companyId:string) => Promise<void>} associateTaskToCompany
 * @property {(requestKey:string) => Promise<{outcome:'found'|'not_found'|'unknown',taskId?:string}>} reconcileTask
 */
const methods = ['findCompanies', 'listContacts', 'getOwner', 'getCompany', 'createTask', 'associateTaskToCompany', 'reconcileTask'];
function assertHubSpotAdapter(adapter) {
  if (!adapter || methods.some(name => typeof adapter[name] !== 'function')) throw new Error('Incomplete HubSpot adapter contract');
  return adapter;
}
module.exports = { assertHubSpotAdapter };
