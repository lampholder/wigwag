#!/usr/bin/env node
// CLI for interacting with the live wigwag tracker (the project this repo
// itself is developed against, github.com/lampholder/wigwag) as the
// persistent "Claude" identity -- see `wigwag_tracker` at the repo root
// for the identity/credentials this reads, and CLAUDE.md for when to use
// this (backlog/TODO tracking for wigwag itself lives in that tracker,
// not in scratch markdown files).
//
// Drives a REAL headless instance of wigwag.html via Playwright, not
// direct JSONL manipulation -- every write goes through the app's own
// logic (real signed history entries, real derived values, real
// gating), the same way a human using the app would produce them. An
// earlier hand-edited-file attempt was deliberately redone this way
// instead; see the commit history around 2026-08-26 for why.
//
// Usage:
//   node wigwag-agent.js list
//   node wigwag-agent.js add-issue "Title text"
//   node wigwag-agent.js comment <num-or-id-prefix> "Comment text"
//   node wigwag-agent.js set-field <num-or-id-prefix> "<Field label>" <value>
//     (value is an option's exact label for a select field, or plain
//     text for a text field)
//
// Each invocation is a fresh, throwaway browser context -- there's no
// persistent profile, so every call re-runs Connect Remote and re-syncs
// from GitHub first. That's deliberate: it means every read/write always
// reflects the current state of the real file, never a stale local copy.
// Costs ~10-20s per call (browser launch + the real ~4s push debounce)
// -- fine for backlog-grooming cadence, not meant for high-frequency use.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = __dirname;
const TRACKER_FILE = path.join(REPO_ROOT, 'wigwag_tracker');
const REPO_OWNER = 'lampholder';
const REPO_NAME = 'wigwag';
const STATUS_FIELD_LABEL = 'Status';

function loadIdentity() {
  const text = fs.readFileSync(TRACKER_FILE, 'utf8');
  const m = text.match(/\n(\{\s*"id":[\s\S]*?\n\})\n/);
  if (!m) throw new Error('Could not find the identity JSON block in ' + TRACKER_FILE);
  return JSON.parse(m[1]);
}

// A throwaway static file server -- same job as tests/static-server.js,
// kept separate since this script has no dependency on the test suite
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

async function withPage(fn) {
  const identity = loadIdentity();
  let server = null;
  let baseUrl = process.env.WIGWAG_URL;
  if (!baseUrl) {
    server = await startStaticServer(REPO_ROOT);
    baseUrl = 'http://127.0.0.1:' + server.address().port;
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: baseUrl });
  const page = await context.newPage();
  page.on('pageerror', e => console.error('page error:', e));

  // Seed the identity BEFORE the app's own first render, so it's already
  // active on boot -- skips the "Add identity..." dance every call, and
  // (critically) means every signed entry uses the SAME keypair every
  // time, not a fresh unrelated one.
  await page.addInitScript((idy) => {
    localStorage.setItem('git_native_tracker_identities_v1', JSON.stringify({
      activeIdentityId: idy.id,
      identities: [idy],
      lastActiveProjectByIdentity: {}
    }));
  }, identity);

  await page.goto('/wigwag.html', { waitUntil: 'load' });
  await page.waitForTimeout(500);

  try {
    await fn(page);
  } finally {
    await browser.close();
    if (server) server.close();
  }
}

// Connects to the tracker via the real Connect Remote flow -- every
// invocation starts a clean browser, so the project is never already
// there. Fails loudly rather than silently proceeding if the identity
// doesn't show write access (a stale/expired token, or a real
// regression in the probe, should stop the script, not produce a
// confusing downstream failure).
async function ensureConnected(page) {
  await page.locator('[data-testid=btn-switcher]').click();
  await page.waitForTimeout(150);
  // "Connect remote..." lives inside the same "Import project..." popover
  // as "From file..." / "Paste from clipboard..." now, not a standalone
  // row of its own.
  await page.locator('[data-testid=btn-import-project-appbar]').click();
  await page.waitForTimeout(150);
  await page.locator('[data-testid=btn-connect-remote-appbar]').click();
  await page.waitForTimeout(150);
  await page.locator('[data-testid=connect-remote-address-input]').fill(`${REPO_OWNER}/${REPO_NAME}`);
  await page.waitForTimeout(2000);
  let probeText = await page.locator('[data-testid=connect-remote-probe-panel]').innerText();
  if (!/Claude[\s\S]{0,30}read and write/.test(probeText)) {
    // One retry -- a transient probe hiccup has been observed live even
    // after the coalescing fix; a second attempt has always cleared it.
    await page.locator('[data-testid=connect-remote-address-input]').fill('');
    await page.waitForTimeout(300);
    await page.locator('[data-testid=connect-remote-address-input]').fill(`${REPO_OWNER}/${REPO_NAME}`);
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

function deriveValues(issue) {
  const latest = {};
  for (const h of issue.history || []) {
    if (!h.field) continue;
    if (!latest[h.field] || h.sortKey > latest[h.field].sortKey) latest[h.field] = h;
  }
  const values = {};
  for (const f in latest) values[f] = latest[f].value;
  return values;
}

function readDoc(page, projectId) {
  return page.evaluate((pid) => {
    const raw = localStorage.getItem('git_native_tracker_v1:' + pid);
    return raw ? JSON.parse(raw) : null;
  }, projectId);
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

async function findIssue(page, projectId, numOrIdPrefix) {
  const doc = await readDoc(page, projectId);
  const byNum = doc.issues.find(i => String(i.num) === String(numOrIdPrefix));
  if (byNum) return byNum;
  const byId = doc.issues.find(i => i.id.startsWith(numOrIdPrefix));
  if (byId) return byId;
  throw new Error(`No issue matches "${numOrIdPrefix}" (checked both num and id prefix)`);
}

async function waitForPush(page) {
  await page.waitForTimeout(5500); // real ~4s debounce + margin
  const status = await page.locator('[data-testid=footer-github-sync]').innerText().catch(() => null);
  if (status) console.log('Sync status:', status.replace(/\n/g, ' '));
}

async function cmdList(page) {
  await ensureConnected(page);
  const projectId = await getActiveProjectId(page);
  const doc = await readDoc(page, projectId);
  const statusColId = fieldLabelToColId(doc.fieldDefs, STATUS_FIELD_LABEL);
  console.log(`Project ${projectId} -- ${doc.issues.length} issues\n`);
  for (const iss of doc.issues.slice().sort((a, b) => a.num - b.num)) {
    const values = deriveValues(iss);
    const status = statusColId ? resolveOptionLabel(doc.fieldDefs[statusColId], values[statusColId]) : '';
    console.log(`#${String(iss.num).padEnd(3)} [${iss.id.slice(0, 8)}] (${status})  ${values.title || '(untitled)'}`);
  }
}

async function cmdAddIssue(page, title) {
  if (!title) throw new Error('Usage: add-issue "<title>"');
  await ensureConnected(page);
  await page.keyboard.down('Control');
  await page.keyboard.press('Space');
  await page.keyboard.up('Control');
  await page.waitForTimeout(150);
  await page.fill('[data-testid=add-item-input]', title);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  console.log('Added issue:', title);
  await waitForPush(page);
}

async function cmdComment(page, numOrId, text) {
  if (!numOrId || !text) throw new Error('Usage: comment <num-or-id> "<text>"');
  await ensureConnected(page);
  const projectId = await getActiveProjectId(page);
  const issue = await findIssue(page, projectId, numOrId);
  await page.goto(`/wigwag.html#/project/${projectId}/issue/${issue.id}`, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await page.locator('[data-testid=new-comment-input]').fill(text);
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(500);
  console.log(`Commented on #${issue.num}`);
  await waitForPush(page);
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
  await cell.click();
  await page.waitForTimeout(150);
  await cell.click();
  await page.waitForTimeout(200);

  if (def.type === 'select') {
    // .scpa is the option row's own class, carrying the actual
    // sc-camel-on-click handler -- getByText(...).click() can resolve to
    // an inner text span instead, which visibly "clicks" (no error) but
    // never fires the framework's delegated handler bound to the row div.
    const optionRow = page.locator('div[style*="z-index: 70"] div.scpa').filter({ hasText: value });
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

async function cmdSetField(page, numOrId, fieldLabel, value) {
  if (!numOrId || !fieldLabel || value === undefined) throw new Error('Usage: set-field <num-or-id> "<field label>" <value>');
  await ensureConnected(page);
  const projectId = await getActiveProjectId(page);
  const issue = await findIssue(page, projectId, numOrId);
  const doc = await readDoc(page, projectId);
  const colId = fieldLabelToColId(doc.fieldDefs, fieldLabel);
  if (!colId) throw new Error(`No field labeled "${fieldLabel}". Fields: ` + Object.values(doc.fieldDefs).map(f => f.label).join(', '));
  const def = doc.fieldDefs[colId];

  for (let attempt = 1; attempt <= 3; attempt++) {
    await attemptSetField(page, projectId, issue.id, colId, def, value);
    const now = await currentFieldValue(page, projectId, issue.id, colId, doc.fieldDefs);
    if (now === value) {
      console.log(`Set "${fieldLabel}" on #${issue.num} to "${value}"`);
      await waitForPush(page);
      return;
    }
    console.log(`  attempt ${attempt}: field still reads "${now}", not "${value}" -- retrying`);
  }
  throw new Error(`Could not confirm "${fieldLabel}" was set to "${value}" on #${issue.num} after 3 attempts (likely concurrent edits on the live tracker -- try again)`);
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const commands = {
    list: (page) => cmdList(page),
    'add-issue': (page) => cmdAddIssue(page, args.join(' ')),
    comment: (page) => cmdComment(page, args[0], args.slice(1).join(' ')),
    'set-field': (page) => cmdSetField(page, args[0], args[1], args.slice(2).join(' ')),
  };
  if (!commands[cmd]) {
    console.log('Usage: node wigwag-agent.js <list|add-issue|comment|set-field> [args]');
    console.log('  list');
    console.log('  add-issue "<title>"');
    console.log('  comment <num-or-id-prefix> "<text>"');
    console.log('  set-field <num-or-id-prefix> "<field label>" <value>');
    process.exitCode = cmd ? 1 : 0;
    return;
  }
  await withPage(commands[cmd]);
}

main().catch(err => { console.error(err.message || err); process.exitCode = 1; });
