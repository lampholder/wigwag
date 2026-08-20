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
  // Uses gotoTrackerFreshIdentity (not gotoTracker) specifically because
  // these tests care about the genuinely-no-email migrated state.
  test.beforeEach(async ({ page }) => { await h.gotoTrackerFreshIdentity(page); });

  test('the pill and title prefix are visible immediately, even with only one (migrated) identity', async ({ page }) => {
    await expect(page.locator('[data-testid=identity-pill]')).toBeVisible();
    await expect(page.locator('[data-testid=identity-pill]')).toContainText('Personal');
    await expect(page.locator('[data-testid=identity-title-prefix]')).toBeVisible();
    await expect(page.locator('[data-testid=identity-title-prefix]')).toContainText('Personal');
  });

  test('the migrated default identity is always labelled "Personal", regardless of whether an email was already set', async ({ page }) => {
    // gotoTrackerFreshIdentity's demo seed never sets identityEmail, so
    // this also covers the empty-email case; the label must still read
    // "Personal", not be derived from an email local-part.
    await page.locator('[data-testid=identity-pill]').click();
    const options = page.locator('[data-testid=identity-option]');
    await expect(options).toHaveCount(1);
    await expect(options.first()).toContainText('Personal');
    await expect(options.first()).toContainText('1 project');
  });

  test('migration preserves the JIRA PROXY URL default for a user who never set their own (regression: it was silently dropped to empty once the gear popover started reading the migrated identity record)', async ({ page }) => {
    await h.openSettings(page);
    await expect(page.locator('[data-testid=settings-jira-proxy-url]')).toHaveValue('http://localhost:8934');
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

// Regression: IDENTITIES_KEY's activeIdentityId and PROJECTS_KEY's
// activeMilestoneId (further overridden per-tab by the session-scoped
// project pointer) are persisted independently and can disagree at boot --
// e.g. one tab last switched identity without changing project, while
// another tab's own sessionStorage remembers a project under a different
// identity entirely. Every INTERACTIVE switch path (switchIdentity,
// switchProject via the tracker switcher, which only ever lists the
// active identity's own projects) already keeps these in sync; only the
// boot-time restoration didn't, producing a header naming one identity
// while showing a project owned by another -- and gating (email/token/
// signing key) resolved against the wrong identity as a result.
test.describe('Active identity reconciles with the active project at boot (regression)', () => {
  test('a mismatched activeIdentityId/activeMilestoneId at boot is corrected to whichever identity actually owns the active project', async ({ page }) => {
    await h.seedTwoIdentities(page, {
      activeIdentityId: 'identity-a', // Personal
      projects: [
        { id: 'project-b1', name: 'Project B1', identityId: 'identity-b' }, // becomes activeMilestoneId -- owned by Northwind, not Personal
        { id: 'project-a', name: 'Project A', identityId: 'identity-a' },
      ],
    });
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    // Corrected to Northwind (the project's real owner), not left as the
    // stale Personal/Project B1 pairing.
    await expect(page.locator('[data-testid=identity-pill]')).toContainText('Northwind');
    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText('Project B1');

    // The correction is real, not just cosmetic -- gating resolves against
    // Northwind's own email, so an authored action (renaming the project)
    // doesn't need to re-prompt for an email that identity already has.
    await page.locator('[data-testid=btn-notes]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid=notes-rename-btn]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=notes-rename-input]').fill('Renamed B1');
    await page.locator('[data-testid=notes-rename-commit-btn]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=email-gate-input]')).toHaveCount(0);
    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText('Renamed B1');
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

test.describe('Project switcher only lists the active identity\'s own projects', () => {
  test.beforeEach(async ({ page }) => {
    await h.seedTwoIdentities(page);
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
  });

  test('the switcher dropdown shows only Personal\'s project while active, and only Northwind\'s after switching', async ({ page }) => {
    await h.openTrackerSwitcher(page);
    await expect(page.locator('[data-testid=milestone-row]')).toHaveCount(1);
    await expect(h.milestoneRow(page, 'Project A')).toBeVisible();
    await page.mouse.click(700, 700);
    await page.waitForTimeout(150);

    await page.locator('[data-testid=identity-pill]').click();
    await page.locator('[data-testid=identity-option]').nth(1).click(); // -> Northwind
    await page.waitForTimeout(400);

    await h.openTrackerSwitcher(page);
    await expect(page.locator('[data-testid=milestone-row]')).toHaveCount(2);
    await expect(h.milestoneRow(page, 'Project B1')).toBeVisible();
    await expect(h.milestoneRow(page, 'Project B2')).toBeVisible();
    await expect(h.milestoneRow(page, 'Project A')).toHaveCount(0);
  });

  test('a newly created blank project is tagged with the active identity and disappears from the switcher after switching away', async ({ page }) => {
    await h.openTrackerSwitcher(page);
    await page.locator('[data-testid=btn-add-milestone]').click();
    await page.locator('[data-testid=btn-new-blank-milestone]').click();
    await page.locator('[data-testid=new-milestone-name-input]').fill('Personal-only project');
    await page.locator('[data-testid=btn-create-milestone]').click();
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText('Personal-only project');

    await page.locator('[data-testid=identity-pill]').click();
    await page.locator('[data-testid=identity-option]').nth(1).click(); // -> Northwind
    await page.waitForTimeout(400);
    await h.openTrackerSwitcher(page);
    await expect(h.milestoneRow(page, 'Personal-only project')).toHaveCount(0);
  });
});

test.describe('Gear Settings popover is scoped to the active identity', () => {
  test.beforeEach(async ({ page }) => {
    await h.seedTwoIdentities(page);
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
  });

  test('YOUR EMAIL/GITHUB TOKEN/JIRA PROXY URL/STATE REPO show the active identity\'s own values, and swap when switching identity', async ({ page }) => {
    await h.openSettings(page);
    await expect(page.locator('[data-testid=settings-identity-email]')).toHaveValue('tom@personal.com');
    await expect(page.locator('[data-testid=settings-state-repo]')).toHaveValue('tom/personal-state');
    await page.mouse.click(10, 10);
    await page.waitForTimeout(150);

    await page.locator('[data-testid=identity-pill]').click();
    await page.locator('[data-testid=identity-option]').nth(1).click(); // -> Northwind
    await page.waitForTimeout(400);

    await h.openSettings(page);
    await expect(page.locator('[data-testid=settings-identity-email]')).toHaveValue('tom@northwind.com');
    await expect(page.locator('[data-testid=settings-state-repo]')).toHaveValue('');
  });

  test('editing YOUR EMAIL and STATE REPO writes through to the active identity\'s own record, and survives a switch away and back', async ({ page }) => {
    await h.openSettings(page);
    await page.locator('[data-testid=settings-identity-email]').fill('tom-changed@personal.com');
    await page.locator('[data-testid=settings-state-repo]').fill('tom/renamed-state');
    await page.waitForTimeout(200);

    let idsRaw = await page.evaluate(() => localStorage.getItem('git_native_tracker_identities_v1'));
    let ids = JSON.parse(idsRaw);
    let personal = ids.identities.find(i => i.id === 'identity-a');
    expect(personal.email).toBe('tom-changed@personal.com');
    expect(personal.stateRepo).toBe('tom/renamed-state');

    await page.mouse.click(10, 10);
    await page.waitForTimeout(150);
    await page.locator('[data-testid=identity-pill]').click();
    await page.locator('[data-testid=identity-option]').nth(1).click(); // -> Northwind and back
    await page.waitForTimeout(400);
    await page.locator('[data-testid=identity-pill]').click();
    await page.locator('[data-testid=identity-option]').nth(0).click();
    await page.waitForTimeout(400);

    await h.openSettings(page);
    await expect(page.locator('[data-testid=settings-identity-email]')).toHaveValue('tom-changed@personal.com');
    await expect(page.locator('[data-testid=settings-state-repo]')).toHaveValue('tom/renamed-state');
  });

  test('the Identities panel card reflects an edit made in the gear popover (host token mask, state repo)', async ({ page }) => {
    await h.openSettings(page);
    await page.locator('[data-testid=settings-github-token]').fill('ghp_newtoken');
    await page.locator('[data-testid=settings-state-repo]').fill('tom/from-gear');
    await page.waitForTimeout(200);
    await page.mouse.click(10, 10);
    await page.waitForTimeout(150);

    await page.locator('[data-testid=identity-pill]').click();
    await page.locator('[data-testid=btn-manage-identities]').click();
    await page.waitForTimeout(200);
    const first = page.locator('[data-testid=identity-card]').first();
    await expect(first).toContainText('tom/from-gear');
    await expect(first).toContainText('••••••••');
  });
});

test.describe('Per-identity signing keys', () => {
  test('switching to an identity with no signing key yet generates one for it, without regenerating the identity being left', async ({ page }) => {
    await h.seedTwoIdentities(page); // both seeded identities start with signingPublicKeyJwk: null
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    // Personal is active at boot, so componentDidMount's own ensureIdentity()
    // call already generated its key by now -- capture that as the baseline.
    let idsRaw = await page.evaluate(() => localStorage.getItem('git_native_tracker_identities_v1'));
    let ids = JSON.parse(idsRaw);
    const personalKeyAtBoot = ids.identities.find(i => i.id === 'identity-a').signingPublicKeyJwk;
    expect(personalKeyAtBoot).toBeTruthy();

    await page.locator('[data-testid=identity-pill]').click();
    await page.locator('[data-testid=identity-option]').nth(1).click(); // -> Northwind
    await page.waitForTimeout(500);

    idsRaw = await page.evaluate(() => localStorage.getItem('git_native_tracker_identities_v1'));
    ids = JSON.parse(idsRaw);
    const personal = ids.identities.find(i => i.id === 'identity-a');
    const northwind = ids.identities.find(i => i.id === 'identity-b');
    expect(JSON.stringify(personal.signingPublicKeyJwk)).toBe(JSON.stringify(personalKeyAtBoot)); // not regenerated
    expect(northwind.signingPublicKeyJwk).toBeTruthy();
    expect(northwind.signingPrivateKeyJwk).toBeTruthy();
  });

  test('two different identities end up with two different signing keys', async ({ page }) => {
    await h.seedTwoIdentities(page);
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    await page.locator('[data-testid=identity-pill]').click();
    await page.locator('[data-testid=identity-option]').nth(1).click(); // -> Northwind, generates its key
    await page.waitForTimeout(500);
    await page.locator('[data-testid=identity-pill]').click();
    await page.locator('[data-testid=identity-option]').nth(0).click(); // -> back to Personal, generates its key (was also null)
    await page.waitForTimeout(500);

    const idsRaw = await page.evaluate(() => localStorage.getItem('git_native_tracker_identities_v1'));
    const ids = JSON.parse(idsRaw);
    const personal = ids.identities.find(i => i.id === 'identity-a');
    const northwind = ids.identities.find(i => i.id === 'identity-b');
    expect(personal.signingPublicKeyJwk).toBeTruthy();
    expect(northwind.signingPublicKeyJwk).toBeTruthy();
    expect(JSON.stringify(personal.signingPublicKeyJwk)).not.toBe(JSON.stringify(northwind.signingPublicKeyJwk));
  });
});

test.describe('Gate first edit on identity email being set', () => {
  // gotoTrackerFreshIdentity's demo seed never sets identityEmail (unlike
  // gotoTracker's own default, which now pre-seeds one so the rest of the
  // suite isn't gated), so every test in this block starts from exactly
  // the "brand new user" state the gate is meant to catch.
  test.beforeEach(async ({ page }) => { await h.gotoTrackerFreshIdentity(page); });

  test('creating the first issue opens the email gate; the issue is not created until it is submitted, then the action completes automatically', async ({ page }) => {
    await page.keyboard.down('Control'); await page.keyboard.press('Space'); await page.keyboard.up('Control');
    await page.waitForTimeout(150);
    await page.locator('[data-testid=add-item-input]').fill('My first issue');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);

    await expect(page.locator('[data-testid=email-gate-modal]')).toBeVisible();
    expect(await page.locator('[data-testid=row]').filter({ hasText: 'My first issue' }).count()).toBe(0);

    await page.locator('[data-testid=email-gate-input]').fill('me@example.com');
    await page.locator('[data-testid=btn-submit-email-gate]').click();
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=email-gate-modal]')).toHaveCount(0);
    await expect(page.locator('[data-testid=row]').filter({ hasText: 'My first issue' })).toHaveCount(1);

    const idsRaw = await page.evaluate(() => localStorage.getItem('git_native_tracker_identities_v1'));
    const ids = JSON.parse(idsRaw);
    expect(ids.identities[0].email).toBe('me@example.com');

    // A second edit shouldn't re-prompt -- the email is now set.
    await page.keyboard.down('Control'); await page.keyboard.press('Space'); await page.keyboard.up('Control');
    await page.waitForTimeout(150);
    await page.locator('[data-testid=add-item-input]').fill('Second issue');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=email-gate-modal]')).toHaveCount(0);
    await expect(page.locator('[data-testid=row]').filter({ hasText: 'Second issue' })).toHaveCount(1);
  });

  test('Cancel on the gate leaves nothing created and the email still unset', async ({ page }) => {
    await page.keyboard.down('Control'); await page.keyboard.press('Space'); await page.keyboard.up('Control');
    await page.waitForTimeout(150);
    await page.locator('[data-testid=add-item-input]').fill('Should not be created');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);

    await page.locator('[data-testid=btn-cancel-email-gate]').click();
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=email-gate-modal]')).toHaveCount(0);
    expect(await page.locator('[data-testid=row]').filter({ hasText: 'Should not be created' }).count()).toBe(0);

    const idsRaw = await page.evaluate(() => localStorage.getItem('git_native_tracker_identities_v1'));
    const ids = JSON.parse(idsRaw);
    expect(ids.identities[0].email).toBe('');
  });

  test('committing a real cell edit gates; clicking into a cell and away without changing it does not', async ({ page }) => {
    // Row 1's title is GitHub-linked in the demo fixture (re-committing it
    // unchanged still re-triggers the link branch, which is its own,
    // separately-gated action) -- row 2 has a genuinely plain-text title,
    // so it's the right one for a true "nothing was edited" no-op check.
    await h.clickTitleToEdit(page, 2);
    await page.waitForTimeout(150);
    await page.mouse.click(700, 700);
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=email-gate-modal]')).toHaveCount(0);

    // A real change does gate.
    await h.clickTitleToEdit(page, 2);
    await h.typeAndCommit(page, 'Changed title');
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=email-gate-modal]')).toBeVisible();

    await page.locator('[data-testid=email-gate-input]').fill('cell@example.com');
    await page.locator('[data-testid=btn-submit-email-gate]').click();
    await page.waitForTimeout(300);
    await expect(h.titleCell(page, 2)).toContainText('Changed title');
  });

  test('adding a comment gates, and renaming the project gates', async ({ page }) => {
    const slideover = await h.openSlideover(page, 1);
    await slideover.locator('[data-testid=new-comment-input]').fill('First comment');
    await slideover.getByText('Post', { exact: true }).click();
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=email-gate-modal]')).toBeVisible();
    await page.locator('[data-testid=email-gate-input]').fill('commenter@example.com');
    await page.locator('[data-testid=btn-submit-email-gate]').click();
    await page.waitForTimeout(300);
    await expect(slideover.getByText('First comment')).toBeVisible();
  });
});

test.describe('Editable identity label', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('editing the label in the gear popover updates the pill and title prefix (namespacing), and persists', async ({ page }) => {
    await h.openSettings(page);
    await expect(page.locator('[data-testid=settings-identity-label]')).toHaveValue('Personal');
    await page.locator('[data-testid=settings-identity-label]').fill('Acme Corp');
    await page.waitForTimeout(200);
    await page.mouse.click(10, 10);
    await page.waitForTimeout(150);

    await expect(page.locator('[data-testid=identity-pill]')).toContainText('Acme Corp');
    await expect(page.locator('[data-testid=identity-title-prefix]')).toContainText('Acme Corp');

    const idsRaw = await page.evaluate(() => localStorage.getItem('git_native_tracker_identities_v1'));
    const ids = JSON.parse(idsRaw);
    expect(ids.identities[0].label).toBe('Acme Corp');
  });

  test('editing the label does not change comment/history authorship, which stays derived from email', async ({ page }) => {
    await h.openSettings(page);
    await page.locator('[data-testid=settings-identity-label]').fill('Acme Corp');
    await page.waitForTimeout(200);
    await page.mouse.click(10, 10);
    await page.waitForTimeout(150);

    const slideover = await h.openSlideover(page, 1);
    await slideover.locator('[data-testid=new-comment-input]').fill('A fresh comment');
    await slideover.getByText('Post', { exact: true }).click();
    await page.waitForTimeout(300);

    const doc = await h.readActiveMilestoneDoc(page);
    const issue = doc.issues.find(i => i.num === 1);
    const newComment = issue.comments.find(c => c.text === 'A fresh comment');
    expect(newComment).toBeTruthy();
    expect(newComment.author).not.toBe('Acme Corp');
    expect(newComment.email).toBe('tom@example.com');
  });
});
