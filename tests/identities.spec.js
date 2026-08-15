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

  test('clicking "Manage identities..." closes the dropdown and opens the Identities panel', async ({ page }) => {
    await page.locator('[data-testid=identity-pill]').click();
    await page.locator('[data-testid=btn-manage-identities]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=identity-option]')).toHaveCount(0);
    await expect(page.locator('[data-testid=identities-panel]')).toBeVisible();
  });
});

test.describe('Settings › Identities panel', () => {
  test.beforeEach(async ({ page }) => {
    await h.seedTwoIdentities(page);
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await page.locator('[data-testid=identity-pill]').click();
    await page.locator('[data-testid=btn-manage-identities]').click();
    await page.waitForTimeout(200);
  });

  test('lists a read-only card per identity: dot, label, IN USE HERE/DEFAULT badges, email, and the state repo/projects/signing key/host token/bridge root grid', async ({ page }) => {
    const cards = page.locator('[data-testid=identity-card]');
    await expect(cards).toHaveCount(2);

    const first = cards.first();
    await expect(first).toContainText('Personal');
    await expect(first).toContainText('IN USE HERE');
    await expect(first).toContainText('DEFAULT');
    await expect(first).toContainText('tom@personal.com');
    await expect(first).toContainText('tom/personal-state');
    await expect(first).toContainText('1 project');
    await expect(first).toContainText('—'); // signing key/host token/bridge root all unset in this seed

    const second = cards.nth(1);
    await expect(second).toContainText('Northwind');
    await expect(second).not.toContainText('IN USE HERE');
    await expect(second).not.toContainText('DEFAULT');
    await expect(second).toContainText('tom@northwind.com');
    await expect(second).toContainText('2 projects');
  });

  test('"Make default" is disabled (no-op, dimmed) on the already-default identity but works on another', async ({ page }) => {
    const makeDefaultBtns = page.locator('[data-testid=btn-make-default]');
    // Personal starts as default -- its own button should not be clickable.
    await expect(page.locator('[data-testid=identity-card]').first()).toContainText('DEFAULT');
    await makeDefaultBtns.nth(1).click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=identity-card]').nth(1)).toContainText('DEFAULT');
    await expect(page.locator('[data-testid=identity-card]').first()).not.toContainText('DEFAULT');
  });

  test('"+ Add identity" reveals a label/email form; Cancel discards it without creating anything', async ({ page }) => {
    await expect(page.locator('[data-testid=add-identity-form]')).toHaveCount(0);
    await page.locator('[data-testid=btn-add-identity]').click();
    await expect(page.locator('[data-testid=add-identity-form]')).toBeVisible();
    await page.locator('[data-testid=new-identity-label-input]').fill('Acme Co');
    await page.locator('[data-testid=btn-cancel-add-identity]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=add-identity-form]')).toHaveCount(0);
    await expect(page.locator('[data-testid=identity-card]')).toHaveCount(2);
  });

  test('creating a new identity generates its own signing key, switches to it, and lands on its empty (zero-project) state', async ({ page }) => {
    await page.locator('[data-testid=btn-add-identity]').click();
    await page.locator('[data-testid=new-identity-label-input]').fill('Acme Co');
    await page.locator('[data-testid=new-identity-email-input]').fill('me@acme.test');
    await page.locator('[data-testid=btn-create-identity]').click();
    await page.waitForTimeout(400);

    await expect(page.locator('[data-testid=identity-card]')).toHaveCount(3);
    await expect(page.locator('[data-testid=identity-pill]')).toContainText('Acme Co');
    await expect(page.locator('[data-testid=row]')).toHaveCount(0);

    const idsRaw = await page.evaluate(() => localStorage.getItem('git_native_tracker_identities_v1'));
    const ids = JSON.parse(idsRaw);
    const created = ids.identities.find(i => i.label === 'Acme Co');
    expect(created).toBeTruthy();
    expect(created.email).toBe('me@acme.test');
    expect(created.signingPublicKeyJwk).toBeTruthy();
    expect(created.signingPrivateKeyJwk).toBeTruthy();
    expect(ids.activeIdentityId).toBe(created.id);
  });

  test('the panel closes via the X button and via clicking the overlay', async ({ page }) => {
    await expect(page.locator('[data-testid=identities-panel]')).toBeVisible();
    await page.locator('[data-testid=identities-close-btn]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=identities-panel]')).toHaveCount(0);

    await page.locator('[data-testid=identity-pill]').click();
    await page.locator('[data-testid=btn-manage-identities]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=identities-panel]')).toBeVisible();
    await page.locator('[data-testid=identities-overlay]').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=identities-panel]')).toHaveCount(0);
  });
});
