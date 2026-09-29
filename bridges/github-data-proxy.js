// Local relay for authed GitHub issue/PR lookups — unlike Jira/Salesforce,
// GitHub's REST API already sends permissive CORS headers, so the tracker
// can (and by default still does) fetch it directly from the browser. This
// proxy is an OPTIONAL alternative for anyone who'd rather the GitHub
// token never touch the browser at all (or who's pointing at a GitHub
// Enterprise Server instance with different CORS behavior): if Settings >
// Integrations > GitHub proxy URL is set, the tracker uses this instead;
// otherwise it keeps using today's direct api.github.com fetch, unchanged.
//
// Usage:
//   GITHUB_TOKEN=ghp_xxxx node github-data-proxy.js
// Usage (GitHub Enterprise Server):
//   GITHUB_TOKEN=xxxx GITHUB_API_BASE_URL=https://ghe.yourco.internal/api/v3 node github-data-proxy.js
//
// Binds to loopback only, and requires every request to carry a shared
// secret (X-Wigwag-Proxy-Secret) matching this process's own — see
// proxy-shared.js. The secret is auto-generated and persisted on first
// run unless GITHUB_PROXY_SECRET is set explicitly; either way, paste the
// same value into Settings > Integrations > GitHub proxy secret.
//
// Nothing here talks to anything except GitHub itself and localhost — no
// telemetry, no third-party relay.
const http = require('http');
const { HOST, secretFor, requireSecret } = require('./proxy-shared');

const PORT = parseInt(process.env.PORT || '8937', 10);
const API_BASE_URL = (process.env.GITHUB_API_BASE_URL || 'https://api.github.com').replace(/\/$/, '');
const TOKEN = process.env.GITHUB_TOKEN || '';
const SECRET = secretFor(__dirname, 'github', 'GITHUB_PROXY_SECRET');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Wigwag-Proxy-Secret');
}

http.createServer(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, 'http://localhost');
  console.log('[' + new Date().toISOString() + '] ' + req.method + ' ' + url.pathname);
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('GitHub data proxy running. API_BASE_URL=' + API_BASE_URL + ' auth=' + (TOKEN ? 'configured' : 'MISSING'));
    return;
  }
  if (!requireSecret(req, res, SECRET)) return;

  const m = url.pathname.match(/^\/issue\/([^/]+)\/([^/]+)\/(\d+)$/);
  if (!m) {
    console.log('  -> 404: path does not match /issue/:owner/:repo/:num (got "' + url.pathname + '")');
    res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'not found' })); return;
  }
  const [, owner, repo, num] = m;

  if (!TOKEN) {
    console.log('  -> 500: GITHUB_TOKEN not set');
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Proxy is missing GITHUB_TOKEN. Set it and restart.' }));
    return;
  }

  const upstreamUrl = API_BASE_URL + '/repos/' + owner + '/' + repo + '/issues/' + num;
  console.log('  fetching ' + upstreamUrl);
  try {
    const apiRes = await fetch(upstreamUrl, {
      headers: { Authorization: 'Bearer ' + TOKEN, Accept: 'application/vnd.github+json' }
    });
    if (!apiRes.ok) {
      // Body included in both the response AND the log -- GitHub's own
      // error text (rate limit, bad credentials, not found, no access to
      // a private repo with this token, ...) is usually far more useful
      // than the bare status code alone for figuring out why a lookup
      // isn't resolving.
      const bodyText = await apiRes.text().catch(() => '');
      console.log('  -> GitHub returned ' + apiRes.status + ': ' + bodyText.slice(0, 500));
      res.writeHead(apiRes.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'GitHub returned ' + apiRes.status + (bodyText ? ': ' + bodyText.slice(0, 300) : '') }));
      return;
    }
    const data = await apiRes.json();
    console.log('  -> 200 OK: ' + owner + '/' + repo + '#' + num + ' "' + data.title + '"');
    // Same normalized shape the tracker's own client-side fetchGithubData()
    // builds for a direct browser fetch -- this proxy is a drop-in
    // transport swap, not a new shape the client has to branch on.
    const isPullRequest = !!data.pull_request;
    const result = {
      title: data.title,
      labels: (data.labels || []).map(l => (typeof l === 'string' ? l : l.name)),
      state: data.state,
      isPullRequest,
      description: data.body || '',
      key: owner + '/' + repo + '#' + num,
      status: data.state || '',
      statusCategory: data.state === 'closed' ? 'done' : 'new',
      issueType: isPullRequest ? 'Pull Request' : 'Issue',
      assignees: (data.assignees || []).map(a => a.login),
      reporter: (data.user && data.user.login) || '',
      created: data.created_at || '',
      updated: data.updated_at || '',
      resolution: data.state_reason || '',
      resolutionDate: data.closed_at || '',
      fixVersions: data.project ? [data.project.title] : [],
      project: owner + '/' + repo
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    console.log('  -> could not reach GitHub: ' + err.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Could not reach GitHub: ' + err.message }));
  }
}).listen(PORT, HOST, () => {
  console.log('GitHub data proxy listening on http://' + HOST + ':' + PORT);
  console.log('  API_BASE_URL: ' + API_BASE_URL);
  console.log('  auth: ' + (TOKEN ? 'configured' : '(not set — requests will fail until you set GITHUB_TOKEN)'));
});
