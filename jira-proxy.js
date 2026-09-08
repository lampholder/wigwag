// Local relay for Jira issue lookups — the tracker's browser code can't call
// Jira's REST API directly (unlike GitHub's, Jira Cloud/Server don't send
// permissive CORS headers), so this small process runs on the user's own
// machine, holds the real Jira credentials, and exposes a normalized
// same-origin-friendly endpoint the app can fetch from http://localhost:PORT.
//
// Usage (Jira Cloud):
//   JIRA_BASE_URL=https://yourco.atlassian.net JIRA_EMAIL=you@yourco.com JIRA_API_TOKEN=xxxx node jira-proxy.js
// Usage (Jira Server / Data Center):
//   JIRA_BASE_URL=https://jira.yourco.internal JIRA_PAT=xxxx node jira-proxy.js
//
// Nothing here talks to anything except Jira itself and localhost — no
// telemetry, no third-party relay. Point the tracker's Settings > Jira proxy
// URL at http://localhost:8934 (or whatever PORT you set) once this is running.
//
// Binds to loopback only, and requires every request to carry a shared
// secret (X-Wigwag-Proxy-Secret) matching this process's own — otherwise
// any local process, or any website the browser visits, could already
// reach this and read real Jira data via a plain cross-origin fetch. The
// secret is auto-generated and persisted on first run (see
// proxy-shared.js) unless JIRA_PROXY_SECRET is set explicitly; either way,
// paste the same value into Settings > Integrations > Jira proxy secret.
const http = require('http');
const { HOST, secretFor, requireSecret } = require('./proxy-shared');

const PORT = parseInt(process.env.PORT || '8934', 10);
const BASE_URL = (process.env.JIRA_BASE_URL || '').replace(/\/$/, '');
const SECRET = secretFor(__dirname, 'jira', 'JIRA_PROXY_SECRET');

// Whichever credential pair is present picks Cloud (Basic, API v3) vs.
// Server/Data Center (Bearer PAT, API v2) — no separate mode flag to set.
function authConfig() {
  if (process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN) {
    return { header: 'Basic ' + Buffer.from(process.env.JIRA_EMAIL + ':' + process.env.JIRA_API_TOKEN).toString('base64'), apiVersion: '3' };
  }
  if (process.env.JIRA_PAT) {
    return { header: 'Bearer ' + process.env.JIRA_PAT, apiVersion: '2' };
  }
  return null;
}

// Jira Cloud's `description` field is Atlassian Document Format (a nested
// JSON tree), not plain text — Server/DC still returns a plain string.
// Flatten either shape to plain text; good enough for a preview/rule input,
// not meant to preserve rich formatting.
function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  let out = node.text || '';
  if (Array.isArray(node.content)) {
    out += node.content.map(adfToText).join('');
    if (node.type === 'paragraph') out += '\n';
  }
  return out;
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Wigwag-Proxy-Secret');
}

http.createServer(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Jira proxy running. BASE_URL=' + (BASE_URL || '(not set)') + ' auth=' + (authConfig() ? 'configured' : 'MISSING'));
    return;
  }
  if (!requireSecret(req, res, SECRET)) return;

  const m = url.pathname.match(/^\/issue\/([^/]+)$/);
  if (!m) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'not found' })); return; }
  const key = decodeURIComponent(m[1]);

  const auth = authConfig();
  if (!BASE_URL || !auth) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Proxy is missing JIRA_BASE_URL and/or credentials (JIRA_EMAIL+JIRA_API_TOKEN, or JIRA_PAT). Set them and restart.' }));
    return;
  }

  try {
    const FIELDS = [
      'summary', 'description', 'labels', 'status', 'issuetype', 'priority',
      'assignee', 'reporter', 'created', 'updated', 'duedate', 'resolution',
      'resolutiondate', 'components', 'fixVersions', 'project'
    ].join(',');
    const apiRes = await fetch(BASE_URL + '/rest/api/' + auth.apiVersion + '/issue/' + encodeURIComponent(key) + '?fields=' + FIELDS, {
      headers: { Authorization: auth.header, Accept: 'application/json' }
    });
    if (!apiRes.ok) {
      res.writeHead(apiRes.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Jira returned ' + apiRes.status }));
      return;
    }
    const data = await apiRes.json();
    const f = data.fields || {};
    // Every field gets a safe empty-string/empty-array default (never
    // null/undefined) so rule text on the app side never needs a null
    // guard — same convention as the existing title/description/labels.
    // Nested objects (person/status/etc.) are flattened to the one or two
    // properties actually useful in a rule, not passed through whole.
    const result = {
      title: f.summary || key,
      description: adfToText(f.description).trim(),
      labels: f.labels || [],
      browseUrl: BASE_URL + '/browse/' + key,
      key,
      status: (f.status && f.status.name) || '',
      // statusCategory is Jira's own 3-bucket normalization ('new' /
      // 'indeterminate' / 'done') -- stabler for a rule to branch on than
      // the raw status name, which varies per project's own workflow.
      statusCategory: (f.status && f.status.statusCategory && f.status.statusCategory.key) || '',
      issueType: (f.issuetype && f.issuetype.name) || '',
      priority: (f.priority && f.priority.name) || '',
      assignee: (f.assignee && f.assignee.displayName) || '',
      reporter: (f.reporter && f.reporter.displayName) || '',
      created: f.created || '',
      updated: f.updated || '',
      dueDate: f.duedate || '',
      resolution: (f.resolution && f.resolution.name) || '',
      resolutionDate: f.resolutiondate || '',
      components: (f.components || []).map(c => c.name),
      fixVersions: (f.fixVersions || []).map(v => v.name),
      project: (f.project && f.project.key) || ''
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Could not reach Jira: ' + err.message }));
  }
}).listen(PORT, HOST, () => {
  console.log('Jira proxy listening on http://' + HOST + ':' + PORT);
  console.log('  BASE_URL: ' + (BASE_URL || '(not set — requests will fail until you set JIRA_BASE_URL)'));
  console.log('  auth: ' + (authConfig() ? 'configured' : '(not set — requests will fail until you set JIRA_EMAIL+JIRA_API_TOKEN or JIRA_PAT)'));
});
