// Local relay for Google Drive file metadata lookups — same reason
// jira-proxy.js/salesforce-proxy.js exist: real auth is required and this
// keeps the credential off the browser entirely. The tracker uses this
// only to turn a bare Drive link in rendered markdown into a named file
// pill (real file name + its own file-type icon) — display only, not a
// bindable/linkable field the way Jira/Salesforce are.
//
// Usage (a pre-obtained OAuth access token — simplest, but expires and
// needs a manual refresh + restart, same trade-off as jira-proxy.js's PAT
// mode; grab one e.g. via `gcloud auth print-access-token` against an
// account with Drive access, or the OAuth2 Playground):
//   GDRIVE_ACCESS_TOKEN=ya29.xxxx node google-drive-proxy.js
//
// No OAuth refresh-token or service-account flow yet — if that's needed,
// this is the file to extend (see getAuth() in salesforce-proxy.js for
// the shape a second auth mode would take).
//
// Binds to loopback only, and requires every request to carry a shared
// secret (X-Wigwag-Proxy-Secret) matching this process's own — see
// proxy-shared.js. The secret is auto-generated and persisted on first
// run unless GDRIVE_PROXY_SECRET is set explicitly; either way, paste the
// same value into Settings > Integrations > Google Drive proxy secret.
//
// Nothing here talks to anything except Google Drive itself and
// localhost — no telemetry, no third-party relay. Point the tracker's
// Settings > Google Drive proxy URL at http://localhost:8938 (or whatever
// PORT you set) once this is running.
const http = require('http');
const { HOST, secretFor, requireSecret } = require('./proxy-shared');

const PORT = parseInt(process.env.PORT || '8938', 10);
const ACCESS_TOKEN = process.env.GDRIVE_ACCESS_TOKEN || '';
const SECRET = secretFor(__dirname, 'gdrive', 'GDRIVE_PROXY_SECRET');

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
    res.end('Google Drive proxy running. auth=' + (ACCESS_TOKEN ? 'configured' : 'MISSING'));
    return;
  }
  if (!requireSecret(req, res, SECRET)) return;

  const m = url.pathname.match(/^\/file\/([^/]+)$/);
  if (!m) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'not found' })); return; }
  const id = decodeURIComponent(m[1]);

  if (!ACCESS_TOKEN) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Proxy is missing GDRIVE_ACCESS_TOKEN. Set it and restart.' }));
    return;
  }

  try {
    const FIELDS = 'id,name,mimeType,iconLink,webViewLink,modifiedTime';
    const apiRes = await fetch(
      'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?fields=' + FIELDS,
      { headers: { Authorization: 'Bearer ' + ACCESS_TOKEN, Accept: 'application/json' } }
    );
    if (!apiRes.ok) {
      res.writeHead(apiRes.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Google Drive returned ' + apiRes.status }));
      return;
    }
    const data = await apiRes.json();
    const result = {
      id: data.id || id,
      name: data.name || id,
      mimeType: data.mimeType || '',
      iconLink: data.iconLink || '',
      webViewLink: data.webViewLink || ('https://drive.google.com/file/d/' + id + '/view'),
      modifiedTime: data.modifiedTime || ''
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Could not reach Google Drive: ' + err.message }));
  }
}).listen(PORT, HOST, () => {
  console.log('Google Drive proxy listening on http://' + HOST + ':' + PORT);
  console.log('  auth: ' + (ACCESS_TOKEN ? 'configured' : '(not set — requests will fail until you set GDRIVE_ACCESS_TOKEN)'));
});
