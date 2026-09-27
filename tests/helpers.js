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
// that isn't sure whether the switcher is already open doesn't
// accidentally close it instead.
async function openTrackerSwitcher(page) {
  if (await page.locator('[data-testid=switcher-menu]').count()) return;
  await page.locator('[data-testid=btn-switcher]').click();
  await page.waitForTimeout(150);
}

// "New project" creates a project directly ("Untitled"/"Untitled N") in
// whichever scope the picker is currently previewing (defaults to the
// active project's own identity), with no naming step -- project
// import/receive lives in the header's own Receive button instead
// (tracker #143, dfb378b2), not in this picker at all.
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

function milestoneRow(page, name) {
  return page.locator('[data-testid=switcher-project-row]').filter({ hasText: name });
}

// .last() matters only when column freezing (tracker #97 round 5) is
// active: frozen columns are then duplicate-rendered into a second,
// non-scrolling overlay pane that comes after the real table in DOM
// order, so a bare match would be ambiguous (strict-mode violation) and
// an unqualified .first() would resolve to the real pane's copy, which
// can be visually covered by the overlay and fail actionability checks.
// .last() reliably picks whichever copy is actually on-screen and
// interactive -- the overlay's when it exists, the only copy otherwise --
// with no behavior change for the overwhelming majority of tests that
// never freeze anything (there's only ever one match then).
function row(page, num) {
  return page.locator(`[data-testid=row][data-row-num="${num}"]`).last();
}

function titleCell(page, num) {
  return row(page, num).locator('[data-testid=title-cell]');
}

function fieldCell(page, num, colId) {
  return row(page, num).locator(`[data-testid=field-cell][data-col="${colId}"]`);
}

function colHeader(page, colId) {
  return page.locator(`[data-testid=col-header][data-col="${colId}"]`).last();
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

// Mocks the Git-backed sync endpoints the repo-sync feature itself talks
// to for one repo/path -- separate from mockGithubApi above, which fakes
// the unrelated per-field issue-link endpoints.
//
// Rewritten (tracker f6b39bf0, live-reported): the old implementation
// mocked only a single GET/PUT to the Contents API's own contents/{path}
// endpoint, matching pullGithubFile/pushGithubFile's OLD implementation --
// but GitHub's Contents API caps inline base64 content at 1MB, silently
// (200, content:"", encoding:"none", no error) past that size, which the
// old code read as "this file is empty". The fix moves reads onto
// Accept: raw (still contents/{path}, just a different Accept header, no
// size cap) and writes onto the Git Data API's own multi-step blob ->
// tree -> commit -> ref sequence (also uncapped). This mock now covers
// all of that, while keeping the exact same test-facing state shape
// (getResponses/pushes/pushCount/pushStatusOverride/lastAuthHeader/
// getCount) so every existing call site needs no changes beyond the shape
// of what a single push's own content actually looks like now (see
// state.pushes below).
function mockGithubContentsApi(page, repo, path = 'tracker.jsonl') {
  const state = { getCount: 0, pushCount: 0, pushes: [], getResponses: [], pushStatusOverride: null, lastAuthHeader: null };
  let commitSha = 'initial-commit-sha';
  let treeSha = 'initial-tree-sha';
  const repoEscaped = repo.replace(/\//g, '\\/');
  const track = (route) => { state.lastAuthHeader = route.request().headers()['authorization'] || null; };

  const currentGetResponse = () => state.getResponses[Math.min(state.getCount, state.getResponses.length - 1)];

  // pushGithubFile's own conflict check re-requests this same contents
  // endpoint with a resolved branch's `?ref=` query string attached (real
  // GitHub behavior, needed to check the right branch) -- a bare-string
  // route pattern doesn't match that suffix at all, so an unmatched
  // request silently escapes to the real, unmocked github.com and comes
  // back with a genuine 401 (fake token), which the app retries in a
  // tight loop with no backoff, hanging any networkidle wait forever.
  // Confirmed live via an ad-hoc reproduction script before this fix.
  page.route(new RegExp('^https://api\\.github\\.com/repos/' + repoEscaped + '/contents/' + path.replace(/\./g, '\\.') + '(\\?.*)?$'), async (route) => {
    track(route);
    if (route.request().method() !== 'GET') { await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }); return; }
    // Two genuinely different callers hit this same URL+method, exactly
    // like real GitHub: pullGithubFile's own real pull (Accept: raw, no
    // size cap, advances the getResponses script) and both
    // pushGithubFile's conflict check and the standalone "Connect a
    // remote" one-off fetch (Accept: json) -- real GitHub returns the
    // same {sha, content, encoding} shape for those either way, so this
    // mock does too; a conflict check only ever reads .sha off it.
    const wantsRaw = (route.request().headers()['accept'] || '').includes('raw');
    const resp = currentGetResponse();
    if (wantsRaw) state.getCount++;
    if (!resp || resp.status === 404) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Not Found' }) });
      return;
    }
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
    if (!wantsRaw) {
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { etag, 'access-control-expose-headers': 'ETag' }, body: JSON.stringify({ sha: resp.sha, content: Buffer.from(resp.text, 'utf8').toString('base64'), encoding: 'base64' }) });
      return;
    }
    const ifNoneMatch = route.request().headers()['if-none-match'];
    if (ifNoneMatch && ifNoneMatch === etag) {
      await route.fulfill({ status: 304, headers: { etag, 'access-control-expose-headers': 'ETag' } });
    } else {
      await route.fulfill({ status: 200, contentType: 'text/plain', headers: { etag, 'access-control-expose-headers': 'ETag' }, body: resp.text });
    }
  });

  page.route(`https://api.github.com/repos/${repo}`, async (route) => {
    // The exact same bare repo:// URL is also what mockGithubRepoAccessApi
    // mocks, for a genuinely different caller (probeGithubRepoAccess's
    // access-level probe) -- a test using both (any "Connect a remote"
    // test) registers that route first, so ours (registered later) would
    // otherwise always win and silently break the probe. The two callers
    // ARE distinguishable on the wire: pushGithubFile's own default-branch
    // lookup always sends Content-Type: application/json (it reuses the
    // same header set as its POST/PATCH calls); probeGithubRepoAccess
    // never sends a Content-Type at all. Fall back to whatever route was
    // registered before this one for anything that isn't ours to answer.
    if (route.request().method() !== 'GET' || !route.request().headers()['content-type']) { await route.fallback(); return; }
    track(route);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ default_branch: 'main' }) });
  });

  page.route(new RegExp('^https://api\\.github\\.com/repos/' + repoEscaped + '/commits/'), async (route) => {
    track(route);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha: commitSha, commit: { tree: { sha: treeSha } } }) });
  });

  page.route(`https://api.github.com/repos/${repo}/git/blobs`, async (route) => {
    track(route);
    const body = JSON.parse(route.request().postData());
    state.pushCount++;
    state.pushes.push(body.content); // real utf-8 text now, not a base64-wrapped PUT body -- see the call sites reading this
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ sha: 'blob-after-push-' + state.pushCount }) });
  });

  page.route(`https://api.github.com/repos/${repo}/git/trees`, async (route) => {
    track(route);
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ sha: 'tree-after-push-' + state.pushCount }) });
  });

  page.route(`https://api.github.com/repos/${repo}/git/commits`, async (route) => {
    track(route);
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ sha: 'commit-after-push-' + state.pushCount }) });
  });

  const finishRef = async (route) => {
    track(route);
    if (state.pushStatusOverride && state.pushCount === state.pushStatusOverride.onCall) {
      await route.fulfill({ status: state.pushStatusOverride.status, contentType: 'application/json', body: '{}' });
      return;
    }
    commitSha = 'commit-after-push-' + state.pushCount;
    treeSha = 'tree-after-push-' + state.pushCount;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha: 'sha-after-push-' + state.pushCount }) });
  };
  page.route(new RegExp('^https://api\\.github\\.com/repos/' + repoEscaped + '/git/refs/heads/'), finishRef);
  page.route(`https://api.github.com/repos/${repo}/git/refs`, finishRef);

  return state;
}

// Mocks the Matrix Client-Server API endpoints wigwag-matrix-host.html's
// standalone transport hits (see wigwag-core.js's resolveMatrixRoomAlias/
// fetchMatrixRoomEntries/sendMatrixEntry/probeMatrixRoomAccess). One
// mocked room per call, matching mockGithubContentsApi's per-repo shape.
//
// `initialEntries` seeds what the FIRST /messages fetch (the startup pull,
// dir=b) returns; every subsequent /messages call (the periodic poll,
// dir=f) returns state.pendingEntries and then clears it -- a test drives
// "a new remote change arrives" by pushing onto state.pendingEntries and
// waiting for the next poll tick, the same "script future calls" idea
// mockGithubContentsApi's getResponses queue uses, just append-only here
// since Matrix's timeline has no equivalent of a single mutable sha.
// `roomName` seeds the best-effort room-name fetch; omit it to simulate a
// room with no name set (the host falls back to a placeholder). Set
// `accessDenied: true` to make every request 403, for testing the
// no-access path without needing a second mocked room. `projectCreationForbidden`
// simulates a non-moderator's power level being too low for the
// dev.wigwag.project state write (tracker f6b39bf0) -- a real 403, same
// shape putMatrixEvent already treats as 'forbidden' for any other event
// type. `messagesReturnsProjectStateEvents` (default true) controls
// whether the /messages timeline mock includes dev.wigwag.project
// occurrences alongside ordinary entries -- set to false to test that
// getMatrixRoomState's real current-state fetch (not timeline scanning)
// is what actually finds a project, independent of how much (or how
// little) of the timeline a given pull happens to reach. `rejectUploadTimes`
// (default 0) makes the media upload endpoint fail N times before
// succeeding (a real M_TOO_LARGE-shaped 413) -- for testing the
// graceful-skip-this-snapshot path; pass Infinity to simulate a snapshot
// that can never be written at all. `seedMediaBlobs` ([{mxc, bytes}])
// pre-populates the media store BEFORE the page ever connects, so a
// manifest event placed in `initialEntries` (simulating "this snapshot
// already existed before this test's own session") can actually resolve
// against a real, already-known mxc -- see tests/matrix-host.spec.js's
// own snapshotEvent() helper.
function mockMatrixClientApi(page, { homeserverUrl, roomId, initialEntries = [], roomName, accessDenied = false, whoamiFails = false, messagesPageSize = null, projectCreationForbidden = false, messagesReturnsProjectStateEvents = true, rejectUploadTimes = 0, seedMediaBlobs = [] } = {}) {
  const state = { sentEntries: [], messagesCallCount: 0, pendingEntries: [] };
  const base = homeserverUrl.replace(/\/$/, '');
  const roomPath = base + '/_matrix/client/v3/rooms/' + encodeURIComponent(roomId);
  // Real Matrix /messages only ever returns one page per call -- this mock
  // used to hand back the WHOLE of initialEntries on the very first call
  // regardless of size, which meant no test here could ever have caught
  // the live-reported bug (Tom, tracker f6b39bf0) where pullInitial only
  // pulling one page missed an entire project's worth of older history.
  // messagesPageSize, when set, actually simulates paging: initialEntries
  // is served messagesPageSize-at-a-time across successive calls, an
  // empty chunk once exhausted, before falling through to pendingEntries
  // for anything added "live" afterward (unchanged from before).
  let remainingInitial = initialEntries.slice();

  page.route(roomPath + '/messages*', async (route) => {
    if (accessDenied) { await route.fulfill({ status: 403, contentType: 'application/json', body: '{}' }); return; }
    // probeMatrixRoomAccess's own limit=0 check must never advance the
    // "which fetch is this" counter below -- it's a separate, repeatable
    // read, not a step in the real pull/poll sequence.
    const isProbe = new URL(route.request().url()).searchParams.get('limit') === '0';
    if (isProbe) { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ chunk: [] }) }); return; }
    state.messagesCallCount++;
    let chunk;
    if (messagesPageSize && remainingInitial.length > 0) {
      chunk = remainingInitial.splice(0, messagesPageSize);
    } else if (messagesPageSize) {
      // Initial pages fully exhausted -- behave like the plain (live-poll)
      // path from here on, same as the non-paginated branch below.
      chunk = state.pendingEntries.splice(0, state.pendingEntries.length);
    } else {
      chunk = state.messagesCallCount === 1 ? initialEntries : state.pendingEntries.splice(0, state.pendingEntries.length);
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ chunk, end: 'cursor-' + state.messagesCallCount }) });
  });

  page.route(roomPath + '/state/m.room.name', async (route) => {
    if (accessDenied || roomName === undefined) { await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }); return; }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: roomName }) });
  });

  page.route(roomPath + '/send/dev.wigwag.entry/*', async (route) => {
    const content = JSON.parse(route.request().postData());
    state.sentEntries.push(content);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ event_id: '$evt' + state.sentEntries.length }) });
  });

  // Bulk-transport optimization (tracker #149): a batch event carries
  // several entries at once. Unpacked back into state.sentEntries as
  // individual items so existing/new test assertions never need to know
  // whether a given entry arrived via a single-entry or batch send.
  page.route(roomPath + '/send/dev.wigwag.entries/*', async (route) => {
    const content = JSON.parse(route.request().postData());
    for (const item of (content.items || [])) state.sentEntries.push(item);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ event_id: '$evt' + state.sentEntries.length }) });
  });

  // Room snapshot (tracker f6b39bf0/#153, f1c7098f/#154): a media-blob
  // snapshot, not chunked events -- the manifest event gets recorded AND
  // fed back into pendingEntries (so a later connect() in the same test,
  // a "second session"/reconnect scenario, can actually discover and
  // resolve what got sent, the same way a real room would hand it back on
  // the next pull); the encrypted blob itself lives in a separate,
  // real-media-repo-shaped store, keyed by a generated mxc:// URI.
  state.sentSnapshotManifests = [];
  page.route(roomPath + '/send/dev.wigwag.snapshot/*', async (route) => {
    const content = JSON.parse(route.request().postData());
    state.sentSnapshotManifests.push(content);
    state.pendingEntries.push({ type: 'dev.wigwag.snapshot', content });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ event_id: '$snap' + state.sentSnapshotManifests.length }) });
  });
  // Media repo (tracker f6b39bf0's media-blob snapshot rework) -- upload
  // stays on the plain, still-current /_matrix/media/v3/upload; download
  // uses the newer authenticated /_matrix/client/v1/media/* endpoint
  // (MSC3916), matching core.uploadMatrixMedia/downloadMatrixMedia's own
  // endpoint choice exactly. `rejectUploadTimes` simulates a real 429
  // (M_LIMIT_EXCEEDED) N times before succeeding -- exercises
  // uploadMatrixMedia's shared fetchWithMatrixRetry429 mechanics, the
  // actual rate-limit scenario this whole rework fixes; pass a huge
  // number to simulate an upload that never succeeds at all.
  state.uploadedSnapshotBlobs = []; // [{mxc, bytes}], in upload order
  let uploadRejectRemaining = rejectUploadTimes;
  const mediaStore = new Map(); // mediaId -> Buffer
  for (const { mxc, bytes } of seedMediaBlobs) {
    mediaStore.set(mxc.split('/').pop(), Buffer.from(bytes));
  }
  page.route(base + '/_matrix/media/v3/upload*', async (route) => {
    if (uploadRejectRemaining > 0) { uploadRejectRemaining--; await route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ errcode: 'M_LIMIT_EXCEEDED', retry_after_ms: 5 }) }); return; }
    const bytes = route.request().postDataBuffer();
    const mediaId = 'media' + (state.uploadedSnapshotBlobs.length + 1);
    mediaStore.set(mediaId, bytes);
    const mxc = 'mxc://example.org/' + mediaId;
    state.uploadedSnapshotBlobs.push({ mxc, bytes });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content_uri: mxc }) });
  });
  page.route(base + '/_matrix/client/v1/media/download/example.org/*', async (route) => {
    const mediaId = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop());
    const bytes = mediaStore.get(mediaId);
    if (!bytes) { await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }); return; }
    await route.fulfill({ status: 200, contentType: 'application/octet-stream', body: bytes });
  });

  // Project index (tracker f6b39bf0, live-reported rate-limit incident) --
  // a real Matrix STATE event: PUT to /state/dev.wigwag.project/{projectId}
  // (createProject), GET /state for the reliable, always-current fetch
  // (getProjectIndex) that discoverProjects unions with its own timeline
  // scan. A live-created one also rides the ordinary /messages stream
  // (state events are timeline events too) unless
  // messagesReturnsProjectStateEvents is false, for testing that the real
  // current-state fetch -- not timeline depth -- is what actually finds it.
  state.sentProjectStateEvents = [];
  const projectStateEventsByKey = new Map(); // projectId -> content
  page.route(roomPath + '/state/dev.wigwag.project/*', async (route) => {
    if (projectCreationForbidden) { await route.fulfill({ status: 403, contentType: 'application/json', body: '{}' }); return; }
    const url = new URL(route.request().url());
    const projectId = decodeURIComponent(url.pathname.split('/').pop());
    const content = JSON.parse(route.request().postData());
    projectStateEventsByKey.set(projectId, content);
    state.sentProjectStateEvents.push({ projectId, content });
    if (messagesReturnsProjectStateEvents) state.pendingEntries.push({ type: 'dev.wigwag.project', state_key: projectId, content });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ event_id: '$projstate' + state.sentProjectStateEvents.length }) });
  });
  page.route(roomPath + '/state', async (route) => {
    if (accessDenied) { await route.fulfill({ status: 403, contentType: 'application/json', body: '{}' }); return; }
    const events = [...projectStateEventsByKey.entries()].map(([projectId, content]) => ({ type: 'dev.wigwag.project', state_key: projectId, content }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(events) });
  });

  page.route(base + '/_matrix/client/v3/directory/room/*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ room_id: roomId }) });
  });

  // whoamiFails is independent of accessDenied -- a token can legitimately
  // read/write room messages (probe succeeds) while lacking permission for
  // (or hitting a flaky) /account/whoami specifically. Exercises the
  // "resolvable-room, unresolvable-identity" path on its own.
  page.route(base + '/_matrix/client/v3/account/whoami', async (route) => {
    if (accessDenied || whoamiFails) { await route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }); return; }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user_id: '@test-user:example.org' }) });
  });

  return state;
}

// Navigates to tests/fixtures/fake-widget-host.html, a disposable stand-in
// for a real Matrix client's widget host, which iframes
// wigwag-matrix-host.html?widgetId=... itself and answers its Widget API
// postMessage requests (see that fixture file for the protocol handling).
// Returns nothing to poll for state -- read `window.__state` on the
// returned page directly (`page.evaluate(() => window.__state)`), and reach
// the tracker UI itself via page.frameLocator('#widget').frameLocator('#frame').
async function gotoFakeWidgetHost(page, { roomId, userId, displayName, roomName, initialEntries, rejectReadEventsTimes, dropReadEventsTimes, forbidStateEventType, rejectUploadTimes, seedMediaBlobs } = {}) {
  await page.addInitScript((cfg) => { window.__fakeHostConfig = cfg; }, { roomId, userId, displayName, roomName, initialEntries, rejectReadEventsTimes, dropReadEventsTimes, forbidStateEventType, rejectUploadTimes, seedMediaBlobs });
  await page.goto('/tests/fixtures/fake-widget-host.html');
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

// Title's own "..." menu (Sort ascending/descending, Freeze up to here,
// Wrap text) -- tracker #92 consolidated what used to be three
// always-visible inline icons into this single menu, matching every field
// column's own convention.
async function openTitleMenu(page) {
  await page.locator('[data-testid=title-menu-trigger]').last().click();
  await page.waitForTimeout(150);
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
  openTitleMenu,
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
  milestoneRow,
  mockGithubApi,
  mockGithubContentsApi,
  mockGithubRepoAccessApi,
  mockMatrixClientApi,
  gotoFakeWidgetHost,
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
