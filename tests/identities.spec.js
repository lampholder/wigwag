// Spec section: Multi-identity (Phase 2 of the identity/IA design handoff)
//   - An identity is a named bundle: label, email, state repo, signing key,
//     host token, bridge root. Projects belong to an identity.
//   - The pill and title prefix always render, even with exactly one
//     identity (deliberate deviation from the README/prototype, which only
//     show them at 2+ -- otherwise there's no entry point at all to the
//     concept of identities, since "Manage identities..." only lives in
//     the pill's own dropdown). The dropdown's SWITCH IDENTITY list simply
//     has one row in that case, not a different layout.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

test.describe('Single identity: pill/prefix still render, migration labels it "Personal"', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('the pill and title prefix are visible immediately, even with only one (migrated) identity', async ({ page }) => {
    await expect(page.locator('[data-testid=identity-pill]')).toBeVisible();
    await expect(page.locator('[data-testid=identity-pill]')).toContainText('Personal');
    await expect(page.locator('[data-testid=identity-title-prefix]')).toBeVisible();
    await expect(page.locator('[data-testid=identity-title-prefix]')).toContainText('Personal');
  });

  test('the migrated default identity is always labelled "Personal", regardless of whether an email was already set', async ({ page }) => {
    // gotoTracker's demo seed never sets identityEmail, so this also covers
    // the empty-email case; the label must still read "Personal", not be
    // derived from an email local-part.
    await page.locator('[data-testid=identity-pill]').click();
    const options = page.locator('[data-testid=identity-option]');
    await expect(options).toHaveCount(1);
    await expect(options.first()).toContainText('Personal');
    await expect(options.first()).toContainText('1 project');
  });
});

test.describe('Multiple identities: pill, dropdown, title prefix', () => {
  test.beforeEach(async ({ page }) => {
    await h.seedTwoIdentities(page);
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
  });

  test('the pill shows the active identity, and the title prefix shows "<label> /" before the project name', async ({ page }) => {
    await expect(page.locator('[data-testid=identity-pill]')).toContainText('Personal');
    await expect(page.locator('[data-testid=identity-title-prefix]')).toContainText('Personal');
    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText('Project A');
  });

  test('opening the dropdown lists both identities with state repo/project counts, a checkmark on the active one, the note line, and Manage identities...', async ({ page }) => {
    await page.locator('[data-testid=identity-pill]').click();
    const options = page.locator('[data-testid=identity-option]');
    await expect(options).toHaveCount(2);
    const texts = (await options.allTextContents()).map(t => t.replace(/\s+/g, ' ').trim());
    expect(texts[0]).toContain('Personal');
    expect(texts[0]).toContain('tom/personal-state');
    expect(texts[0]).toContain('1 project');
    expect(texts[1]).toContain('Northwind');
    expect(texts[1]).toContain('2 projects');
    await expect(options.first().locator('text=✓')).toBeVisible(); // active identity checked
    await expect(page.getByText('Switching reloads the project list and everything you write is attributed to that address.')).toBeVisible();
    await expect(page.locator('[data-testid=btn-manage-identities]')).toContainText('Manage identities…');
  });

  test('clicking outside the open dropdown closes it', async ({ page }) => {
    await page.locator('[data-testid=identity-pill]').click();
    await expect(page.locator('[data-testid=identity-option]')).toHaveCount(2);
    await page.mouse.click(700, 700);
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=identity-option]')).toHaveCount(0);
  });

  test('switching identity via the dropdown loads that identity\'s first project and updates the title prefix', async ({ page }) => {
    await page.locator('[data-testid=identity-pill]').click();
    await page.locator('[data-testid=identity-option]').nth(1).click();
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=identity-title-prefix]')).toContainText('Northwind');
    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText('Project B1');
  });

  test('switching back to a previously-active identity restores whichever of its projects was last active, not just its first', async ({ page }) => {
    await page.locator('[data-testid=identity-pill]').click();
    await page.locator('[data-testid=identity-option]').nth(1).click(); // -> Northwind, lands on Project B1
    await page.waitForTimeout(400);

    // Switch to Project B2 within Northwind before leaving.
    await h.openTrackerSwitcher(page);
    await h.milestoneRow(page, 'Project B2').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText('Project B2');

    // Back to Personal, then back to Northwind -- should remember B2, not re-default to B1.
    await page.locator('[data-testid=identity-pill]').click();
    await page.locator('[data-testid=identity-option]').nth(0).click();
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText('Project A');

    await page.locator('[data-testid=identity-pill]').click();
    await page.locator('[data-testid=identity-option]').nth(1).click();
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText('Project B2');
  });

  test('switching to an identity with zero projects shows no issues and none of the previous identity\'s data (uses switchProject\'s existing no-doc-found fallback, same one a not-yet-persisted project id already falls back to)', async ({ page }) => {
    await h.seedTwoIdentities(page, {
      projects: [
        { id: 'project-a', name: 'Project A', identityId: 'identity-a' },
      ],
    });
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    await page.locator('[data-testid=identity-pill]').click();
    await page.locator('[data-testid=identity-option]').nth(1).click(); // Northwind, 0 projects
    await page.waitForTimeout(400);

    // No phantom rows, and specifically none of Personal's data leaked
    // across the switch.
    await expect(page.locator('[data-testid=row]')).toHaveCount(0);
    await expect(page.getByText('Project A', { exact: true })).toHaveCount(0);
  });

  test('clicking "Manage identities..." closes the dropdown (Settings panel itself lands in a later batch)', async ({ page }) => {
    await page.locator('[data-testid=identity-pill]').click();
    await page.locator('[data-testid=btn-manage-identities]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=identity-option]')).toHaveCount(0);
  });
});
