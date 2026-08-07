// Shared helpers for the tracker's Playwright test suite. The app has no
// build step and no client-side router — every test just navigates to the
// bundled HTML file fresh, which resets to the seed demo data because each
// Playwright test gets an isolated browser context (fresh localStorage).
const TRACKER_PATH = '/Git-native%20Project%20Tracker.html';

async function gotoTracker(page) {
  await page.goto(TRACKER_PATH, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300); // initial render settle
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
  await row(page, num).locator('[data-testid=row-chevron]').click();
  await page.locator('[data-testid=row-menu-open]').click();
  await page.waitForTimeout(200);
  return page.locator('[data-testid=slideover]');
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

async function openSettings(page) {
  await page.locator('[data-testid=btn-settings]').click();
  await page.waitForTimeout(150);
}

async function setGithubToken(page, token) {
  await openSettings(page);
  await page.locator('[data-testid=settings-github-token]').fill(token);
  await page.mouse.click(700, 700);
  await page.waitForTimeout(150);
}

async function setJiraProxyUrl(page, url) {
  await openSettings(page);
  await page.locator('[data-testid=settings-jira-proxy-url]').fill(url);
  await page.mouse.click(700, 700);
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
    const d = JSON.parse(localStorage.getItem('git_native_tracker_v1'));
    const iss = d.issues.find(i => i.id === issueId);
    return iss ? iss.history.map(h => h.text) : [];
  }, issueId);
}

module.exports = {
  TRACKER_PATH,
  gotoTracker,
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
  mockGithubApi,
  mockJiraProxy,
  openSettings,
  setGithubToken,
  setJiraProxyUrl,
};
