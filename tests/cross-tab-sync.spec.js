// Spec: two tabs on the same file share the same localStorage origin, but
// each tab only ever read it once, at construction -- so they'd silently
// diverge, and worse, an idle stale tab's own componentDidUpdate (which
// unconditionally re-persists on every local state change) could clobber
// whatever a more current tab had just written. A 'storage' event listener
// (fires in every OTHER tab when one tab writes localStorage) now keeps the
// milestone list, the active milestone's own content, and its column widths
// in sync across tabs without a manual reload.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

test.describe('Cross-tab sync', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('a milestone created in one tab appears in another tab\'s switcher without reloading', async ({ page, context }) => {
    const pageB = await context.newPage();
    await pageB.goto(h.TRACKER_PATH);
    await pageB.waitForTimeout(300);

    await h.openTrackerSwitcher(page);
    await h.createNamedBlankProject(page, 'Cross-tab test');
    await page.waitForTimeout(300);

    await h.openTrackerSwitcher(pageB);
    await expect(h.milestoneRow(pageB, 'Cross-tab test')).toHaveCount(1);
  });

  test('an edit to the active milestone in one tab shows up live in another tab on the same milestone', async ({ page, context }) => {
    const pageB = await context.newPage();
    await pageB.goto(h.TRACKER_PATH);
    await pageB.waitForTimeout(300);

    await h.clickTitleToEdit(page, 1);
    await h.typeAndCommit(page, 'Edited from tab A');
    await page.waitForTimeout(300);

    await expect(h.titleCell(pageB, 1).locator('span').first()).toHaveText('Edited from tab A');
  });

  test('a column resize in one tab is reflected in another tab', async ({ page, context }) => {
    const pageB = await context.newPage();
    await pageB.goto(h.TRACKER_PATH);
    await pageB.waitForTimeout(300);

    const before = await h.colHeader(pageB, 'rag').boundingBox();

    const handle = h.colHeader(page, 'rag').locator('[data-testid=col-resize-handle]');
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    const after = await h.colHeader(pageB, 'rag').boundingBox();
    expect(after.width).toBeGreaterThan(before.width + 30);
  });

  // Regression: persistColumnWidths() used to write unconditionally on
  // every componentDidUpdate, with no staleness check on either the
  // writing or the receiving end (unlike persistIdentities()/
  // persistProjectIndex(), which both compare against the last-written
  // JSON first). A resize fires many rapid componentDidUpdate cycles (one
  // per mousemove), and with a second tab open, every write echoed back
  // through that tab's own unconditional re-write of the same key.
  test('a column resize does not cause the two tabs to keep re-writing localStorage back and forth at each other', async ({ page, context }) => {
    const pageB = await context.newPage();
    await pageB.goto(h.TRACKER_PATH);
    await pageB.waitForTimeout(300);

    for (const p of [page, pageB]) {
      await p.evaluate(() => {
        window.__colWidthWrites = 0;
        const orig = localStorage.setItem.bind(localStorage);
        localStorage.setItem = (k, v) => {
          if (k === 'git_native_tracker_col_widths_v1') window.__colWidthWrites++;
          return orig(k, v);
        };
      });
    }

    const handle = h.colHeader(page, 'rag').locator('[data-testid=col-resize-handle]');
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);

    const midA = await page.evaluate(() => window.__colWidthWrites);
    const midB = await pageB.evaluate(() => window.__colWidthWrites);
    await page.waitForTimeout(1500); // well past any real propagation delay
    const endA = await page.evaluate(() => window.__colWidthWrites);
    const endB = await pageB.evaluate(() => window.__colWidthWrites);

    expect(endA).toBe(midA); // tab A: no further writes once the drag itself stopped
    expect(endB).toBe(midB); // tab B: no echo writes at all, let alone a growing count
    expect(midB).toBe(0); // tab B never had a reason to write localStorage in the first place
  });

  test('independent edits made in two tabs at once are not lost: neither tab clobbers the other', async ({ page, context }) => {
    const pageB = await context.newPage();
    await pageB.goto(h.TRACKER_PATH);
    await pageB.waitForTimeout(300);

    // Tab A edits row 1's title; tab B (after picking that up) edits a
    // different field on a different row -- tab B's own persist() then
    // writes back a document that must still carry tab A's change too.
    await h.clickTitleToEdit(page, 1);
    await h.typeAndCommit(page, 'From tab A');
    await page.waitForTimeout(300);
    await expect(h.titleCell(pageB, 1).locator('span').first()).toHaveText('From tab A');

    await h.clickFieldToEdit(pageB, 2, 'mitigation');
    await h.typeAndCommit(pageB, 'From tab B');
    await page.waitForTimeout(300);

    await page.reload();
    await page.waitForTimeout(300);
    await expect(h.titleCell(page, 1).locator('span').first()).toHaveText('From tab A');
    await expect(h.fieldCell(page, 2, 'mitigation')).toContainText('From tab B');
  });

  // Regression: which project is "active" used to be a single value
  // shared across every tab on this origin (PROJECTS_KEY.activeMilestoneId)
  // -- reloading a tab adopted whatever ANY tab most recently made active,
  // not necessarily what THAT tab itself was showing. sessionStorage is
  // per-tab and never inherited by a genuinely new tab, so it now wins over
  // the shared pointer on load; a brand new tab with no session entry yet
  // still falls back to the shared pointer as a reasonable default.
  test('reloading a tab stays on its own project, even if another tab made a different one active', async ({ page, context }) => {
    await h.openTrackerSwitcher(page);
    await h.createNamedBlankProject(page, 'Second Project');
    await page.waitForTimeout(400);

    const pageB = await context.newPage();
    await pageB.goto(h.TRACKER_PATH);
    await pageB.waitForTimeout(300);
    await h.openTrackerSwitcher(pageB);
    await h.milestoneRow(pageB, 'Delivery tracker').click();
    await pageB.waitForTimeout(300);
    await expect(pageB.locator('[data-testid=tracker-name-title]')).toHaveText('Delivery tracker');

    // Tab A never touched anything -- reloading it must not jump to
    // whatever tab B made globally active.
    await page.reload();
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText('Second Project');

    // A genuinely new tab (no session entry of its own yet) still falls
    // back to the shared "last active anywhere" pointer as a default.
    const pageC = await context.newPage();
    await pageC.goto(h.TRACKER_PATH);
    await pageC.waitForTimeout(300);
    await expect(pageC.locator('[data-testid=tracker-name-title]')).toHaveText('Delivery tracker');
  });

  // Regression: persistProjectIndex() ran unconditionally on every
  // componentDidUpdate in every tab, and its payload embeds
  // activeMilestoneId -- genuinely different per tab by design (each
  // tracks its own active project). Two tabs open on different active
  // projects therefore never converged on a byte-identical write, so
  // every render in either tab produced a real 'storage' event in the
  // other: a continuous, CPU-burning infinite loop, confirmed live via
  // an instrumented two-tab repro. It also caused real data loss here
  // specifically: a stale echo from a tab that hadn't yet seen a rename
  // could land in localStorage after the real rename write and revert
  // it, which is what this test exercises (create then immediately
  // rename -- two closely-spaced writes -- while another tab is open on
  // a different project the whole time).
  test('creating then immediately renaming a project in one tab reliably reaches another tab with the final name, not a stale echo', async ({ page, context }) => {
    const pageB = await context.newPage();
    await pageB.goto(h.TRACKER_PATH);
    await pageB.waitForTimeout(300);

    await h.openTrackerSwitcher(page);
    await h.createNamedBlankProject(page, 'Cross-tab test');
    await page.waitForTimeout(300);

    await h.openTrackerSwitcher(pageB);
    await expect(h.milestoneRow(pageB, 'Cross-tab test')).toHaveCount(1);
    await expect(h.milestoneRow(pageB, 'Untitled')).toHaveCount(0); // not a stale pre-rename echo
  });
});

// Regression: the identities list (IDENTITIES_KEY) never had the same live
// cross-tab sync as everything above -- persistIdentities() runs
// unconditionally on every componentDidUpdate (any state change at all,
// in any tab) and writes whatever THAT tab's own in-memory state.identities
// currently holds. A tab that's been open since before another tab
// created/renamed/re-emailed an identity had no way to find out, so its
// next incidental update (even something unrelated) silently overwrote the
// shared identity list with its own stale snapshot -- confirmed live, more
// than once, as genuine data loss. Fixed the same way every other shared-
// but-per-tab-cached piece of state already is, plus a revision check
// (every write stamped with Date.now(); an incoming sync whose revision
// isn't strictly newer than the last one this tab has already seen or
// written itself is dropped) since rapid interaction in either tab can
// otherwise queue several echo writes whose delivery order across tabs
// isn't guaranteed to match write order.
test.describe('Cross-tab sync: identities', () => {
  test.beforeEach(async ({ page }) => {
    await h.seedTwoIdentities(page);
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
  });

  test('an identity created in one tab appears live in another tab\'s dropdown, and survives an unrelated update in that other tab', async ({ page, context }) => {
    const pageB = await context.newPage();
    await pageB.goto(h.TRACKER_PATH);
    await pageB.waitForTimeout(400);

    await page.locator('[data-testid=btn-switcher]').click();
    await page.locator('[data-testid=btn-add-identity]').click();
    await page.locator('[data-testid=new-identity-label-input]').fill('Acme Corp');
    await page.locator('[data-testid=new-identity-email-input]').fill('me@acme.test');
    await page.locator('[data-testid=btn-create-identity]').click();

    // createIdentity is async (generates a real ECDSA keypair before
    // switching) -- poll instead of assuming a fixed wait is enough. 8s
    // (40x200ms) still flaked under a long single-worker full-suite run
    // (browser/CPU contention after ~15min of continuous test churn, not
    // reproducible standalone) -- widened for real headroom under load.
    let ids = null;
    for (let i = 0; i < 100; i++) {
      ids = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_identities_v1')));
      if (ids.identities.length === 3) break;
      await page.waitForTimeout(200);
    }
    expect(ids.identities.length).toBe(3);
    await pageB.waitForTimeout(300);

    // Tab B's own switcher shows it live, no reload.
    await pageB.locator('[data-testid=btn-switcher]').click();
    await pageB.waitForTimeout(150);
    await expect(pageB.locator('[data-testid=switcher-scope-row]')).toHaveCount(3);

    // An unrelated update in tab B (open/close its own dropdown) used to
    // be exactly the moment a stale tab clobbered the shared list back
    // down -- confirm it survives.
    await pageB.keyboard.press('Escape');
    await pageB.waitForTimeout(300);
    const idsAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_identities_v1')));
    expect(idsAfter.identities.length).toBe(3);
    expect(idsAfter.identities.some(i => i.label === 'Acme Corp')).toBe(true);
  });

  test('editing the active identity\'s email in one tab is reflected in shared storage without another tab reverting it', async ({ page, context }) => {
    const pageB = await context.newPage();
    await pageB.goto(h.TRACKER_PATH);
    await pageB.waitForTimeout(400);

    // Tab B touches something unrelated first (its own switcher), then
    // settles -- simulating the "stale-ish but not idle-forever" tab.
    await pageB.locator('[data-testid=btn-switcher]').click();
    await pageB.waitForTimeout(150);
    await pageB.keyboard.press('Escape');
    await pageB.waitForTimeout(500);

    await page.locator('[data-testid=btn-switcher]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=btn-switcher-settings]').click();
    await page.waitForTimeout(200);
    await page.locator('[data-testid=settings-identity-email]').fill('tom-changed@personal.com');
    await page.waitForTimeout(500);

    const idsRaw = await page.evaluate(() => localStorage.getItem('git_native_tracker_identities_v1'));
    const ids = JSON.parse(idsRaw);
    const personal = ids.identities.find(i => i.id === 'identity-a');
    expect(personal.email).toBe('tom-changed@personal.com');
  });
});
