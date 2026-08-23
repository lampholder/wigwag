// Spec: the mobile header/sheets/row-list/row-detail rework from
// design_handoff_mobile_header (reactive.zip). Deliberately scoped --
// per that handoff's own "Desktop is not covered here", only the mobile
// tree (isMobileViewport) is exercised here; everything the handoff
// doesn't cover (field editing, add-item, comments, settings, sync)
// still falls back to the desktop-only markup, which isn't reachable at
// a mobile viewport width -- see wigwag.html's isMobileViewport/
// isDesktopViewport sc-if split.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

test.use({ viewport: { width: 390, height: 844 } });

test.describe('Mobile header (S1 resting)', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('shows the identity/project breadcrumb instead of desktop chrome, and the row list', async ({ page }) => {
    await expect(page.locator('[data-testid=identity-pill]')).toHaveCount(0); // desktop-only, not in the mobile tree
    await expect(page.locator('[data-testid=mobile-header]')).toBeVisible();
    await expect(page.locator('[data-testid=crumb-identity]')).toContainText('Personal');
    await expect(page.locator('[data-testid=crumb-project]')).toContainText('Delivery tracker');
    await expect(page.locator('[data-testid=mobile-row]')).toHaveCount(9);
  });

  test('a row shows title, pills, and a meta line with id/age', async ({ page }) => {
    const row = page.locator('[data-testid=mobile-row]').first();
    await expect(row).toContainText('Sidebar sizing does not stick between application starts');
    await expect(row).toContainText('Enhancement'); // a select pill
    await expect(row).toContainText('Platform'); // a multiselect pill
    await expect(row).toContainText('#'); // meta line's short id
  });
});

test.describe('Mobile identity sheet (S2)', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('opens on tapping the identity crumb, shows the current identity, and dismisses on scrim tap', async ({ page }) => {
    await page.locator('[data-testid=crumb-identity]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=mobile-sheet]')).toBeVisible();
    await expect(page.locator('[data-testid=mobile-identity-row]')).toHaveCount(1);
    await expect(page.locator('[data-testid=mobile-identity-row]')).toContainText('Personal');

    await page.locator('[data-testid=mobile-sheet-scrim]').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=mobile-sheet]')).toHaveCount(0);
  });

  test('lists every identity, switching loads that identity\'s default project', async ({ page }) => {
    await h.seedTwoIdentities(page);
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    await page.locator('[data-testid=crumb-identity]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=mobile-identity-row]')).toHaveCount(2);

    await page.locator('[data-testid=mobile-identity-row]').filter({ hasText: 'Northwind' }).click();
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=mobile-sheet]')).toHaveCount(0); // switching closes the sheet
    await expect(page.locator('[data-testid=crumb-identity]')).toContainText('Northwind');
  });

  test('"Import project from file…" and "Appearance" are the only app-level actions', async ({ page }) => {
    await page.locator('[data-testid=crumb-identity]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=mobile-import-project]')).toBeVisible();
    await expect(page.locator('[data-testid=appearance-wrap]')).toBeVisible();

    await page.locator('[data-testid=btn-appearance]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=appearance-menu]')).toBeVisible();
    await page.locator('[data-testid=appearance-option][data-appearance-id=dark]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark');
    await expect(page.locator('[data-testid=appearance-value-label]')).toHaveText('Dark');
  });
});

test.describe('Mobile project sheet (S3)', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('opens on tapping the project crumb, lists only the current identity\'s projects', async ({ page }) => {
    await h.seedTwoIdentities(page);
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    await page.locator('[data-testid=crumb-project]').click();
    await page.waitForTimeout(300);
    // Identity A (active) has one project.
    await expect(page.locator('[data-testid=mobile-project-row]')).toHaveCount(1);
    await expect(page.locator('[data-testid=mobile-project-row]')).toContainText('Project A');
  });

  test('shows an issue count per project, with the current project checked', async ({ page }) => {
    await page.locator('[data-testid=crumb-project]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=mobile-project-row]')).toContainText('9 issues');
    await expect(page.locator('[data-testid=mobile-project-row]')).toContainText('✓'); // current project marked
  });

  test('"Project settings" is the sheet\'s own settings entry point', async ({ page }) => {
    await page.locator('[data-testid=crumb-project]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=mobile-project-settings]')).toBeVisible();
  });
});

test.describe('Mobile header collapse (S1 <-> S4)', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('collapses past the scroll threshold: mark instead of identity text, smaller project text, shadow -- and expands back at the top', async ({ page }) => {
    const header = page.locator('[data-testid=mobile-header]');
    await expect(header).toContainText('Personal');

    await page.locator('[data-testid=mobile-row-list]').evaluate(el => el.scrollTo(0, 200));
    await page.waitForTimeout(250);
    await expect(header).not.toContainText('Personal'); // replaced by the app mark
    const shadow = await header.evaluate(el => getComputedStyle(el).boxShadow);
    expect(shadow).not.toBe('none');

    await page.locator('[data-testid=mobile-row-list]').evaluate(el => el.scrollTo(0, 0));
    await page.waitForTimeout(250);
    await expect(header).toContainText('Personal');
  });

  test('both crumbs stay tappable while collapsed', async ({ page }) => {
    await page.locator('[data-testid=mobile-row-list]').evaluate(el => el.scrollTo(0, 200));
    await page.waitForTimeout(250);
    await page.locator('[data-testid=crumb-project]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=mobile-sheet]')).toBeVisible();
  });
});

test.describe('Mobile row detail (S5)', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('opens on tapping a row, shows fields in order with the title and id/age', async ({ page }) => {
    await page.locator('[data-testid=mobile-row]').first().click();
    await page.waitForTimeout(350);
    await expect(page.locator('[data-testid=mobile-sheet]')).toBeVisible();
    await expect(page.locator('[data-testid=mobile-sheet]')).toContainText('Sidebar sizing does not stick between application starts');
    const fields = page.locator('[data-testid=mobile-row-detail-field]');
    await expect(fields).toHaveCount(6);
    await expect(fields.first()).toHaveAttribute('data-col', 'type');
  });

  test('a bound field carries a rule description and is not directly editable', async ({ page }) => {
    await page.locator('[data-testid=mobile-row]').first().click();
    await page.waitForTimeout(350);
    const typeField = page.locator('[data-testid=mobile-row-detail-field][data-col=type]');
    await expect(typeField).toContainText('bound');
    // No inline edit surface (input/select) inside the field row.
    await expect(typeField.locator('input, select')).toHaveCount(0);
  });

  test('tapping a bound field closes the sheet (routes toward the rule editor)', async ({ page }) => {
    await page.locator('[data-testid=mobile-row]').first().click();
    await page.waitForTimeout(350);
    await page.locator('[data-testid=mobile-row-detail-field][data-col=type]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=mobile-sheet]')).toHaveCount(0);
  });

  test('dismisses on scrim tap', async ({ page }) => {
    await page.locator('[data-testid=mobile-row]').first().click();
    await page.waitForTimeout(350);
    await page.locator('[data-testid=mobile-sheet-scrim]').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=mobile-sheet]')).toHaveCount(0);
  });
});

test.describe('Mobile header actions', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('the overflow menu offers Refresh linked issues / Apply update… / Project settings', async ({ page }) => {
    await page.locator('[data-testid=btn-overflow]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=mobile-overflow-refresh]')).toBeVisible();
    await expect(page.locator('[data-testid=mobile-overflow-apply-update]')).toBeVisible();
    await expect(page.locator('[data-testid=mobile-overflow-project-settings]')).toBeVisible();
  });

  test('"Project settings" in the overflow menu opens the project sheet', async ({ page }) => {
    await page.locator('[data-testid=btn-overflow]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=mobile-overflow-project-settings]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=mobile-sheet]')).toBeVisible();
    await expect(page.locator('[data-testid=mobile-project-row]')).toBeVisible();
  });
});

test.describe('Desktop is unaffected by the mobile tree', () => {
  test('at a desktop viewport, the desktop chrome renders and the mobile tree does not exist in the DOM', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await h.gotoTracker(page);
    await expect(page.locator('[data-testid=identity-pill]')).toBeVisible();
    await expect(page.locator('[data-testid=mobile-header]')).toHaveCount(0);
    await expect(page.locator('[data-testid=row]')).toHaveCount(9);
  });
});
