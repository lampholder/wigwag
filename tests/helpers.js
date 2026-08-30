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
const TRACKER_PATH = '/wigwag.html';

const DEMO_MILESTONE_ID = 'demo-milestone';
const DEMO_MILESTONE_NAME = 'Delivery tracker';
const demoLines = fs.readFileSync(path.join(__dirname, 'fixtures', 'demo-milestone.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const demoFieldsLine = demoLines.find(l => l.type === 'fields');
const demoIssues = demoLines.filter(l => l.type === 'issue');
const demoDoc = {
  fieldDefs: demoFieldsLine.fields, columnOrder: demoFieldsLine.columnOrder, hiddenFieldIds: [],
  issues: demoIssues.map(iss => ({
    id: iss.id, num: iss.num, fieldRefs: iss.fieldRefs || {}, fieldLoading: {},
    values: iss.values, comments: iss.comments, history: iss.history
  })),
  githubRepo: '', githubRepoPath: 'tracker.jsonl', githubRepoBranch: ''
};

// Seeds the demo dataset (tests/fixtures/demo-milestone.jsonl -- extracted
// from what the app itself used to seed on first-ever open, before it
// switched to starting blank) as an already-bootstrapped milestone, via
// addInitScript so it exists before the app's own constructor runs on the
// next navigation. Exported separately from gotoTracker so a test that
// specifically needs a truly-unseeded first-ever-open state can navigate
// without it.
// addInitScript re-runs on EVERY navigation in this page, including a test's
// own page.reload() after making edits -- guarded the same way the app's
// own bootstrapFirstProjectIfNeeded() guards itself, so a reload doesn't
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
    githubRepo: '', githubRepoPath: 'tracker.jsonl', githubRepoBranch: '', githubTokenOverride: '', projectNotes: '', projectComments: []
  };
  await page.addInitScript(({ idA, idB, activeIdentityId, projects, blankDoc, docs }) => {
    localStorage.setItem('git_native_tracker_identities_v1', JSON.stringify({
      activeIdentityId,
      identities: [
        { id: idA, label: 'Personal', email: 'tom@personal.com', githubToken: '', jiraProxyUrl: '', signingPublicKeyJwk: null, signingPrivateKeyJwk: null },
        { id: idB, label: 'Northwind', email: 'tom@northwind.com', githubToken: '', jiraProxyUrl: '', signingPublicKeyJwk: null, signingPrivateKeyJwk: null },
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
    window.__wigwagPushDebounceMs = 300;
    // Deliberately NOT shrunk anywhere near as aggressively as the above --
    // unlike the debounce (a plain setTimeout), a poll tick is a real
    // fetch(), so a short interval keeps the network from ever going idle
    // and hangs any page.reload({waitUntil:'networkidle'}) in every test
    // that already has a repo connected (most of this spec). 5s comfortably
    // clears Playwright's 500ms idle threshold in the gaps between ticks;
    // tests that specifically exercise polling wait past it.
    window.__wigwagPollIntervalMs = 5000;
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

const SHARED_PROJECT_ID = 'shared-project';
const SHARED_PROJECT_NAME = 'Rules demo';
const SHARED_PERSONAL_IDENTITY_ID = 'personal-identity';

// Seeds a project with the demo fixture's own content (same field/issue
// shape as gotoTracker's own seed -- deliberately not a tiny hand-built
// import) but NO derived identity (identityId: null), as the active
// project -- for exercising the "Shared with you" / first-write
// attribution flow (requireAttribution, the attribution-gate UI).
// Pre-seeds IDENTITIES_KEY directly, bypassing ensureDefaultIdentityIfNeeded's
// bootstrap entirely -- that bootstrap's own retroactive identity-tagging
// treats a missing OR null identityId the same way (`m.identityId ? m :
// ...`), so it would otherwise silently stomp a null identityId back to
// non-null before a test ever got to see the "Shared with you" state.
async function gotoTrackerWithSharedProject(page) {
  await useFastTimers(page);
  await page.addInitScript(({ personalId, sharedId, sharedName, doc, email }) => {
    if (localStorage.getItem('git_native_tracker_identities_v1')) return;
    localStorage.setItem('git_native_tracker_identities_v1', JSON.stringify({
      activeIdentityId: personalId,
      identities: [{ id: personalId, label: 'Personal', email, githubToken: '', jiraProxyUrl: '', salesforceProxyUrl: '', signingPublicKeyJwk: null, signingPrivateKeyJwk: null }],
      lastActiveProjectByIdentity: {}
    }));
    localStorage.setItem('git_native_tracker_milestones_v1', JSON.stringify({
      activeMilestoneId: sharedId,
      milestones: [{ id: sharedId, name: sharedName, identityId: null }]
    }));
    localStorage.setItem('git_native_tracker_v1:' + sharedId, JSON.stringify(doc));
  }, { personalId: SHARED_PERSONAL_IDENTITY_ID, sharedId: SHARED_PROJECT_ID, sharedName: SHARED_PROJECT_NAME, doc: demoDoc, email: DEMO_IDENTITY_EMAIL });
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

// Idempotent -- the pill itself is a plain toggle (click closes it if
// already open, same as the old dropdowns it replaced), so a call site
// that isn't sure whether the switcher is already open (e.g. right after
// openImportProjectMenu, which opens it as a side effect) doesn't
// accidentally close it instead.
async function openTrackerSwitcher(page) {
  if (await page.locator('[data-testid=switcher-menu]').count()) return;
  await page.locator('[data-testid=btn-switcher]').click();
  await page.waitForTimeout(150);
}

// "New project" creates a project directly ("Untitled"/"Untitled N") in
// whichever scope the picker is currently previewing (defaults to the
// active project's own identity), with no naming step and no import
// options of its own -- those live in the picker's own "Import
// project..." footer item instead (see openImportProjectMenu below).
// Assumes the switcher is already open (openTrackerSwitcher) and, if a
// specific identity's scope matters, already selected via a
// switcher-scope-row click -- "New project" is hidden entirely while
// previewing "Shared with you" (no identity to create it under).
async function addBlankProject(page) {
  await page.locator('[data-testid=btn-switcher-new-project]').click();
  await page.waitForTimeout(400);
}

// Renames whichever project is currently active, via the real
// project-panel rename flow a user would use -- for tests that need a
// specific, distinguishable name rather than the auto "Untitled" one.
async function renameActiveProject(page, name) {
  await page.locator('[data-testid=btn-notes]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-testid=notes-rename-btn]').click();
  await page.waitForTimeout(150);
  await page.locator('[data-testid=notes-rename-input]').fill(name);
  await page.locator('[data-testid=notes-rename-commit-btn]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-testid=notes-close-btn]').click();
  await page.waitForTimeout(200);
}

async function createNamedBlankProject(page, name) {
  await addBlankProject(page);
  await renameActiveProject(page, name);
}

// The one dedicated entry point for file/paste project import -- lives in
// the unified switcher's own footer now, next to the projects it creates
// (not a standalone app-bar button). Opens the switcher itself first if
// it isn't already open.
async function openImportProjectMenu(page) {
  if (!(await page.locator('[data-testid=switcher-menu]').count())) {
    await openTrackerSwitcher(page);
  }
  await page.locator('[data-testid=btn-import-project-appbar]').click();
  await page.waitForTimeout(150);
}

function milestoneRow(page, name) {
  return page.locator('[data-testid=switcher-project-row]').filter({ hasText: name });
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

// Refreshing a single row is now: check its box, Refresh in the bulk bar
// (replacing the old per-row hover button) -- then clear the selection so
// callers see the same "nothing selected" state afterward they used to.
async function refreshRow(page, num) {
  await row(page, num).locator('[data-testid=row-select-checkbox]').click();
  await page.locator('[data-testid=bulk-refresh-btn]').click();
  await page.locator('[data-testid=bulk-clear-btn]').click();
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

// Mirrors mockJiraProxy, for the local Salesforce proxy (salesforce-proxy.js)
// -- same CORS constraint as Jira. fixtures maps record Id -> the proxy's
// normalized response shape ({id, objectType, name, status, owner, url, fields}).
async function mockSalesforceProxy(page, fixtures, proxyUrl = 'http://localhost:8936') {
  await page.route(proxyUrl + '/record/*', async (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\/record\//, ''));
    const fixture = fixtures[id];
    if (fixture) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) });
    } else {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not found' }) });
    }
  });
}

// Settings lives behind a per-identity cog in the switcher's own left
// column now (one per real identity row, none on "Shared with you") --
// this helper hides that path so every existing call site (there are
// many) keeps working unchanged. Clicks whichever cog is already
// rendered full-strength (the previewed/selected identity, which the
// switcher defaults to matching the active project's own identity), so
// this opens Settings for the identity a caller would naturally expect
// without needing to know its name. Opening always resets to the
// Identity section (see openSettingsSection below for the other three).
async function openSettings(page) {
  await openTrackerSwitcher(page);
  const activeId = await page.evaluate(() => {
    const raw = localStorage.getItem('git_native_tracker_identities_v1');
    return raw ? JSON.parse(raw).activeIdentityId : null;
  });
  const row = activeId
    ? page.locator(`[data-testid=switcher-scope-row][data-scope-id="${activeId}"]`)
    : page.locator('[data-testid=switcher-scope-row]').first();
  await row.locator('[data-testid=switcher-scope-settings-btn]').click();
  await page.waitForTimeout(150);
}

// Settings is a two-pane modal split into Identity/github/integrations
// sections -- most fields only exist in the DOM once their own section is
// selected. Opens Settings (always landing on Identity first) then, if a
// different section is requested, clicks over to it.
async function openSettingsSection(page, sectionId) {
  await openSettings(page);
  if (sectionId && sectionId !== 'identity') {
    await page.locator('[data-testid=settings-nav-item][data-section-id=' + sectionId + ']').click();
    await page.waitForTimeout(120);
  }
}

async function setGithubToken(page, token) {
  await openSettingsSection(page, 'github');
  await page.locator('[data-testid=settings-github-token]').fill(token);
  await page.mouse.click(10, 10); // outside Settings -- its full-screen backdrop closes it from anywhere
  await page.waitForTimeout(150);
}

async function openProjectPanel(page) {
  await page.locator('[data-testid=btn-notes]').click();
  await page.waitForTimeout(300);
}
async function closeProjectPanel(page) {
  await page.locator('[data-testid=notes-close-btn]').click();
  await page.waitForTimeout(200);
}

// The project panel is itself split into sections (Notes / Sync & Export /
// Danger Zone), mirroring Settings' own left-nav -- assumes the panel is
// already open (openProjectPanel). Always lands back on 'notes' the next
// time the panel opens (see toggleProjectNotes), so callers needing a
// different section must select it explicitly every time.
async function selectProjectPanelSection(page, id) {
  await page.locator(`[data-testid=project-panel-nav-item][data-section-id="${id}"]`).click();
  await page.waitForTimeout(200);
}

// Configures the tracker's own repo-sync -- repo/path/branch/token
// override live in the active PROJECT's own panel (Sync & Export section,
// per-project since a different project may sync to a different repo);
// the identity-level default token (used by any project that doesn't set
// its own override) still lives in Settings > GitHub access.
async function setGithubRepoSync(page, { repo, path, branch, token, tokenOverride } = {}) {
  if (token !== undefined) {
    await openSettingsSection(page, 'github');
    await page.locator('[data-testid=settings-github-token]').fill(token);
    await page.mouse.click(10, 10); // outside Settings -- its full-screen backdrop closes it from anywhere
    await page.waitForTimeout(150);
  }
  if (repo !== undefined || path !== undefined || branch !== undefined || tokenOverride !== undefined) {
    await openProjectPanel(page);
    await selectProjectPanelSection(page, 'sync');
    if (repo !== undefined) await page.locator('[data-testid=settings-github-repo]').fill(repo);
    if (path !== undefined) await page.locator('[data-testid=settings-github-repo-path]').fill(path);
    if (branch !== undefined) await page.locator('[data-testid=settings-github-repo-branch]').fill(branch);
    if (tokenOverride !== undefined) await page.locator('[data-testid=settings-github-token-override]').fill(tokenOverride);
    await page.waitForTimeout(150);
    await closeProjectPanel(page);
  }
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
  const state = { getCount: 0, pushCount: 0, pushes: [], getResponses: [], pushStatusOverride: null, lastAuthHeader: null };
  page.route(`https://api.github.com/repos/${repo}/contents/${path}`, async (route) => {
    const method = route.request().method();
    state.lastAuthHeader = route.request().headers()['authorization'] || null;
    if (method === 'GET') {
      const idx = Math.min(state.getCount, state.getResponses.length - 1);
      const resp = state.getResponses[idx];
      state.getCount++;
      if (!resp || resp.status === 404) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Not Found' }) });
      } else {
        // Real GitHub ETags are quoted strings, deterministic per blob --
        // derived from the same sha the app already tracks, so a test can
        // drive a real conditional-GET 304 just by repeating a getResponses
        // entry with the same sha and checking the incoming If-None-Match.
        // Access-Control-Expose-Headers is required for this to actually
        // work, not just be present on the wire -- fetch() can't read an
        // arbitrary response header cross-origin without it, a real CORS
        // restriction the app's own code has to work within too (confirmed
        // this is the real GitHub API's own behavior, not just this mock's).
        const etag = '"' + resp.sha + '"';
        const ifNoneMatch = route.request().headers()['if-none-match'];
        if (ifNoneMatch && ifNoneMatch === etag) {
          await route.fulfill({ status: 304, headers: { etag, 'access-control-expose-headers': 'ETag' } });
        } else {
          await route.fulfill({ status: 200, contentType: 'application/json', headers: { etag, 'access-control-expose-headers': 'ETag' }, body: JSON.stringify({ sha: resp.sha, content: Buffer.from(resp.text, 'utf8').toString('base64') }) });
        }
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

// Mocks the GitHub repo-metadata endpoint (GET /repos/{owner}/{repo}) that
// the Connect Remote sheet's probe (probeGithubRepoAccess) hits once per
// identity plus once anonymously, all in parallel -- so callers are told
// apart by their Authorization header (or its absence), not call order.
// `responses` maps a token string (use '' for the anonymous request) to
// {status, push}; `push` only matters for a 200 with a token (an
// unauthenticated 200 never carries a permissions object, matching the
// real API). A token with no entry in `responses` gets a 404, matching a
// private/nonexistent repo. Returns the list of tokens actually seen, in
// request order, for tests that care which identities were probed.
function mockGithubRepoAccessApi(page, owner, repo, responses) {
  const calls = [];
  page.route(`https://api.github.com/repos/${owner}/${repo}`, async (route) => {
    const auth = route.request().headers()['authorization'] || '';
    const token = auth.replace(/^Bearer /, '');
    calls.push(token);
    const resp = responses[token];
    if (!resp || resp.status === 404) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Not Found' }) });
    } else if (resp.status === 401) {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'Bad credentials' }) });
    } else {
      const body = token ? { permissions: { push: !!resp.push } } : {};
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    }
  });
  return calls;
}

async function setJiraProxyUrl(page, url) {
  await openSettingsSection(page, 'integrations');
  await page.locator('[data-testid=settings-jira-proxy-url]').fill(url);
  await page.mouse.click(10, 10); // outside Settings -- its full-screen backdrop closes it from anywhere
  await page.waitForTimeout(150);
}

async function setSalesforceProxyUrl(page, url) {
  await openSettingsSection(page, 'integrations');
  await page.locator('[data-testid=settings-salesforce-proxy-url]').fill(url);
  await page.mouse.click(10, 10);
  await page.waitForTimeout(150);
}

async function pasteText(page, text) {
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
  await page.keyboard.press('Control+A'); // replace any pre-filled value, don't paste-append at the cursor
  await page.keyboard.press('Control+KeyV');
}

// Commits via Tab (which blurs), not Enter -- blur already commits every
// field type regardless of which key triggered it, but Enter itself no
// longer does for a multiline markdown 'text' field (it inserts a
// newline instead), so Tab is the one commit signal that works
// universally across every field type this helper is used against.
async function typeAndCommit(page, text) {
  await page.keyboard.press('Control+A');
  if (text) await page.keyboard.type(text);
  else await page.keyboard.press('Delete');
  await page.keyboard.press('Tab');
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
// "Issue" for Title or "Related" for the 'linked' field) and rule text.
// Binding a source opens straight into the rule-builder panel's row
// editor (not advanced mode) -- "Edit directly" switches to the raw
// expression textarea, which is what this helper always wants since it's
// given a hand-written expression string. Assumes the field editor is
// already open (see openFieldEditor). Closes the rule-builder panel
// itself before returning -- unlike the old inline textarea (a small
// centered modal a caller could dismiss with a tuned "click elsewhere"
// coordinate), this panel is full-height and 1040px wide, so an arbitrary
// outside-click coordinate a caller might use is liable to land ON the
// panel instead of its overlay.
async function setBoundSourceAndRule(page, sourceLabel, ruleText) {
  await page.locator('[data-testid=field-editor-source-select]').selectOption({ label: sourceLabel });
  await page.waitForTimeout(150);
  await page.locator('[data-testid=field-editor-open-rules]').click();
  await page.waitForTimeout(400);
  if (await page.locator('[data-testid=rule-edit-expression]').count()) {
    await page.locator('[data-testid=rule-edit-expression]').click();
    await page.waitForTimeout(150);
  }
  const textarea = page.locator('[data-testid=rule-advanced-textarea]');
  await textarea.click();
  await textarea.fill(ruleText);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  await page.locator('[data-testid=rule-builder] >> text=✕').first().click();
  await page.waitForTimeout(400);
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
  DEMO_MILESTONE_NAME,
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
  addBlankProject,
  renameActiveProject,
  createNamedBlankProject,
  openImportProjectMenu,
  milestoneRow,
  mockGithubApi,
  mockGithubContentsApi,
  mockGithubRepoAccessApi,
  mockJiraProxy,
  mockSalesforceProxy,
  openSettings,
  openSettingsSection,
  openProjectPanel,
  closeProjectPanel,
  selectProjectPanelSection,
  setGithubToken,
  setGithubRepoSync,
  setJiraProxyUrl,
  setSalesforceProxyUrl,
  seedTwoIdentities,
  gotoTrackerFreshIdentity,
  DEMO_IDENTITY_EMAIL,
  gotoTrackerWithSharedProject,
  SHARED_PROJECT_ID,
  SHARED_PROJECT_NAME,
  SHARED_PERSONAL_IDENTITY_ID,
  demoDoc,
};
