// Spec: the mobile view full rebuild from design_handoff_mobile_view
// (mobile.zip, tracker issue #75/6eb65418) -- replaces the earlier
// design_handoff_mobile_header handoff entirely. Covers all 8 screens:
// M1 list, M2 switcher sheet, M3 overflow sheet, M4 paste sheet, M5 add
// issue, M6 filter/id-jump, M7 row detail, M8 settings. Only the mobile
// tree (isMobileViewport) is exercised here -- see wigwag.html's
// isMobileViewport/isDesktopViewport sc-if split.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

test.use({ viewport: { width: 390, height: 844 } });

const FIXTURE_ID = 'deadbee0-1111-2222-3333-444455556666';
async function seedJumpFixture(page) {
  const doc = await h.readActiveMilestoneDoc(page);
  doc.issues.push({
    id: FIXTURE_ID, num: (doc.issues.reduce((m, i) => Math.max(m, i.num || 0), 0)) + 1, fieldRefs: {}, fieldLoading: {},
    values: { title: 'Fixture jump target', type: 'chore', priority: 'p2', rag: null, teams: [], mitigation: '', linked: '' },
    comments: [],
    history: [{ time: 'Aug 1', actor: 'tom', text: 'Created', sortKey: 1 }]
  });
  await h.writeActiveMilestoneDoc(page, doc);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
}

test.describe('M1: list (resting)', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('shows one breadcrumb tap target, search + overflow icons, the row list, and a FAB', async ({ page }) => {
    await expect(page.locator('[data-testid=identity-pill]')).toHaveCount(0); // desktop-only, not in the mobile tree
    await expect(page.locator('[data-testid=mobile-header]')).toBeVisible();
    await expect(page.locator('[data-testid=mobile-crumb-switcher]')).toContainText('Personal');
    await expect(page.locator('[data-testid=mobile-crumb-switcher]')).toContainText('Delivery tracker');
    await expect(page.locator('[data-testid=btn-search]')).toBeVisible();
    await expect(page.locator('[data-testid=btn-overflow]')).toBeVisible();
    await expect(page.locator('[data-testid=btn-share]')).toHaveCount(0); // moved into the overflow sheet
    await expect(page.locator('[data-testid=mobile-row]')).toHaveCount(9);
    await expect(page.locator('[data-testid=mobile-add-fab]')).toBeVisible();
  });

  test('a row shows title, pills, and a meta line with id/age', async ({ page }) => {
    const row = page.locator('[data-testid=mobile-row]').first();
    await expect(row).toContainText('Sidebar sizing does not stick between application starts');
    await expect(row).toContainText('Enhancement'); // a select pill
    await expect(row).toContainText('Platform'); // a multiselect pill
    await expect(row).toContainText('#'); // meta line's short id
  });

  // mobile2.zip (#76): a comment-count glyph in the row meta line,
  // shown only when the issue actually has comments -- tapping it opens
  // straight to M7's Comments tab (not whatever tab was last viewed).
  test('a row with comments shows a comment-count glyph; tapping it opens straight to the Comments tab', async ({ page }) => {
    const rowNoComments = page.locator('[data-testid=mobile-row]').first(); // i1, no comments in the fixture
    await expect(rowNoComments.locator('[data-testid=mobile-row-comment-count]')).toHaveCount(0);

    const rowWithComments = page.locator('[data-testid=mobile-row]').nth(1); // i2, has one seed comment
    const glyph = rowWithComments.locator('[data-testid=mobile-row-comment-count]');
    await expect(glyph).toBeVisible();
    await expect(glyph).toContainText('1');

    // Land on History first, then use the glyph -- it must force Comments.
    await rowWithComments.click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid=mobile-activity-tab-history]').click();
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await glyph.click();
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=mobile-sheet]')).toBeVisible();
    await expect(page.locator('[data-testid=mobile-activity-tab-comments]')).toContainText('COMMENTS');
    await expect(page.locator('[data-testid=mobile-activity-entry]')).toHaveCount(1);
  });
});

test.describe('M1: sync-status glyph', () => {
  // mobile2.zip (#76): tick/spinner/warning glyph left of search, tap
  // for timestamp/error detail -- driven entirely by desktop's own
  // githubSyncStatus/githubSyncError/githubLastSyncedAt state.
  test('hidden when no repo is connected', async ({ page }) => {
    await h.gotoTracker(page);
    await expect(page.locator('[data-testid=mobile-sync-indicator]')).toHaveCount(0);
  });

  test('shows a checkmark once synced, and tapping reveals a "Synced" detail', async ({ page }) => {
    await h.gotoTracker(page);
    const doc = await h.readActiveMilestoneDoc(page);
    doc.githubRepo = 'acme/app';
    doc.githubRepoPath = 'tracker.jsonl';
    await h.writeActiveMilestoneDoc(page, doc);
    const mock = h.mockGithubContentsApi(page, 'acme/app');
    mock.getResponses.push({ status: 200, sha: 'sha1', text: JSON.stringify(doc) });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(600);

    const indicator = page.locator('[data-testid=mobile-sync-indicator]');
    await expect(indicator).toBeVisible();
    await expect(page.locator('[data-testid=mobile-sync-detail]')).toHaveCount(0);
    await indicator.click();
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=mobile-sync-detail]')).toContainText('Synced');
  });
});

test.describe('M2: switcher sheet', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('opens on tapping the breadcrumb, shows IDENTITY and PROJECTS sections together, dismisses on scrim tap', async ({ page }) => {
    await page.locator('[data-testid=mobile-crumb-switcher]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=mobile-sheet]')).toBeVisible();
    await expect(page.locator('[data-testid=mobile-identity-row]')).toHaveCount(1);
    await expect(page.locator('[data-testid=mobile-identity-row]')).toContainText('Personal');
    await expect(page.locator('[data-testid=mobile-project-row]')).toHaveCount(1);
    await expect(page.locator('[data-testid=mobile-add-identity]')).toBeVisible();

    await page.locator('[data-testid=mobile-sheet-scrim]').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=mobile-sheet]')).toHaveCount(0);
  });

  // Tom's live feedback (after #75 shipped): "Clicking an ID in the mobile
  // ID popover should just change the popover to show the projects in
  // that ID -- it shouldn't switch the project view to something
  // prematurely." Mirrors desktop's own unified switcher exactly: tapping
  // an identity (or "Shared with you") only sets switcherScopeId as a
  // PREVIEW -- nothing is committed (no switchIdentity/switchProject, the
  // sheet stays open) until a PROJECT row is actually tapped.
  test('tapping an identity previews its projects below, without switching identity or closing the sheet', async ({ page }) => {
    await h.seedTwoIdentities(page);
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    await page.locator('[data-testid=mobile-crumb-switcher]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=mobile-identity-row]')).toHaveCount(2);
    // Starts previewing the active identity's own projects.
    await expect(page.locator('[data-testid=mobile-project-row]')).toContainText('Project A');

    await page.locator('[data-testid=mobile-identity-row]').filter({ hasText: 'Northwind' }).click();
    await page.waitForTimeout(300);
    // Still open, nothing committed -- the breadcrumb hasn't changed --
    // but the projects section now previews Northwind's own projects.
    await expect(page.locator('[data-testid=mobile-sheet]')).toBeVisible();
    await expect(page.locator('[data-testid=mobile-crumb-switcher]')).toContainText('Personal');
    await expect(page.locator('[data-testid=mobile-sheet]')).toContainText('PROJECTS IN NORTHWIND');
    const rows = page.locator('[data-testid=mobile-project-row]');
    await expect(rows).toHaveCount(2);
    await expect(rows).toContainText(['Project B1', 'Project B2']);

    // Only tapping a project actually commits and closes the sheet.
    await rows.filter({ hasText: 'Project B1' }).click();
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=mobile-sheet]')).toHaveCount(0);
    await expect(page.locator('[data-testid=mobile-crumb-switcher]')).toContainText('Northwind');
    await expect(page.locator('[data-testid=mobile-crumb-switcher]')).toContainText('Project B1');
  });

  test('lists only the currently-previewed scope\'s projects, with an issue count and the current one checked', async ({ page }) => {
    await h.seedTwoIdentities(page);
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    await page.locator('[data-testid=mobile-crumb-switcher]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=mobile-project-row]')).toHaveCount(1);
    await expect(page.locator('[data-testid=mobile-project-row]')).toContainText('Project A');
    await expect(page.locator('[data-testid=mobile-project-row]')).toContainText('✓');
  });

  // Tom's live feedback: a project with no identityId (desktop's own
  // unified switcher already treats this as its own "Shared with you"
  // scope, switcherHasShared/switcherScopeId==='shared') was completely
  // unreachable from mobile's switcher sheet -- and per Tom's follow-up
  // ("Shared with me should appear as a peer of the identities when
  // there is something there"), it's a peer tile in the same IDENTITY
  // list, not a separate always-different section.
  test('"Shared with you" is a peer tile in the identity list; previewing it, then tapping a project, is reachable', async ({ page }) => {
    await h.seedTwoIdentities(page, {
      projects: [
        { id: 'project-a', name: 'Project A', identityId: 'identity-a' },
        { id: 'project-shared', name: 'Shared Roadmap', identityId: null },
      ]
    });
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    await page.locator('[data-testid=mobile-crumb-switcher]').click();
    await page.waitForTimeout(300);
    const sharedTile = page.locator('[data-testid=mobile-identity-row][data-scope-id=shared]');
    await expect(sharedTile).toHaveCount(1);
    await expect(sharedTile).toContainText('Shared with you');
    // A peer of the identity tiles, not off in its own section.
    await expect(page.locator('[data-testid=mobile-identity-row]')).toHaveCount(3);

    await sharedTile.click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=mobile-sheet]')).toBeVisible(); // preview only
    await expect(page.locator('[data-testid=mobile-sheet]')).toContainText('SHARED WITH YOU');
    const projectRow = page.locator('[data-testid=mobile-project-row]');
    await expect(projectRow).toHaveCount(1);
    await expect(projectRow).toContainText('Shared Roadmap');

    await projectRow.click();
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=mobile-sheet]')).toHaveCount(0);
    await expect(page.locator('[data-testid=mobile-crumb-switcher]')).toContainText('Shared Roadmap');
  });

  test('no "Shared with you" tile when every project has an identity', async ({ page }) => {
    await page.locator('[data-testid=mobile-crumb-switcher]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=mobile-identity-row][data-scope-id=shared]')).toHaveCount(0);
    await expect(page.locator('[data-testid=mobile-sheet]')).not.toContainText('Shared with you');
  });

  test('"Add identity" opens a form; submitting creates and switches to it, closing the sheet', async ({ page }) => {
    await page.locator('[data-testid=mobile-crumb-switcher]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid=mobile-add-identity]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=mobile-add-identity-page]')).toBeVisible();
    await page.locator('[data-testid=mobile-add-identity-label]').fill('Acme Corp');
    await page.locator('[data-testid=mobile-add-identity-email]').fill('me@acme.com');
    await page.locator('[data-testid=mobile-add-identity-submit]').click();
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=mobile-add-identity-page]')).toHaveCount(0);
    await expect(page.locator('[data-testid=mobile-sheet]')).toHaveCount(0);
    await expect(page.locator('[data-testid=mobile-crumb-switcher]')).toContainText('Acme Corp');
  });

  test('Escape closes the sheet', async ({ page }) => {
    await page.locator('[data-testid=mobile-crumb-switcher]').click();
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=mobile-sheet]')).toHaveCount(0);
  });
});

test.describe('M3: overflow sheet', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('offers Share project / Apply update… / Import project… / Appearance / Settings -- not the old refresh/project-settings items', async ({ page }) => {
    await page.locator('[data-testid=btn-overflow]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=mobile-overflow-share]')).toBeVisible();
    await expect(page.locator('[data-testid=mobile-overflow-apply-update]')).toBeVisible();
    await expect(page.locator('[data-testid=mobile-overflow-import-project]')).toBeVisible();
    await expect(page.locator('[data-testid=appearance-wrap]')).toBeVisible();
    await expect(page.locator('[data-testid=mobile-overflow-settings]')).toBeVisible();
    await expect(page.locator('[data-testid=mobile-overflow-refresh]')).toHaveCount(0);
    await expect(page.locator('[data-testid=mobile-overflow-project-settings]')).toHaveCount(0);
  });

  test('Appearance is interactive from the overflow sheet', async ({ page }) => {
    await page.locator('[data-testid=btn-overflow]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=btn-appearance]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=appearance-menu]')).toBeVisible();
    await page.locator('[data-testid=appearance-option][data-appearance-id=dark]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark');
    await expect(page.locator('[data-testid=appearance-value-label]')).toHaveText('Dark');
  });

  test('"Settings" opens the settings sheet', async ({ page }) => {
    await page.locator('[data-testid=btn-overflow]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=mobile-overflow-settings]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=mobile-settings-row]')).toHaveCount(4);
  });
});

test.describe('M4: paste sheet', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('"Apply update…" opens a full-screen paste-merge sheet, Cancel closes it, Escape closes it too', async ({ page }) => {
    await page.locator('[data-testid=btn-overflow]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=mobile-overflow-apply-update]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=mobile-paste-merge-page]')).toBeVisible();
    await expect(page.locator('[data-testid=mobile-paste-merge-textarea]')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=mobile-paste-merge-page]')).toHaveCount(0);
  });

  test('"Import project…" opens a full-screen paste-import sheet', async ({ page }) => {
    await page.locator('[data-testid=btn-overflow]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=mobile-overflow-import-project]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=mobile-paste-import-page]')).toBeVisible();
    await expect(page.locator('[data-testid=mobile-paste-import-textarea]')).toBeVisible();
  });

  test('pasting valid JSONL into the merge sheet applies it (same onSubmitPasteMerge desktop uses)', async ({ page }) => {
    const pastedJsonl = [
      JSON.stringify({ type: 'fields', fields: { title: { label: 'Issue', type: 'text' } }, columnOrder: [] }),
      JSON.stringify({ type: 'issue', id: 'mobile-pasted-merge-1', num: 300, fieldRefs: {}, values: { title: 'Pasted-in via mobile merge sheet' }, comments: [], history: [] })
    ].join('\n');

    await page.locator('[data-testid=btn-overflow]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=mobile-overflow-apply-update]').click();
    await page.waitForTimeout(300);
    // No project id in the pasted text -- accept the resulting "brand new
    // project" mismatch warning, same as desktop's equivalent test.
    page.once('dialog', d => d.accept());
    await page.locator('[data-testid=mobile-paste-merge-textarea]').fill(pastedJsonl);
    await page.locator('[data-testid=mobile-paste-merge-submit]').click();
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=mobile-paste-merge-page]')).toHaveCount(0);
  });
});

test.describe('M5: add issue', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('the FAB opens a composer; typing and submitting creates a plain issue', async ({ page }) => {
    await page.locator('[data-testid=mobile-add-fab]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=mobile-add-page]')).toBeVisible();
    await page.locator('[data-testid=mobile-add-input]').fill('New mobile-created issue');
    await page.locator('[data-testid=mobile-add-submit]').click();
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=mobile-add-page]')).toHaveCount(0);
    await expect(page.locator('[data-testid=mobile-row]')).toHaveCount(10);
    await expect(page.locator('[data-testid=mobile-row]').last()).toContainText('New mobile-created issue');
  });

  test('Cancel and Escape both dismiss without creating an issue', async ({ page }) => {
    await page.locator('[data-testid=mobile-add-fab]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid=mobile-add-input]').fill('Should not be created');
    await page.locator('[data-testid=mobile-add-cancel]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=mobile-add-page]')).toHaveCount(0);
    await expect(page.locator('[data-testid=mobile-row]')).toHaveCount(9);
  });

  // Tom's live feedback on #75: the composer's background was fully
  // transparent, so the main list/header showed straight through behind
  // "New issue". Root cause was a CSS custom property (--n6) copied
  // verbatim from the design mockup's own local, unrelated token set --
  // never actually defined in wigwag.html's real <style> blocks, so it
  // silently resolved to nothing. Same bug hit every other new
  // full-screen mobile overlay (settings, add-identity, both paste
  // sheets); this asserts against the whole class, not just this one
  // instance, by checking the underlying row list is genuinely hidden
  // (not just covered by an element Playwright still finds "behind").
  test('the composer renders on a real opaque background -- the list behind it is not visible', async ({ page }) => {
    await page.locator('[data-testid=mobile-add-fab]').click();
    await page.waitForTimeout(300);
    const bg = await page.locator('[data-testid=mobile-add-page]').evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(bg).not.toBe('');
    // toBeVisible() alone doesn't catch "covered by an opaque overlay" --
    // it only checks size/display/opacity, not stacking. Ask the browser
    // directly which element paints at the row's on-screen position.
    const topElementIsRow = await page.locator('[data-testid=mobile-row]').first().evaluate(el => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + 5, r.top + 5);
      return !!(top && el.contains(top));
    });
    expect(topElementIsRow).toBe(false);
  });
});

test.describe('M6: filter / id jump', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); await seedJumpFixture(page); });

  test('the search icon replaces the breadcrumb with a filter input, Cancel restores it', async ({ page }) => {
    await page.locator('[data-testid=btn-search]').click();
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=mobile-filter-input]')).toBeVisible();
    await expect(page.locator('[data-testid=mobile-header]')).toHaveCount(0);
    await page.locator('[data-testid=mobile-filter-cancel]').click();
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=mobile-header]')).toBeVisible();
  });

  test('an id-shaped query surfaces a direct jump row above the narrowed list; tapping it opens that issue', async ({ page }) => {
    await page.locator('[data-testid=btn-search]').click();
    await page.waitForTimeout(200);
    await page.locator('[data-testid=mobile-filter-input]').fill('dead');
    await page.waitForTimeout(250);
    await expect(page.locator('[data-testid=mobile-jump-row]')).toContainText('Fixture jump target');
    await page.locator('[data-testid=mobile-jump-row]').first().click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=mobile-sheet]')).toBeVisible();
    await expect(page.locator('[data-testid=mobile-sheet]')).toContainText('Fixture jump target');
  });

  test('a plain keyword query narrows the row list instead of jumping', async ({ page }) => {
    await page.locator('[data-testid=btn-search]').click();
    await page.waitForTimeout(200);
    await page.locator('[data-testid=mobile-filter-input]').fill('sidebar');
    await page.waitForTimeout(250);
    await expect(page.locator('[data-testid=mobile-jump-row]')).toHaveCount(0);
    await expect(page.locator('[data-testid=mobile-row]')).toHaveCount(1);
    await expect(page.locator('[data-testid=mobile-row]')).toContainText('Sidebar sizing');
  });
});

test.describe('M7: row detail', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('opens on tapping a row, shows fields in order with the title and id/age ("ago")', async ({ page }) => {
    await page.locator('[data-testid=mobile-row]').first().click();
    await page.waitForTimeout(350);
    await expect(page.locator('[data-testid=mobile-sheet]')).toBeVisible();
    await expect(page.locator('[data-testid=mobile-sheet]')).toContainText('Sidebar sizing does not stick between application starts');
    await expect(page.locator('[data-testid=mobile-sheet]')).toContainText('ago');
    // Regression: relativeAge() already returns "...Xd ago" -- an earlier
    // pass appended a second " ago" on top of it, producing "ago ago".
    await expect(page.locator('[data-testid=mobile-sheet]')).not.toContainText('ago ago');
    const fields = page.locator('[data-testid=mobile-row-detail-field]');
    await expect(fields).toHaveCount(6);
    await expect(fields.first()).toHaveAttribute('data-col', 'type');
  });

  // Tom's live feedback on #75: a "Description" text field needs the same
  // special treatment mobile gets on desktop's own slide-over -- promoted
  // full-width just beneath the title, markdown-rendered, and excluded
  // from the regular fields list (see slideOver's own descriptionColId
  // heuristic: a type:'text' field literally labeled "Description").
  test('a "Description" field is promoted full-width beneath the title, markdown-rendered, and excluded from the fields grid', async ({ page }) => {
    const doc = await h.readActiveMilestoneDoc(page);
    doc.fieldDefs.description = { label: 'Description', type: 'text' };
    doc.issues[0].history.push({
      id: 'test-desc-1', time: 'Aug 1', actor: 'tom', email: '', text: 'Description set',
      field: 'description', value: 'This is the **full** description body.', sortKey: 100
    });
    await h.writeActiveMilestoneDoc(page, doc);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    await page.locator('[data-testid=mobile-row]').first().click();
    await page.waitForTimeout(350);
    const desc = page.locator('[data-testid=mobile-row-detail-description]');
    await expect(desc).toBeVisible();
    await expect(desc).toContainText('Description');
    await expect(desc).toContainText('full');
    await expect(desc.locator('[data-testid=text-field-md] strong')).toHaveCount(1); // markdown rendered, not raw
    await expect(page.locator('[data-testid=mobile-row-detail-field][data-col=description]')).toHaveCount(0);
  });

  test('a bound field carries a rule description, is not directly editable, and routes to the rule editor on tap', async ({ page }) => {
    await page.locator('[data-testid=mobile-row]').first().click();
    await page.waitForTimeout(350);
    const typeField = page.locator('[data-testid=mobile-row-detail-field][data-col=type]');
    await expect(typeField).toContainText('bound');
    await expect(typeField.locator('input, select')).toHaveCount(0);
    // Bound fields never get the new editable-chevron treatment below.
    await expect(typeField.locator('[data-testid=mobile-field-chevron]')).toHaveCount(0);
    await typeField.click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=mobile-sheet]')).toHaveCount(0);
  });

  // #76 M7 editable fields: select/multiselect/date fields carry a chevron
  // and open the matching picker/input on tap, reusing desktop's own
  // selectOption/toggleMultiOption/startEdit+commitEdit mutation methods
  // verbatim (no new mutation logic, only new mobile-native markup).
  //
  // Real bug found and fixed while building this: the new picker's own
  // taps were being swallowed by the app's global _onOutsideMouseDown
  // handler -- it only recognized desktop's own field-cell/slideover-field
  // testids as "inside an open popover", so tapping any option inside the
  // new mobile-field-picker-page was treated as an outside click, clearing
  // activeCell (and closing the picker) via mousedown before the click's
  // own onSelect ever fired. Same bug shape as the mobile jump-panel fix
  // from #75 -- see docs/EDITING.md-adjacent memory. Confirmed fixed here
  // by asserting the value actually commits, not just that the picker
  // opens and closes.
  test.describe('M7 editable fields: select/multiselect/date pickers', () => {
    test('a select field shows a chevron, opens a full-screen picker on tap, and committing a choice updates the row', async ({ page }) => {
      await page.locator('[data-testid=mobile-row]').first().click();
      await page.waitForTimeout(350);
      const row = page.locator('[data-testid=mobile-row-detail-field][data-col=priority]');
      await expect(row.locator('[data-testid=mobile-field-chevron]')).toBeVisible();
      const before = await row.innerText();

      await row.click();
      const picker = page.locator('[data-testid=mobile-field-picker-page]');
      await expect(picker).toBeVisible();
      await expect(picker).toContainText('Priority');

      const options = page.locator('[data-testid=mobile-field-picker-option]');
      const optionCount = await options.count();
      expect(optionCount).toBeGreaterThan(1); // includes the "no value" clear option
      // Pick whichever option isn't already selected, so the value actually changes.
      let target = options.nth(1);
      const targetLabel = (await target.innerText()).trim();
      await target.click();

      await expect(picker).toHaveCount(0);
      await expect(row).toContainText(targetLabel);
      expect(await row.innerText()).not.toBe(before);
    });

    test('picking "— No value —" clears a select field', async ({ page }) => {
      await page.locator('[data-testid=mobile-row]').first().click();
      await page.waitForTimeout(350);
      const row = page.locator('[data-testid=mobile-row-detail-field][data-col=priority]');
      await row.click();
      await page.locator('[data-testid=mobile-field-picker-option]').first().click();
      await page.waitForTimeout(300);
      await expect(row).toContainText('—');
    });

    test('a multiselect field opens a picker where tapping options toggles them without closing, and the row reflects the change', async ({ page }) => {
      await page.locator('[data-testid=mobile-row]').first().click();
      await page.waitForTimeout(350);
      const row = page.locator('[data-testid=mobile-row-detail-field][data-col=teams]');
      await expect(row.locator('[data-testid=mobile-field-chevron]')).toBeVisible();

      await row.click();
      const picker = page.locator('[data-testid=mobile-field-picker-page]');
      await expect(picker).toBeVisible();
      const firstOption = page.locator('[data-testid=mobile-field-picker-option]').first();
      const wasSelected = (await firstOption.locator('text=✓').count()) > 0;
      const label = (await firstOption.innerText()).replace('✓', '').trim();
      await firstOption.click();
      await page.waitForTimeout(200);
      // Multiselect stays open after one tap -- unlike select, which commits and closes.
      await expect(picker).toBeVisible();
      await expect(firstOption.locator('text=✓')).toHaveCount(wasSelected ? 0 : 1);

      await page.locator('[data-testid=mobile-field-picker-close]').click();
      await expect(picker).toHaveCount(0);
      const rowText = await row.innerText();
      if (wasSelected) expect(rowText).not.toContain(label);
      else expect(rowText).toContain(label);
    });

    test('a date field edits inline with an auto-focused native date input on tap, and commits on blur', async ({ page }) => {
      const doc = await h.readActiveMilestoneDoc(page);
      doc.fieldDefs.dueDate = { label: 'Due date', type: 'date' };
      await h.writeActiveMilestoneDoc(page, doc);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(300);

      await page.locator('[data-testid=mobile-row]').first().click();
      await page.waitForTimeout(350);
      const row = page.locator('[data-testid=mobile-row-detail-field][data-col=dueDate]');
      await expect(row.locator('[data-testid=mobile-field-chevron]')).toBeVisible();
      await expect(row).toContainText('—');

      await row.click();
      const input = page.locator('[data-testid=mobile-field-date-input]');
      await expect(input).toBeVisible();
      await expect(input).toBeFocused();
      await input.fill('2026-12-25');
      await input.blur();
      await page.waitForTimeout(300);

      await expect(input).toHaveCount(0);
      await expect(row).toContainText('2026-12-25');
    });
  });

  test('dismisses on scrim tap and on Escape', async ({ page }) => {
    await page.locator('[data-testid=mobile-row]').first().click();
    await page.waitForTimeout(350);
    await page.locator('[data-testid=mobile-sheet-scrim]').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=mobile-sheet]')).toHaveCount(0);

    await page.locator('[data-testid=mobile-row]').first().click();
    await page.waitForTimeout(350);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=mobile-sheet]')).toHaveCount(0);
    await expect(page.locator('[data-testid=mobile-sheet-scrim]')).toHaveCount(0);
  });

  // mobile2.zip (#76): Comments/History as separate tabs with counts,
  // exactly matching desktop's own slide-over split -- mobile row detail
  // previously had no activity at all. Reuses the same activityTab
  // state/addComment() desktop's slide-over already uses.
  test('Comments and History render as separate tabs with counts, defaulting to Comments', async ({ page }) => {
    await page.locator('[data-testid=mobile-row]').nth(1).click(); // i2: 1 comment, 2 history entries
    await page.waitForTimeout(350);
    await expect(page.locator('[data-testid=mobile-activity-tab-comments]')).toContainText('COMMENTS (1)');
    await expect(page.locator('[data-testid=mobile-activity-tab-history]')).toContainText('HISTORY (2)');
    await expect(page.locator('[data-testid=mobile-activity-entry]')).toHaveCount(1);
    await expect(page.locator('[data-testid=mobile-new-comment-input]')).toBeVisible();

    await page.locator('[data-testid=mobile-activity-tab-history]').click();
    await page.waitForTimeout(250);
    await expect(page.locator('[data-testid=mobile-activity-entry]')).toHaveCount(2);
    await expect(page.locator('[data-testid=mobile-new-comment-input]')).toHaveCount(0); // no composing on History

    await page.locator('[data-testid=mobile-activity-tab-comments]').click();
    await page.waitForTimeout(250);
    await expect(page.locator('[data-testid=mobile-activity-entry]')).toHaveCount(1);
  });

  test('posting a comment from the mobile box adds it to the thread and bumps the tab count', async ({ page }) => {
    await page.locator('[data-testid=mobile-row]').first().click(); // i1: no comments yet
    await page.waitForTimeout(350);
    await expect(page.locator('[data-testid=mobile-activity-tab-comments]')).toContainText('COMMENTS (0)');
    await expect(page.locator('[data-testid=mobile-sheet]')).toContainText('Nothing yet.');

    await page.locator('[data-testid=mobile-new-comment-input]').fill('A mobile-posted comment');
    await page.locator('[data-testid=mobile-post-comment-btn]').click();
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=mobile-activity-tab-comments]')).toContainText('COMMENTS (1)');
    await expect(page.locator('[data-testid=mobile-activity-entry]')).toContainText('A mobile-posted comment');
    await expect(page.locator('[data-testid=mobile-new-comment-input]')).toHaveValue(''); // cleared after posting
  });
});

test.describe('M8: settings', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('lists four sections; tapping one pushes a full-screen page with a back arrow', async ({ page }) => {
    await page.locator('[data-testid=btn-overflow]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=mobile-overflow-settings]').click();
    await page.waitForTimeout(300);
    const rows = page.locator('[data-testid=mobile-settings-row]');
    await expect(rows).toHaveCount(4);
    await expect(rows).toContainText(['Identity', 'GitHub access', 'Integrations', 'Notifications']);

    await rows.filter({ hasText: 'Identity' }).click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=mobile-settings-page]')).toBeVisible();
    await expect(page.locator('[data-testid=mobile-settings-page]')).toContainText('Identity');
    await page.locator('[data-testid=mobile-settings-back]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=mobile-settings-row]')).toHaveCount(4);
  });

  test('the Identity page shows editable label and email fields matching desktop\'s identity settings', async ({ page }) => {
    await page.locator('[data-testid=btn-overflow]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=mobile-overflow-settings]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid=mobile-settings-row]').filter({ hasText: 'Identity' }).click();
    await page.waitForTimeout(300);
    const page1 = page.locator('[data-testid=mobile-settings-page]');
    await expect(page1).toContainText('LABEL');
    await expect(page1).toContainText('YOUR EMAIL');
    const inputs = page1.locator('input');
    await expect(inputs.first()).toHaveValue('Personal');
  });

  test('GitHub access, Integrations, and Notifications pages all render without error', async ({ page }) => {
    await page.locator('[data-testid=btn-overflow]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=mobile-overflow-settings]').click();
    await page.waitForTimeout(300);
    for (const label of ['GitHub access', 'Integrations', 'Notifications']) {
      await page.locator('[data-testid=mobile-settings-row]').filter({ hasText: label }).click();
      await page.waitForTimeout(300);
      await expect(page.locator('[data-testid=mobile-settings-page]')).toBeVisible();
      await expect(page.locator('[data-testid=mobile-settings-page]')).toContainText(label);
      await page.locator('[data-testid=mobile-settings-back]').click();
      await page.waitForTimeout(300);
    }
  });
});

test.describe('Mobile header collapse', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  // Tom's live feedback: "When we scroll down the id/project is replaced
  // with the icon and the word wigwag. This isn't helpful. Please leave
  // the id/project name. Switching to the smaller font when we scroll
  // down IS good." The identity/project text must stay visible at all
  // times -- only its font size (and the header's shadow/padding) should
  // change on collapse.
  test('collapses past the scroll threshold (shrinking, not hiding, the identity/project text) and expands back at the top', async ({ page }) => {
    const header = page.locator('[data-testid=mobile-header]');
    await expect(header).toContainText('Personal');
    await expect(header).toContainText('Delivery tracker');
    const sizeBefore = await page.locator('[data-testid=mobile-crumb-switcher]').evaluate(el => getComputedStyle(el.firstElementChild).fontSize);

    await page.locator('[data-testid=mobile-row-list]').evaluate(el => el.scrollTo(0, 200));
    await page.waitForTimeout(250);
    // Still visible, just smaller -- never replaced by the app mark.
    await expect(header).toContainText('Personal');
    await expect(header).toContainText('Delivery tracker');
    const sizeAfter = await page.locator('[data-testid=mobile-crumb-switcher]').evaluate(el => getComputedStyle(el.firstElementChild).fontSize);
    expect(parseFloat(sizeAfter)).toBeLessThan(parseFloat(sizeBefore));
    const shadow = await header.evaluate(el => getComputedStyle(el).boxShadow);
    expect(shadow).not.toBe('none');

    await page.locator('[data-testid=mobile-row-list]').evaluate(el => el.scrollTo(0, 0));
    await page.waitForTimeout(250);
    await expect(header).toContainText('Personal');
    const sizeRestored = await page.locator('[data-testid=mobile-crumb-switcher]').evaluate(el => getComputedStyle(el.firstElementChild).fontSize);
    expect(sizeRestored).toBe(sizeBefore);
  });

  test('the breadcrumb stays tappable while collapsed', async ({ page }) => {
    await page.locator('[data-testid=mobile-row-list]').evaluate(el => el.scrollTo(0, 200));
    await page.waitForTimeout(250);
    await page.locator('[data-testid=mobile-crumb-switcher]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=mobile-sheet]')).toBeVisible();
  });
});

// Bug: the header breadcrumb showed the active identity's own label even
// when the open project is actually a "Shared with you" project (no
// identityId, or an identityId belonging to someone else) -- it read
// activeIdentity.label directly instead of reusing desktop's own
// switcherBreadcrumbIdentityLabel, which already accounts for this.
test.describe('Mobile header breadcrumb: shared-with-you projects', () => {
  test('shows "Shared with you" (not the active identity) when the open project has no identityId', async ({ page }) => {
    await h.gotoTrackerWithSharedProject(page);
    await expect(page.locator('[data-testid=mobile-header]')).toContainText('Shared with you');
    await expect(page.locator('[data-testid=mobile-header]')).not.toContainText('Personal');
  });
});

// Bug: pressing "Post" on a comment did nothing on mobile whenever the
// write needed attribution confirmation (a first write to a "Shared with
// you" project, or an identity mismatch) -- requireAttribution() correctly
// set attributionGateOpen/emailGate.open, but that gate's modal markup was
// nested inside the desktop-only branch of the template (isDesktopViewport),
// so on mobile it never rendered at all: the gate was open with nothing
// visible to interact with. Fix added mobile-native full-screen equivalents
// (mobile-attribution-gate-page / mobile-email-gate-page), reusing the same
// emailGate.*/attributionGate.* state and handlers as desktop.
test.describe('Mobile: the attribution gate is reachable when posting a comment', () => {
  test('posting on a project with no derived identity opens the real, visible mobile gate page, and confirming it posts the comment', async ({ page }) => {
    await h.gotoTrackerWithSharedProject(page);
    await page.locator('[data-testid=mobile-row]').first().click();
    await page.locator('[data-testid=mobile-activity-tab-comments]').waitFor({ state: 'visible' });
    await page.locator('[data-testid=mobile-new-comment-input]').fill('Posted after attribution');
    await page.locator('[data-testid=mobile-post-comment-btn]').click();

    const gate = page.locator('[data-testid=mobile-attribution-gate-page]');
    await expect(gate).toBeVisible();
    // Real occlusion check -- the page must actually be the topmost element
    // at its own position, not merely present in the DOM.
    const topmost = await page.evaluate(() => {
      const el = document.querySelector('[data-testid=mobile-attribution-gate-page]');
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + 10);
      return top ? top.closest('[data-testid=mobile-attribution-gate-page]') !== null : false;
    });
    expect(topmost).toBe(true);

    await page.locator('[data-testid=mobile-attribution-gate-option]').first().click();
    await page.locator('[data-testid=mobile-attribution-gate-save]').click();
    await expect(gate).toHaveCount(0);
    await expect(page.locator('[data-testid=mobile-activity-entry]').first()).toContainText('Posted after attribution');
  });

  test('Cancel on the mobile gate abandons the pending comment -- nothing is posted, the draft stays put', async ({ page }) => {
    await h.gotoTrackerWithSharedProject(page);
    await page.locator('[data-testid=mobile-row]').first().click();
    await page.locator('[data-testid=mobile-activity-tab-comments]').waitFor({ state: 'visible' });
    await page.locator('[data-testid=mobile-new-comment-input]').fill('Should not be posted');
    await page.locator('[data-testid=mobile-post-comment-btn]').click();
    await page.locator('[data-testid=mobile-attribution-gate-page]').waitFor({ state: 'visible' });

    await page.locator('[data-testid=mobile-attribution-gate-cancel]').click();
    await expect(page.locator('[data-testid=mobile-attribution-gate-page]')).toHaveCount(0);
    const count = await page.locator('[data-testid=mobile-activity-entry]').count();
    for (let i = 0; i < count; i++) {
      await expect(page.locator('[data-testid=mobile-activity-entry]').nth(i)).not.toContainText('Should not be posted');
    }
  });
});

// Bug: the mobile row-detail bottom sheet had no swipe-to-dismiss gesture at
// all -- only tapping the scrim closed it. Added a dedicated drag handle
// (mobile-sheet-grip) using the same manual touch-listener pattern the
// codebase already uses for column-resize drags (one bound start event,
// then document-level move/up listeners that remove themselves), with a
// distance threshold so a small swipe snaps back instead of dismissing.
test.describe('Mobile: bottom sheet swipe-to-dismiss', () => {
  test.use({ hasTouch: true });

  async function swipeGrip(page, distance) {
    const grip = page.locator('[data-testid=mobile-sheet-grip]');
    const box = await grip.boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.evaluate(({ x, y, distance }) => {
      const el = document.querySelector('[data-testid=mobile-sheet-grip]');
      const t1 = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
      el.dispatchEvent(new TouchEvent('touchstart', { touches: [t1], targetTouches: [t1], changedTouches: [t1], cancelable: true, bubbles: true }));
      const t2 = new Touch({ identifier: 1, target: el, clientX: x, clientY: y + distance });
      document.dispatchEvent(new TouchEvent('touchmove', { touches: [t2], targetTouches: [t2], changedTouches: [t2], cancelable: true, bubbles: true }));
      document.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [t2], cancelable: true, bubbles: true }));
    }, { x, y, distance });
  }

  test('a swipe down past the threshold dismisses the sheet', async ({ page }) => {
    await h.gotoTracker(page);
    await page.locator('[data-testid=mobile-row]').first().click();
    await page.locator('[data-testid=mobile-sheet]').waitFor({ state: 'visible' });
    await swipeGrip(page, 150);
    await expect(page.locator('[data-testid=mobile-sheet]')).toBeHidden();
  });

  test('a small swipe below the threshold snaps back without dismissing', async ({ page }) => {
    await h.gotoTracker(page);
    await page.locator('[data-testid=mobile-row]').first().click();
    await page.locator('[data-testid=mobile-sheet]').waitFor({ state: 'visible' });
    await swipeGrip(page, 30);
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=mobile-sheet]')).toBeVisible();
  });

  // Real gap found while investigating a live "field edit doesn't persist"
  // report: closeSlideOver() never committed a pending activeCell edit
  // before tearing down state -- invisible for a mouse click (which
  // naturally blurs the focused input first, and blur is what commits),
  // but a swipe-to-dismiss is a touch gesture with no blur involved at
  // all, so an in-progress inline edit (e.g. the M7 date-field editor,
  // which reuses the same activeCell/commitEdit machinery as desktop)
  // was silently discarded.
  test('swiping the sheet away mid-edit still commits the pending change, not discards it', async ({ page }) => {
    await h.gotoTracker(page);
    const doc = await h.readActiveMilestoneDoc(page);
    doc.fieldDefs.dueDate = { label: 'Due date', type: 'date' };
    await h.writeActiveMilestoneDoc(page, doc);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    await page.locator('[data-testid=mobile-row]').first().click();
    await page.waitForTimeout(350);
    const row = page.locator('[data-testid=mobile-row-detail-field][data-col=dueDate]');
    await row.click();
    const input = page.locator('[data-testid=mobile-field-date-input]');
    await expect(input).toBeVisible();
    await input.fill('2026-11-11');
    // No blur here -- go straight to a swipe-dismiss while still editing.
    await swipeGrip(page, 150);
    await expect(page.locator('[data-testid=mobile-sheet]')).toBeHidden();

    await page.locator('[data-testid=mobile-row]').first().click();
    await page.waitForTimeout(350);
    await expect(page.locator('[data-testid=mobile-row-detail-field][data-col=dueDate]')).toContainText('2026-11-11');
  });
});

test.describe('Desktop is unaffected by the mobile tree', () => {
  test('at a desktop viewport, the desktop chrome renders and the mobile tree does not exist in the DOM', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await h.gotoTracker(page);
    await expect(page.locator('[data-testid=btn-switcher]')).toBeVisible();
    await expect(page.locator('[data-testid=mobile-header]')).toHaveCount(0);
    await expect(page.locator('[data-testid=row]')).toHaveCount(9);
  });
});
