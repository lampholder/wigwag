// Shared helpers for every local *-proxy.js relay in this project
// (jira-proxy.js, salesforce-proxy.js, github-data-proxy.js,
// google-drive-proxy.js) -- binding + shared-secret auth, the two things
// that must not be allowed to drift between four independently-run
// copies of essentially the same security-critical logic. No external
// dependencies, same as every proxy that uses it.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Every proxy binds to loopback only -- these exist to be reachable from
// this machine's own browser tab, never from the network. Without this,
// Node's default bind is all interfaces, which is a much bigger exposure
// than intended for something holding real Jira/Salesforce/GitHub/Drive
// credentials.
const HOST = '127.0.0.1';

// Resolves this proxy's shared secret -- the value the app must send back
// as X-Wigwag-Proxy-Secret for a request to be served at all, since a
// bare loopback bind + CORS '*' otherwise means any local process, or any
// website the browser visits (a plain cross-origin fetch), can already
// reach these endpoints.
//
// An env var override (envVar, e.g. 'JIRA_PROXY_SECRET') wins if set;
// otherwise a secret is generated once and persisted to a dotfile next to
// the calling script (dir should be that script's own __dirname), so a
// restart doesn't invalidate what's already pasted into Settings and
// there's nothing to manually generate. Printed on every startup
// (whichever of the three sources it came from), not just first
// generation -- while these are still new/being set up, that's more
// useful than making someone go dig the dotfile out by hand on a
// restart. Revisit once that's no longer the common case.
function secretFor(dir, name, envVar) {
  if (process.env[envVar]) {
    console.log('Proxy secret (from ' + envVar + '): ' + process.env[envVar]);
    return process.env[envVar];
  }
  const file = path.join(dir, '.' + name + '-proxy-secret');
  try {
    const secret = fs.readFileSync(file, 'utf8').trim();
    console.log('Proxy secret (from ' + file + '): ' + secret);
    return secret;
  } catch (e) {
    const secret = crypto.randomBytes(32).toString('hex');
    try {
      fs.writeFileSync(file, secret, { mode: 0o600 });
      console.log('Generated a new proxy secret, saved to ' + file);
    } catch (writeErr) {
      console.warn('Could not persist a generated secret to ' + file + ' (' + writeErr.message + ') -- set ' + envVar + ' explicitly instead.');
    }
    console.log('Proxy secret: ' + secret + ' (copy it into Settings > Integrations, or set ' + envVar + ' yourself)');
    return secret;
  }
}

// First line of every proxy's request handler, after CORS/OPTIONS --
// writes the 401 itself and returns false if the caller didn't send a
// matching header, so the handler can just `if (!requireSecret(...))
// return;`.
function requireSecret(req, res, secret) {
  const sent = req.headers['x-wigwag-proxy-secret'];
  if (sent === secret) return true;
  // Never log either the sent or the expected secret value itself -- just
  // enough to tell "Settings has nothing in the secret field yet" apart
  // from "Settings has a secret, but it doesn't match this process's
  // (probably pasted before a restart regenerated one, or a typo)".
  console.log('  -> 401: ' + (sent ? 'X-Wigwag-Proxy-Secret header did not match' : 'no X-Wigwag-Proxy-Secret header sent'));
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Missing or incorrect X-Wigwag-Proxy-Secret header.' }));
  return false;
}

module.exports = { HOST, secretFor, requireSecret };
