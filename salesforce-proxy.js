// Local relay for Salesforce record lookups — same reason jira-proxy.js
// exists: the tracker's browser code can't call Salesforce's REST API
// directly (no permissive CORS, and real auth is required), so this small
// process runs on the user's own machine, holds the real Salesforce
// credentials, and exposes a normalized same-origin-friendly endpoint the
// app can fetch from http://localhost:PORT.
//
// Usage (a pre-obtained access token — simplest, but expires and needs a
// manual refresh + restart, same trade-off as jira-proxy.js's PAT mode):
//   SF_INSTANCE_URL=https://yourco.my.salesforce.com SF_ACCESS_TOKEN=xxxx node salesforce-proxy.js
// Usage (just username + password + security token, no Connected App at
// all — uses the older SOAP login() call, the same thing tools like
// simple-salesforce default to; the proxy re-authenticates itself, no
// manual token juggling):
//   SF_USERNAME=you@yourco.com SF_PASSWORD=xxxx SF_SECURITY_TOKEN=xxxx node salesforce-proxy.js
//   (SF_SECURITY_TOKEN can be omitted if your org has a Trusted IP Range
//   covering wherever this runs from.)
// Usage (OAuth2 username-password flow via a Connected App — more setup
// than the above for no real benefit besides using the newer REST OAuth
// endpoint instead of SOAP; kept as an option since some orgs disable one
// flow but not the other):
//   SF_LOGIN_URL=https://login.salesforce.com SF_CLIENT_ID=... SF_CLIENT_SECRET=... \
//   SF_USERNAME=you@yourco.com SF_PASSWORD=xxxx SF_SECURITY_TOKEN=xxxx node salesforce-proxy.js
//   (SF_LOGIN_URL defaults to https://login.salesforce.com; use
//   https://test.salesforce.com for a sandbox org. Some orgs disable one or
//   both of these password-based flows entirely via security policy — use
//   token mode instead if so.)
//
// Nothing here talks to anything except Salesforce itself and localhost —
// no telemetry, no third-party relay. Point the tracker's Settings >
// Salesforce proxy URL at http://localhost:8936 (or whatever PORT you set)
// once this is running.
const http = require('http');

const PORT = parseInt(process.env.PORT || '8936', 10);
const API_VERSION = 'v59.0';

function tokenModeAuth() {
  if (process.env.SF_INSTANCE_URL && process.env.SF_ACCESS_TOKEN) {
    return { accessToken: process.env.SF_ACCESS_TOKEN, instanceUrl: process.env.SF_INSTANCE_URL.replace(/\/$/, '') };
  }
  return null;
}

// Salesforce's password-flow convention (shared by both the SOAP and
// REST-OAuth2 password-based logins below): the security token (if your
// org requires one, e.g. no trusted IP range configured) is appended
// directly onto the password, not sent as a separate field.
function sfPassword() {
  return process.env.SF_PASSWORD + (process.env.SF_SECURITY_TOKEN || '');
}

function passwordFlowConfigured() {
  return !!(process.env.SF_CLIENT_ID && process.env.SF_CLIENT_SECRET && process.env.SF_USERNAME && process.env.SF_PASSWORD);
}

// Salesforce's token endpoint doesn't hand back an expiry, so this just
// caches until a downstream 401 forces a re-authentication (see getAuth).
let cachedPasswordAuth = null;
async function passwordFlowAuth(forceRefresh) {
  if (cachedPasswordAuth && !forceRefresh) return cachedPasswordAuth;
  const loginUrl = (process.env.SF_LOGIN_URL || 'https://login.salesforce.com').replace(/\/$/, '');
  const params = new URLSearchParams({
    grant_type: 'password',
    client_id: process.env.SF_CLIENT_ID,
    client_secret: process.env.SF_CLIENT_SECRET,
    username: process.env.SF_USERNAME,
    password: sfPassword()
  });
  const res = await fetch(loginUrl + '/services/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error('Salesforce login failed (' + res.status + '): ' + body);
  }
  const data = await res.json();
  cachedPasswordAuth = { accessToken: data.access_token, instanceUrl: data.instance_url };
  return cachedPasswordAuth;
}

function soapFlowConfigured() {
  return !!(process.env.SF_USERNAME && process.env.SF_PASSWORD);
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// The older SOAP login() call -- no Connected App needed at all, just the
// same username/password/security-token most people already have handy
// (this is what tools like simple-salesforce default to). Returns a
// session Id that works directly as a REST API Bearer token, plus a
// serverUrl whose origin is the instance URL for subsequent calls. Same
// no-expiry-given/cache-until-401 pattern as passwordFlowAuth above.
let cachedSoapAuth = null;
async function soapFlowAuth(forceRefresh) {
  if (cachedSoapAuth && !forceRefresh) return cachedSoapAuth;
  const loginUrl = (process.env.SF_LOGIN_URL || 'https://login.salesforce.com').replace(/\/$/, '');
  const envelope = '<?xml version="1.0" encoding="utf-8"?>' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:partner.soap.sforce.com">' +
    '<soapenv:Body><urn:login><urn:username>' + escapeXml(process.env.SF_USERNAME) + '</urn:username>' +
    '<urn:password>' + escapeXml(sfPassword()) + '</urn:password></urn:login></soapenv:Body></soapenv:Envelope>';
  const res = await fetch(loginUrl + '/services/Soap/u/' + API_VERSION.replace(/^v/, ''), {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=UTF-8', SOAPAction: 'login' },
    body: envelope
  });
  const text = await res.text();
  const sessionId = (text.match(/<sessionId>([\s\S]*?)<\/sessionId>/) || [])[1];
  const serverUrl = (text.match(/<serverUrl>([\s\S]*?)<\/serverUrl>/) || [])[1];
  if (!res.ok || !sessionId || !serverUrl) {
    const fault = (text.match(/<faultstring>([\s\S]*?)<\/faultstring>/) || [])[1];
    throw new Error('Salesforce SOAP login failed' + (fault ? ': ' + fault : ' (status ' + res.status + ')'));
  }
  cachedSoapAuth = { accessToken: sessionId, instanceUrl: new URL(serverUrl).origin };
  return cachedSoapAuth;
}

// Whichever credential set is present picks the mode -- no separate mode
// flag to set, same convention as jira-proxy.js's authConfig(). Password
// OAuth2 mode requires a Connected App (client id/secret) on top of the
// same username/password/token the SOAP mode needs, so it only wins over
// SOAP when those extra two are actually present.
async function getAuth(forceRefresh) {
  const tok = tokenModeAuth();
  if (tok) return tok;
  if (passwordFlowConfigured()) return passwordFlowAuth(forceRefresh);
  if (soapFlowConfigured()) return soapFlowAuth(forceRefresh);
  return null;
}

function authModeLabel() {
  if (tokenModeAuth()) return 'token';
  if (passwordFlowConfigured()) return 'password-flow (OAuth2)';
  if (soapFlowConfigured()) return 'password-flow (SOAP)';
  return 'MISSING';
}

// True for any mode where a 401 is worth retrying after a forced
// re-authentication -- not token mode, since that credential is static
// and re-fetching it would just return the same (now-expired) value.
function reauthableMode() {
  return !tokenModeAuth() && (passwordFlowConfigured() || soapFlowConfigured());
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// A record's own Compact Layout (admin-configured per object type) is the
// one Salesforce field set that's actually meaningful for ANY object
// without this proxy needing to know ahead of time whether it's looking
// at an Opportunity, a Case, or a custom object -- unlike Jira's fixed
// issue schema, there's no universal "status/priority/assignee" shape
// here. displayValue is preferred over the raw value everywhere (Salesforce
// resolves lookups like Owner to the related record's name there already,
// under a normal compact layout) -- best-effort, not guaranteed for every
// custom object's own compact layout configuration.
function normalizeRecord(id, apiName, instanceUrl, body) {
  const rawFields = body.fields || {};
  const flat = {};
  for (const k in rawFields) {
    const f = rawFields[k];
    flat[k] = (f && typeof f === 'object') ? (f.displayValue != null ? f.displayValue : (f.value != null ? f.value : '')) : (f || '');
  }
  const objectType = apiName || body.apiName || '';
  return {
    id, objectType,
    name: flat.Name || flat.Subject || flat.CaseNumber || id,
    status: flat.Status || flat.StageName || '',
    owner: flat.Owner || '',
    url: instanceUrl + '/lightning/r/' + (objectType || 'Record') + '/' + id + '/view',
    lastModified: body.lastModifiedDate || '',
    fields: flat
  };
}

http.createServer(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Salesforce proxy running. auth=' + authModeLabel());
    return;
  }

  const m = url.pathname.match(/^\/record\/([^/]+)$/);
  if (!m) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'not found' })); return; }
  const id = decodeURIComponent(m[1]);

  let auth;
  try {
    auth = await getAuth(false);
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Could not authenticate with Salesforce: ' + err.message }));
    return;
  }
  if (!auth) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Proxy is missing Salesforce credentials (SF_INSTANCE_URL+SF_ACCESS_TOKEN, or SF_USERNAME+SF_PASSWORD[+SF_SECURITY_TOKEN], or SF_CLIENT_ID+SF_CLIENT_SECRET+SF_USERNAME+SF_PASSWORD). Set them and restart.' }));
    return;
  }

  try {
    const fetchRecord = (a) => fetch(
      a.instanceUrl + '/services/data/' + API_VERSION + '/ui-api/records/' + encodeURIComponent(id) + '?layoutTypes=Compact&modes=View',
      { headers: { Authorization: 'Bearer ' + a.accessToken, Accept: 'application/json' } }
    );
    let apiRes = await fetchRecord(auth);
    if (apiRes.status === 401 && reauthableMode()) {
      auth = await getAuth(true);
      apiRes = await fetchRecord(auth);
    }
    if (!apiRes.ok) {
      res.writeHead(apiRes.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Salesforce returned ' + apiRes.status }));
      return;
    }
    const body = await apiRes.json();
    const result = normalizeRecord(id, body.apiName, auth.instanceUrl, body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Could not reach Salesforce: ' + err.message }));
  }
}).listen(PORT, () => {
  console.log('Salesforce proxy listening on http://localhost:' + PORT);
  console.log('  auth: ' + authModeLabel());
});
