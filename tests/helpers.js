// Shared helpers for the tracker's Playwright test suite. The app has no
// build step and no client-side router — every test just navigates to the
// bundled HTML file fresh (each Playwright test gets an isolated browser
// context, i.e. fresh localStorage). The real app now starts genuinely
// blank on a true first-ever open (no seed content) -- gotoTracker below
// pre-seeds the classic 9-issue demo dataset instead, since virtually the
// whole suite relies on that exact fixture (specific issues/fields/values)
// and that's a test-suite concern, entirely decoupled from what a real new
// user should see.
const fs = require('fs');
const path = require('path');
const TRACKER_PATH = '/Git-native%20Project%20Tracker.html';

const DEMO_MILESTONE_ID = 'demo-milestone';
const DEMO_MILESTONE_NAME = 'Delivery tracker';
const demoLines = fs.readFileSync(path.join(__dirname, 'fixtures', 'demo-milestone.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const demoFieldsLine = demoLines.find(l => l.type === 'fields');
const demoIssues = demoLines.filter(l => l.type === 'issue');
const demoDoc = {
  fieldDefs: demoFieldsLine.fields, columnOrder: demoFieldsLine.columnOrder, hiddenFieldIds: [],
  issues: demoIssues.map(iss => ({
    id: iss.id, uid: iss.uid, num: iss.num, fieldRefs: iss.fieldRefs || {}, fieldLoading: {},
    values: iss.values, comments: iss.comments, history: iss.history
  })),
  githubRepo: '', githubRepoPath: 'tracker.jsonl', githubRepoBranch: ''
};

// Seeds the demo dataset (tests/fixtures/demo-milestone.jsonl -- extracted
// from what the app itself used to seed on first-ever open, before it
// switched to starting blank) as an already-migrated milestone, via
// addInitScript so it exists before the app's own constructor runs on the
// next navigation. Exported separately from gotoTracker so a test that
// specifically needs a truly-unseeded first-ever-open state (e.g. legacy
// storage migration) can navigate without it.
// addInitScript re-runs on EVERY navigation in this page, including a test's
// own page.reload() after making edits -- guarded the same way the app's
// own migrateLegacyStorageIfNeeded() guards itself, so a reload doesn't
// clobber whatever's actually there back to the pristine seed.
async function seedDemoMilestone(page) {
  await page.addInitScript(({ id, name, doc }) => {
    if (localStorage.getItem('git_native_tracker_milestones_v1')) return;
    localStorage.setItem('git_native_tracker_milestones_v1', JSON.stringify({ activeMilestoneId: id, milestones: [{ id, name }] }));
    localStorage.setItem('git_native_tracker_v1:' + id, JSON.stringify(doc));
  }, { id: DEMO_MILESTONE_ID, name: DEMO_MILESTONE_NAME, doc: demoDoc });
}

// Two real-time windows (GitHub-leader staleness, auto-push debounce)
// otherwise cost the suite ~35s+ of pure waiting across a handful of
// tests. Both are overridable via a window global the app reads at
// startup (production default when unset, see GITHUB_LEADER_STALE_MS /
// maybeScheduleGithubPush in the tracker source) -- shrinking them here
// runs the exact same real timing logic, just on a compressed clock, not
// a mocked one.
// Seeds two identities (with known, stable ids -- not the random ones a
// real migration would generate) and a small project set split across
// them, for tests that need real multi-identity UI to be reachable (the
// pill/dropdown/title-prefix all render only when identities.length > 1).
// Bypasses gotoTracker's own demo-project seed entirely -- coordinating a
// known identity id with whatever random id a real migration would assign
// the demo project isn't worth it when a fully custom seed is simpler and
// more explicit about which project belongs to which identity.
async function seedTwoIdentities(page, opts = {}) {
  const idA = opts.idA || 'identity-a';
  const idB = opts.idB || 'identity-b';
  const activeIdentityId = opts.activeIdentityId || idA;
  const projects = opts.projects || [
    { id: 'project-a', name: 'Project A', identityId: idA },
    { id: 'project-b1', name: 'Project B1', identityId: idB },
    { id: 'project-b2', name: 'Project B2', identityId: idB },
  ];
  const blankDoc = {
    fieldDefs: { title: { label: 'Issue', type: 'text' } }, issues: [], hiddenFieldIds: [],
    githubRepo: '', githubRepoPath: 'tracker.jsonl', githubRepoBranch: '', projectNotes: '', projectComments: []
  };
  await page.addInitScript(({ idA, idB, activeIdentityId, projects, blankDoc, docs }) => {
    localStorage.setItem('git_native_tracker_identities_v1', JSON.stringify({
      activeIdentityId, defaultIdentityId: idA,
      identities: [
        { id: idA, label: 'Personal', email: 'tom@personal.com', githubToken: '', jiraProxyUrl: '', stateRepo: 'tom/personal-state', signingPublicKeyJwk: null, signingPrivateKeyJwk: null },
        { id: idB, label: 'Northwind', email: 'tom@northwind.com', githubToken: '', jiraProxyUrl: '', stateRepo: '', signingPublicKeyJwk: null, signingPrivateKeyJwk: null },
      ],
      lastActiveProjectByIdentity: {}
    }));
    localStorage.setItem('git_native_tracker_milestones_v1', JSON.stringify({
      activeMilestoneId: projects[0].id, milestones: projects
    }));
    for (const p of projects) {
      localStorage.setItem('git_native_tracker_v1:' + p.id, JSON.stringify((docs && docs[p.id]) || blankDoc));
    }
  }, { idA, idB, activeIdentityId, projects, blankDoc, docs: opts.docs });
}

async function useFastTimers(page) {
  await page.addInitScript(() => {
    window.__wigwagLeaderStaleMs = 600;
    window.__wigwagPushDebounceMs = 300;
    window.__wigwagLeaderHeartbeatMs = 200; // keep the same ~3x safety margin vs. staleMs as production (5000 vs 15000)
  });
}

const DEMO_IDENTITY_EMAIL = 'tom@example.com';

// Pre-seeds SECRETS_KEY's identityEmail before the app boots, so the
// migration that synthesizes the demo user's "Personal" identity picks it
// up already set -- the fixture represents an already-onboarded user, which
// is what virtually the whole rest of the suite assumes (the first-edit
// email gate would otherwise block every editing test). Tests that
// specifically need a genuinely fresh, no-email identity (the gate itself)
// use gotoTrackerFreshIdentity below instead.
async function seedDemoIdentityEmail(page) {
  await page.addInitScript((email) => {
    const raw = localStorage.getItem('git_native_tracker_secrets_v1');
    const secrets = raw ? JSON.parse(raw) : {};
    if (!secrets.identityEmail) {
      localStorage.setItem('git_native_tracker_secrets_v1', JSON.stringify(Object.assign({}, secrets, { identityEmail: email })));
    }
  }, DEMO_IDENTITY_EMAIL);
}

async function gotoTracker(page) {
  await useFastTimers(page);
  await seedDemoIdentityEmail(page);
  await seedDemoMilestone(page);
  await page.goto(TRACKER_PATH, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300); // initial render settle
}

// Same demo fixture as gotoTracker, but deliberately WITHOUT a pre-set
// email -- for tests that need a genuinely first-time, ungated identity
// (the first-edit email gate itself).
async function gotoTrackerFreshIdentity(page) {
  await useFastTimers(page);
  await seedDemoMilestone(page);
  await page.goto(TRACKER_PATH, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
}

// The tracker's own document (fieldDefs/issues/etc.) is persisted under a
// per-milestone key resolved via a small index -- see the milestone-switcher
// storage layout. Tests that used to read the bare 'git_native_tracker_v1'
// key directly should go through these instead.
// The inline View Source panel pretty-prints each record for readability
// (design handoff §9) -- display is deliberately not the clipboard
// content, so reading real compact JSONL for assertions means opening the
// panel and using its own Copy button (same buildSourceText() output the
// Share menu's "Copy to clipboard" produces), not scraping the <pre>'s
// rendered text.
async function readSourceViewText(page) {
  await page.getByText('{ } View source', { exact: true }).click();
  await page.waitForTimeout(200);
  await page.locator('[data-testid=btn-source-view-copy]').click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  await page.locator('[data-testid=source-view] >> text=✕').click();
  await page.waitForTimeout(150);
  return text;
}

async function readActiveMilestoneDoc(page) {
  return page.evaluate(() => {
    const idx = JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1'));
    return JSON.parse(localStorage.getItem('git_native_tracker_v1:' + idx.activeMilestoneId));
  });
}
async function writeActiveMilestoneDoc(page, doc) {
  await page.evaluate((doc) => {
    const idx = JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1'));
    localStorage.setItem('git_native_tracker_v1:' + idx.activeMilestoneId, JSON.stringify(doc));
  }, doc);
}
// values/fieldRefs are no longer persisted/exported directly -- history is
// the sole source of truth. Mirrors the app's own deriveIssueFieldRefs:
// latest history entry for this field that explicitly carries a fieldRef.
function latestFieldRef(issue, colId) {
  const entries = (issue.history || []).filter(hh => hh.field === colId && hh.fieldRef !== undefined);
  if (!entries.length) return undefined;
  return entries.reduce((a, b) => (b.sortKey > a.sortKey ? b : a)).fieldRef;
}
function latestFieldValue(issue, colId) {
  const entries = (issue.history || []).filter(hh => hh.field === colId && hh.value !== undefined);
  if (!entries.length) return undefined;
  return entries.reduce((a, b) => (b.sortKey > a.sortKey ? b : a)).value;
}

async function openTrackerSwitcher(page) {
  await page.locator('[data-testid=btn-tracker-switcher]').click();
  await page.waitForTimeout(150);
}

function milestoneRow(page, name) {
  return page.locator('[data-testid=milestone-row]').filter({ hasText: name });
}

function row(page, num) {
  return page.locator(`[data-testid=row][data-row-num="${num}"]`);
}

function titleCell(page, num) {
  return row(page, num).locator('[data-testid=title-cell]');
}

function fieldCell(page, num, colId) {
  return row(page, num).locator(`[data-testid=field-cell][data-col="${colId}"]`);
}

function colHeader(page, colId) {
  return page.locator(`[data-testid=col-header][data-col="${colId}"]`);
}

function slideoverField(page, colId) {
  return page.locator(`[data-testid=slideover] [data-testid=slideover-field][data-col="${colId}"]`);
}

// GitHub-Projects-style two-click cells: a first click just selects a
// cell, a second click on the SAME cell commits to editing (or opens the
// select/multiselect popover). Every cell-editing helper below performs
// both clicks so callers don't have to think about the gate.
async function clickTitleToEdit(page, num) {
  // Clicking the title's own resolved text/pill opens the slide-over
  // instead of editing (see clickTitleToPeek) -- to reach genuine edit
  // mode (revealing the raw URL/text), click elsewhere in the title cell,
  // twice. dispatchEvent targets the cell's own wrapping div directly
  // rather than guessing at real "empty" pixel coordinates within it (the
  // resolved text span is width:100% and usually fills the cell).
  const cell = titleCell(page, num);
  await cell.dispatchEvent('click');
  await page.waitForTimeout(120);
  await cell.dispatchEvent('click');
}

// Single click on the title's own resolved text/pill: opens the
// slide-over peek panel (GitHub Projects-style), bypassing the two-click
// gate entirely.
async function clickTitleToPeek(page, num) {
  await titleCell(page, num).locator('span').first().click();
}

async function clickFieldToEdit(page, num, colId) {
  const cell = fieldCell(page, num, colId);
  await cell.click();
  await page.waitForTimeout(120);
  await cell.click();
}

async function openSlideover(page, num) {
  await clickTitleToPeek(page, num);
  await page.waitForTimeout(200);
  return page.locator('[data-testid=slideover]');
}

// The row-hover refresh button, replacing the old chevron-then-menu path.
async function refreshRow(page, num) {
  await row(page, num).locator('[data-testid=row-refresh-btn]').click();
}

async function closeSlideover(page) {
  await page.keyboard.press('Escape');
  await page.mouse.click(700, 700);
  await page.waitForTimeout(150);
}

// GitHub's unauthenticated REST API allows 60 requests/hour per IP — trivial
// to exhaust across a whole test suite run (confirmed the hard way: this
// exact suite hit a real 403 rate-limit mid-development). Tests should be
// deterministic and independent of that external, time-varying quota, so
// mock the endpoint instead of hitting it live. Fixture values below are
// real responses captured earlier this session, kept verbatim so existing
// assertions ("Edited README via GitHub" etc.) still match.
const GITHUB_FIXTURES = {
  'octocat/Hello-World/issues/1': { title: 'Edited README via GitHub', state: 'closed', pull_request: {}, labels: [] },
  'octocat/Hello-World/issues/2': { title: 'README file modified ', state: 'closed', pull_request: {}, labels: [] },
  'octocat/Hello-World/issues/3': { title: 'Test issue for the tracker suite', state: 'open', labels: [{ name: 'bug' }] },
};

async function mockGithubApi(page) {
  await page.route('https://api.github.com/repos/**', async (route) => {
    const url = new URL(route.request().url());
    const key = url.pathname.replace(/^\/repos\//, '');
    const fixture = GITHUB_FIXTURES[key];
    if (fixture) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) });
    } else {
      // seed data references fictional repos (acme/app, owner/app) for
      // demonstrating a resolved-but-not-really-fetchable link — a real 404
      // for anything not in the fixture table above keeps that meaningful.
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Not Found' }) });
    }
  });
}

// Mirrors mockGithubApi, for the local Jira proxy the app talks to instead
// of Jira directly (Jira doesn't allow direct browser CORS requests the way
// GitHub does — see jira-proxy.js). fixtures maps issue key -> the proxy's
// normalized response shape ({title, description, labels, browseUrl}).
async function mockJiraProxy(page, fixtures, proxyUrl = 'http://localhost:8934') {
  await page.route(proxyUrl + '/issue/*', async (route) => {
    const key = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\/issue\//, ''));
    const fixture = fixtures[key];
    if (fixture) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) });
    } else {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not found' }) });
    }
  });
}

// Settings moved off its own standalone gear button and into the identity
// dropdown (a "Settings..." link, above "Manage identities...") -- this
// helper hides that two-click path so every existing call site (there are
// many) keeps working unchanged.
async function openSettings(page) {
  await page.locator('[data-testid=identity-pill]').click();
  await page.waitForTimeout(150);
  await page.locator('[data-testid=btn-open-settings]').click();
  await page.waitForTimeout(150);
}

async function setGithubToken(page, token) {
  await openSettings(page);
  await page.locator('[data-testid=settings-github-token]').fill(token);
  await page.mouse.click(10, 10); // outside Settings -- its panel is tall enough to reach (700,700) on some layouts
  await page.waitForTimeout(150);
}

// Configures the tracker's own repo-sync (Settings > GITHUB REPO SYNC),
// distinct from setGithubToken's issue-linking-only use above (the token
// field is dual-purpose and shared by both).
async function setGithubRepoSync(page, { repo, path, branch, token } = {}) {
  await openSettings(page);
  if (token !== undefined) await page.locator('[data-testid=settings-github-token]').fill(token);
  if (repo !== undefined) await page.locator('[data-testid=settings-github-repo]').fill(repo);
  if (path !== undefined) await page.locator('[data-testid=settings-github-repo-path]').fill(path);
  if (branch !== undefined) await page.locator('[data-testid=settings-github-repo-branch]').fill(branch);
  await page.mouse.click(10, 10); // outside Settings -- its panel is tall enough to reach (700,700) on some layouts
  await page.waitForTimeout(150);
}

// Mocks the Contents API endpoint the repo-sync feature itself talks to
// (GET to pull, PUT to push) for one repo/path -- separate from
// mockGithubApi above, which fakes the unrelated per-field issue-link
// endpoints. `state.getResponses` is a script of {status, sha, text}
// consumed one per GET call (the last entry repeats for any GET beyond the
// script's length, so a test only has to describe the calls it cares
// about). `state.pushStatusOverride` lets a test make exactly one PUT come
// back as e.g. 409 before reverting to normal 200s. Returns live counters
// and the raw bodies of every PUT actually sent, for assertions.
function mockGithubContentsApi(page, repo, path = 'tracker.jsonl') {
  const state = { getCount: 0, pushCount: 0, pushes: [], getResponses: [], pushStatusOverride: null };
  page.route(`https://api.github.com/repos/${repo}/contents/${path}`, async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      const idx = Math.min(state.getCount, state.getResponses.length - 1);
      const resp = state.getResponses[idx];
      state.getCount++;
      if (!resp || resp.status === 404) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Not Found' }) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha: resp.sha, content: Buffer.from(resp.text, 'utf8').toString('base64') }) });
      }
      return;
    }
    if (method === 'PUT') {
      const body = JSON.parse(route.request().postData());
      state.pushCount++;
      state.pushes.push(body);
      if (state.pushStatusOverride && state.pushCount === state.pushStatusOverride.onCall) {
        await route.fulfill({ status: state.pushStatusOverride.status, contentType: 'application/json', body: '{}' });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: { sha: 'sha-after-push-' + state.pushCount } }) });
      }
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  return state;
}

async function setJiraProxyUrl(page, url) {
  await openSettings(page);
  await page.locator('[data-testid=settings-jira-proxy-url]').fill(url);
  await page.mouse.click(10, 10); // outside Settings -- its panel is tall enough to reach (700,700) on some layouts
  await page.waitForTimeout(150);
}

async function pasteText(page, text) {
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
  await page.keyboard.press('Control+A'); // replace any pre-filled value, don't paste-append at the cursor
  await page.keyboard.press('Control+KeyV');
}

async function typeAndCommit(page, text) {
  await page.keyboard.press('Control+A');
  if (text) await page.keyboard.type(text);
  else await page.keyboard.press('Delete');
  await page.keyboard.press('Enter');
}

// Sandbox network latency for a fresh connection is sometimes well over a
// second (confirmed earlier this session) — poll instead of a fixed sleep.
async function waitUntil(check, timeoutMs = 15000, intervalMs = 100) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('waitUntil: condition not met within ' + timeoutMs + 'ms');
}

async function waitForFieldResolved(page, num, colId) {
  await waitUntil(async () => {
    const text = await fieldCell(page, num, colId).textContent();
    return !text.includes('Loading');
  });
}

async function waitForTitleResolved(page, num) {
  await waitUntil(async () => {
    const text = await titleCell(page, num).textContent();
    return !text.includes('Loading');
  });
}

async function openColumnMenu(page, colId) {
  await colHeader(page, colId).locator('span', { hasText: '⋯' }).click();
  await page.waitForTimeout(150);
  return page.locator('[data-testid=field-editor], .row-menu, div').first(); // caller usually queries by text after this
}

// Opens the column "..." menu and clicks through to the field editor modal
// (FIELD NAME / BOUND SOURCE / RULE / OPTIONS). Only bindable types (select,
// multiselect, text) offer "Edit field…" at all.
async function openFieldEditor(page, colId) {
  await openColumnMenu(page, colId);
  await page.getByText('Edit field…', { exact: true }).click();
  await page.waitForTimeout(150);
  return page.locator('[data-testid=field-editor]');
}

// Binds a field's rule to the given source (by its dropdown label, e.g.
// "Issue" for Title or "Related" for the 'linked' field) and rule text, via
// the field editor's BOUND SOURCE select + RULE textarea. Assumes the field
// editor is already open (see openFieldEditor).
async function setBoundSourceAndRule(page, sourceLabel, ruleText) {
  await page.locator('[data-testid=field-editor-source-select]').selectOption({ label: sourceLabel });
  await page.waitForTimeout(150);
  const textarea = page.locator('[data-testid=field-editor-rule-textarea]');
  await textarea.click();
  await textarea.fill(ruleText);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
}

// The header's own inline sort-arrow icon only appears once a column is
// ALREADY the active sort (col.isSorted gates it) — it's a shortcut for
// flipping direction, not how a first sort gets triggered. The "⋯" column
// menu's Sort ascending/descending items are the actual entry point.
async function sortByColumn(page, colId, dir = 'ascending') {
  await openColumnMenu(page, colId);
  await page.getByText(dir === 'ascending' ? 'Sort ascending' : 'Sort descending', { exact: true }).click();
  await page.waitForTimeout(200);
}

async function getHistoryEntries(page) {
  return page.evaluate(() => {
    const marker = [...document.querySelectorAll('div')].find(d => d.textContent.trim().startsWith('HISTORY') && d.textContent.trim().length < 20);
    if (!marker) return [];
    const container = marker.parentElement;
    // history rows are direct children after the HISTORY label; grab the leaf text lines
    return [...container.querySelectorAll('div')]
      .map(d => d.textContent.trim())
      .filter(x => x && x !== 'HISTORY' && x.length < 120);
  });
}

// Reads an issue's history log directly from persisted state — more direct
// than getHistoryEntries (which scrapes the slide-over's DOM and requires it
// to be open) for tests that just need to confirm a specific event happened.
async function getHistoryEntriesFor(page, issueId) {
  return page.evaluate((issueId) => {
    const idx = JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1'));
    const d = JSON.parse(localStorage.getItem('git_native_tracker_v1:' + idx.activeMilestoneId));
    const iss = d.issues.find(i => i.id === issueId);
    return iss ? iss.history.map(h => h.text) : [];
  }, issueId);
}

module.exports = {
  TRACKER_PATH,
  gotoTracker,
  seedDemoMilestone,
  useFastTimers,
  row,
  titleCell,
  fieldCell,
  colHeader,
  slideoverField,
  clickTitleToEdit,
  clickTitleToPeek,
  clickFieldToEdit,
  openSlideover,
  closeSlideover,
  refreshRow,
  pasteText,
  typeAndCommit,
  waitUntil,
  waitForFieldResolved,
  waitForTitleResolved,
  openColumnMenu,
  openFieldEditor,
  setBoundSourceAndRule,
  sortByColumn,
  getHistoryEntries,
  getHistoryEntriesFor,
  readActiveMilestoneDoc,
  writeActiveMilestoneDoc,
  readSourceViewText,
  latestFieldRef,
  latestFieldValue,
  openTrackerSwitcher,
  milestoneRow,
  mockGithubApi,
  mockGithubContentsApi,
  mockJiraProxy,
  openSettings,
  setGithubToken,
  setGithubRepoSync,
  setJiraProxyUrl,
  seedTwoIdentities,
  gotoTrackerFreshIdentity,
  DEMO_IDENTITY_EMAIL,
};
