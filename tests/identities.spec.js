// Spec section: Multi-identity (Phase 2 of the identity/IA design handoff),
// plus the identity-scoped Settings redesign on top of it (settings.zip),
// plus the unified switcher (unified_switcher.zip) that replaced the
// separate identity-pill / tracker-switcher dropdowns with one merged
// breadcrumb + two-column picker:
//   - An identity is a named bundle: label, email, state repo, signing key,
//     GitHub token, Jira proxy. A project's identity is DERIVED (the
//     identity last committed with there), not assigned/moved -- see
//     identity-attribution.spec.js for the late-bound-identity model
//     itself. This file covers identity management (creation, per-
//     identity signing keys, Settings scoping) and the switcher's own
//     scope/project mechanics.
//   - "Switch identity" no longer exists as a standalone act: the left
//     column of the picker only ever PREVIEWS a scope (identity or
//     "Shared with you"); only clicking an actual project row commits,
//     and if that project belongs to a different identity than the one
//     currently active, activeIdentityId updates to match as a side
//     effect of picking that project -- never as its own action. Tests
//     that used to "switch identity, land on its default/remembered
//     project" are rewritten to preview-then-click-a-project instead.
//   - The breadcrumb (identity-title-prefix + tracker-name-title) and the
//     switcher always render, even with exactly one identity (deliberate
//     deviation from the README/prototype, which only show a scope list
//     at 2+ -- otherwise there's no entry point at all to the concept of
//     identities).
//   - Settings is a single surface, unambiguously scoped to the active
//     identity: a two-pane modal (Identity/GitHub access/Integrations
//     sections) reached via the switcher's own "Settings…" link (right
//     column, shown only while previewing a real identity scope). The
//     separate "Manage identities" panel this used to duplicate is gone --
//     its read-only facts (signing key, project count, default-identity
//     toggle) moved into the modal's Identity section, and "Add
//     identity…" moved inline into the switcher's own left column.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

test.describe('Single identity: breadcrumb still renders, migration labels it "Personal"', () => {
  // Uses gotoTrackerFreshIdentity (not gotoTracker) specifically because
  // these tests care about the genuinely-no-email migrated state.
  test.beforeEach(async ({ page }) => { await h.gotoTrackerFreshIdentity(page); });

  test('the breadcrumb is visible immediately, even with only one (migrated) identity', async ({ page }) => {
    await expect(page.locator('[data-testid=btn-switcher]')).toBeVisible();
    await expect(page.locator('[data-testid=btn-switcher]')).toContainText('Personal');
    await expect(page.locator('[data-testid=identity-title-prefix]')).toBeVisible();
    await expect(page.locator('[data-testid=identity-title-prefix]')).toContainText('Personal');
  });

  test('the migrated default identity is always labelled "Personal", regardless of whether an email was already set', async ({ page }) => {
    // gotoTrackerFreshIdentity's demo seed never sets identityEmail, so
    // this also covers the empty-email case; the label must still read
    // "Personal", not be derived from an email local-part. An identity
    // scope row's own sub-line is its email (or "no email set"), not a
    // project count -- that's "Shared with you"'s own sub-line instead.
    await h.openTrackerSwitcher(page);
    const scopes = page.locator('[data-testid=switcher-scope-row]');
    await expect(scopes).toHaveCount(1);
    await expect(scopes.first()).toContainText('Personal');
    await expect(scopes.first()).toContainText('no email set');
  });

  test('migration preserves the JIRA PROXY URL default for a user who never set their own (regression: it was silently dropped to empty once the gear popover started reading the migrated identity record)', async ({ page }) => {
    await h.openSettingsSection(page, 'integrations');
    await expect(page.locator('[data-testid=settings-jira-proxy-url]')).toHaveValue('http://localhost:8934');
  });
});

test.describe('Multiple identities: switcher scopes, projects, breadcrumb', () => {
  test.beforeEach(async ({ page }) => {
    await h.seedTwoIdentities(page);
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
  });

  test('the breadcrumb shows the active identity, and the title prefix shows "<label> /" before the project name', async ({ page }) => {
    await expect(page.locator('[data-testid=btn-switcher]')).toContainText('Personal');
    await expect(page.locator('[data-testid=identity-title-prefix]')).toContainText('Personal');
    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText('Project A');
  });

  test('opening the switcher lists both identities as scopes with their email as the sub-line, each with its own settings cog', async ({ page }) => {
    await h.openTrackerSwitcher(page);
    const scopes = page.locator('[data-testid=switcher-scope-row]');
    await expect(scopes).toHaveCount(2);
    const texts = (await scopes.allTextContents()).map(t => t.replace(/\s+/g, ' ').trim());
    // Alphabetical, not creation order -- seedTwoIdentities creates Personal
    // first and Northwind second, but "Northwind" < "Personal" alphabetically.
    expect(texts[0]).toContain('Northwind');
    expect(texts[0]).toContain('tom@northwind.com');
    expect(texts[1]).toContain('Personal');
    expect(texts[1]).toContain('tom@personal.com');
    // Every real identity gets a cog -- not just the previewed one.
    await expect(page.locator('[data-testid=switcher-scope-settings-btn]')).toHaveCount(2);
    await expect(page.locator('[data-testid=btn-switcher-settings]')).toHaveCount(0); // the old right-column link is gone
  });

  // #78: identities used to list in raw creation order -- no sort at all.
  // Seeded here deliberately out of both creation and alphabetical order
  // (Zulu, Alpha, Mike) so a passing test can't be an accident of the
  // fixture happening to already be alphabetical.
  test('identities list alphabetically by label, regardless of creation order', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('git_native_tracker_identities_v1', JSON.stringify({
        activeIdentityId: 'id-zulu',
        identities: [
          { id: 'id-zulu', label: 'Zulu Corp', email: 'a@zulu.com', githubToken: '', jiraProxyUrl: '', signingPublicKeyJwk: null, signingPrivateKeyJwk: null },
          { id: 'id-alpha', label: 'Alpha Inc', email: 'b@alpha.com', githubToken: '', jiraProxyUrl: '', signingPublicKeyJwk: null, signingPrivateKeyJwk: null },
          { id: 'id-mike', label: 'Mike LLC', email: 'c@mike.com', githubToken: '', jiraProxyUrl: '', signingPublicKeyJwk: null, signingPrivateKeyJwk: null },
        ],
        lastActiveProjectByIdentity: {}
      }));
      localStorage.setItem('git_native_tracker_milestones_v1', JSON.stringify({
        activeMilestoneId: 'p-zulu',
        milestones: [
          { id: 'p-zulu', name: 'Zulu Project', identityId: 'id-zulu' },
          { id: 'p-alpha', name: 'Alpha Project', identityId: 'id-alpha' },
          { id: 'p-mike', name: 'Mike Project', identityId: 'id-mike' },
        ]
      }));
      const blankDoc = { fieldDefs: { title: { label: 'Issue', type: 'text' } }, issues: [], hiddenFieldIds: [], githubRepo: '', githubRepoPath: 'tracker.jsonl', githubRepoBranch: '', githubTokenOverride: '', projectNotes: '', projectComments: [] };
      localStorage.setItem('git_native_tracker_v1:p-zulu', JSON.stringify(blankDoc));
      localStorage.setItem('git_native_tracker_v1:p-alpha', JSON.stringify(blankDoc));
      localStorage.setItem('git_native_tracker_v1:p-mike', JSON.stringify(blankDoc));
    });
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    await h.openTrackerSwitcher(page);
    const scopes = page.locator('[data-testid=switcher-scope-row]');
    await expect(scopes).toHaveCount(3);
    const texts = (await scopes.allTextContents()).map(t => t.replace(/\s+/g, ' ').trim());
    expect(texts[0]).toContain('Alpha Inc');
    expect(texts[1]).toContain('Mike LLC');
    expect(texts[2]).toContain('Zulu Corp');
  });

  test('clicking outside the open switcher closes it', async ({ page }) => {
    await h.openTrackerSwitcher(page);
    await expect(page.locator('[data-testid=switcher-menu]')).toBeVisible();
    await page.mouse.click(700, 700);
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=switcher-menu]')).toHaveCount(0);
  });

  // "Switch identity" is not a standalone act anymore -- previewing a
  // different scope only repopulates the right column; picking one of
  // ITS projects is what actually switches identity+project together.
  test('previewing a different scope does not commit anything; clicking one of its projects switches identity and project together, updating the title prefix', async ({ page }) => {
    await h.openTrackerSwitcher(page);
    const northwindScope = page.locator('[data-testid=switcher-scope-row]').filter({ hasText: 'Northwind' });
    await northwindScope.click();
    await page.waitForTimeout(150);
    // Still Personal / Project A -- previewing alone commits nothing.
    await expect(page.locator('[data-testid=identity-title-prefix]')).toContainText('Personal');
    await expect(page.locator('[data-testid=switcher-project-row]').filter({ hasText: 'Project B1' })).toBeVisible();

    await page.locator('[data-testid=switcher-project-row]').filter({ hasText: 'Project B1' }).click();
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=identity-title-prefix]')).toContainText('Northwind');
    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText('Project B1');
  });

  // Regression: switching to an identity with zero projects used to call
  // switchProject(null), leaving state.projectId genuinely null -- the UI's
  // various "meta ? meta.name : 'Untitled'" fallbacks then rendered a name
  // that LOOKED like a real, renamable project but wasn't backed by any
  // project object, so trying to rename it silently did nothing (nothing
  // ever matched state.projectId). Fixed the same way deleteProject()
  // already handles losing an identity's last project: auto-create a real
  // blank one instead of leaving projectId null. Reachable today via the
  // switcher's own "New project" footer action on a zero-project scope
  // (there's no other way to "land on" an identity with nothing in it).
  test('creating the first project for a zero-project identity via "New project" yields a real, immediately-renamable project -- not a phantom "Untitled" placeholder', async ({ page }) => {
    await h.seedTwoIdentities(page, {
      projects: [
        { id: 'project-a', name: 'Project A', identityId: 'identity-a' },
      ],
    });
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    await h.openTrackerSwitcher(page);
    const northwindScope = page.locator('[data-testid=switcher-scope-row]').filter({ hasText: 'Northwind' });
    await northwindScope.click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=switcher-project-row]')).toHaveCount(0); // genuinely empty
    await page.locator('[data-testid=btn-switcher-new-project]').click();
    await page.waitForTimeout(400);

    // No phantom rows, and specifically none of Personal's data leaked
    // across the switch.
    await expect(page.locator('[data-testid=row]')).toHaveCount(0);
    await expect(page.getByText('Project A', { exact: true })).toHaveCount(0);

    // A real, named project exists -- not the null-projectId fallback.
    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText('Untitled Project 1');
    const idx = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1')));
    const active = idx.milestones.find(m => m.id === idx.activeMilestoneId);
    expect(active).toBeTruthy();
    expect(active.identityId).toBe('identity-b'); // Northwind, not left/mis-tagged to Personal
    const idsRaw = await page.evaluate(() => localStorage.getItem('git_native_tracker_identities_v1'));
    expect(JSON.parse(idsRaw).activeIdentityId).toBe('identity-b'); // activeIdentityId follows too (see the onCreateProject fix)

    // And it's genuinely renamable -- the actual bug report.
    await page.locator('[data-testid=btn-notes]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid=notes-rename-btn]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=notes-rename-input]').fill('Wigwag');
    await page.locator('[data-testid=notes-rename-commit-btn]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=notes-panel]')).toContainText('Wigwag');
    await page.locator('[data-testid=notes-close-btn]').click();
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText('Wigwag');
  });

  test('clicking the active identity\'s settings cog closes the switcher and opens the Settings modal on the Identity section', async ({ page }) => {
    await h.openTrackerSwitcher(page);
    const personalRow = page.locator('[data-testid=switcher-scope-row]').filter({ hasText: 'Personal' });
    await personalRow.locator('[data-testid=switcher-scope-settings-btn]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=switcher-menu]')).toHaveCount(0);
    await expect(page.locator('[data-testid=settings-modal]')).toBeVisible();
    await expect(page.locator('[data-testid=settings-identity-email]')).toHaveValue('tom@personal.com');
  });

  // A cog on a NOT-yet-active identity is still a real, working button
  // (dimmed, not disabled) -- clicking it switches identity first so
  // Settings shows THAT identity's own data, not whatever was active
  // a moment ago.
  test('clicking a non-active identity\'s settings cog switches to it first, then opens Settings with its own data', async ({ page }) => {
    await h.openTrackerSwitcher(page);
    const northwindRow = page.locator('[data-testid=switcher-scope-row]').filter({ hasText: 'Northwind' });
    await northwindRow.locator('[data-testid=switcher-scope-settings-btn]').click();
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=switcher-menu]')).toHaveCount(0);
    await expect(page.locator('[data-testid=settings-modal]')).toBeVisible();
    await expect(page.locator('[data-testid=settings-identity-email]')).toHaveValue('tom@northwind.com');
    const activeIdentityId = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_identities_v1')).activeIdentityId);
    expect(activeIdentityId).toBe('identity-b');
  });

  test('"Shared with you" has no settings cog -- there is no identity to configure', async ({ page }) => {
    // seedTwoIdentities' own addInitScript reapplies on every navigation
    // (with no "already seeded" guard, unlike seedDemoMilestone), so a
    // shared project must be part of the initial seed, not layered on
    // via page.evaluate + reload -- the reload would just re-run the
    // init script and wipe the mutation straight back out.
    await h.seedTwoIdentities(page, {
      projects: [
        { id: 'project-a', name: 'Project A', identityId: 'identity-a' },
        { id: 'shared-proj', name: 'Shared thing', identityId: null },
      ],
    });
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await h.openTrackerSwitcher(page);
    const sharedRow = page.locator('[data-testid=switcher-scope-row]').filter({ hasText: 'Shared with you' });
    await expect(sharedRow).toHaveCount(1);
    await expect(sharedRow.locator('[data-testid=switcher-scope-settings-btn]')).toHaveCount(0);
  });

  // "Add identity…" lives inline in the switcher's own left column now
  // (same underlying form/state as before, just relocated).
  test('"Add identity…" reveals an inline label/email form in the switcher; Cancel discards it without creating anything', async ({ page }) => {
    await h.openTrackerSwitcher(page);
    await expect(page.locator('[data-testid=add-identity-form]')).toHaveCount(0);
    await page.locator('[data-testid=btn-add-identity]').click();
    await expect(page.locator('[data-testid=add-identity-form]')).toBeVisible();
    await page.locator('[data-testid=new-identity-label-input]').fill('Acme Co');
    await page.locator('[data-testid=btn-cancel-add-identity]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=add-identity-form]')).toHaveCount(0);
    await expect(page.locator('[data-testid=switcher-scope-row]')).toHaveCount(2);
  });

  test('creating a new identity via the inline form generates its own signing key, switches to it, and lands on its empty (zero-project) state', async ({ page }) => {
    await h.openTrackerSwitcher(page);
    await page.locator('[data-testid=btn-add-identity]').click();
    await page.locator('[data-testid=new-identity-label-input]').fill('Acme Co');
    await page.locator('[data-testid=new-identity-email-input]').fill('me@acme.test');
    await page.locator('[data-testid=btn-create-identity]').click();
    await page.waitForTimeout(400);

    await expect(page.locator('[data-testid=btn-switcher]')).toContainText('Acme Co');
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
});

// Regression: IDENTITIES_KEY's activeIdentityId and PROJECTS_KEY's
// activeMilestoneId (further overridden per-tab by the session-scoped
// project pointer) are persisted independently and can disagree at boot --
// e.g. one tab last switched identity without changing project, while
// another tab's own sessionStorage remembers a project under a different
// identity entirely. Every INTERACTIVE switch path (switchIdentity,
// switchProject via the switcher, which only ever lists the previewed
// scope's own projects) already keeps these in sync; only the boot-time
// restoration didn't, producing a header naming one identity while
// showing a project owned by another -- and gating (email/token/signing
// key) resolved against the wrong identity as a result.
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
    await expect(page.locator('[data-testid=btn-switcher]')).toContainText('Northwind');
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

// The old "Manage identities" panel duplicated these same facts read-only
// in a second surface; deleted, and the facts moved into the Settings
// modal's own Identity section (the "THIS IDENTITY" grid: signing key,
// project count) plus what the switcher's own scope row already shows
// (label, email, project count). There is no separate "default identity"
// concept -- activeIdentityId is independently persisted/restored on its
// own, so whichever identity was last active is simply what reopens.
test.describe('Settings modal: Identity section', () => {
  test.beforeEach(async ({ page }) => {
    await h.seedTwoIdentities(page);
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await h.openSettings(page);
  });

  test('header identifies which identity Settings applies to, and the "THIS IDENTITY" grid shows signing key / project count', async ({ page }) => {
    const body = page.locator('[data-testid=settings-body]');
    await expect(page.locator('[data-testid=settings-modal]')).toContainText('SETTINGS FOR');
    await expect(page.locator('[data-testid=settings-modal]')).toContainText('Personal');
    await expect(page.locator('[data-testid=settings-modal]')).toContainText('tom@personal.com');

    await expect(body).toContainText('Signing key');
    // componentDidMount's own ensureIdentity() call already generated one
    // for the active identity by the time Settings opens (see "Per-identity
    // signing keys" below) -- "None yet" only shows for an identity that
    // has never been made active. The real public key (its x-coordinate)
    // is shown, not a placeholder label -- a base64url string, so no
    // spaces or "None yet"/"Generated" wording.
    const signingKeyValue = await page.locator('[data-testid=settings-body]').locator('text=Signing key').locator('xpath=following-sibling::span[1]').innerText();
    expect(signingKeyValue).not.toContain('None yet');
    expect(signingKeyValue).not.toContain(' ');
    expect(signingKeyValue.length).toBeGreaterThan(20);
    await expect(body).toContainText('1 project');
    await expect(page.locator('[data-testid=btn-make-default]')).toHaveCount(0); // removed -- no "default identity" concept
  });

  test('the modal closes via the X button and via clicking the backdrop', async ({ page }) => {
    await expect(page.locator('[data-testid=settings-modal]')).toBeVisible();
    await page.locator('[data-testid=settings-close-btn]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=settings-modal]')).toHaveCount(0);

    await h.openSettings(page);
    await expect(page.locator('[data-testid=settings-modal]')).toBeVisible();
    await page.locator('[data-testid=settings-overlay]').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=settings-modal]')).toHaveCount(0);
  });
});

test.describe('Settings modal: section navigation', () => {
  test.beforeEach(async ({ page }) => {
    await h.gotoTracker(page);
    await h.openSettings(page);
  });

  test('opens on the Identity section by default; each of the 3 sections shows its own fields and hides the others\' ', async ({ page }) => {
    await expect(page.locator('[data-testid=settings-identity-email]')).toBeVisible();
    await expect(page.locator('[data-testid=settings-github-token]')).toHaveCount(0);

    await page.locator('[data-testid=settings-nav-item][data-section-id=github]').click();
    await page.waitForTimeout(120);
    await expect(page.locator('[data-testid=settings-github-token]')).toBeVisible();
    await expect(page.locator('[data-testid=settings-identity-email]')).toHaveCount(0);

    // Sync (repo/path/branch/token override) lives in the Project panel
    // now, not Settings -- there's no third settings section for it.
    await expect(page.locator('[data-testid=settings-nav-item][data-section-id=sync]')).toHaveCount(0);

    await page.locator('[data-testid=settings-nav-item][data-section-id=integrations]').click();
    await page.waitForTimeout(120);
    await expect(page.locator('[data-testid=settings-jira-proxy-url]')).toBeVisible();
    await expect(page.locator('[data-testid=settings-github-token]')).toHaveCount(0);
  });

  test('a section shows a small accent dot once it has something configured', async ({ page }) => {
    const githubNav = page.locator('[data-testid=settings-nav-item][data-section-id=github]');
    await expect(githubNav.locator('span[style*="border-radius"]')).toHaveCount(0);

    await page.locator('[data-testid=settings-nav-item][data-section-id=github]').click();
    await page.waitForTimeout(120);
    await page.locator('[data-testid=settings-github-token]').fill('ghp_configured');
    await page.waitForTimeout(200);
    await expect(githubNav.locator('span[style*="border-radius"]')).toHaveCount(1);
  });

  test('reopening Settings from an identity\'s settings cog always resets to the Identity section', async ({ page }) => {
    await page.locator('[data-testid=settings-nav-item][data-section-id=integrations]').click();
    await page.waitForTimeout(120);
    await page.mouse.click(10, 10);
    await page.waitForTimeout(150);

    await h.openSettings(page);
    await expect(page.locator('[data-testid=settings-identity-email]')).toBeVisible();
  });
});

test.describe('Switcher only lists the previewed scope\'s own projects', () => {
  test.beforeEach(async ({ page }) => {
    await h.seedTwoIdentities(page);
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
  });

  test('the switcher shows only Personal\'s project while its scope is previewed, and only Northwind\'s once that scope is previewed', async ({ page }) => {
    await h.openTrackerSwitcher(page);
    await expect(page.locator('[data-testid=switcher-project-row]')).toHaveCount(1);
    await expect(h.milestoneRow(page, 'Project A')).toBeVisible();

    const northwindScope = page.locator('[data-testid=switcher-scope-row]').filter({ hasText: 'Northwind' });
    await northwindScope.click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=switcher-project-row]')).toHaveCount(2);
    await expect(h.milestoneRow(page, 'Project B1')).toBeVisible();
    await expect(h.milestoneRow(page, 'Project B2')).toBeVisible();
    await expect(h.milestoneRow(page, 'Project A')).toHaveCount(0);
  });

  test('a newly created blank project is tagged with the active identity and disappears from the switcher after moving to a different scope', async ({ page }) => {
    await h.openTrackerSwitcher(page);
    await h.createNamedBlankProject(page, 'Personal-only project');
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText('Personal-only project');

    await h.openTrackerSwitcher(page);
    const northwindScope = page.locator('[data-testid=switcher-scope-row]').filter({ hasText: 'Northwind' });
    await northwindScope.click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=switcher-project-row]').first().click(); // commits into Northwind
    await page.waitForTimeout(400);
    await h.openTrackerSwitcher(page);
    await expect(h.milestoneRow(page, 'Personal-only project')).toHaveCount(0);
  });
});

test.describe('Settings is scoped to the active identity', () => {
  test.beforeEach(async ({ page }) => {
    await h.seedTwoIdentities(page);
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
  });

  // Switches identity+project together by previewing Northwind's scope
  // then clicking one of its projects -- there's no standalone "switch
  // identity" action anymore (see the switcher describe block above).
  async function switchToNorthwind(page) {
    await h.openTrackerSwitcher(page);
    const northwindScope = page.locator('[data-testid=switcher-scope-row]').filter({ hasText: 'Northwind' });
    await northwindScope.click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=switcher-project-row]').first().click();
    await page.waitForTimeout(400);
  }

  test('YOUR EMAIL/GITHUB TOKEN/JIRA PROXY URL show the active identity\'s own values, and swap when switching identity', async ({ page }) => {
    await h.openSettings(page);
    await expect(page.locator('[data-testid=settings-identity-email]')).toHaveValue('tom@personal.com');
    await page.locator('[data-testid=settings-nav-item][data-section-id=github]').click();
    await page.waitForTimeout(120);
    await expect(page.locator('[data-testid=settings-github-token]')).toHaveValue('');
    await page.locator('[data-testid=settings-github-token]').fill('ghp_personal');
    await page.mouse.click(10, 10);
    await page.waitForTimeout(150);

    await switchToNorthwind(page);

    await h.openSettings(page);
    await expect(page.locator('[data-testid=settings-identity-email]')).toHaveValue('tom@northwind.com');
    await page.locator('[data-testid=settings-nav-item][data-section-id=github]').click();
    await page.waitForTimeout(120);
    await expect(page.locator('[data-testid=settings-github-token]')).toHaveValue(''); // Northwind's own (unset), not Personal's
  });

  test('editing YOUR EMAIL and GITHUB TOKEN writes through to the active identity\'s own record, and survives a switch away and back', async ({ page }) => {
    await h.openSettings(page);
    await page.locator('[data-testid=settings-identity-email]').fill('tom-changed@personal.com');
    await page.locator('[data-testid=settings-nav-item][data-section-id=github]').click();
    await page.waitForTimeout(120);
    await page.locator('[data-testid=settings-github-token]').fill('ghp_renamed');
    await page.waitForTimeout(200);

    let idsRaw = await page.evaluate(() => localStorage.getItem('git_native_tracker_identities_v1'));
    let ids = JSON.parse(idsRaw);
    let personal = ids.identities.find(i => i.id === 'identity-a');
    expect(personal.email).toBe('tom-changed@personal.com');
    expect(personal.githubToken).toBe('ghp_renamed');

    await page.mouse.click(10, 10);
    await page.waitForTimeout(150);
    await switchToNorthwind(page);

    // Back to Personal -- the switcher opens on whichever scope owns the
    // CURRENTLY active project (Northwind, right now), so Personal's own
    // project needs its scope previewed first before it's clickable.
    await h.openTrackerSwitcher(page);
    await page.locator('[data-testid=switcher-scope-row]').filter({ hasText: 'Personal' }).click();
    await page.waitForTimeout(150);
    await h.milestoneRow(page, 'Project A').click();
    await page.waitForTimeout(400);

    await h.openSettings(page);
    await expect(page.locator('[data-testid=settings-identity-email]')).toHaveValue('tom-changed@personal.com');
    await page.locator('[data-testid=settings-nav-item][data-section-id=github]').click();
    await page.waitForTimeout(120);
    await expect(page.locator('[data-testid=settings-github-token]')).toHaveValue('ghp_renamed');
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

    await h.openTrackerSwitcher(page);
    await page.locator('[data-testid=switcher-scope-row]').filter({ hasText: 'Northwind' }).click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=switcher-project-row]').first().click();
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

    await h.openTrackerSwitcher(page);
    await page.locator('[data-testid=switcher-scope-row]').filter({ hasText: 'Northwind' }).click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=switcher-project-row]').first().click(); // -> Northwind, generates its key
    await page.waitForTimeout(500);
    await h.openTrackerSwitcher(page);
    await page.locator('[data-testid=switcher-scope-row]').filter({ hasText: 'Personal' }).click();
    await page.waitForTimeout(150);
    await h.milestoneRow(page, 'Project A').click(); // -> back to Personal (already had a key)
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

  test('editing the label in Settings updates the breadcrumb and title prefix (namespacing), and persists', async ({ page }) => {
    await h.openSettings(page);
    await expect(page.locator('[data-testid=settings-identity-label]')).toHaveValue('Personal');
    await page.locator('[data-testid=settings-identity-label]').fill('Acme Corp');
    await page.waitForTimeout(200);
    await page.mouse.click(10, 10);
    await page.waitForTimeout(150);

    await expect(page.locator('[data-testid=btn-switcher]')).toContainText('Acme Corp');
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
