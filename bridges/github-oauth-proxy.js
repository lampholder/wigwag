// Local relay for "Sign in with GitHub" — the one step in the OAuth
// Authorization Code flow that needs a client secret (exchanging the
// callback's `code` for an access token) can't happen in the browser, so
// this small process does just that one thing and hands the token back to
// the popup that's waiting for it. Everything else (the actual repo sync
// traffic) goes straight from the browser to api.github.com, same as the
// token-paste flow — this proxy is never in that hot path.
//
// Setup (see README for the full GitHub App registration walkthrough):
//   1. Register a GitHub App at https://github.com/settings/apps/new
//      - Callback URL: http://localhost:8935/callback (or wherever this
//        runs — must match exactly)
//      - Request "Contents: Read and write" repository permission
//      - "Request user authorization (OAuth) during installation": on
//   2. GITHUB_APP_CLIENT_ID=Iv1.xxxx GITHUB_APP_CLIENT_SECRET=xxxx npm run github-oauth-proxy
//   3. In the tracker's Settings, set OAuth Client ID to the same client ID
//      and OAuth proxy URL to wherever this is listening, then click "Sign
//      in with GitHub".
const http = require('http');
const https = require('https');

const PORT = parseInt(process.env.PORT || '8935', 10);
const CLIENT_ID = process.env.GITHUB_APP_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GITHUB_APP_CLIENT_SECRET || '';

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        try { resolve(JSON.parse(chunks)); }
        catch (err) { reject(new Error('Non-JSON response from ' + url + ': ' + chunks.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// A tiny HTML page, not JSON — it runs in the popup and hands the token
// back to the tab that opened it. targetOrigin is '*' because this proxy
// has no reliable way to know the app's own origin (it could be a local
// file://, a plain static server, anything) — the payload only ever reaches
// window.opener specifically, never broadcast beyond that one window, and
// the app-side listener independently checks the `state` nonce before
// trusting anything it receives.
function popupResponseHtml(payload) {
  return '<!doctype html><html><body style="font-family:sans-serif;padding:2em;">' +
    (payload.token ? 'Signed in — you can close this window.' : 'Sign-in failed: ' + escapeHtml(payload.error || 'unknown error')) +
    '<script>window.opener && window.opener.postMessage(' + JSON.stringify(payload) + ', "*"); window.close();</' + 'script>' +
    '</body></html>';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('GitHub OAuth proxy running. CLIENT_ID=' + (CLIENT_ID || '(not set)') + ' secret=' + (CLIENT_SECRET ? 'configured' : 'MISSING'));
    return;
  }

  if (url.pathname !== '/callback') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') || '';
  res.writeHead(200, { 'Content-Type': 'text/html' });

  if (!CLIENT_ID || !CLIENT_SECRET) {
    res.end(popupResponseHtml({ source: 'github-oauth', state, error: 'Proxy is missing GITHUB_APP_CLIENT_ID and/or GITHUB_APP_CLIENT_SECRET. Set them and restart.' }));
    return;
  }
  if (!code) {
    res.end(popupResponseHtml({ source: 'github-oauth', state, error: 'GitHub did not send an authorization code (' + (url.searchParams.get('error_description') || url.searchParams.get('error') || 'unknown') + ').' }));
    return;
  }

  try {
    const data = await postJson('https://github.com/login/oauth/access_token', {
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code
    });
    if (!data.access_token) {
      res.end(popupResponseHtml({ source: 'github-oauth', state, error: data.error_description || data.error || 'GitHub did not return a token.' }));
      return;
    }
    res.end(popupResponseHtml({ source: 'github-oauth', state, token: data.access_token }));
  } catch (err) {
    res.end(popupResponseHtml({ source: 'github-oauth', state, error: 'Could not reach GitHub: ' + err.message }));
  }
}).listen(PORT, () => {
  console.log('GitHub OAuth proxy listening on http://localhost:' + PORT);
  console.log('  CLIENT_ID: ' + (CLIENT_ID || '(not set — requests will fail until you set GITHUB_APP_CLIENT_ID)'));
  console.log('  CLIENT_SECRET: ' + (CLIENT_SECRET ? 'configured' : '(not set — requests will fail until you set GITHUB_APP_CLIENT_SECRET)'));
  console.log('  callback URL to register with the GitHub App: http://localhost:' + PORT + '/callback');
});
