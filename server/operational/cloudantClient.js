const axios = require('axios');
function unavailable(status) { return Object.assign(new Error('Cloudant request unavailable'), { status }); }
class CloudantClient {
  constructor({ url, apiKey, database, http = axios }) {
    let parsed;
    try { parsed = new URL(url); } catch { throw new Error('Cloudant configuration incomplete'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/' || !apiKey || !/^[a-z][a-z0-9_$()+-]*$/.test(database || '')) throw new Error('Invalid Cloudant configuration');
    this.base = `${parsed.origin}/${encodeURIComponent(database)}`;
    this.apiKey = apiKey; this.http = http; this.token = null;
  }
  async bearer() {
    if (this.token && this.expires > Date.now() + 60000) return this.token;
    try {
      const { data } = await this.http.request({ method: 'POST', url: 'https://iam.cloud.ibm.com/identity/token', data: new URLSearchParams({ grant_type: 'urn:ibm:params:oauth:grant-type:apikey', apikey: this.apiKey }).toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000, maxRedirects: 0 });
      if (typeof data.access_token !== 'string' || !Number.isFinite(data.expires_in)) throw new Error();
      this.token = data.access_token; this.expires = Date.now() + data.expires_in * 1000; return this.token;
    } catch { throw unavailable(); }
  }
  async request(method, suffix = '', data, params) {
    // Reads may retry once on transient failure. Writes are never blindly retried.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await this.http.request({ method, url: this.base + suffix, data, params, headers: { Authorization: `Bearer ${await this.bearer()}`, 'Content-Type': 'application/json' }, timeout: 15000, maxRedirects: 0, maxContentLength: 16 * 1024 * 1024 });
        if (response.status === 202) throw unavailable(202); // quorum not confirmed
        return response.data;
      } catch (error) {
        const status = error.response?.status || error.status;
        if (method === 'GET' && attempt === 0 && (!status || status === 401 || status === 429 || status >= 500)) {
          if (status === 401) this.token = null;
          await new Promise(resolve => setTimeout(resolve, 200)); continue;
        }
        throw unavailable(status);
      }
    }
  }
  async get(id) {
    try { return await this.request('GET', '/' + encodeURIComponent(id), undefined, { conflicts: true }); }
    catch (error) { if (error.status === 404) return null; throw error; }
  }
  async put(doc) { return this.request('PUT', '/' + encodeURIComponent(doc._id), doc); }
  async page(start, skip, limit) {
    return this.request('GET', '/_all_docs', undefined, { include_docs: true, conflicts: true, startkey: JSON.stringify(start), endkey: JSON.stringify('source:\uffff'), skip, limit });
  }
  async health() { const info = await this.request('GET'); if (!info?.db_name) throw unavailable(); return { ready: true, backend: 'cloudant', scope: 'database_read' }; }
}
module.exports = { CloudantClient };
