// Spec: identity is derived from the last write to a project, never
// assigned at import ("Shared with you" until someone actually changes
// something). See docs/ (unified switcher + late-bound identity handoff)
// and requireAttribution()/confirmAttributionGate() in wigwag.html.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

test.describe('Late-bound identity: the attribution gate', () => {
  test('importing a project leaves it with no derived identity (Shared with you)', async ({ page }) => {
    await h.gotoTrackerWithSharedProject(page);
    const projects = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1')).milestones);
    const shared = projects.find(p => p.id === h.SHARED_PROJECT_ID);
    expect(shared.identityId).toBeNull();
  });

  test('the first write opens the attribution gate before anything commits, with "first write" copy and the active identity pre-selected', async ({ page }) => {
    await h.gotoTrackerWithSharedProject(page);
    await expect(page.locator('[data-testid=attribution-gate-modal]')).toHaveCount(0);

    await h.clickFieldToEdit(page, 1, 'mitigation');
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Root cause identified');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=attribution-gate-modal]')).toBeVisible();
    await expect(page.locator('[data-testid=attribution-gate-title]')).toHaveText('Who’s making this change?');
    const options = page.locator('[data-testid=attribution-gate-option]');
    await expect(options).toHaveCount(1);
    await expect(options.first()).toContainText('Personal');
    await expect(page.locator('[data-testid=attribution-gate-option][data-identity-id="' + h.SHARED_PERSONAL_IDENTITY_ID + '"]')).toContainText('✓'); // pre-selected check mark
  });

  test('Cancel abandons the pending edit entirely -- nothing commits, the project stays unattributed, and the cell can be edited again cleanly', async ({ page }) => {
    await h.gotoTrackerWithSharedProject(page);
    const before = await h.readActiveMilestoneDoc(page);
    const historyLenBefore = before.issues[0].history.length;

    await h.clickFieldToEdit(page, 1, 'mitigation');
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Root cause identified');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);

    await page.locator('[data-testid=btn-cancel-attribution-gate]').click();
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=attribution-gate-modal]')).toHaveCount(0);

    const doc = await h.readActiveMilestoneDoc(page);
    expect(doc.issues[0].history.length).toBe(historyLenBefore); // nothing new landed
    const projects = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1')).milestones);
    expect(projects.find(p => p.id === h.SHARED_PROJECT_ID).identityId).toBeNull();

    // Editing the same cell again must work cleanly -- no stale draft, no
    // leftover "still editing" state from the cancelled gate.
    await h.clickFieldToEdit(page, 1, 'mitigation');
    await page.keyboard.press('Control+A');
    await page.keyboard.type('clean retry');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    await page.locator('[data-testid=attribution-gate-option]').first().click();
    await page.locator('[data-testid=btn-save-attribution-gate]').click();
    await page.waitForTimeout(300);
    await expect(h.fieldCell(page, 1, 'mitigation')).toContainText('clean retry');
  });

  test('confirming attributes the project to the selected identity and the write commits with that identity as author', async ({ page }) => {
    await h.gotoTrackerWithSharedProject(page);
    await h.clickFieldToEdit(page, 1, 'mitigation');
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Root cause identified');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);

    await page.locator('[data-testid=attribution-gate-option][data-identity-id="' + h.SHARED_PERSONAL_IDENTITY_ID + '"]').click();
    await page.locator('[data-testid=btn-save-attribution-gate]').click();
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=attribution-gate-modal]')).toHaveCount(0);
    await expect(h.fieldCell(page, 1, 'mitigation')).toContainText('Root cause identified');

    const doc = await h.readActiveMilestoneDoc(page);
    const entry = doc.issues[0].history.filter(hh => hh.field === 'mitigation').pop();
    expect(entry.email).toBe(h.DEMO_IDENTITY_EMAIL);

    const projects = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1')).milestones);
    expect(projects.find(p => p.id === h.SHARED_PROJECT_ID).identityId).toBe(h.SHARED_PERSONAL_IDENTITY_ID);
  });

  test('a second write by the same (now-attributed) identity does not re-prompt', async ({ page }) => {
    await h.gotoTrackerWithSharedProject(page);
    await h.clickFieldToEdit(page, 1, 'mitigation');
    await page.keyboard.press('Control+A');
    await page.keyboard.type('first write');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    await page.locator('[data-testid=attribution-gate-option]').first().click();
    await page.locator('[data-testid=btn-save-attribution-gate]').click();
    await page.waitForTimeout(300);

    await h.clickFieldToEdit(page, 1, 'mitigation');
    await page.keyboard.press('Control+A');
    await page.keyboard.type('second write');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=attribution-gate-modal]')).toHaveCount(0);
    await expect(h.fieldCell(page, 1, 'mitigation')).toContainText('second write');
  });

  test('"Someone else…" bootstraps a new identity inline, selects it, and Save attributes to it', async ({ page }) => {
    await h.gotoTrackerWithSharedProject(page);
    await h.clickFieldToEdit(page, 1, 'mitigation');
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Root cause identified');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);

    await page.locator('[data-testid=btn-attribution-gate-add]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=attribution-gate-new-label-input]').fill('Northwind');
    await page.locator('[data-testid=attribution-gate-new-email-input]').fill('ben@northwind.com');
    await page.locator('[data-testid=btn-create-attribution-gate-identity]').click();
    await page.waitForTimeout(400);

    const northwindOption = page.locator('[data-testid=attribution-gate-option]').filter({ hasText: 'Northwind' });
    await expect(northwindOption).toHaveCount(1);
    await expect(northwindOption).toContainText('✓'); // pre-selected after creation

    await page.locator('[data-testid=btn-save-attribution-gate]').click();
    await page.waitForTimeout(300);

    const doc = await h.readActiveMilestoneDoc(page);
    const entry = doc.issues[0].history.filter(hh => hh.field === 'mitigation').pop();
    expect(entry.email).toBe('ben@northwind.com');
  });

  test('a write while a different identity is active than the project\'s own derived identity re-prompts with mismatch copy, pre-selecting the project\'s stored identity', async ({ page, context }) => {
    // A genuine same-session mismatch is a real multi-tab scenario, not a
    // contrivable single-tab one: reconcileActiveIdentityWithProject() only
    // ever runs once, at boot, and every other navigation path
    // (switchIdentity, resolveDeepLinkFromHash for an already-attributed
    // project) keeps activeIdentityId and a project's own identityId in
    // sync. The one thing that changes activeIdentityId WITHOUT navigating
    // is confirmAttributionGate() itself -- and a second, already-open tab
    // on the same project doesn't adopt that change (cross-tab sync only
    // refreshes the active identity's own record fields, never which
    // identity a tab considers active), so it can end up attributing its
    // own next write differently than the project's own just-updated
    // history. Reproduced here with two real tabs, exactly that way.
    // Not gotoTrackerWithSharedProject here -- it needs a second, known
    // identity seeded from the start too, which that helper's own
    // identities-already-seeded guard would otherwise skip straight past.
    const northwindId = 'northwind-identity';
    await h.useFastTimers(page);
    await page.addInitScript(({ personalId, northwindId, sharedId, sharedName, doc, email }) => {
      if (localStorage.getItem('git_native_tracker_identities_v1')) return;
      localStorage.setItem('git_native_tracker_identities_v1', JSON.stringify({
        activeIdentityId: personalId, defaultIdentityId: personalId,
        identities: [
          { id: personalId, label: 'Personal', email, githubToken: '', jiraProxyUrl: '', salesforceProxyUrl: '', signingPublicKeyJwk: null, signingPrivateKeyJwk: null },
          { id: northwindId, label: 'Northwind', email: 'ben@northwind.com', githubToken: '', jiraProxyUrl: '', salesforceProxyUrl: '', signingPublicKeyJwk: null, signingPrivateKeyJwk: null }
        ],
        lastActiveProjectByIdentity: {}
      }));
      localStorage.setItem('git_native_tracker_milestones_v1', JSON.stringify({
        activeMilestoneId: sharedId,
        milestones: [{ id: sharedId, name: sharedName, identityId: null }]
      }));
      localStorage.setItem('git_native_tracker_v1:' + sharedId, JSON.stringify(doc));
    }, { personalId: h.SHARED_PERSONAL_IDENTITY_ID, northwindId, sharedId: h.SHARED_PROJECT_ID, sharedName: h.SHARED_PROJECT_NAME, doc: h.demoDoc, email: h.DEMO_IDENTITY_EMAIL });
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300); // tab A: Personal active, on the shared project

    const pageB = await context.newPage();
    await h.useFastTimers(pageB);
    await pageB.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await pageB.waitForTimeout(300); // tab B: also boots as Personal, also on the shared project

    // Tab A resolves the gate as Northwind (a pre-existing identity, not
    // "someone else") -- the project's identityId AND tab A's own
    // activeIdentityId both become Northwind.
    await h.clickFieldToEdit(page, 1, 'mitigation');
    await page.keyboard.press('Control+A');
    await page.keyboard.type('written by Northwind, tab A');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    await page.locator('[data-testid=attribution-gate-option][data-identity-id="' + northwindId + '"]').click();
    await page.locator('[data-testid=btn-save-attribution-gate]').click();
    await page.waitForTimeout(300);

    // Tab B never navigated -- it's still Personal. Give it a moment to
    // pick up the cross-tab project-list sync, then write.
    await pageB.waitForTimeout(300);
    await h.clickFieldToEdit(pageB, 1, 'mitigation');
    await pageB.keyboard.press('Control+A');
    await pageB.keyboard.type('written from tab B, still Personal');
    await pageB.keyboard.press('Tab');
    await pageB.waitForTimeout(300);

    await expect(pageB.locator('[data-testid=attribution-gate-modal]')).toBeVisible();
    await expect(pageB.locator('[data-testid=attribution-gate-title]')).toHaveText('Your last changes here were as Northwind. Still Northwind?');
    await expect(pageB.locator('[data-testid=attribution-gate-option][data-identity-id="' + northwindId + '"]')).toContainText('✓');
  });
});
