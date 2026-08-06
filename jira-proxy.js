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
const http = require('http');

const PORT = parseInt(process.env.PORT || '8934', 10);
const BASE_URL = (process.env.JIRA_BASE_URL || '').replace(/\/$/, '');

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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
    const apiRes = await fetch(BASE_URL + '/rest/api/' + auth.apiVersion + '/issue/' + encodeURIComponent(key) + '?fields=summary,description,labels', {
      headers: { Authorization: auth.header, Accept: 'application/json' }
    });
    if (!apiRes.ok) {
      res.writeHead(apiRes.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Jira returned ' + apiRes.status }));
      return;
    }
    const data = await apiRes.json();
    const result = {
      title: (data.fields && data.fields.summary) || key,
      description: adfToText(data.fields && data.fields.description).trim(),
      labels: (data.fields && data.fields.labels) || [],
      browseUrl: BASE_URL + '/browse/' + key
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Could not reach Jira: ' + err.message }));
  }
}).listen(PORT, () => {
  console.log('Jira proxy listening on http://localhost:' + PORT);
  console.log('  BASE_URL: ' + (BASE_URL || '(not set — requests will fail until you set JIRA_BASE_URL)'));
  console.log('  auth: ' + (authConfig() ? 'configured' : '(not set — requests will fail until you set JIRA_EMAIL+JIRA_API_TOKEN or JIRA_PAT)'));
});
