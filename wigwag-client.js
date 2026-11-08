// Library for driving a REAL headless instance of wigwag.html via
// Playwright -- not direct JSONL manipulation. Every write goes through
// the app's own logic (real signed history entries, real derived values,
// real gating), the same way a human using the app would produce them.
// An earlier hand-edited-file attempt was deliberately redone this way
// instead; see the commit history around 2026-08-26 for why.
//
// This module owns the browser/session lifecycle and the actual read/
// write operations. It knows nothing about argv or console output --
// see wigwag-agent.js for the CLI built on top of it. Every method
// returns data, never prints.
//
// Usage:
//   const { connect } = require('./wigwag-client');
//   const client = await connect();
//   try {
//     const { issues } = await client.list();
//   } finally {
//     await client.close();
//   }
//
// connect() does the full real Connect Remote flow and re-syncs from
// GitHub -- there's no persistent profile, so every connect() reflects
// the current state of the real file, never a stale local copy. Costs
// ~10-20s (browser launch + the real ~4s push debounce on the first
// write). A client can be reused for several operations before close()
// to amortize that cost across a session; each individual write still
// pays its own push-debounce wait.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { FORMAT_VERSION } = require('./wigwag-core.js');

const REPO_ROOT = __dirname;
const DEFAULT_TRACKER_FILE = path.join(REPO_ROOT, 'wigwag_tracker');
const STATUS_FIELD_LABEL = 'Status';

// Also reused by wigwag-file-store.js's CredentialStore -- exported so
// the file-based CLI can point at the exact same identity files (e.g.
// wigwag_tracker) without a second parser for the same documented,
// prose-plus-embedded-JSON format.
function loadIdentity(identityPath) {
  const text = fs.readFileSync(identityPath, 'utf8');
  const m = text.match(/\n(\{\s*"id":[\s\S]*?\n\})\n/);
  if (!m) throw new Error('Could not find the identity JSON block in ' + identityPath);
  return JSON.parse(m[1]);
}

// Live-caught bug (2026-09-29): repoOwner/repoName used to be separate
// hardcoded constants (lampholder/wigwag) alongside this file's own
// wigwag_tracker, which already carries the real project's location in
// its own first-line `wigwag:` link -- when the live tracker moved to
// lampholder/project-state, only wigwag_tracker's link got updated, and
// every connect() kept silently probing the old, no-longer-real repo
// (a real GitHub token can easily show "no write access" against a repo
// it was never asked to touch, rather than an obviously-wrong error).
// Deriving from the link itself removes the second, driftable copy
// entirely -- there's nothing left to fall out of sync.
function repoLocationFromTrackerLink(identityPath) {
  const text = fs.readFileSync(identityPath, 'utf8');
  const linkMatch = text.match(/wigwag:\/\S+/);
  if (!linkMatch) return null;
  let url;
  try { url = new URL(linkMatch[0]); } catch (e) { return null; }
  const from = url.searchParams.get('from');
  const m = from && from.match(/^github\.com\/([^/]+)\/([^/]+)$/);
  if (!m) return null;
  return { repoOwner: m[1], repoName: m[2], repoPath: url.searchParams.get('path') || 'tracker.jsonl' };
}

// Incident, 2026-10-31 (tracker issue d5e8dbe6) -- happened TWICE that
// day, the second time from this very check's own first version: connect()
// launches a LOCAL wigwag.html build and points its real Connect Remote
// flow at the live file -- if that local build's own FORMAT_VERSION
// doesn't match what's actually on the remote, the app has no
// backward-compat read path (by design, see docs/FORMAT_V2.md) and
// silently hydrates every issue as empty, then happily pushes that
// blanked state back to GitHub as if it were a real sync. Checked via a
// plain, unauthenticated raw-content fetch -- deliberately NOT through
// the local app itself, so this check can never be fooled by the exact
// bug it exists to catch.
//
// Returns 'missing' when the remote genuinely doesn't have this file
// yet (confirmed via a real 404 -- nothing there to blank, safe to
// proceed), the real formatVersion number when a 'fields' line was
// found, or null for every other case: network failure, a non-200/404
// status, a readable file with no 'fields' line at all. The FIRST
// version of this function returned null for all of those and its
// caller treated null as "inconclusive, skip the check" -- which is
// exactly how this same incident happened a second time, from the
// safety check itself, that same day: a transient read failure was
// silently treated as "must be fine." The caller now fails CLOSED --
// null blocks the connection, same as a confirmed mismatch -- so
// "couldn't tell" and "confirmed wrong" are both refused; only
// 'missing' or a confirmed version match let the connection proceed.
async function fetchRemoteFormatVersion(repoOwner, repoName, repoPath) {
  const url = `https://raw.githubusercontent.com/${repoOwner}/${repoName}/HEAD/${repoPath}`;
  // Node's built-in fetch (undici) doesn't honor HTTP_PROXY/HTTPS_PROXY
  // on its own (confirmed live in this project's own sandboxed dev
  // container, which forces all outbound traffic through a proxy
  // sidecar -- see CLAUDE.md) -- curl does, so it's the fallback for an
  // environment where a bare fetch can't resolve DNS at all. A real
  // unprivileged machine (CI, a contributor's own laptop) just succeeds
  // on the first try and never reaches the fallback.
  const { text, status } = await (async () => {
    try {
      const res = await fetch(url);
      return { text: res.ok ? await res.text() : null, status: res.status };
    } catch (e) {
      try {
        const { execFileSync } = require('child_process');
        // Live-caught (2026-11-08): Node's execFileSync defaults maxBuffer
        // to 1MB -- fine when this safety check was written, but
        // tracker.jsonl has since grown past it (confirmed: 1,092,126
        // bytes, just over the 1,048,576-byte default), so curl's own
        // real output was silently truncated into an ENOBUFS throw here,
        // landing in the outer catch as {text:null, status:null} --
        // which the caller then (correctly, by design) treats as
        // "inconclusive, fail closed," refusing every connection
        // deterministically, not flakily, from that point on. 64MB is
        // generous headroom past any size this file is likely to reach
        // for a long while.
        const out = execFileSync('curl', ['-s', '-w', '\n%{http_code}', url], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        const idx = out.lastIndexOf('\n');
        return { text: out.slice(0, idx), status: parseInt(out.slice(idx + 1), 10) };
      } catch (e2) { return { text: null, status: null }; }
    }
  })();
  if (status !== 200 || text == null) return status === 404 ? 'missing' : null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch (e) { continue; }
    if (obj.type === 'fields') return obj.formatVersion || 1; // absent formatVersion predates the field existing at all -- that's v1
    if (obj.type === 'wigwag.export') continue; // the signed envelope line, if present -- the real schema line follows it
  }
  return null; // no 'fields' line found at all -- can't tell, don't block on an inconclusive read
}

// A throwaway static file server -- same job as tests/static-server.js,
// kept separate since this module has no dependency on the test suite
// and shouldn't need one running to work standalone.
function startStaticServer(root) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let file = req.url.split('?')[0];
      if (file === '/') file = '/wigwag.html';
      const filePath = path.join(root, path.normalize(file));
      if (!filePath.startsWith(root)) { res.writeHead(403); res.end(); return; }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': filePath.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// Connects to the tracker via the real Connect Remote flow -- every
// connect() starts a clean browser, so the project is never already
// there. Fails loudly rather than silently proceeding if the identity
// doesn't show write access (a stale/expired token, or a real
// regression in the probe, should stop the caller, not produce a
// confusing downstream failure).
async function ensureConnected(page, repoOwner, repoName) {
  await page.locator('[data-testid=btn-switcher]').click();
  await page.waitForTimeout(150);
  // "Connect remote..." is a standalone footer row now (tracker #143,
  // dfb378b2, new_bits.zip's Send/Receive/Search handoff Part B) --
  // "Import project..." was removed from this popover entirely, no more
  // intermediate click needed to reach it.
  await page.locator('[data-testid=btn-connect-remote-appbar]').click();
  await page.waitForTimeout(150);
  await page.locator('[data-testid=connect-remote-address-input]').fill(`${repoOwner}/${repoName}`);
  await page.waitForTimeout(2000);
  let probeText = await page.locator('[data-testid=connect-remote-probe-panel]').innerText();
  if (!/Claude[\s\S]{0,30}read and write/.test(probeText)) {
    // One retry -- a transient probe hiccup has been observed live even
    // after the coalescing fix; a second attempt has always cleared it.
    await page.locator('[data-testid=connect-remote-address-input]').fill('');
    await page.waitForTimeout(300);
    await page.locator('[data-testid=connect-remote-address-input]').fill(`${repoOwner}/${repoName}`);
    await page.waitForTimeout(2000);
    probeText = await page.locator('[data-testid=connect-remote-probe-panel]').innerText();
    if (!/Claude[\s\S]{0,30}read and write/.test(probeText)) {
      throw new Error('Claude identity does not show write access to the repo. Probe:\n' + probeText);
    }
  }
  await page.locator('[data-testid=connect-remote-connect-btn]').click();
  await page.waitForTimeout(2000);
  if (await page.locator('[data-testid=connect-remote-modal]').count()) {
    const err = await page.locator('[data-testid=connect-remote-error]').textContent().catch(() => null);
    throw new Error('Connect Remote failed: ' + err);
  }
}

// Format v2: an issue's own data lives in issue.fields[colId].history now,
// not one flat issue.history array keyed by h.field (see docs/FORMAT_V2.md)
// -- each field's own latest entry is read directly off its own array.
function deriveValues(issue) {
  const values = {};
  for (const colId in (issue.fields || {})) {
    const history = issue.fields[colId].history || [];
    if (!history.length) continue;
    values[colId] = history.reduce((a, b) => (b.sortKey > a.sortKey ? b : a)).value;
  }
  return values;
}

// Tracker #187, Phase 3: the project doc now lives in IndexedDB
// (wigwag-docstore/projectDocs), not localStorage -- read it the same
// way the app's own docStore.getDoc() does.
function readDoc(page, projectId) {
  return page.evaluate((pid) => new Promise((resolve, reject) => {
    const req = indexedDB.open('wigwag-docstore', 1);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(['projectDocs'], 'readonly');
      const getReq = tx.objectStore('projectDocs').get(pid);
      getReq.onsuccess = () => resolve(getReq.result || null);
      getReq.onerror = () => reject(getReq.error);
    };
    req.onerror = () => reject(req.error);
  }), projectId);
}

function getActiveProjectId(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1')).activeMilestoneId);
}

function resolveOptionLabel(fieldDef, value) {
  if (!value) return '—';
  const opt = ((fieldDef && fieldDef.options) || []).find(o => o.id === value);
  return opt ? opt.label : value;
}

function fieldLabelToColId(fieldDefs, label) {
  const target = label.trim().toLowerCase();
  for (const colId in fieldDefs) {
    if ((fieldDefs[colId].label || '').toLowerCase() === target) return colId;
  }
  return null;
}

// Format v2 drops `num` entirely (unstable across devices by its own
// design -- see docs/FORMAT_V2.md) -- an issue is identified purely by
// its real id (or an unambiguous prefix of it) now.
async function findIssue(page, projectId, idPrefix) {
  const doc = await readDoc(page, projectId);
  const byId = doc.issues.find(i => i.id.startsWith(idPrefix));
  if (byId) return byId;
  throw new Error(`No issue matches id prefix "${idPrefix}"`);
}

// A blind fixed sleep here (previously 5.5s -- the real ~4s debounce plus
// a margin) was confirmed live to be unreliable: two consecutive edits
// (tracker #133/0b22b69e and #134, 2026-09-22) reported success but never
// actually reached GitHub. A first fix (poll for the spinner to clear
// after a fixed 4.5s wait) was ALSO caught losing an edit live: this
// tracker's own background polling can reset the debounce timer by
// touching state again while we're waiting, so "spinner not visible yet"
// after a fixed wait is ambiguous between "already finished" and "hasn't
// started yet" -- checking that wrong is exactly how the second loss
// happened. Waits for the spinner to actually APPEAR first (proving a
// real sync attempt started), then waits for it to clear -- never
// inferring "done" from a spinner we simply haven't observed yet.
async function waitForPush(page) {
  const spinner = page.locator('[data-testid=footer-github-sync-spinner]');
  try { await spinner.waitFor({ state: 'visible', timeout: 15000 }); } catch (e) { /* may have already finished before we could observe it starting -- fall through */ }
  try { await spinner.waitFor({ state: 'hidden', timeout: 20000 }); } catch (e) { /* give up waiting; report whatever the footer shows now */ }
  const status = await page.locator('[data-testid=footer-github-sync]').innerText().catch(() => null);
  return status ? status.replace(/\n/g, ' ') : null;
}

// Interacts via the slide-over, not the table row -- a table row's own
// data-row-num is a pure positional index (rowPos + 1 in the currently
// rendered/filtered list), NOT issue.num, so a row lookup keyed by num
// silently targets the wrong issue as soon as num has any gaps (a
// deleted issue, e.g.) or the table isn't in plain ascending-num order.
// It only ever looked right against the demo fixture (1..9, no gaps).
// The slide-over is opened by issue.id via the URL hash instead, which
// has no such ambiguity.
async function attemptSetField(page, projectId, issueId, colId, def, value) {
  await page.goto(`/wigwag.html#/project/${projectId}/issue/${issueId}`, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  const cell = page.locator(`[data-testid=slideover-field][data-col="${colId}"]`);
  await cell.scrollIntoViewIfNeeded();
  // A select field's click-commit handler lives on its own inner
  // cursor:pointer span, not the outer [data-testid=slideover-field]
  // wrapper (buildSelectCell binds onClick there specifically) -- this
  // framework's click delegation doesn't reliably bubble from arbitrary
  // descendants, so clicking the wrapper visibly "clicks" but never opens
  // the popover. A text field is the opposite: buildTextCell deliberately
  // leaves its inner span's onClick unset so the click bubbles to
  // onCellClick on the wrapper -- clicking the inner span there would
  // never fire anything.
  const trigger = def.type === 'select' ? cell.locator('span[style*="cursor: pointer"]').first() : cell;
  await trigger.click();
  await page.waitForTimeout(150);
  await trigger.click();
  await page.waitForTimeout(200);

  if (def.type === 'select') {
    // [data-testid=select-option] is the option row itself, carrying the
    // actual sc-camel-on-click handler -- getByText(...).click() can
    // resolve to an inner text span instead, which visibly "clicks" (no
    // error) but never fires the framework's delegated handler bound to
    // the row div.
    const optionRow = page.locator('[data-testid=select-option]').filter({ hasText: value });
    if (!(await optionRow.count())) throw new Error(`No option labeled "${value}" for field type select. Options: ` + (def.options || []).map(o => o.label).join(', '));
    await optionRow.first().click();
  } else {
    await page.keyboard.press('Control+A');
    await page.keyboard.type(value);
    await page.keyboard.press('Tab');
  }
  await page.waitForTimeout(300);
}

async function currentFieldValue(page, projectId, issueId, colId, fieldDefs) {
  const doc = await readDoc(page, projectId);
  const iss = doc.issues.find(i => i.id === issueId);
  const values = deriveValues(iss);
  return fieldDefs[colId].type === 'select' ? resolveOptionLabel(fieldDefs[colId], values[colId]) : (values[colId] || '');
}

async function connect(opts = {}) {
  const identityPath = opts.identityPath || DEFAULT_TRACKER_FILE;
  const identity = loadIdentity(identityPath);
  const linkLocation = repoLocationFromTrackerLink(identityPath);
  if (!opts.repoOwner && !opts.repoName && !linkLocation) {
    throw new Error('Could not find a wigwag: link (with a github.com from= param) in ' + identityPath + ' to derive repoOwner/repoName from -- pass them explicitly instead.');
  }
  const repoOwner = opts.repoOwner || linkLocation.repoOwner;
  const repoName = opts.repoName || linkLocation.repoName;
  const repoPath = opts.repoPath || (linkLocation && linkLocation.repoPath) || 'tracker.jsonl';

  // See fetchRemoteFormatVersion's own comment -- this is the one check
  // standing between a format mismatch and silently blanking the live
  // file, so it runs BEFORE any browser/write-capable session exists,
  // not as an afterthought once already connected. opts.skipFormatCheck
  // exists only for this function's own tests against a fixture repo,
  // never for real tracker use -- don't pass it to bypass this.
  //
  // Fails CLOSED: only 'missing' (confirmed nothing there yet) or a
  // confirmed exact version match are allowed through. Every other
  // outcome -- a confirmed mismatch, OR an inconclusive read (null) --
  // refuses to connect. An earlier version of this check whitelisted
  // the mismatch case and let null silently proceed; that is the exact
  // shape of bug this check exists to catch, and it reproduced the live
  // incident a second time, from this check itself, on 2026-10-31
  // (tracker issue d5e8dbe6). "Couldn't confirm it's safe" must refuse,
  // the same as "confirmed it's not safe" -- never treated as "assume
  // it's fine."
  if (!opts.skipFormatCheck) {
    const remoteFormatVersion = await fetchRemoteFormatVersion(repoOwner, repoName, repoPath);
    const confirmedSafe = remoteFormatVersion === 'missing' || remoteFormatVersion === FORMAT_VERSION;
    if (!confirmedSafe) {
      throw new Error(
        `Refusing to connect: could not confirm ${repoOwner}/${repoName}/${repoPath} is formatVersion ${FORMAT_VERSION} ` +
        `(read: ${remoteFormatVersion === null ? 'inconclusive -- network failure, or no "fields" line found' : remoteFormatVersion}). ` +
        `This local wigwag.html build only has a safe read path for formatVersion ${FORMAT_VERSION}. ` +
        `Connecting without a confirmed match previously blanked every issue on this exact tracker -- TWICE, the ` +
        `second time from an earlier, fail-open version of this very check (2026-10-31, tracker issue d5e8dbe6) -- ` +
        `do not bypass this without first confirming the remote's real format by hand.`
      );
    }
  }

  let server = null;
  let baseUrl = opts.baseUrl || process.env.WIGWAG_URL;
  if (!baseUrl) {
    server = await startStaticServer(REPO_ROOT);
    baseUrl = 'http://127.0.0.1:' + server.address().port;
  }

  const browser = await chromium.launch();
  let page;

  // Live-caught bug (2026-09-29): ensureConnected() throws loudly on a
  // real access/connect failure (by design, see its own comment) -- but
  // nothing closed the browser on that path, leaving a real Chromium
  // process (and its open pipe to this one) running forever. Node's
  // event loop never drains with that handle still open, so the whole
  // CLI invocation hung indefinitely instead of exiting non-zero like
  // main()'s own .catch() intended. Any failure between here and the
  // normal return now closes everything before rethrowing.
  try {
    const context = await browser.newContext({ baseURL: baseUrl });
    page = await context.newPage();
    page.on('pageerror', e => console.error('page error:', e));

    // Seed the identity BEFORE the app's own first render, so it's
    // already active on boot -- skips the "Add identity..." dance every
    // call, and (critically) means every signed entry uses the SAME
    // keypair every time, not a fresh unrelated one.
    await page.addInitScript((idy) => {
      localStorage.setItem('git_native_tracker_identities_v1', JSON.stringify({
        activeIdentityId: idy.id,
        identities: [idy],
        lastActiveProjectByIdentity: {}
      }));
    }, identity);

    await page.goto('/wigwag.html', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    await ensureConnected(page, repoOwner, repoName);
  } catch (e) {
    await browser.close();
    if (server) server.close();
    throw e;
  }

  async function close() {
    await browser.close();
    if (server) server.close();
  }

  async function list() {
    const projectId = await getActiveProjectId(page);
    const doc = await readDoc(page, projectId);
    const statusColId = fieldLabelToColId(doc.fieldDefs, STATUS_FIELD_LABEL);
    const issues = doc.issues.map(iss => {
      const values = deriveValues(iss);
      return {
        id: iss.id, values,
        status: statusColId ? resolveOptionLabel(doc.fieldDefs[statusColId], values[statusColId]) : null
      };
    });
    return { projectId, fieldDefs: doc.fieldDefs, issues };
  }

  async function getIssue(idPrefix) {
    const projectId = await getActiveProjectId(page);
    const issue = await findIssue(page, projectId, idPrefix);
    const doc = await readDoc(page, projectId);
    return {
      id: issue.id, values: deriveValues(issue),
      fieldDefs: doc.fieldDefs,
      comments: (issue.fields.comments && issue.fields.comments.history) || [],
      fields: issue.fields || {}
    };
  }

  async function addIssue(title) {
    if (!title) throw new Error('addIssue requires a title');
    await page.keyboard.down('Control');
    await page.keyboard.press('Space');
    await page.keyboard.up('Control');
    await page.waitForTimeout(150);
    await page.fill('[data-testid=add-item-input]', title);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    const syncStatus = await waitForPush(page);
    const projectId = await getActiveProjectId(page);
    const doc = await readDoc(page, projectId);
    // Format v2 has no `num` to sort by (see docs/FORMAT_V2.md) -- the
    // just-created issue is whichever one has the newest title entry.
    const created = doc.issues.slice().sort((a, b) => {
      const at = (a.fields.title && a.fields.title.history || []).reduce((m, h) => Math.max(m, h.sortKey || 0), 0);
      const bt = (b.fields.title && b.fields.title.history || []).reduce((m, h) => Math.max(m, h.sortKey || 0), 0);
      return bt - at;
    })[0];
    return { id: created.id, syncStatus };
  }

  async function comment(idPrefix, text) {
    if (!idPrefix || !text) throw new Error('comment requires an issue and text');
    const projectId = await getActiveProjectId(page);
    const issue = await findIssue(page, projectId, idPrefix);
    await page.goto(`/wigwag.html#/project/${projectId}/issue/${issue.id}`, { waitUntil: 'load' });
    await page.waitForTimeout(600);
    await page.locator('[data-testid=new-comment-input]').fill(text);
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(500);
    const syncStatus = await waitForPush(page);
    return { id: issue.id, syncStatus };
  }

  async function setField(idPrefix, fieldLabel, value) {
    if (!idPrefix || !fieldLabel || value === undefined) throw new Error('setField requires an issue, field label, and value');
    const projectId = await getActiveProjectId(page);
    const issue = await findIssue(page, projectId, idPrefix);
    const doc = await readDoc(page, projectId);
    const colId = fieldLabelToColId(doc.fieldDefs, fieldLabel);
    if (!colId) throw new Error(`No field labeled "${fieldLabel}". Fields: ` + Object.values(doc.fieldDefs).map(f => f.label).join(', '));
    const def = doc.fieldDefs[colId];

    for (let attempt = 1; attempt <= 3; attempt++) {
      await attemptSetField(page, projectId, issue.id, colId, def, value);
      const now = await currentFieldValue(page, projectId, issue.id, colId, doc.fieldDefs);
      if (now === value) {
        const syncStatus = await waitForPush(page);
        return { id: issue.id, syncStatus };
      }
    }
    throw new Error(`Could not confirm "${fieldLabel}" was set to "${value}" on [${issue.id.slice(0, 8)}] after 3 attempts (likely concurrent edits on the live tracker -- try again)`);
  }

  return { page, list, getIssue, addIssue, comment, setField, close };
}

module.exports = { connect, loadIdentity };
