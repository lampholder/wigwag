// Tracker #144 (e9d61424, new_bits.zip Part C): a global Ctrl+K/Cmd+K
// search across every project in this browser -- id or title, opens the
// project switcher and Send menu it might interrupt, and reuses the
// existing deep-link path (resolveDeepLinkFromHash) to land cross-project
// opens. Supersedes the desktop filter box's own id-jump behavior (see
// tests/id-jump.spec.js's header comment) and the switcher's own
// "Search projects" box, both removed as part of this same change.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

async function openGlobalSearch(page) {
  await page.locator('[data-testid=btn-global-search]').click();
  await page.waitForTimeout(150);
}

test.describe('Global search: entry points', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('the top-bar button opens it, autofocused, and its title names the shortcut', async ({ page }) => {
    await expect(page.locator('[data-testid=btn-global-search]')).toHaveAttribute('title', /Search all projects/);
    await openGlobalSearch(page);
    await expect(page.locator('[data-testid=global-search-overlay]')).toBeVisible();
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid'));
    expect(focused).toBe('global-search-input');
  });

  test('the panel itself shows the Ctrl/Cmd+K shortcut hint (the redundant "esc" keycap was removed as confusing alongside it)', async ({ page }) => {
    await openGlobalSearch(page);
    await expect(page.locator('[data-testid=global-search-shortcut-hint]')).toHaveText(/Ctrl K|⌘K/);
    await expect(page.locator('[data-testid=global-search-panel]').getByText('esc', { exact: true })).toHaveCount(0);
  });

  test('Ctrl+K opens it even while typing in the filter box, and toggles closed on a second press', async ({ page }) => {
    await page.locator('[data-testid=filter-input]').click();
    await page.locator('[data-testid=filter-input]').fill('something');
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=global-search-overlay]')).toBeVisible();
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=global-search-overlay]')).toHaveCount(0);
  });

  test('opening it closes the project switcher', async ({ page }) => {
    await h.openTrackerSwitcher(page);
    await expect(page.locator('[data-testid=switcher-menu]')).toBeVisible();
    await openGlobalSearch(page);
    await expect(page.locator('[data-testid=switcher-menu]')).toHaveCount(0);
    await expect(page.locator('[data-testid=global-search-overlay]')).toBeVisible();
  });

  test('Escape closes it, ahead of any other Escape handling', async ({ page }) => {
    await openGlobalSearch(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=global-search-overlay]')).toHaveCount(0);
  });

  test('clicking the backdrop closes it, clicking inside the panel does not', async ({ page }) => {
    await openGlobalSearch(page);
    await page.locator('[data-testid=global-search-panel]').click();
    await page.waitForTimeout(100);
    await expect(page.locator('[data-testid=global-search-overlay]')).toBeVisible();
    await page.locator('[data-testid=global-search-overlay]').click({ position: { x: 5, y: 5 } });
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=global-search-overlay]')).toHaveCount(0);
  });
});

test.describe('Global search: matching and results', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('empty query shows the "type an id or title" hint, not a result list', async ({ page }) => {
    await openGlobalSearch(page);
    await expect(page.locator('[data-testid=global-search-result]')).toHaveCount(0);
    await expect(page.locator('[data-testid=global-search-results]')).toContainText('Type an issue or project id');
  });

  test('a title query under 2 characters finds nothing (matches the "nothing matches" empty state)', async ({ page }) => {
    await openGlobalSearch(page);
    await page.locator('[data-testid=global-search-input]').fill('a');
    await page.waitForTimeout(250);
    await expect(page.locator('[data-testid=global-search-result]')).toHaveCount(0);
    await expect(page.locator('[data-testid=global-search-results]')).toContainText('Nothing matches');
  });

  test('a title match highlights the matched substring and shows the project name', async ({ page }) => {
    await openGlobalSearch(page);
    await page.locator('[data-testid=global-search-input]').fill('sidebar');
    await page.waitForTimeout(250);
    const result = page.locator('[data-testid=global-search-result]');
    await expect(result).toHaveCount(1);
    await expect(result).toContainText('Sidebar sizing');
    await expect(result).toContainText('Delivery tracker');
    const html = await result.innerHTML();
    expect(html).toContain('--c4'); // the highlight fill token, same as the table filter's own match highlighting
  });

  test('an id-prefix query (>=2 hex/dash chars, optional leading #) matches by prefix, not substring', async ({ page }) => {
    // The demo fixture's own issue ids ("i1", "i2"...) aren't hex-shaped,
    // so they can never exercise the id-match branch -- seed one with a
    // real hex-dash id, same style tracker #62's own id-jump tests used.
    const doc = await h.readActiveMilestoneDoc(page);
    const hexId = 'deadbee0-1111-2222-3333-444455556666';
    doc.issues.push({
      id: hexId, num: (doc.issues.reduce((m, i) => Math.max(m, i.num || 0), 0)) + 1, fieldRefs: {}, fieldLoading: {},
      values: { title: 'Hex id fixture', type: 'chore', priority: 'p2', rag: null, teams: [], mitigation: '', linked: '' },
      commentStreams: {},
      history: [{ time: 'Aug 1', actor: 'tom', text: 'Created', sortKey: 1 }]
    });
    await h.writeActiveMilestoneDoc(page, doc);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    await openGlobalSearch(page);
    await page.locator('[data-testid=global-search-input]').fill('#deadbee0');
    await page.waitForTimeout(250);
    await expect(page.locator('[data-testid=global-search-result]')).toHaveCount(1);
    await expect(page.locator('[data-testid=global-search-result]')).toContainText('Hex id fixture');

    await page.locator('[data-testid=global-search-input]').fill('#eadbee0'); // interior slice, not a prefix
    await page.waitForTimeout(250);
    await expect(page.locator('[data-testid=global-search-result]')).toHaveCount(0);
  });

  test('results are capped and sorted: current project before others at equal score', async ({ page }) => {
    // "field" appears in more than one demo title -- just confirm the
    // list never exceeds the documented cap of 30 regardless of query.
    await openGlobalSearch(page);
    await page.locator('[data-testid=global-search-input]').fill('e');
    await page.waitForTimeout(250);
    const count = await page.locator('[data-testid=global-search-result]').count();
    expect(count).toBeLessThanOrEqual(30);
  });

  test('ArrowDown/ArrowUp move the active row, and only the active row shows the enter keycap', async ({ page }) => {
    await openGlobalSearch(page);
    await page.locator('[data-testid=global-search-input]').fill('es'); // matches several demo titles
    await page.waitForTimeout(250);
    const rows = page.locator('[data-testid=global-search-result]');
    const count = await rows.count();
    expect(count).toBeGreaterThan(1);

    const activeBg = async (i) => rows.nth(i).evaluate(el => getComputedStyle(el).backgroundColor);
    const bg0Before = await activeBg(0);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    expect(await activeBg(0)).not.toBe(bg0Before);
    expect(await activeBg(1)).toBe(bg0Before);
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(100);
    expect(await activeBg(0)).toBe(bg0Before);
  });

  test('hovering a row makes it active', async ({ page }) => {
    await openGlobalSearch(page);
    await page.locator('[data-testid=global-search-input]').fill('es');
    await page.waitForTimeout(250);
    const rows = page.locator('[data-testid=global-search-result]');
    expect(await rows.count()).toBeGreaterThan(1);
    const bg1Before = await rows.nth(1).evaluate(el => getComputedStyle(el).backgroundColor);
    await rows.nth(1).hover();
    await page.waitForTimeout(100);
    expect(await rows.nth(1).evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(bg1Before);
  });
});

test.describe('Global search: opening a result', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('Enter opens the active result in the current project, closing the panel', async ({ page }) => {
    await openGlobalSearch(page);
    await page.locator('[data-testid=global-search-input]').fill('sidebar');
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=global-search-overlay]')).toHaveCount(0);
    await expect(page.locator('[data-testid=slideover]')).toBeVisible();
    await expect(page.locator('[data-testid=slideover]')).toContainText('Sidebar sizing');
  });

  test('clicking a result opens it too, same as Enter', async ({ page }) => {
    await openGlobalSearch(page);
    await page.locator('[data-testid=global-search-input]').fill('sidebar');
    await page.waitForTimeout(250);
    await page.locator('[data-testid=global-search-result]').first().click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=global-search-overlay]')).toHaveCount(0);
    await expect(page.locator('[data-testid=slideover]')).toBeVisible();
  });

  test('an issue in a different project switches projects and opens it there, reusing the deep-link path', async ({ page }) => {
    await h.openTrackerSwitcher(page);
    await h.createNamedBlankProject(page, 'Other Project XYZ');
    await page.waitForTimeout(300);
    await page.keyboard.down('Control'); await page.keyboard.press('Space'); await page.keyboard.up('Control');
    await page.waitForTimeout(150);
    await page.keyboard.type('Findable cross-project issue');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');

    await h.openTrackerSwitcher(page);
    await h.milestoneRow(page, 'Delivery tracker').click();
    await page.waitForTimeout(300);

    await openGlobalSearch(page);
    await page.locator('[data-testid=global-search-input]').fill('findable');
    await page.waitForTimeout(250);
    await expect(page.locator('[data-testid=global-search-result]')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText('Other Project XYZ');
    await expect(page.locator('[data-testid=slideover]')).toBeVisible();
    await expect(page.locator('[data-testid=slideover]')).toContainText('Findable cross-project issue');
  });

  test('a project-level result (matched by name or id, no issue) switches to it without opening a slide-over', async ({ page }) => {
    await h.openTrackerSwitcher(page);
    await h.createNamedBlankProject(page, 'Zzz Other Project');
    await page.waitForTimeout(300);
    await h.openTrackerSwitcher(page);
    await h.milestoneRow(page, 'Delivery tracker').click();
    await page.waitForTimeout(300);

    await openGlobalSearch(page);
    await page.locator('[data-testid=global-search-input]').fill('zzz other');
    await page.waitForTimeout(250);
    await expect(page.locator('[data-testid=global-search-result]')).toHaveCount(1);
    await expect(page.locator('[data-testid=global-search-result]')).toContainText('Project'); // meta column reads "Project" for a project-level row
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText('Zzz Other Project');
    await expect(page.locator('[data-testid=slideover]')).toHaveCount(0);
  });
});

test.describe('Global search: replaced desktop id-jump and switcher search', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('the desktop filter box no longer id-jumps: placeholder is keyword-only, and no jump panel ever appears', async ({ page }) => {
    const doc = await h.readActiveMilestoneDoc(page);
    await expect(page.locator('[data-testid=filter-input]')).toHaveAttribute('placeholder', 'Filter this project');
    await page.locator('[data-testid=filter-input]').fill(doc.issues[0].id);
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=jump-panel]')).toHaveCount(0);
    await expect(page.locator('[data-testid=filter-input-wrap]')).toHaveAttribute('aria-expanded', 'false');
  });

  test('the project switcher no longer has its own "Search projects" box', async ({ page }) => {
    await h.openTrackerSwitcher(page);
    await expect(page.locator('[data-testid=switcher-search-input]')).toHaveCount(0);
  });

});

test.describe('Global search: typing stays responsive on a large project (live report)', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  // Live report: typing in the search box felt sluggish, keystrokes not
  // registering immediately. Root cause was systemic, not search-specific
  // (any setState re-renders the whole table -- see tracker #146,
  // 70a52f00) but the search box's own fix is twofold: (1) debounce the
  // setState the box's onChange triggers, so a fast burst of typing pays
  // for one expensive render instead of one per keystroke, and (2) the
  // input itself is now uncontrolled (no reactive value= binding) --
  // debouncing alone still let an eventual re-render's value= write race
  // against in-flight native keystrokes and silently drop characters, since
  // this app's "on change" binding re-asserts the bound value right after
  // invoking the handler. A fresh, empty DOM node every time the panel
  // opens (confirmed: it's fully unmounted/remounted via sc-if, not just
  // hidden) makes an uncontrolled input safe here with no reset logic
  // needed. Enter must still act on what's actually typed, not a value
  // debounced state hasn't caught up to yet -- that's _gsPendingQuery,
  // exercised directly by the last test below.
  test('rapid typing is never dropped or reordered, even mid-debounce', async ({ page }) => {
    await page.locator('[data-testid=btn-global-search]').click();
    await page.waitForTimeout(150);
    const input = page.locator('[data-testid=global-search-input]');
    for (const ch of 'sidebar sizing') await input.press(ch);
    await expect(input).toHaveValue('sidebar sizing');
  });

  test('a keystroke commits within one debounce window, not immediately (proves the setState is actually deferred)', async ({ page }) => {
    await page.locator('[data-testid=btn-global-search]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=global-search-input]').fill('sidebar');
    // Immediately after fill(), before the debounce can have fired, the
    // results list must still be empty -- proves onChange itself isn't
    // synchronously calling setState (which the old, sluggish version did).
    expect(await page.locator('[data-testid=global-search-result]').count()).toBe(0);
    await expect(page.locator('[data-testid=global-search-result]')).toHaveCount(1); // settles once the debounce fires
  });

  test('pressing Enter immediately after typing opens the just-typed query\'s result, not a stale one', async ({ page }) => {
    await page.locator('[data-testid=btn-global-search]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=global-search-input]').pressSequentially('sidebar', { delay: 5 });
    await page.keyboard.press('Enter'); // fires well inside the debounce window
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=global-search-overlay]')).toHaveCount(0);
    await expect(page.locator('[data-testid=slideover]')).toContainText('Sidebar sizing');
  });
});
