// Local relay for real Web Push -- the piece that lets an installed wigwag
// PWA get notified of an @mention, or of an update on an issue it's
// subscribed to, even when it's fully closed (tracker issues #72/67fa1ba2
// and #73/59372970). The in-tab `Notification` path already built into
// wigwag.html (checkForNewMentions/checkForSubscribedIssueUpdates/
// sendTestNotification) only ever fires while a tab is literally open;
// genuine "closed app" notification needs a real Push subscription plus
// something that can wake it up, which is what this process is for.
//
// Design, in short: this polls the SAME tracker.jsonl a subscribed
// device's project already syncs with (same GitHub Contents API, same
// parseJsonl/textMentionsEmail logic wigwag.html itself uses --
// require('../wigwag-core.js'), not a reimplementation). For every
// subscriber it sends a real Web Push message (via the `web-push` npm
// package) for: (a) any new comment that mentions their email anywhere,
// on any issue, and (b) any new comment or field-change history entry on
// an issue they've explicitly subscribed to (their own subscribedIssueIds
// list, kept in sync by wigwag.html's syncIssueSubscriptionsToRelay).
//
// This process needs OUTBOUND internet access only (to reach GitHub's API
// and each push service's endpoint -- Apple's/Google's, chosen by the
// browser, not configured here). It does NOT need to be publicly
// reachable itself -- run it on your own laptop, a home server, wherever,
// as long as it's actually running when you want pushes to arrive. It is
// NOT the same thing as a GitHub webhook receiver (which WOULD need a
// public address) -- this deliberately polls instead, matching how
// wigwag.html's own background sync already works, to sidestep that
// requirement entirely.
//
// Usage:
//   node push-relay.js
// (Optional) point at a private repo or raise GitHub's rate limit:
//   GITHUB_TOKEN=ghp_xxxx node push-relay.js
// (Optional) a real contact address, sent to push services per the VAPID
// spec so they can reach you if a subscription is misbehaving:
//   VAPID_SUBJECT=mailto:you@example.com node push-relay.js
//
// On first run this generates and persists a VAPID keypair
// (.push-relay-vapid.json) and a shared secret (.push-relay-proxy-secret,
// same mechanism as every other *-proxy.js -- see proxy-shared.js),
// printing both. Paste the relay's URL (http://localhost:8939 by default)
// and that secret into wigwag's Settings > Notifications > push relay
// fields, then click "Enable push notifications on this device" from an
// iOS home-screen-installed copy of wigwag (Web Push on iOS only works
// for an installed PWA, never a plain Safari tab).
//
// Binds to loopback only. Every request (including the public-key
// lookup) must carry a matching X-Wigwag-Proxy-Secret header -- without
// this, any local process or any website the browser visits could
// register bogus push subscriptions against this relay, or enumerate who
// else has subscribed.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { ProxyAgent, setGlobalDispatcher } = require('undici');
const webpush = require('web-push');
const { HOST, secretFor, requireSecret } = require('./proxy-shared');
const core = require('../wigwag-core.js');

// Node's built-in fetch does NOT honor HTTP_PROXY/HTTPS_PROXY on its own --
// without this, the GitHub polling below fails outright on any network
// that requires an outbound proxy (this project's own devcontainer sandbox
// included; see the identical setup in wigwag-cli.js).
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
if (proxyUrl) setGlobalDispatcher(new ProxyAgent(proxyUrl));

const PORT = parseInt(process.env.PORT || '8939', 10);
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '60000', 10);
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@localhost';
const SECRET = secretFor(__dirname, 'push-relay', 'PUSH_RELAY_PROXY_SECRET');

const VAPID_FILE = path.join(__dirname, '.push-relay-vapid.json');
const SUBSCRIPTIONS_FILE = path.join(__dirname, '.push-relay-subscriptions.json');

function loadOrGenerateVapidKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    console.log('VAPID keys: from VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY env vars');
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  try {
    const saved = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
    console.log('VAPID keys: loaded from ' + VAPID_FILE);
    return saved;
  } catch (e) {
    const keys = webpush.generateVAPIDKeys();
    try {
      fs.writeFileSync(VAPID_FILE, JSON.stringify(keys), { mode: 0o600 });
      console.log('Generated a new VAPID keypair, saved to ' + VAPID_FILE);
    } catch (writeErr) {
      console.warn('Could not persist generated VAPID keys to ' + VAPID_FILE + ' (' + writeErr.message + ') -- set VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY yourself to avoid regenerating (and invalidating every existing subscription) on every restart.');
    }
    return keys;
  }
}
const VAPID_KEYS = loadOrGenerateVapidKeys();
console.log('VAPID public key: ' + VAPID_KEYS.publicKey);
webpush.setVapidDetails(VAPID_SUBJECT, VAPID_KEYS.publicKey, VAPID_KEYS.privateKey);

function loadSubscriptions() {
  try { return JSON.parse(fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf8')); } catch (e) { return []; }
}
function saveSubscriptions(subs) {
  try { fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subs, null, 2)); } catch (e) { console.warn('Could not persist subscriptions:', e.message); }
}
let subscriptions = loadSubscriptions();

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Wigwag-Proxy-Secret');
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url, 'http://localhost');
  console.log('[' + new Date().toISOString() + '] ' + req.method + ' ' + url.pathname);

  if (url.pathname === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('wigwag push relay running. ' + subscriptions.length + ' subscription(s). Polling every ' + POLL_INTERVAL_MS + 'ms.');
    return;
  }
  if (!requireSecret(req, res, SECRET)) return;

  if (url.pathname === '/vapid-public-key' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ publicKey: VAPID_KEYS.publicKey }));
    return;
  }

  if (url.pathname === '/subscribe' && req.method === 'POST') {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'invalid JSON body' })); return;
    }
    const { email, subscription, repo, path: repoPath, branch, origin, subscribedIssueIds } = body || {};
    if (!email || !subscription || !subscription.endpoint || !repo) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'body must include email, subscription (with endpoint), and repo' }));
      return;
    }
    // Upsert by endpoint -- a re-subscribe (browser rotated the endpoint,
    // or the same device re-enabling after disabling) replaces the old
    // entry rather than accumulating duplicates that'd double-notify.
    // subscribedIssueIds is a full replacement each time (the client
    // always sends its complete current set, per issue #73/59372970) --
    // no separate add/remove endpoint needed.
    const existing = subscriptions.find(s => s.subscription.endpoint === subscription.endpoint);
    subscriptions = subscriptions.filter(s => s.subscription.endpoint !== subscription.endpoint);
    subscriptions.push({
      email, subscription, repo, path: repoPath || 'tracker.jsonl', branch: branch || '', origin: origin || '',
      subscribedIssueIds: Array.isArray(subscribedIssueIds) ? subscribedIssueIds : [],
      notifiedEventIds: (existing && existing.notifiedEventIds) || []
    });
    saveSubscriptions(subscriptions);
    console.log('  subscribed ' + email + ' to ' + repo + ' (' + subscriptions.length + ' total subscription(s))');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname === '/subscribe' && req.method === 'DELETE') {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch (e) { body = {}; }
    const before = subscriptions.length;
    subscriptions = subscriptions.filter(s => s.subscription.endpoint !== (body && body.endpoint));
    saveSubscriptions(subscriptions);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, removed: before - subscriptions.length }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

// Per-repo cache of the last-seen ETag, purely to make an unchanged poll
// free against GitHub's rate limit -- same technique wigwag.html's own
// background poll already uses (pollGithubForRemoteChanges).
const repoCache = new Map(); // key: repo|path|branch -> { etag, text }

function repoKeyFor(sub) { return sub.repo + '|' + sub.path + '|' + sub.branch; }

async function pollOnce() {
  if (!subscriptions.length) return;
  const byRepoKey = new Map();
  for (const sub of subscriptions) {
    const key = repoKeyFor(sub);
    if (!byRepoKey.has(key)) byRepoKey.set(key, []);
    byRepoKey.get(key).push(sub);
  }
  let subsChanged = false;
  for (const [key, subs] of byRepoKey) {
    const { repo, path: repoPath, branch } = subs[0];
    const cached = repoCache.get(key) || {};
    let result;
    try {
      result = await core.pullGithubFile({ fetchImpl: fetch, repo, path: repoPath, branch, token: GITHUB_TOKEN, etag: cached.etag });
    } catch (e) {
      console.warn('  poll failed for ' + key + ':', e.message);
      continue;
    }
    if (result.status === 'error' || result.status === 'not-found') {
      console.warn('  poll for ' + key + ' returned ' + result.status + (result.message ? ': ' + result.message : ''));
      continue;
    }
    let text = cached.text;
    if (result.status === 'ok') {
      text = result.text;
      repoCache.set(key, { etag: result.etag, text });
    } else if (result.status === 'not-modified' && !text) {
      continue; // nothing cached yet and nothing changed -- can't proceed
    }
    let parsed;
    try { parsed = core.parseJsonl(text, core.defaultFieldDefs()); } catch (e) {
      console.warn('  could not parse ' + key + ':', e.message);
      continue;
    }
    for (const sub of subs) {
      const subscribedSet = new Set(sub.subscribedIssueIds || []);
      const alreadyNotified = new Set(sub.notifiedEventIds || []);
      const newlyNotified = [];
      const deepLink = (issueId) => sub.origin ? (sub.origin.replace(/#.*$/, '') + '#/project/' + parsed.projectId + '/issue/' + issueId) : './';
      // Fires and, on success, tracks id in newlyNotified; on a 404/410
      // (subscription expired/revoked) removes this subscription entirely
      // rather than retrying it forever.
      async function sendAndTrack(payload, id) {
        try {
          await webpush.sendNotification(sub.subscription, payload);
          newlyNotified.push(id);
          return true;
        } catch (e) {
          if (e.statusCode === 404 || e.statusCode === 410) {
            console.log('  subscription for ' + sub.email + ' is gone (HTTP ' + e.statusCode + ') -- removing it');
            subscriptions = subscriptions.filter(s => s.subscription.endpoint !== sub.subscription.endpoint);
            subsChanged = true;
          } else {
            console.warn('  push to ' + sub.email + ' failed:', e.message);
          }
          return false;
        }
      }
      for (const iss of parsed.issues) {
        const isSubscribedIssue = subscribedSet.has(iss.id);
        for (const c of (iss.comments || [])) {
          // commentKey(), not raw c.id -- a legacy comment predating real
          // ids (c.id undefined) would otherwise seed/check mismatched
          // values, since JSON round-tripping turns undefined into null.
          const key = core.commentKey(c);
          if (alreadyNotified.has(key) || newlyNotified.includes(key)) continue;
          if (c.redacted || !c.text || (c.email && c.email === sub.email)) continue;
          const mentionsMe = core.textMentionsEmail(c.text, sub.email);
          if (!mentionsMe && !isSubscribedIssue) continue;
          const payload = JSON.stringify({
            title: (c.author || 'Someone') + (mentionsMe ? ' mentioned you' : ' commented'),
            body: core.truncate(c.text, 140) + ' — ' + (iss.values.title || 'an issue'),
            tag: key,
            url: deepLink(iss.id)
          });
          const ok = await sendAndTrack(payload, key);
          if (ok) console.log('  pushed ' + (mentionsMe ? 'mention' : 'subscribed comment') + ' to ' + sub.email + ' (issue ' + (iss.num || iss.id) + ')');
        }
        if (!isSubscribedIssue) continue;
        // Any real field mutation (Status, or any other field) on a
        // subscribed issue -- see docs/FORMAT.md's history entry shape.
        // legacy-backfill entries are migration bookkeeping, not
        // something that actually just happened, so they're excluded the
        // same way the Activity timeline itself excludes them.
        for (const h of (iss.history || [])) {
          const key = core.entryKey(h);
          if (alreadyNotified.has(key) || newlyNotified.includes(key)) continue;
          if (!h.field || h.origin === 'legacy-backfill' || (h.email && h.email === sub.email)) continue;
          const payload = JSON.stringify({
            title: 'Update on ' + (iss.values.title || 'an issue'),
            body: h.text || 'A field changed',
            tag: key,
            url: deepLink(iss.id)
          });
          const ok = await sendAndTrack(payload, key);
          if (ok) console.log('  pushed issue update to ' + sub.email + ' (issue ' + (iss.num || iss.id) + ')');
        }
      }
      if (newlyNotified.length) {
        const merged = (sub.notifiedEventIds || []).concat(newlyNotified);
        sub.notifiedEventIds = merged.slice(Math.max(0, merged.length - core.NOTIFIED_MENTIONS_CAP));
        subsChanged = true;
      }
    }
  }
  if (subsChanged) saveSubscriptions(subscriptions);
}

server.listen(PORT, HOST, () => {
  console.log('Push relay listening on http://' + HOST + ':' + PORT);
  pollOnce().catch(e => console.warn('initial poll failed:', e.message));
  setInterval(() => { pollOnce().catch(e => console.warn('poll failed:', e.message)); }, POLL_INTERVAL_MS);
});
