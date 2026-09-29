// Tracker #147 (320b4b08), Phase 2: wigwag-matrix-host.html's standalone
// (direct-homeserver) transport. Drives the HOST file directly, not
// wigwag.html -- verifying the bootstrap seeding, the localStorage
// bridge in both directions, and reconnect-merges-not-clobbers, all
// against a mocked homeserver (see helpers.mockMatrixClientApi). Real
// Element/widget-embedded verification is Phase 3 and, per the plan,
// can't be meaningfully automated here at all -- not attempted in this
// file.
//
// Every [data-testid=tracker-name-title] / [data-testid=btn-switcher] /
// [data-testid=btn-import-merge] query below uses .first() -- live-
// diagnosed 2026-09-28 (tracker #153's 4a widget-body pass): right after a
// fresh connect or project switch, an element gated by the isWidgetMode/
// !isWidgetMode <sc-if> split briefly resolves to two DOM nodes (one still
// showing literal unrendered "{{ ... }}" text) before settling to one a
// few hundred ms later, tripping Playwright's strict-mode check if an
// assertion lands in that window. Reproduces reliably in a tight polling
// loop; which specific test/locator in a full run happens to land inside
// the window varies -- btn-import-merge itself only actually flaked once,
// in a full-suite run done while verifying tracker #156's follow-up fix,
// but .first() is applied to every occurrence pre-emptively since the
// underlying race is the same one already caught on the other two
// testids. Root cause believed to be the template runtime failing to
// atomically reconcile the isWidgetMode/!isWidgetMode branch switch on
// first mount inside an iframe (a pre-existing hydration edge case made
// newly visible once 4a made that branch's own DOM meaningfully bigger)
// -- not fixable from application code; filed as tracker #157 (2aaea4e5)
// for follow-up. .first() reliably resolves to the same element the DOM
// settles on, confirmed via repeated live reproduction.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');
const core = require('../wigwag-core.js');

const HOMESERVER = 'https://matrix.example.org';
const ROOM_ID = '!room123:example.org';

// Tracker #169/4f07e72b follow-up: shared power-levels fixtures for both
// the layout-proposal icon and "+ New project"/"Receive a project"
// (empty-room screen and switcher), all gated by the same real, live
// isRoomModerator check now. whoami always resolves to
// '@test-user:example.org' in mockMatrixClientApi (the direct transport);
// the widget-embedded transport instead gets its user id straight from
// the widget URL (fake-widget-host.html's own cfg.userId, which defaults
// to '@fake-user:example.org') -- widget-transport tests that need
// moderator power levels must key MODERATOR_LEVELS.users off whatever
// userId they actually configured, not this constant's own key.
const MODERATOR_LEVELS = { users: { '@test-user:example.org': 50 }, users_default: 0, state_default: 50 };
const NON_MODERATOR_LEVELS = { users_default: 0, state_default: 50 };

function entryEvent({ issueId, stream, entry, projectId }) {
  const content = { v: 1, scope: 'issue', issueId, stream: stream || null, entry };
  if (projectId) content.projectId = projectId;
  return { type: 'work.wigwag.entry', content };
}

// A minimal, permanently-invisible legacy issue -- most pre-existing
// tests in this file are about something other than project discovery
// itself (identity bootstrap, widget capability negotiation, retry
// timing) but still need a real, already-discoverable project to exist.
// Tracker f6b39bf0's grandfather clause treats ANY untagged entry
// (issue-scope included) as evidence the room's legacy default project
// already exists -- new projects are what the moderator gate applies to,
// not this. A __deleted__ tombstone keeps the seed issue out of every
// row-count assertion, and using the plain 'title' field (not
// __project_name__) never touches the project's own derived NAME, which
// still falls back to the room name exactly as before.
function seedLegacyEntries() {
  return [
    entryEvent({ issueId: 'seed-issue', entry: { id: 'seed-h1', field: 'title', value: 'seed', sortKey: 1, origin: 'authored' } }),
    entryEvent({ issueId: 'seed-issue', entry: { id: 'seed-h2', field: '__deleted__', value: true, sortKey: 2, origin: 'authored' } })
  ];
}

// No more storage-namespace prefix to derive here (tracker f6b39bf0/#153)
// -- content lives only in in-memory shims on both ends now, never real,
// shared-origin localStorage, so there's no key collision to namespace
// around any more. Tests that need to peek at either side's shim use
// window.__wigwagHostStorage (this file, exposed for tests) or
// window.__wigwagRoomStorageShim (wigwag.html, same reasoning).

test.describe('wigwag-matrix-host.html: connecting', () => {
  test('a successful connect to a genuinely empty room hides the setup form, shows the iframe, and shows "no projects yet" -- never a phantom default project (tracker f6b39bf0)', async ({ page }) => {
    h.mockMatrixClientApi(page, { homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'My Delivery Room', initialEntries: [] });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();

    await expect(page.locator('#setup')).toBeHidden();
    await expect(page.locator('#frame')).toBeVisible();
    // Project creation is moderator-gated now (Tom's explicit call) --
    // Room Scoped Widget Mode has a real "no projects yet" state instead
    // of always synthesizing a default project the moment a room is
    // empty (the OLD behavior this test used to assert).
    await expect(page.frameLocator('#frame').locator('[data-testid=room-no-projects]')).toBeVisible();
  });

  test('a room with no name set falls back to a placeholder for a legacy (grandfathered) project, rather than failing', async ({ page }) => {
    // A non-empty room -- untagged legacy entries are grandfathered in
    // (tracker f6b39bf0's own backward-compat rule) regardless of the new
    // moderator gate, so the room-name-fallback naming path is still
    // reachable and worth its own coverage.
    h.mockMatrixClientApi(page, {
      homeserverUrl: HOMESERVER, roomId: ROOM_ID, initialEntries: [entryEvent({ issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'Legacy issue', sortKey: 1, origin: 'authored' } })]
    }); // roomName omitted -> 404
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.frameLocator('#frame').locator('[data-testid=tracker-name-title]').first()).toHaveText('Matrix room ' + ROOM_ID);
  });

  test('an account not joined to the room (403) surfaces a clear error and never shows the iframe', async ({ page }) => {
    h.mockMatrixClientApi(page, { homeserverUrl: HOMESERVER, roomId: ROOM_ID, accessDenied: true });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.locator('#status')).toContainText('not joined');
    await expect(page.locator('#frame')).toBeHidden();
    await expect(page.locator('#connectBtn')).toBeEnabled(); // can retry, not stuck disabled
  });

  test('a token that can read/write the room but fails /account/whoami fails loudly instead of writing a placeholder identity', async ({ page }) => {
    h.mockMatrixClientApi(page, { homeserverUrl: HOMESERVER, roomId: ROOM_ID, initialEntries: seedLegacyEntries(), whoamiFails: true });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.locator('#status')).toContainText('Matrix user id');
    await expect(page.locator('#frame')).toBeHidden();
    const identities = await page.evaluate(() => localStorage.getItem('git_native_tracker_identities_v1'));
    expect(identities).toBeNull(); // nothing written at all -- no placeholder identity
  });

  test('a #alias room id resolves to a real room id before connecting', async ({ page }) => {
    h.mockMatrixClientApi(page, { homeserverUrl: HOMESERVER, roomId: ROOM_ID, initialEntries: seedLegacyEntries() });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill('#my-alias:example.org');
    await page.locator('#connectBtn').click();
    await expect(page.locator('#frame')).toBeVisible();
  });

  test('existing history in the room is reflected in the tracker on first connect', async ({ page }) => {
    h.mockMatrixClientApi(page, {
      homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Seeded Room',
      initialEntries: [
        entryEvent({ issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'Fix the login bug', sortKey: 1, origin: 'authored' } }),
        entryEvent({ issueId: 'i1', entry: { id: 'h2', field: 'status', value: 'todo', sortKey: 2, origin: 'authored' } }),
      ]
    });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    const frame = page.frameLocator('#frame');
    await expect(frame.locator('[data-testid=row]')).toHaveCount(1);
    await expect(frame.locator('[data-testid=row]')).toContainText('Fix the login bug');
  });
});

test.describe('wigwag-matrix-host.html: the localStorage bridge', () => {
  function assertNoKeyRef(content) {
    if ('keyRef' in content.entry) throw new Error('a Matrix-backend entry should never carry keyRef -- inline pubKey only');
  }

  async function connect(page, opts = {}) {
    const state = h.mockMatrixClientApi(page, { homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room', initialEntries: seedLegacyEntries(), ...opts });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.locator('#frame')).toBeVisible();
    return state;
  }

  // Live-reported (Tom, 2026-09-28): a legacy-backfill entry (deterministic
  // Created/Updated backfill) got pushed to the room repeatedly on
  // reconnect ("loads of events"). Root-cause fix: these entries are now
  // never pushed as real signed events at all, from any code path --
  // they're fully derivable by any reader (see hydrateProjectFromMatrixTimeline's
  // own unit test coverage in wigwag-core.test.js for the read-side half of
  // this guarantee).
  test('legacy-backfill entries (e.g. Created/Updated) are backfilled locally but never actually sent to the room, even across a real push cycle', async ({ page }) => {
    const state = await connect(page);
    const frame = page.frameLocator('#frame');
    // seedLegacyEntries()'s one issue is immediately tombstoned
    // (__deleted__) precisely so it never shows as a row -- see that
    // function's own comment -- so the baseline here is 0, not 1.
    await expect(frame.locator('[data-testid=row]')).toHaveCount(0);

    // Confirm the backfill actually happened locally (created/updated
    // exist and are populated) -- this isn't a test that just trivially
    // passes because nothing triggered backfill in the first place.
    // Project content lives only in the host's in-memory storage shim now
    // (tracker f6b39bf0/#153), exposed for tests as window.__wigwagHostStorage
    // -- real, unshimmed window.localStorage deliberately never sees it
    // (see wigwag-matrix-host.html's own "In-memory storage shim" comment).
    const doc = await page.evaluate(() => {
      const store = window.__wigwagHostStorage;
      const raw = Object.keys(store.dumpAll()).find(k => k.startsWith('git_native_tracker_v1:'));
      return raw ? JSON.parse(store.getItem(raw)) : null;
    });
    expect(doc).toBeTruthy();
    expect(doc.fieldDefs.created).toBeTruthy();
    expect(doc.fieldDefs.updated).toBeTruthy();

    // Trigger a real push cycle (any edit fires persist() -> storage-changed
    // -> pushNewLocalEntries) and give it time to actually run.
    await frame.locator('body').click();
    await page.keyboard.down('Control');
    await page.keyboard.press('Space');
    await page.keyboard.up('Control');
    await page.waitForTimeout(200);
    await page.keyboard.type('Trigger a push cycle');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    const backfillSent = state.sentEntries.filter(c => c.entry.origin === 'legacy-backfill');
    expect(backfillSent).toEqual([]);
  });

  test('creating an issue inside the iframe sends its entries to the room', async ({ page }) => {
    const state = await connect(page);
    const frame = page.frameLocator('#frame');
    await frame.locator('body').click();
    await page.keyboard.down('Control');
    await page.keyboard.press('Space');
    await page.keyboard.up('Control');
    await page.waitForTimeout(200);
    await page.keyboard.type('A brand new issue from the bridge');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    await expect.poll(() => state.sentEntries.some(c => c.entry.field === 'title' && c.entry.value === 'A brand new issue from the bridge')).toBe(true);
    const titleEvent = state.sentEntries.find(c => c.entry.field === 'title' && c.entry.value === 'A brand new issue from the bridge');
    assertNoKeyRef(titleEvent);
    // Tracker #149: every entry sent from here on is tagged with the
    // room's own derived project id -- a room can hold more than one
    // project's history, and an untagged entry only means "predates this
    // field" now, not "there's only one project to belong to".
    expect(typeof titleEvent.projectId).toBe('string');
    expect(titleEvent.projectId.length).toBeGreaterThan(0);

    // Creating one issue writes to localStorage more than once in quick
    // succession (a "Created" entry, then a "Title set" entry), each
    // firing its own storage event -- regression check for a real race
    // where two overlapping pushes each computed their own "what's new"
    // list from the same stale snapshot and both sent the same entry.
    await page.waitForTimeout(300);
    const ids = state.sentEntries.map(c => c.entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Tracker #158 (design handoff pending_and_failed.zip): pending/failed
  // local-edit UI, end to end -- host outbox -> wigwag:pending-update ->
  // iframe rendering, for both the grid cell and the slide-over field.
  test('a local field edit shows as pending until confirmed, and as failed with a working Retry when the send errors', async ({ page }) => {
    const state = await connect(page);
    const frame = page.frameLocator('#frame');
    await frame.locator('body').click();
    await page.keyboard.down('Control');
    await page.keyboard.press('Space');
    await page.keyboard.up('Control');
    await page.waitForTimeout(200);
    await page.keyboard.type('Pending/failed test issue');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await expect(frame.locator('[data-testid=row]')).toHaveCount(1);

    const cell = frame.locator('[data-testid=field-cell][data-col=type]').first();
    const dot = frame.locator('[data-testid=field-cell][data-col=type] [data-testid=pending-dot]');
    await cell.click();
    await page.waitForTimeout(150);
    await cell.click();
    await page.waitForTimeout(200);
    await frame.locator('[data-testid=select-option]').nth(1).click();
    await page.waitForTimeout(300);
    await expect(dot).toBeVisible();

    // Confirmed once the sent entry actually round-trips back through the
    // room (the mock's send and poll endpoints are deliberately separate,
    // same as every other test in this file that simulates "a remote
    // entry arrived").
    const firstSent = state.sentEntries[state.sentEntries.length - 1];
    state.pendingEntries.push({ type: 'work.wigwag.entry', content: firstSent });
    await expect(dot).toBeHidden({ timeout: 8000 });

    // Now force the send itself to fail outright (not a 429 -- that has
    // its own multi-second retry-with-backoff, a real and deliberate
    // design choice for routine rate limiting, not what this is testing).
    await page.route(new RegExp('^https://matrix\\.example\\.org/_matrix/client/v3/rooms/[^/]+/send/work\\.wigwag\\.entry/.*'), route =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ errcode: 'M_UNKNOWN' }) }));
    await cell.click();
    await page.waitForTimeout(150);
    await cell.click();
    await page.waitForTimeout(200);
    await frame.locator('[data-testid=select-option]').nth(2).click();
    await page.waitForTimeout(500);
    await expect(dot).toBeVisible();

    await frame.locator('[data-testid=title-cell]').first().locator('span').first().click();
    await page.waitForTimeout(300);
    const caption = frame.locator('[data-testid=slideover-field][data-col=type] [data-testid=pending-caption]');
    await expect(caption).toContainText('Failed to sync');
    const retryBtn = frame.locator('[data-testid=slideover-field][data-col=type] [data-testid=pending-retry]');
    await expect(retryBtn).toBeVisible();

    // A real infinite loop was caught here during development: persist()
    // unconditionally writes on every render, and the room-mode storage
    // shim unconditionally posts wigwag:local-write on every write --
    // marking an entry failed is itself a state change, which persists,
    // which (without the fix) retried the same failed entry forever. This
    // wait is deliberately generous specifically to catch a regression of
    // that loop (it would still be spamming failed sends well past this
    // point).
    await page.waitForTimeout(1500);
    const failedSendAttempts = state.sentEntries.length;
    await page.waitForTimeout(1500);
    expect(state.sentEntries.length).toBe(failedSendAttempts); // no automatic retry storm

    // Retry: explicit, and only now does the send succeed again.
    await page.unroute(new RegExp('^https://matrix\\.example\\.org/_matrix/client/v3/rooms/[^/]+/send/work\\.wigwag\\.entry/.*'));
    await retryBtn.click();
    await page.waitForTimeout(500);
    await expect(caption).toContainText('Pending');
    const retriedSent = state.sentEntries[state.sentEntries.length - 1];
    state.pendingEntries.push({ type: 'work.wigwag.entry', content: retriedSent });
    await expect(frame.locator('[data-testid=slideover-field][data-col=type] [data-testid=pending-dot]')).toBeHidden({ timeout: 8000 });
  });

  test('a new remote entry arriving on a later poll is merged into the iframe live, without wiping local state', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'timer-dependent, one browser is enough to prove the mechanism');
    const state = await connect(page);
    const frame = page.frameLocator('#frame');
    await expect(frame.locator('[data-testid=row]')).toHaveCount(0);

    state.pendingEntries.push(entryEvent({ issueId: 'i-remote', entry: { id: 'hr1', field: 'title', value: 'Created from another client', sortKey: 1, origin: 'authored' } }));
    await expect(frame.locator('[data-testid=row]')).toHaveCount(1, { timeout: 8000 }); // next 5s poll tick picks it up
    await expect(frame.locator('[data-testid=row]')).toContainText('Created from another client');
  });

  // Live-reported (Tom, tracker f6b39bf0): imported a big project on one
  // account -- loaded fine there -- but a second account already
  // connected to the same room never saw it at all, not even after
  // waiting. Root cause: the live poll only ever reconciled projects it
  // already knew about; a genuinely NEW project id showing up mid-session
  // was invisible until a full reconnect (which runs discovery from
  // scratch). "Everyone who can see the widget in the room sees the same
  // state" requires the live poll to discover new projects too, not just
  // refresh known ones.
  test('a project that first appears in the room mid-session (someone else\'s import) is discovered by the live poll, without needing a reconnect', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'timer-dependent, one browser is enough to prove the mechanism');
    const state = await connect(page);
    const frame = page.frameLocator('#frame');
    await frame.locator('[data-testid=btn-switcher]').first().click();
    await expect(frame.locator('[data-testid=switcher-project-row]')).toHaveCount(1);
    await frame.locator('[data-testid=btn-switcher]').first().click(); // close it again

    state.pendingEntries.push(
      { type: 'work.wigwag.entry', content: { v: 1, scope: 'project', projectId: 'mid-session-import', entry: { id: 'mph1', field: '__project_name__', value: 'Imported Mid-Session', sortKey: 1, origin: 'authored' } } },
      entryEvent({ issueId: 'mi1', entry: { id: 'mh1', field: 'title', value: 'Mid-session issue', sortKey: 2, origin: 'authored' }, projectId: 'mid-session-import' })
    );

    await expect(async () => {
      await frame.locator('[data-testid=btn-switcher]').first().click();
      await expect(frame.locator('[data-testid=switcher-project-row]')).toHaveCount(2);
      await frame.locator('[data-testid=btn-switcher]').first().click();
    }).toPass({ timeout: 8000 }); // next 5s poll tick picks it up, no reconnect needed
  });

  test('reconnecting to the same room resolves to the same local project, not a duplicate', async ({ page }) => {
    await connect(page);
    const milestonesKey = 'git_native_tracker_milestones_v1';
    const projectCountAfterFirst = await page.evaluate((key) => JSON.parse(window.__wigwagHostStorage.getItem(key)).milestones.length, milestonesKey);

    await page.goto('/bridges/wigwag-matrix-host.html');
    h.mockMatrixClientApi(page, { homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room', initialEntries: seedLegacyEntries() });
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.locator('#frame')).toBeVisible();

    const projectCountAfterSecond = await page.evaluate((key) => JSON.parse(window.__wigwagHostStorage.getItem(key)).milestones.length, milestonesKey);
    expect(projectCountAfterSecond).toBe(projectCountAfterFirst);
  });

  // Live-reported (Tom): hidden-field state didn't survive a reload in
  // Room Scoped Widget Mode, even though column ORDER (a sibling cosmetic
  // pref) did. Root cause: hiddenFieldIds used to be embedded INSIDE the
  // per-project doc itself, which lives under docKey(...) -- exactly the
  // key this mode's storage shim treats as in-memory-only "room content",
  // wiped on every reconnect (see the REMOVED test's own comment just
  // above for that same "no persistent local cache, ever" design point).
  // columnOrder/columnWidths/sort have always lived in their own separate,
  // real (unshimmed) localStorage keys, so they correctly survived --
  // hiddenFieldIds was the one cosmetic pref that had accidentally ridden
  // along inside the shimmed doc instead. Fixed by giving it its own real
  // key (HIDDEN_FIELDS_KEY), same pattern as its siblings.
  test('hidden-field state survives a full reconnect, unlike the room-content doc it used to live inside', async ({ page }) => {
    const state = await connect(page);
    const frame = page.frameLocator('#frame');
    await expect(frame.locator('[data-testid=row]')).toHaveCount(0); // seedLegacyEntries' seed issue is tombstoned

    await frame.locator('[data-testid=col-header][data-col="type"]').last().locator('span', { hasText: '⋯' }).click();
    await page.waitForTimeout(200);
    await frame.getByText('Hide field', { exact: true }).click();
    await page.waitForTimeout(300);
    await expect(frame.locator('[data-testid=col-header][data-col="type"]')).toHaveCount(0);

    // A real reconnect -- full page navigation, exactly like the
    // "reconnecting to the same room" test just above, not just a poll tick.
    await page.goto('/bridges/wigwag-matrix-host.html');
    h.mockMatrixClientApi(page, { homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room', initialEntries: seedLegacyEntries() });
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.locator('#frame')).toBeVisible();

    const frame2 = page.frameLocator('#frame');
    await expect(frame2.locator('[data-testid=col-header][data-col="type"]')).toHaveCount(0);
  });

  // REMOVED (tracker f6b39bf0/#153, the storage-shim rework): this test's
  // own premise -- an edit sits in real, persistent local storage across
  // a literal page reload, before ever reaching Matrix, and survives via
  // reconcileIntoLocal's merge on reconnect -- no longer holds. Content
  // now lives ONLY in an in-memory shim on both ends (see wigwag.html's
  // createRoomModeStorageShim and this file's own `localStorage` above);
  // a real page reload before a push completes is real, expected data
  // loss now, not a bug -- "no persistent local cache, ever" was
  // precisely the point of this change (see the plan doc's own note on
  // this exact trade-off). The still-valid, adjacent invariant --  a
  // remote entry arriving on a later poll merges in without wiping
  // *in-session* local state -- is already covered by "a new remote entry
  // arriving on a later poll is merged into the iframe live, without
  // wiping local state" above.
});

// The actual guarantee this whole rework exists for (tracker f6b39bf0/
// #153, Tom's own words): "the objective of room scoped widget mode is
// that all the data lives securely managed under the same conditions as
// in the room. Decrypting and storing in local browser storage managed by
// the wigwag client is a fail." Every other test in this file exercises
// the mechanism; this one encodes the guarantee itself, so a future
// regression that reintroduces real-storage content can't slip through
// silently just because the mechanism otherwise still "works".
test.describe('wigwag-matrix-host.html: Room Scoped Widget Mode never persists content locally', () => {
  test('after a full create/edit/comment session, the iframe\'s own real localStorage holds zero project/doc content', async ({ page }) => {
    const state = h.mockMatrixClientApi(page, { homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room', initialEntries: seedLegacyEntries() });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.locator('#frame')).toBeVisible();

    const frame = page.frameLocator('#frame');
    await frame.locator('body').click();
    await page.keyboard.down('Control');
    await page.keyboard.press('Space');
    await page.keyboard.up('Control');
    await page.waitForTimeout(200);
    await page.keyboard.type('An issue created entirely inside the widget');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await frame.locator('[data-testid=row]').click();
    await page.keyboard.type(' -- edited too', { delay: 0 });
    await page.locator('body').press('Escape');
    await page.waitForTimeout(300);
    expect(state.sentEntries.length).toBeGreaterThan(0); // sanity: the session really did produce room content

    // The actual assertion: real, un-shimmed window.localStorage inside
    // the iframe -- the same object a real attacker or a browser devtools
    // inspection would see -- must contain no project index, no project
    // doc, and no issue content. Only per-device UI prefs and the signing
    // identity (a device credential, not room content -- see
    // resolveRoomModeIdentity's own comment) are expected to be there.
    const realKeys = await frame.locator('body').evaluate(() => Object.keys(window.localStorage));
    const contentKeyPattern = /^git_native_tracker_milestones_v1$|^git_native_tracker_v1:/;
    const leakedContentKeys = realKeys.filter(k => contentKeyPattern.test(k));
    expect(leakedContentKeys).toEqual([]);

    // And the actual issue text itself is nowhere in real storage either
    // (belt and suspenders against a differently-named future leak).
    const realValuesText = await frame.locator('body').evaluate(() =>
      Object.keys(window.localStorage).map(k => window.localStorage.getItem(k)).join('\n'));
    expect(realValuesText).not.toContain('An issue created entirely inside the widget');
  });
});

// Phase 3: the widget-embedded transport, driven through
// tests/fixtures/fake-widget-host.html (a disposable Widget-API postMessage
// host, not a real Matrix client). This validates wigwag-matrix-host.html's
// OWN protocol handling end to end -- it is not, and can't be, proof that a
// real client like Element will behave identically; that's an explicit
// manual step per the plan doc, not something this suite claims to cover.
test.describe('wigwag-matrix-host.html: widget-embedded transport', () => {
  test('a widget-mode load skips the setup form entirely and auto-connects using the URL-supplied room', async ({ page }) => {
    await h.gotoFakeWidgetHost(page, { roomId: '!widgetroom:example.org', roomName: 'Widget Room', initialEntries: seedLegacyEntries() });
    const widget = page.frameLocator('#widget');
    await expect(widget.locator('#setup')).toBeHidden();
    await expect(widget.locator('#frame')).toBeVisible();
    await expect(widget.frameLocator('#frame').locator('[data-testid=tracker-name-title]').first()).toHaveText('Widget Room');
  });

  test('a widget with no $matrix_room_id in its URL surfaces a clear, VISIBLE error instead of a blank screen', async ({ page }) => {
    // Regression: an earlier version hid the whole #setup container (which
    // #status lives inside) the moment widget mode was detected, before any
    // status was ever shown -- every error message was technically in the
    // DOM but invisible, i.e. exactly a white screen from the user's side.
    await h.gotoFakeWidgetHost(page, { roomId: '' });
    const widget = page.frameLocator('#widget');
    await expect(widget.locator('#status')).toBeVisible();
    await expect(widget.locator('#status')).toContainText('$matrix_room_id');
    await expect(widget.locator('#frame')).toBeHidden();
  });

  test('existing room history is reflected on first load, same as the standalone transport', async ({ page }) => {
    await h.gotoFakeWidgetHost(page, {
      roomId: '!widgetroom:example.org', roomName: 'Seeded Widget Room',
      initialEntries: [
        entryEvent({ issueId: 'wi1', entry: { id: 'wh1', field: 'title', value: 'Fix the widget bug', sortKey: 1, origin: 'authored' } }),
        entryEvent({ issueId: 'wi1', entry: { id: 'wh2', field: 'status', value: 'todo', sortKey: 2, origin: 'authored' } }),
      ]
    });
    const frame = page.frameLocator('#widget').frameLocator('#frame');
    await expect(frame.locator('[data-testid=row]')).toHaveCount(1);
    await expect(frame.locator('[data-testid=row]')).toContainText('Fix the widget bug');
  });

  test('creating an issue inside the widget-embedded iframe sends its entries through send_event, deduplicated', async ({ page }) => {
    await h.gotoFakeWidgetHost(page, { roomId: '!widgetroom:example.org', roomName: 'Widget Room', initialEntries: seedLegacyEntries() });
    const widget = page.frameLocator('#widget');
    await expect(widget.locator('#frame')).toBeVisible();
    const frame = widget.frameLocator('#frame');
    await frame.locator('body').click();
    await page.keyboard.down('Control');
    await page.keyboard.press('Space');
    await page.keyboard.up('Control');
    await page.waitForTimeout(200);
    await page.keyboard.type('A brand new issue from the widget');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    const state = await page.evaluate(() => window.__state);
    const titleEvent = state.sentEntries.find(c => c.entry.field === 'title' && c.entry.value === 'A brand new issue from the widget');
    expect(titleEvent).toBeTruthy();
    expect(typeof titleEvent.projectId).toBe('string'); // tracker #149 -- same tagging as the direct transport
    expect(titleEvent.projectId.length).toBeGreaterThan(0);
    const ids = state.sentEntries.map(c => c.entry.id);
    expect(new Set(ids).size).toBe(ids.length); // same reentrancy guard as the direct transport, exercised through send_event this time
  });

  test('a bulk-adopted project through the widget transport uploads its snapshot via MSC4039 upload_file, not send_event chunking', async ({ page }) => {
    await h.gotoFakeWidgetHost(page, { roomId: '!widgetroom:example.org', roomName: 'Widget Room', initialEntries: seedLegacyEntries() });
    const widget = page.frameLocator('#widget');
    await expect(widget.locator('#frame')).toBeVisible();
    const frame = widget.frameLocator('#frame');

    const pastedJsonl = [
      JSON.stringify({ type: 'fields', fields: { title: { label: 'Issue', type: 'text' } }, id: 'widget-snapshot-proj', name: 'Widget Snapshot Project' }),
      JSON.stringify({ type: 'issue', id: 'wsi1', num: 1, fieldRefs: {}, values: { title: 'Widget-imported issue' }, comments: [], history: [] })
    ].join('\n');
    await frame.locator('[data-testid=btn-import-merge]').first().click();
    await page.waitForTimeout(150);
    const [fc] = await Promise.all([
      page.waitForEvent('filechooser'),
      frame.locator('[data-testid=btn-paste-merge-open-file]').click(),
    ]);
    await fc.setFiles({ name: 'widget-snapshot.jsonl', mimeType: 'application/octet-stream', buffer: Buffer.from(pastedJsonl) });
    await expect(frame.locator('[data-testid=confirm-dialog-modal]')).toBeVisible();
    await frame.locator('[data-testid=btn-confirm-dialog-confirm]').click();
    await page.waitForTimeout(500);

    const fakeHostState = await page.evaluate(() => window.__state);
    expect(fakeHostState.uploadedSnapshotBlobs.length).toBe(1); // one MSC4039 upload_file call, not one send_event per chunk
    const manifest = fakeHostState.sentEntries.find(c => c.mxc); // the snapshot manifest is the only sent entry carrying an mxc
    expect(manifest).toBeTruthy();
    expect(manifest.projectId).toBe('widget-snapshot-proj');
    expect(manifest.mxc).toBe(fakeHostState.uploadedSnapshotBlobs[0].mxc);

    // Decrypt the real uploaded blob (via download_file's own store) and
    // confirm the actual entry survived the round trip through MSC4039.
    const blobBytesArray = fakeHostState.uploadedSnapshotBlobs[0].bytes;
    const plaintextBytes = await core.decryptSnapshotPayload({ ciphertext: new Uint8Array(Object.values(blobBytesArray)), encryption: manifest.encryption });
    const parsed = JSON.parse(new TextDecoder().decode(plaintextBytes));
    const items = parsed.map(item => core.entryFromMatrixEvent({ content: item })).filter(Boolean);
    const titlePush = items.find(i => i.scope === 'issue' && i.entry.field === 'title');
    expect(titlePush.entry.value).toBe('Widget-imported issue');
  });

  // Live-reported (Tom, tracker f6b39bf0): a real Element reply to
  // org.matrix.msc4039.download_file carries the file as a genuine Blob,
  // not a raw Uint8Array/ArrayBuffer -- `new Uint8Array(blob)` silently
  // produced ZERO bytes (Blob has no numeric `.length` the constructor
  // can read), which then failed the snapshot's own hash check and made
  // a perfectly good snapshot look corrupted/absent. Every existing
  // snapshot test decrypted the uploaded blob's bytes DIRECTLY (bypassing
  // the real download_file round trip entirely), so this was invisible
  // here until fake-widget-host.html's own mock reply was corrected to
  // match real Element (a Blob, not a Uint8Array) -- this test drives a
  // genuine SECOND, independent connect() (a real reconnect, new page,
  // mediaStore wiped) that must resolve the snapshot via the real
  // postMessage round trip to get the project's real name back at all.
  test('a fresh reconnect through the widget transport can actually resolve a previously-uploaded snapshot (not just decrypt its bytes directly)', async ({ page }) => {
    const ROOM_ID = '!widgetreconnect:example.org';
    // Default fake-widget-host.html userId ('@fake-user:example.org') is
    // the one that needs the power level -- this test's own moderator
    // clicks "+ New project", now gated client-side too (#169/4f07e72b).
    await h.gotoFakeWidgetHost(page, { roomId: ROOM_ID, roomName: 'Widget Reconnect Room', initialEntries: [], powerLevels: { users: { '@fake-user:example.org': 50 }, users_default: 0, state_default: 50 } });
    const widget = page.frameLocator('#widget');
    await expect(widget.locator('#frame')).toBeVisible();
    const frame = widget.frameLocator('#frame');
    await expect(frame.locator('[data-testid=room-no-projects]')).toBeVisible();
    await frame.locator('[data-testid=btn-create-first-room-project]').click();
    await page.waitForTimeout(500);

    const stateAfterCreate = await page.evaluate(() => window.__state);
    const stateEvent = stateAfterCreate.sentStateEvents.find(e => e.type === 'work.wigwag.project');
    expect(stateEvent).toBeTruthy();
    const manifest = stateAfterCreate.sentEntries.find(c => c.mxc);
    expect(manifest).toBeTruthy();
    const blob = stateAfterCreate.uploadedSnapshotBlobs.find(b => b.mxc === manifest.mxc);
    expect(blob).toBeTruthy();

    // A genuinely fresh page -- mediaStore, bridgedProjects, everything
    // wiped -- seeded with exactly what the room would actually hold:
    // the state event and the manifest as real timeline events, plus the
    // uploaded blob available for a real download_file call to find.
    await h.gotoFakeWidgetHost(page, {
      roomId: ROOM_ID, roomName: 'Widget Reconnect Room',
      initialEntries: [
        { type: 'work.wigwag.project', state_key: stateEvent.state_key, content: stateEvent.content },
        { type: 'work.wigwag.snapshot', content: manifest }
      ],
      seedMediaBlobs: [{ mxc: blob.mxc, bytes: Array.from(Object.values(blob.bytes)) }]
    });
    const widget2 = page.frameLocator('#widget');
    await expect(widget2.locator('#frame')).toBeVisible();
    const frame2 = widget2.frameLocator('#frame');
    await expect(frame2.locator('[data-testid=tracker-name-title]').first()).toHaveText('Untitled Project 1');
  });

  test('a remote entry arriving via read_events on a later poll is merged into the widget-embedded iframe live', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'timer-dependent, one browser is enough to prove the mechanism');
    await h.gotoFakeWidgetHost(page, { roomId: '!widgetroom:example.org', roomName: 'Widget Room', initialEntries: seedLegacyEntries() });
    const frame = page.frameLocator('#widget').frameLocator('#frame');
    await expect(frame.locator('[data-testid=row]')).toHaveCount(0);

    await page.evaluate((event) => { window.__state.pendingEntries.push(event); },
      entryEvent({ issueId: 'wi-remote', entry: { id: 'whr1', field: 'title', value: 'Created from Element', sortKey: 1, origin: 'authored' } }));
    await expect(frame.locator('[data-testid=row]')).toHaveCount(1, { timeout: 8000 });
    await expect(frame.locator('[data-testid=row]')).toContainText('Created from Element');
  });

  test('a transient capability-not-yet-approved rejection on the very first read is retried, not treated as a permanent failure', async ({ page }) => {
    // Regression for a real race confirmed live: Element only grants a
    // just-approved capability once the user clicks through its approval
    // dialog, but this file's own first read fires on iframe load, with
    // no signal telling it that dialog has resolved yet -- so the very
    // first attempt can legitimately get rejected even though the
    // capability is (or will imminently be) granted.
    await h.gotoFakeWidgetHost(page, { roomId: '!widgetroom:example.org', roomName: 'Widget Room', initialEntries: seedLegacyEntries(), rejectReadEventsTimes: 2 });
    const widget = page.frameLocator('#widget');
    await expect(widget.locator('#frame')).toBeVisible({ timeout: 8000 });
    await expect(widget.locator('#setup')).toBeHidden();
  });

  test('a request that gets no reply at all times out and is retried, rather than hanging on "Connecting..." forever', async ({ page }) => {
    // Regression for a real hang confirmed live: a connection attempt sat
    // on "Connecting..." for 20+ seconds with no reply -- success or
    // error -- ever arriving for the first read. postToHost's own
    // per-request timeout bounds that; this proves the bridge still
    // reaches a real connected state afterward rather than getting stuck.
    test.setTimeout(45000);
    await h.gotoFakeWidgetHost(page, { roomId: '!widgetroom:example.org', roomName: 'Widget Room', initialEntries: seedLegacyEntries(), dropReadEventsTimes: 1 });
    const widget = page.frameLocator('#widget');
    await expect(widget.locator('#status')).toContainText('Connecting', { timeout: 2000 });
    await expect(widget.locator('#frame')).toBeVisible({ timeout: 15000 });
    await expect(widget.locator('#setup')).toBeHidden();
  });

  test('the widget requests every capability it actually needs, including the room-scoped timeline one', async ({ page }) => {
    // Regression: canReceiveRoomEvent/canSendRoomEvent (gating individual
    // event types) and canUseRoomTimeline (gating read_events access to
    // the room at all) are THREE separate capability checks in real
    // Element -- confirmed live: requesting only the first two still got
    // "Unable to access room timeline" back. Nothing else in this suite
    // checks what gets requested (the fake host doesn't gate on
    // capabilities at all), so this is the only thing that would catch
    // one going missing again.
    await h.gotoFakeWidgetHost(page, { roomId: '!widgetroom:example.org', roomName: 'Widget Room', initialEntries: seedLegacyEntries() });
    await expect(page.frameLocator('#widget').locator('#frame')).toBeVisible();
    const caps = await page.evaluate(() => window.__state.requestedCapabilities);
    expect(caps).toEqual(expect.arrayContaining([
      'org.matrix.msc2762.receive.event:work.wigwag.entry',
      'org.matrix.msc2762.send.event:work.wigwag.entry',
      'org.matrix.msc2762.timeline:!widgetroom:example.org'
    ]));
  });

  test('the widget answers supported_api_versions with a real version list, not an empty object', async ({ page }) => {
    // Regression: confirmed live that Element's own handling of this
    // reply does `response.supported_versions.includes(...)` with no
    // guard -- an empty {} reply (as if this were just another ignorable
    // notification) throws inside Element's OWN code, and that throw was
    // observed landing in the same dispatch path that delivers replies to
    // this widget's own pending requests, silently killing every
    // read_events call after the first.
    await h.gotoFakeWidgetHost(page, { roomId: '!widgetroom:example.org', roomName: 'Widget Room', initialEntries: seedLegacyEntries() });
    await expect(page.frameLocator('#widget').locator('#frame')).toBeVisible();
    const reply = await page.evaluate(() => window.__state.supportedApiVersionsReply);
    expect(Array.isArray(reply.supported_versions)).toBe(true);
    expect(reply.supported_versions).toEqual(expect.arrayContaining(['org.matrix.msc2762', 'org.matrix.msc2876']));
  });
});

// Tracker #149 (29e719c1): identity bootstrap must be keyed on the Matrix
// user id itself, not "is any identity already present in this browser" --
// the old check meant a second Matrix account, or a pre-existing personal
// identity, sharing a browser would silently sign every write as whoever
// was already active (including leaking a real personal email into a
// shared room). See wigwag.html's own resolveRoomModeIdentity comment for
// the full reasoning. Deliberately NOT namespaced/prefixed (tracker
// f6b39bf0) -- a signing keypair is a device credential, not room
// content, so it lives in wigwag.html's real, un-shimmed, un-prefixed
// localStorage, shared (correctly, MXID-keyed) across every room this
// browser ever bridges as a widget -- same-origin with the innermost
// #frame (wigwag.html) regardless of nesting, so reading/seeding it from
// the outer page works the same as it always did.
const IDENTITIES_LS_KEY = 'git_native_tracker_identities_v1';
async function readIdentities(page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw).identities : null;
  }, IDENTITIES_LS_KEY);
}

test.describe('wigwag-matrix-host.html: MXID-keyed identity bootstrap', () => {
  test('two different Matrix users connecting from the same browser each get their own identity', async ({ page }) => {
    await h.gotoFakeWidgetHost(page, { roomId: '!widgetroom:example.org', userId: '@alice:example.org', roomName: 'Widget Room', initialEntries: seedLegacyEntries() });
    await expect(page.frameLocator('#widget').locator('#frame')).toBeVisible();
    const afterAlice = await readIdentities(page);
    expect(afterAlice).toHaveLength(1);
    expect(afterAlice[0].matrixUserId).toBe('@alice:example.org');

    await h.gotoFakeWidgetHost(page, { roomId: '!widgetroom:example.org', userId: '@bob:example.org', roomName: 'Widget Room', initialEntries: seedLegacyEntries() });
    await expect(page.frameLocator('#widget').locator('#frame')).toBeVisible();
    const afterBob = await readIdentities(page);
    expect(afterBob).toHaveLength(2); // Alice's own identity is untouched, not overwritten
    expect(afterBob.map(i => i.matrixUserId).sort()).toEqual(['@alice:example.org', '@bob:example.org']);
  });

  test('reconnecting as the same Matrix user reuses the same identity and signing key, not a fresh one', async ({ page }) => {
    await h.gotoFakeWidgetHost(page, { roomId: '!widgetroom:example.org', userId: '@tom:lant.uk', roomName: 'Widget Room', initialEntries: seedLegacyEntries() });
    await expect(page.frameLocator('#widget').locator('#frame')).toBeVisible();
    const first = (await readIdentities(page))[0];

    await h.gotoFakeWidgetHost(page, { roomId: '!widgetroom:example.org', userId: '@tom:lant.uk', roomName: 'Widget Room', initialEntries: seedLegacyEntries() });
    await expect(page.frameLocator('#widget').locator('#frame')).toBeVisible();
    const afterReconnect = await readIdentities(page);
    expect(afterReconnect).toHaveLength(1); // no duplicate minted
    expect(afterReconnect[0].id).toBe(first.id);
    expect(afterReconnect[0].signingPublicKeyJwk).toEqual(first.signingPublicKeyJwk); // same key, not a fresh one
  });

  test('a pre-existing personal (non-Matrix) identity in the same browser is never adopted or overwritten', async ({ page }) => {
    // addInitScript re-runs on EVERY same-origin navigation in this page --
    // including the nested #frame iframe loading wigwag.html AFTER
    // bootstrapLocalStorage has already run -- so an unconditional write
    // here would clobber the freshly-created Matrix identity right back
    // to this seed. Guarded the same way seedDemoMilestone already is.
    await page.addInitScript((key) => {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, JSON.stringify({
        activeIdentityId: 'personal-1',
        identities: [{ id: 'personal-1', label: 'Real Person', email: 'real.person@example.com', githubToken: '', jiraProxyUrl: '', salesforceProxyUrl: '', signingPublicKeyJwk: {}, signingPrivateKeyJwk: {} }],
        lastActiveProjectByIdentity: {}
      }));
    }, IDENTITIES_LS_KEY);
    await h.gotoFakeWidgetHost(page, { roomId: '!widgetroom:example.org', userId: '@tom:lant.uk', roomName: 'Widget Room', initialEntries: seedLegacyEntries() });
    await expect(page.frameLocator('#widget').locator('#frame')).toBeVisible();
    const identities = await readIdentities(page);
    expect(identities).toHaveLength(2);
    const personal = identities.find(i => i.id === 'personal-1');
    expect(personal.email).toBe('real.person@example.com'); // untouched
    expect(personal.matrixUserId).toBeUndefined();
    const matrixIdentity = identities.find(i => i.id !== 'personal-1');
    expect(matrixIdentity.matrixUserId).toBe('@tom:lant.uk');
  });

  test('a legacy identity whose email already equals this MXID is adopted, keeping its existing signing key', async ({ page }) => {
    // Same re-fires-on-every-navigation guard as above.
    await page.addInitScript((key) => {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, JSON.stringify({
        activeIdentityId: 'legacy-1',
        identities: [{ id: 'legacy-1', label: 'Matrix', email: '@tom:lant.uk', githubToken: '', jiraProxyUrl: '', salesforceProxyUrl: '', signingPublicKeyJwk: { kty: 'EC', x: 'legacy-x' }, signingPrivateKeyJwk: {} }],
        lastActiveProjectByIdentity: {}
      }));
    }, IDENTITIES_LS_KEY);
    await h.gotoFakeWidgetHost(page, { roomId: '!widgetroom:example.org', userId: '@tom:lant.uk', displayName: 'Tom', roomName: 'Widget Room', initialEntries: seedLegacyEntries() });
    await expect(page.frameLocator('#widget').locator('#frame')).toBeVisible();
    const identities = await readIdentities(page);
    expect(identities).toHaveLength(1); // adopted, not duplicated
    expect(identities[0].id).toBe('legacy-1');
    expect(identities[0].signingPublicKeyJwk).toEqual({ kty: 'EC', x: 'legacy-x' }); // the pre-existing key survives
    expect(identities[0].matrixUserId).toBe('@tom:lant.uk'); // backfilled
    expect(identities[0].label).toBe('Tom'); // refreshed from the current display name
  });

  test('a widget with no resolvable Matrix user id fails loudly instead of writing a shared "unknown-matrix-user" placeholder', async ({ page }) => {
    await h.gotoFakeWidgetHost(page, { roomId: '!widgetroom:example.org', userId: '', roomName: 'Widget Room', initialEntries: seedLegacyEntries() });
    const widget = page.frameLocator('#widget');
    await expect(widget.locator('#status')).toBeVisible();
    await expect(widget.locator('#status')).toContainText('Matrix user id');
    await expect(widget.locator('#frame')).toBeHidden();
    const identities = await readIdentities(page);
    expect(identities).toBeNull(); // nothing written at all -- no placeholder identity
  });
});

// Tracker #149: a room can hold more than one project's history (an
// imported project keeps its own id, rather than getting mangled into
// "the" room's one project). Discovery scans whatever's already been
// pulled for distinct projectId values; a picker only ever appears when
// there's genuinely more than one.
test.describe('wigwag-matrix-host.html: multiple projects in one room', () => {
  test('a room with only untagged (legacy-shaped) entries connects straight through, no prompt of any kind', async ({ page }) => {
    h.mockMatrixClientApi(page, {
      homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room',
      initialEntries: [entryEvent({ issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'Untagged issue', sortKey: 1, origin: 'authored' } })] // no projectId at all
    });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.locator('#frame')).toBeVisible();
    await expect(page.frameLocator('#frame').locator('[data-testid=row]')).toContainText('Untagged issue');
  });

  // Tracker #149, live-reported: no "which project would you like everybody
  // to see?" prompt -- the room's own data already tells you what's there,
  // so ALL discovered projects are bootstrapped and bridged immediately.
  // wigwag.html's own switcher (left fully live) is the real way to move
  // between them.
  test('a room with two explicitly-tagged projects bootstraps both immediately -- no picker, switching shows each one\'s own issues', async ({ page }) => {
    h.mockMatrixClientApi(page, {
      homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room',
      initialEntries: [
        entryEvent({ issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'In project A', sortKey: 1, origin: 'authored' }, projectId: 'proj-a' }),
        entryEvent({ issueId: 'i2', entry: { id: 'h2', field: 'title', value: 'In project B', sortKey: 2, origin: 'authored' }, projectId: 'proj-b' }),
      ]
    });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.locator('#frame')).toBeVisible();
    await page.waitForTimeout(300);

    const frame = page.frameLocator('#frame');
    // Neither project is the room's own legacy default (no untagged
    // entries exist) -- whichever opens first, both must already be
    // listed in the switcher, with no prompt ever shown.
    await frame.locator('[data-testid=btn-switcher]').first().click();
    const rows = frame.locator('[data-testid=switcher-project-row]');
    await expect(rows).toHaveCount(2);

    await rows.filter({ hasText: 'proj-b'.slice(-8) }).click();
    await page.waitForTimeout(200);
    await expect(frame.locator('[data-testid=row]')).toHaveCount(1);
    await expect(frame.locator('[data-testid=row]')).toContainText('In project B');
  });

  test('untagged legacy entries stay attributed to the room\'s own default project even when another, explicitly-tagged project also exists', async ({ page }) => {
    h.mockMatrixClientApi(page, {
      homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room',
      initialEntries: [
        entryEvent({ issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'Legacy default issue', sortKey: 1, origin: 'authored' } }), // untagged
        entryEvent({ issueId: 'i2', entry: { id: 'h2', field: 'title', value: 'In a real other project', sortKey: 2, origin: 'authored' }, projectId: 'proj-other' }),
      ]
    });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.locator('#frame')).toBeVisible();
    await page.waitForTimeout(300);

    // The room's own default (untagged) project opens first automatically.
    const frame = page.frameLocator('#frame');
    await expect(frame.locator('[data-testid=row]')).toHaveCount(1);
    await expect(frame.locator('[data-testid=row]')).toContainText('Legacy default issue');

    // The other, explicitly-tagged project is ALSO already bootstrapped
    // and switchable -- untagged entries must never leak into it.
    await frame.locator('[data-testid=btn-switcher]').first().click();
    const rows = frame.locator('[data-testid=switcher-project-row]');
    await expect(rows).toHaveCount(2);
    await rows.filter({ hasText: 'proj-other'.slice(-8) }).click();
    await page.waitForTimeout(200);
    await expect(frame.locator('[data-testid=row]')).toHaveCount(1);
    await expect(frame.locator('[data-testid=row]')).toContainText('In a real other project');
  });

  // Tracker #149: a discovered project's switcher label prefers its own
  // real, derived name (a field:'__project_name__' history entry) over
  // the generic "Project <short-id>" placeholder -- the same "signed
  // history wins" mechanism a field definition already uses.
  test('a discovered project with its own rename entry shows its real name in the switcher, not a placeholder', async ({ page }) => {
    const namedProjectEntry = {
      type: 'work.wigwag.entry',
      content: { v: 1, scope: 'project', projectId: 'proj-named', entry: { id: 'pn1', field: '__project_name__', value: 'Real Project Name', sortKey: 1, origin: 'authored' } }
    };
    h.mockMatrixClientApi(page, {
      homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room',
      initialEntries: [
        namedProjectEntry,
        entryEvent({ issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'In the named project', sortKey: 2, origin: 'authored' }, projectId: 'proj-named' }),
        entryEvent({ issueId: 'i2', entry: { id: 'h2', field: 'title', value: 'In the unnamed project', sortKey: 3, origin: 'authored' }, projectId: 'proj-unnamed' }),
      ]
    });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.locator('#frame')).toBeVisible();
    await page.waitForTimeout(300);

    const frame = page.frameLocator('#frame');
    await frame.locator('[data-testid=btn-switcher]').first().click();
    const rows = frame.locator('[data-testid=switcher-project-row]');
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: 'Real Project Name' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'proj-unnamed'.slice(-8) })).toHaveCount(1);

    await rows.filter({ hasText: 'Real Project Name' }).click();
    await page.waitForTimeout(200);
    await expect(frame.locator('[data-testid=row]')).toHaveCount(1);
    await expect(frame.locator('[data-testid=row]')).toContainText('In the named project');
  });

  // Live-reported (Tom): two viewers disagreeing on a project's name.
  // Root cause -- PROJECTS_KEY.milestones[].name (what the switcher
  // actually renders) was only ever refreshed when a project was actively
  // opened/switched to; a project sitting un-opened in the switcher kept
  // whatever name it had at first discovery, forever, even after a real
  // rename landed in the room's own signed history afterward.
  // reconcileIntoLocal already re-derives every bridged project's real
  // name from its merged history on every poll tick -- it just never used
  // to reach the switcher's own local cache. This drives a rename arriving
  // on a LATER poll, for a project this viewer never opens at all.
  test('a project\'s rename that arrives on a later poll updates the switcher immediately, even if this viewer never opens that project', async ({ page }) => {
    const state = h.mockMatrixClientApi(page, {
      homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room',
      initialEntries: [
        entryEvent({ issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'In the active project', sortKey: 1, origin: 'authored' } }), // untagged -- the legacy default, what this viewer opens
        entryEvent({ issueId: 'i2', entry: { id: 'h2', field: 'title', value: 'In the other project', sortKey: 2, origin: 'authored' }, projectId: 'proj-other' }),
      ]
    });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.locator('#frame')).toBeVisible();
    await page.waitForTimeout(300);

    const frame = page.frameLocator('#frame');
    await frame.locator('[data-testid=btn-switcher]').first().click();
    const rows = frame.locator('[data-testid=switcher-project-row]');
    await expect(rows.filter({ hasText: 'proj-other'.slice(-8) })).toHaveCount(1); // placeholder label, no real name yet
    await frame.locator('[data-testid=btn-switcher]').first().click(); // close it again -- never opened proj-other

    // Someone else renames proj-other -- arrives on this viewer's next
    // poll, as a real signed project-scope entry, same as any other edit.
    state.pendingEntries.push({
      type: 'work.wigwag.entry',
      content: { v: 1, scope: 'project', projectId: 'proj-other', entry: { id: 'rn1', field: '__project_name__', value: 'Renamed By Someone Else', sortKey: 3, origin: 'authored' } }
    });

    await expect(async () => {
      await frame.locator('[data-testid=btn-switcher]').first().click();
      await expect(frame.locator('[data-testid=switcher-project-row]').filter({ hasText: 'Renamed By Someone Else' })).toHaveCount(1);
      await frame.locator('[data-testid=btn-switcher]').first().click();
    }).toPass({ timeout: 8000 }); // next 5s poll tick picks it up, no need to ever open the project

    // The local switcher cache itself was actually updated, not just this
    // one render -- reopening the switcher again later still shows it.
    const projects = await page.evaluate(() => JSON.parse(window.__wigwagHostStorage.getItem('git_native_tracker_milestones_v1')));
    expect(projects.milestones.find(m => m.id === 'proj-other').name).toBe('Renamed By Someone Else');
  });
});

// Tracker f6b39bf0, live-reported rate-limit incident: project creation is
// now a moderator-gated Matrix state event (work.wigwag.project), not an
// unconditional local-then-bridged action. Room Scoped Widget Mode has a
// real "no projects yet" state instead of always synthesizing a default
// project the moment a room is empty.
test.describe('wigwag-matrix-host.html: moderator-gated project creation', () => {
  test('a moderator\'s "+ New project" from the empty-room screen succeeds and shows the new project', async ({ page }) => {
    h.mockMatrixClientApi(page, { homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room', initialEntries: [], powerLevels: MODERATOR_LEVELS });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    const frame = page.frameLocator('#frame');
    await expect(frame.locator('[data-testid=room-no-projects]')).toBeVisible();

    await frame.locator('[data-testid=btn-create-first-room-project]').click();
    await page.waitForTimeout(300);
    await expect(frame.locator('[data-testid=room-no-projects]')).toBeHidden();
    await expect(frame.locator('[data-testid=tracker-name-title]').first()).toBeVisible();
  });

  // Tracker #169/4f07e72b follow-up: the button itself is now hidden
  // entirely for a real non-moderator (client-side isRoomModerator check),
  // so this scenario is only reachable when the client-side check and the
  // server's own power-level enforcement disagree -- e.g. a moderator
  // demoted between page load and click. powerLevels: MODERATOR_LEVELS
  // makes the button visible/clickable; projectCreationForbidden: true
  // still forces the real write to be rejected server-side, exercising
  // exactly the belt-and-braces path this test exists for: a rejected
  // write must never look like it succeeded, regardless of what the
  // client-side check believed.
  test('a moderator (by client-side check) whose write is still rejected server-side is rolled back locally and shown a real error -- never silently dropped', async ({ page }) => {
    h.mockMatrixClientApi(page, { homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room', initialEntries: [], projectCreationForbidden: true, powerLevels: MODERATOR_LEVELS });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    const frame = page.frameLocator('#frame');
    await expect(frame.locator('[data-testid=room-no-projects]')).toBeVisible();

    await frame.locator('[data-testid=btn-create-first-room-project]').click();
    await page.waitForTimeout(300);
    // Still on the empty-room screen (rolled back, not silently accepted)
    // -- tracker f6b39bf0's own lesson from the double-send incident: a
    // rejected write must never look like it succeeded.
    await expect(frame.locator('[data-testid=room-no-projects]')).toBeVisible();
    await expect(frame.locator('[data-testid=room-no-projects-rejected]')).toBeVisible();
    await expect(frame.locator('[data-testid=room-no-projects-rejected]')).toContainText('moderator');
    // Nothing left behind locally either -- the optimistically-created
    // local project was rolled back out of PROJECTS_KEY's milestone list
    // (the key itself may still exist, from createBlankProject's own
    // initial write, but must hold no rejected project).
    const projectsAfter = await page.evaluate(() => JSON.parse(window.__wigwagHostStorage.getItem('git_native_tracker_milestones_v1') || 'null'));
    expect((projectsAfter && projectsAfter.milestones) || []).toEqual([]);
  });

  // Live-reported (Tom, tracker f6b39bf0 follow-up): the empty-room screen
  // only ever offered "+ New project" -- no way to receive a project
  // someone sends you (paste or file), unlike the normal in-app "Receive"
  // flow. Wired through the SAME handleApplyUpdateParsed used everywhere
  // else: content with no matching local project id always lands via
  // importParsedAsNewProject, which is exactly what happens here since
  // the room has zero projects to match against.
  test('a moderator can paste-receive a project from the empty-room screen, same underlying import path as the main app', async ({ page }) => {
    h.mockMatrixClientApi(page, { homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room', initialEntries: [], powerLevels: MODERATOR_LEVELS });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    const frame = page.frameLocator('#frame');
    await expect(frame.locator('[data-testid=room-no-projects]')).toBeVisible();

    await frame.locator('[data-testid=btn-receive-first-room-project]').click();
    await expect(frame.locator('[data-testid=room-no-projects-receive-modal]')).toBeVisible();
    const pastedJsonl = [
      JSON.stringify({ type: 'fields', fields: { title: { label: 'Issue', type: 'text' } }, id: 'received-proj-1', name: 'Received Project' }),
      JSON.stringify({ type: 'issue', id: 'ri1', num: 1, fieldRefs: {}, values: { title: 'Received issue' }, comments: [], history: [] })
    ].join('\n');
    await frame.locator('[data-testid=room-no-projects-receive-textarea]').fill(pastedJsonl);
    await frame.locator('[data-testid=btn-submit-room-no-projects-receive]').click();
    // Goes straight to importParsedAsNewProject, not through
    // handleApplyUpdateParsed's generic "brand new project?" confirm --
    // with zero projects in the room there is no existing project a
    // paste could plausibly be an update to, so that confirm would never
    // be ambiguous here; skipping it is simpler and one less click.
    await page.waitForTimeout(300);

    await expect(frame.locator('[data-testid=room-no-projects]')).toBeHidden();
    await expect(frame.locator('[data-testid=row]')).toContainText('Received issue');
  });

  // Live-reported (Tom, 2026-09-28): a fresh bulk import correctly sent
  // exactly one snapshot (the earlier duplicate-snapshot race fixed above),
  // but every imported item stayed stuck showing 'pending' in the UI
  // indefinitely. Root cause: the outbox's normal confirmation path
  // (clearConfirmedFromOutbox) only clears an entry once it appears in a
  // freshly-recomputed remoteDoc, which is derived purely from the room's
  // plain work.wigwag.entry timeline -- a snapshot's actual content lives
  // in an encrypted media blob nothing re-resolves back into that timeline
  // for an already-bridged project's own ongoing reconcile, so the pending
  // state could never clear within the same session. Fixed by having a
  // successful snapshot upload directly confirm its own items -- but via a
  // distinct 'confirmed-via-snapshot' outbox status, NOT by deleting them:
  // deleting made them indistinguishable from "never attempted" to the
  // very next send-decision check, causing an immediate, separate resend
  // of the exact items the snapshot just delivered (caught live while
  // building this fix, before it reached this test).
  test('a fresh bulk import via the snapshot path clears pending state immediately, with no follow-up resend', async ({ page }) => {
    await page.addInitScript(() => { window.__wigwagTestTracePendingUpdates = []; });
    const state = h.mockMatrixClientApi(page, { homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room', initialEntries: [], powerLevels: MODERATOR_LEVELS });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    const frame = page.frameLocator('#frame');
    await expect(frame.locator('[data-testid=room-no-projects]')).toBeVisible();

    await frame.locator('[data-testid=btn-receive-first-room-project]').click();
    await expect(frame.locator('[data-testid=room-no-projects-receive-modal]')).toBeVisible();
    const issueLines = [];
    for (let i = 1; i <= 30; i++) {
      issueLines.push(JSON.stringify({ type: 'issue', id: 'ri' + i, num: i, fieldRefs: {}, values: { title: 'Received issue ' + i, status: 'todo' }, comments: [], history: [] }));
    }
    const pastedJsonl = [
      JSON.stringify({ type: 'fields', fields: {
        title: { label: 'Issue', type: 'text' },
        status: { label: 'Status', type: 'select', options: [{ id: 'todo', label: 'Todo', color: 'gray' }, { id: 'done', label: 'Done', color: 'green' }] }
      }, id: 'received-proj-1', name: 'Received Project' }),
      ...issueLines
    ].join('\n');
    await frame.locator('[data-testid=room-no-projects-receive-textarea]').fill(pastedJsonl);
    await frame.locator('[data-testid=btn-submit-room-no-projects-receive]').click();
    await expect(frame.locator('[data-testid=row]')).toHaveCount(30);
    await page.waitForTimeout(3000); // long enough for a follow-up resend, if the bug regressed, to actually happen

    const trace = await page.evaluate(() => window.__wigwagTestTracePendingUpdates);
    expect(trace.length).toBeGreaterThan(0);
    expect(Object.keys(trace[0].issues).length).toBeGreaterThan(0); // the import really did mark things pending first
    const lastSummary = trace[trace.length - 1];
    expect(lastSummary.issues).toEqual({});
    expect(lastSummary.project).toEqual({});

    expect(state.sentSnapshotManifests.length).toBe(1);
    expect(state.sentEntries.length).toBe(0);
  });

  // Live-reported (Tom): two accounts viewing the SAME room-mode project
  // disagreed on its name -- one saw the real "Untitled Project 1", the
  // other fell back to "Untitled" then "Project <id tail>". Root cause:
  // createBlankProject only ever wrote the initial name to the local,
  // unsynced PROJECTS_KEY cache -- never a real signed history entry,
  // unlike every LATER rename. Fixed by having it append one, same as a
  // rename does; verified here via a full reconnect (a fresh session
  // discovering the project purely from the room's own signed history,
  // never having created it locally itself -- the same shape as a
  // second account).
  test('a project created via "+ New project" has a real name a totally fresh session can derive, not just a local-only label', async ({ page }) => {
    h.mockMatrixClientApi(page, { homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room', initialEntries: [], powerLevels: MODERATOR_LEVELS });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    let frame = page.frameLocator('#frame');
    await expect(frame.locator('[data-testid=room-no-projects]')).toBeVisible();
    await frame.locator('[data-testid=btn-create-first-room-project]').click();
    await page.waitForTimeout(300);
    await expect(frame.locator('[data-testid=tracker-name-title]').first()).toHaveText('Untitled Project 1');
    await page.waitForTimeout(800); // let the new name-history entry actually push to the room

    // A totally fresh session, reconnecting from scratch -- has never
    // created this project locally, only ever sees it via the room's own
    // signed history (matching a second, independent account exactly).
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    frame = page.frameLocator('#frame');
    await expect(frame.locator('[data-testid=tracker-name-title]').first()).toHaveText('Untitled Project 1');
  });

  // Live-reported (Tom, tracker f6b39bf0), the follow-up once the id/
  // auto-switch bug above was fixed: the right project now appears, but
  // still under the wrong (fallback) name -- because a REAL "+ New
  // project" always bulk-adopts by pushing its entire history as a
  // single snapshot blob, never plain entries, and the mid-session
  // discovery loop (unlike connect() itself) never resolves snapshots at
  // all. A plain-entries-only project (the test above) could never have
  // caught this.
  test('a viewer already sitting on the empty-room screen resolves a newly-appeared project\'s snapshot-only name via the live poll, not stuck on a generic fallback', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'timer-dependent, one browser is enough to prove the mechanism');
    const items = [
      { scope: 'project', entry: { id: 'ph1', field: '__project_name__', value: 'Snapshot-Only Mid-Session Project', sortKey: 1, origin: 'authored' }, projectId: 'mid-session-snap-project' }
    ];
    const { manifestEvent, mediaBlob } = await snapshotEvent({ projectId: 'mid-session-snap-project', snapshotId: 'snap-mid-1', items, cutoffSortKey: 1, mxc: 'mxc://example.org/midsession1' });
    const state = h.mockMatrixClientApi(page, {
      homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room',
      initialEntries: [], seedMediaBlobs: [mediaBlob]
    });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    const frame = page.frameLocator('#frame');
    await expect(frame.locator('[data-testid=room-no-projects]')).toBeVisible();

    // A DIFFERENT, moderator account's "+ New project" -- the state
    // event plus the one snapshot manifest that carries its ENTIRE
    // history, exactly what a real bulk adopt sends.
    state.pendingEntries.push(
      { type: 'work.wigwag.project', state_key: 'mid-session-snap-project', content: { v: 1, createdAt: new Date().toISOString(), createdBy: '@someone-else:example.org' } },
      manifestEvent
    );

    await expect(frame.locator('[data-testid=room-no-projects]')).toBeHidden({ timeout: 8000 });
    await expect(frame.locator('[data-testid=tracker-name-title]').first()).toHaveText('Snapshot-Only Mid-Session Project');
  });

  // Live-reported (Tom, tracker f6b39bf0): a viewer who was ALREADY
  // connected -- sitting on the "no projects yet" screen -- when a
  // moderator (a different account) created the room's first project
  // saw it show up as "Untitled" with "no id" when opened, and it never
  // recovered. Root cause: the PROJECTS_KEY storage-change handler only
  // ever refreshed s.projects, by design never touching s.projectId
  // (right call for Local Mode's cross-tab sync, where another tab
  // creating a project should never steal this tab's focus). In Room
  // Mode, a viewer with ZERO projects has nothing of its own to protect
  // -- s.projectId stayed null forever, permanently hitting every "no
  // matching project" fallback even once s.projects was no longer empty.
  test('a viewer already sitting on the empty-room screen auto-switches into a project that appears via the live poll, not stuck on "Untitled" with no id', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'timer-dependent, one browser is enough to prove the mechanism');
    const state = h.mockMatrixClientApi(page, { homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room', initialEntries: [] });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    const frame = page.frameLocator('#frame');
    await expect(frame.locator('[data-testid=room-no-projects]')).toBeVisible();

    // A DIFFERENT, moderator account creates the room's first project
    // while THIS viewer is already connected and sitting on the empty
    // screen.
    const otherProjectId = 'mid-session-first-project';
    state.pendingEntries.push(
      { type: 'work.wigwag.project', state_key: otherProjectId, content: { v: 1, createdAt: new Date().toISOString(), createdBy: '@someone-else:example.org' } },
      { type: 'work.wigwag.entry', content: { v: 1, scope: 'project', projectId: otherProjectId, entry: { id: 'mp1', field: '__project_name__', value: "Someone Else's Project", sortKey: 1, origin: 'authored' } } }
    );

    await expect(frame.locator('[data-testid=room-no-projects]')).toBeHidden({ timeout: 8000 });
    await expect(frame.locator('[data-testid=tracker-name-title]').first()).toHaveText("Someone Else's Project");

    // The project-id-in-slide-over feature (also live-reported: "appears
    // to have no id when opened") must show the REAL id, not an empty
    // ref from a still-null projectId.
    await frame.locator('[data-testid=btn-notes]').click();
    await expect(frame.locator('[data-testid=notes-shortref]')).toContainText(otherProjectId.slice(0, 8));
  });

  // Targets the exact race Tom found live: the OLD fix appended the name
  // entry via a SEPARATE, later write (appendProjectHistory, after
  // switchProject) -- which only mattered if it landed before the room's
  // adoption flow (moderator-gated state event, then an immediate initial
  // snapshot of "whatever the doc looks like right now") got there first.
  // Live evidence showed the real widget-transport round trip winning
  // that race: the pushed snapshot's cutoffSortKey exactly matched the
  // project's OWN creation timestamp, proving the name entry didn't
  // exist in the doc yet when the snapshot was built. The fix bakes the
  // name entry into the doc's FIRST write instead, so there's no second
  // write left to race against -- checked here by inspecting the FIRST
  // snapshot's own decrypted contents directly, not just the eventual
  // state after a reconnect (which the earlier, still-racy fix already
  // passed against this mock, since its own timing happened to favor
  // the local write).
  test('a project created via "+ New project" has its name baked into the FIRST snapshot pushed, not a separate later write', async ({ page }) => {
    const state = h.mockMatrixClientApi(page, { homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room', initialEntries: [], powerLevels: MODERATOR_LEVELS });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    const frame = page.frameLocator('#frame');
    await expect(frame.locator('[data-testid=room-no-projects]')).toBeVisible();
    await frame.locator('[data-testid=btn-create-first-room-project]').click();
    await page.waitForTimeout(500);

    expect(state.sentSnapshotManifests.length).toBe(1);
    const manifest = state.sentSnapshotManifests[0];
    const items = await decryptedSnapshotItems(state, manifest);
    const namePush = items.find(i => i.entry.field === '__project_name__');
    expect(namePush, 'the name entry must be in the FIRST snapshot, not a later separate send').toBeTruthy();
    expect(namePush.entry.value).toBe('Untitled Project 1');
  });

  // Live-reported (Tom, tracker f6b39bf0): a project created via "+ New
  // project" "sprouted" extra fields (Related/Type/Delivery Teams/
  // Mitigation) it never actually had, within a poll tick or two of
  // creation. Root cause: hydrateProjectFromMatrixTimeline's own
  // fallbackFieldDefs isn't just "use this if nothing else exists" --
  // backfillProjectHistory bakes a real, permanent history entry for
  // EVERY field the fallback carries that the project's own real history
  // doesn't happen to mention, regardless of how many real fields
  // already exist. core.defaultFieldDefs() (the built-in demo-style rich
  // set) was being passed as that fallback for every project, not just
  // the room's genuinely-legacy untagged-entries default one.
  test('a project created via "+ New project" never sprouts fields from the built-in default set it never actually had', async ({ page }) => {
    h.mockMatrixClientApi(page, { homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room', initialEntries: [], powerLevels: MODERATOR_LEVELS });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    const frame = page.frameLocator('#frame');
    await expect(frame.locator('[data-testid=room-no-projects]')).toBeVisible();
    await frame.locator('[data-testid=btn-create-first-room-project]').click();
    await page.waitForTimeout(300);

    const projectId = await page.evaluate(() =>
      JSON.parse(window.__wigwagHostStorage.getItem('git_native_tracker_milestones_v1')).activeMilestoneId);
    // Past at least one full poll tick (5s) -- reconcileIntoLocal's own
    // re-hydration is exactly where the bug injected the extra fields.
    await page.waitForTimeout(5500);

    const doc = await page.evaluate((pid) =>
      JSON.parse(window.__wigwagHostStorage.getItem('git_native_tracker_v1:' + pid)), projectId);
    const fieldIds = Object.keys(doc.fieldDefs);
    // core.defaultFieldDefs()'s own extra fields beyond what "+ New
    // project" (blankProjectFieldDefs) actually starts with.
    expect(fieldIds).not.toContain('linked'); // Related
    expect(fieldIds).not.toContain('type'); // Type
    expect(fieldIds).not.toContain('teams'); // Delivery Teams
    expect(fieldIds).not.toContain('mitigation'); // Mitigation
    // Its own real starter fields must still be there, untouched.
    expect(fieldIds.some(id => doc.fieldDefs[id].label === 'Priority')).toBe(true);
    expect(fieldIds.some(id => doc.fieldDefs[id].label === 'RAG')).toBe(true);
  });

  test('an existing room\'s legacy project (grandfathered, predates this feature) is discovered without needing a state event', async ({ page }) => {
    h.mockMatrixClientApi(page, {
      homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room',
      initialEntries: [entryEvent({ issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'Pre-existing issue', sortKey: 1, origin: 'authored' } })] // untagged, no work.wigwag.project event anywhere
    });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    const frame = page.frameLocator('#frame');
    await expect(frame.locator('[data-testid=room-no-projects]')).toBeHidden();
    await expect(frame.locator('[data-testid=row]')).toContainText('Pre-existing issue');
  });

  test('the project index is found via a real current-state fetch, not by how far a timeline pull happens to reach', async ({ page }) => {
    // messagesReturnsProjectStateEvents: false -- the work.wigwag.project
    // event exists ONLY in room state (getMatrixRoomState), never in the
    // /messages timeline this test's connect() actually pulls from. If
    // discovery only ever scanned the timeline (the old mechanism), this
    // project would be invisible; the real current-state fetch must be
    // what actually finds it.
    const state = h.mockMatrixClientApi(page, {
      homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room', initialEntries: [], messagesReturnsProjectStateEvents: false, powerLevels: MODERATOR_LEVELS
    });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    const frame = page.frameLocator('#frame');
    await expect(frame.locator('[data-testid=room-no-projects]')).toBeVisible();
    await frame.locator('[data-testid=btn-create-first-room-project]').click();
    await page.waitForTimeout(300);
    expect(state.sentProjectStateEvents.length).toBe(1);

    // Fresh reconnect, same room -- the state event is now sitting in
    // /state (never in /messages, per the flag above).
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(200);
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.frameLocator('#frame').locator('[data-testid=room-no-projects]')).toBeHidden();
  });
});

// Live-reported (Tom): after a big bulk import, one account saw the new
// project immediately; a different account in the same room, reconnecting
// fresh, saw ONLY the new project (the room's older, original project had
// vanished) AND the new project's own name was missing too -- both
// symptoms of the same root cause. A bulk import's entries are the most
// RECENT events in the room, so they dominate the first page(s) of a
// dir=b (backward-from-now) pull; pullInitial used to stop after exactly
// one page, so an older project (and, depending on ordering, even the new
// project's own __project_name__ entry) simply hadn't been reached yet.
test.describe('wigwag-matrix-host.html: connect pulls the FULL room history, not just one page', () => {
  test('an older project and a name entry that only exist in a later page are still discovered on connect', async ({ page }) => {
    const newProjectNameEntry = {
      type: 'work.wigwag.entry',
      content: { v: 1, scope: 'project', projectId: 'new-project', entry: { id: 'nph1', field: '__project_name__', value: 'Freshly Imported', sortKey: 100, origin: 'authored' } }
    };
    const newProjectIssueEntry = entryEvent({ issueId: 'new1', entry: { id: 'nh1', field: 'title', value: 'New project issue', sortKey: 101, origin: 'authored' }, projectId: 'new-project' });
    const oldProjectEntry = entryEvent({ issueId: 'old1', entry: { id: 'oh1', field: 'title', value: 'Old project issue', sortKey: 1, origin: 'authored' }, projectId: 'old-project' });

    // Most-recent-first ordering (matching dir=b), paged 2-at-a-time so a
    // single-page pull would see only the new project's issue entry and
    // miss both its own name (page 1) and the old project entirely (page 2).
    h.mockMatrixClientApi(page, {
      homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room',
      initialEntries: [newProjectIssueEntry, newProjectNameEntry, oldProjectEntry],
      messagesPageSize: 2
    });

    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.locator('#frame')).toBeVisible();

    const frame = page.frameLocator('#frame');
    await frame.locator('[data-testid=btn-switcher]').first().click();
    const rows = frame.locator('[data-testid=switcher-project-row]');
    await expect(rows).toHaveCount(2); // both projects, not just the one dominating the most recent page
    await expect(rows.filter({ hasText: 'Freshly Imported' })).toHaveCount(1); // name resolved, not a placeholder
    await expect(rows.filter({ hasText: 'old-project'.slice(-8) })).toHaveCount(1);
  });
});

// Inspects what a real bulk-adopt/snapshot push actually sent, for tests
// that need to look inside the encrypted blob rather than just confirm a
// snapshot happened -- finds the uploaded blob a given manifest points at
// (by mxc) and decrypts it via the real core.js primitives (never
// assuming/mocking the encryption itself), returning the same flat
// {scope, issueId, stream, entry, projectId} item array the OLD
// state.sentSnapshotChunks used to expose directly, pre-encryption.
async function decryptedSnapshotItems(state, manifest) {
  const blob = state.uploadedSnapshotBlobs.find(b => b.mxc === manifest.mxc);
  if (!blob) return [];
  const plaintextBytes = await core.decryptSnapshotPayload({ ciphertext: blob.bytes, encryption: manifest.encryption });
  const parsed = JSON.parse(new TextDecoder().decode(plaintextBytes));
  return parsed.map(item => core.entryFromMatrixEvent({ content: item })).filter(Boolean);
}

// Room snapshot (tracker f6b39bf0/#153, f1c7098f/#154): a project's full
// history repackaged as ONE client-side-encrypted media blob (not chunked
// events -- see WIGWAG_MATRIX_SNAPSHOT_TYPE's own comment in
// wigwag-core.js for the full design and why chunking was replaced),
// referenced by a single small manifest event. These tests drive the READ
// side directly (a room that only has a snapshot, no individual entries at
// all, still hydrates correctly, including a corrupted/unreachable blob
// falling back safely) and the WRITE side (a bulk-adopt automatically
// produces one, in far fewer requests than the old chunked design).
//
// Builds a REAL encrypted blob via the actual core.js primitives (never a
// fake/stubbed encryption) and a manifest event referencing it at a given
// mxc -- callers pass that mxc to mockMatrixClientApi's own
// `seedMediaBlobs` so the manifest's reference actually resolves.
async function snapshotEvent({ projectId, snapshotId, items, cutoffSortKey, mxc }) {
  const plaintext = new TextEncoder().encode(JSON.stringify(items.map(item => core.matrixEventContentFromEntry(item))));
  const { ciphertext, encryption } = await core.encryptSnapshotPayload(plaintext);
  const manifestEvent = { type: 'work.wigwag.snapshot', content: core.matrixEventContentFromSnapshotManifest({ projectId, snapshotId, cutoffSortKey, mxc, size: ciphertext.length, encryption }) };
  return { manifestEvent, mediaBlob: { mxc, bytes: ciphertext } };
}

test.describe('wigwag-matrix-host.html: room snapshot', () => {
  test('a room whose ONLY history for a project is a snapshot (no individual entries at all) still hydrates it correctly', async ({ page }) => {
    const items = [
      { scope: 'project', entry: { id: 'ph1', field: '__project_name__', value: 'Snapshotted Project', sortKey: 1, origin: 'authored' }, projectId: 'snap-project' },
      { scope: 'issue', issueId: 'si1', entry: { id: 'sh1', field: 'title', value: 'From the snapshot', sortKey: 2, origin: 'authored' }, projectId: 'snap-project' }
    ];
    const { manifestEvent, mediaBlob } = await snapshotEvent({ projectId: 'snap-project', snapshotId: 'snap-1', items, cutoffSortKey: 2, mxc: 'mxc://example.org/preseed1' });
    h.mockMatrixClientApi(page, {
      homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room',
      initialEntries: [manifestEvent], seedMediaBlobs: [mediaBlob]
    });

    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.locator('#frame')).toBeVisible();

    const frame = page.frameLocator('#frame');
    await frame.locator('[data-testid=btn-switcher]').first().click();
    await expect(frame.locator('[data-testid=switcher-project-row]').filter({ hasText: 'Snapshotted Project' })).toHaveCount(1);
    await frame.locator('[data-testid=switcher-project-row]').filter({ hasText: 'Snapshotted Project' }).click();
    await expect(frame.locator('[data-testid=row]')).toHaveCount(1);
    await expect(frame.locator('[data-testid=row]')).toContainText('From the snapshot');
  });

  test('a snapshot plus a newer "tail" entry combines correctly -- the tail is not swallowed by the snapshot', async ({ page }) => {
    const snapshotItems = [
      { scope: 'issue', issueId: 'si1', entry: { id: 'sh1', field: 'title', value: 'From the snapshot', sortKey: 1, origin: 'authored' }, projectId: 'snap-project' }
    ];
    const { manifestEvent, mediaBlob } = await snapshotEvent({ projectId: 'snap-project', snapshotId: 'snap-1', items: snapshotItems, cutoffSortKey: 1, mxc: 'mxc://example.org/preseed2' });
    const tailEntry = entryEvent({ issueId: 'si2', entry: { id: 'th1', field: 'title', value: 'After the snapshot', sortKey: 2, origin: 'authored' }, projectId: 'snap-project' });
    h.mockMatrixClientApi(page, {
      homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room',
      initialEntries: [manifestEvent, tailEntry], seedMediaBlobs: [mediaBlob]
    });

    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.locator('#frame')).toBeVisible();

    const frame = page.frameLocator('#frame');
    await expect(frame.locator('[data-testid=row]')).toHaveCount(2);
    await expect(frame.locator('[data-testid=row]').filter({ hasText: 'From the snapshot' })).toHaveCount(1);
    await expect(frame.locator('[data-testid=row]').filter({ hasText: 'After the snapshot' })).toHaveCount(1);
  });

  test('a manifest pointing at a blob that was never actually uploaded (404) is discarded -- falls back to the plain entries as if no snapshot existed', async ({ page }) => {
    const { manifestEvent } = await snapshotEvent({ projectId: 'snap-project', snapshotId: 'snap-1', items: [{ scope: 'issue', issueId: 'si1', entry: { id: 'sh1', field: 'title', value: 'Should be discarded', sortKey: 1, origin: 'authored' }, projectId: 'snap-project' }], cutoffSortKey: 1, mxc: 'mxc://example.org/never-uploaded' });
    // A real, plain entry for the same project exists independently of the
    // (unresolvable) snapshot -- deliberately NOT seeding the blob this
    // manifest points at.
    const plainEntry = entryEvent({ issueId: 'si2', entry: { id: 'ph1', field: 'title', value: 'Plain entry survives', sortKey: 5, origin: 'authored' }, projectId: 'snap-project' });
    h.mockMatrixClientApi(page, {
      homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room',
      initialEntries: [manifestEvent, plainEntry]
    });

    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.locator('#frame')).toBeVisible();

    const frame = page.frameLocator('#frame');
    await expect(frame.locator('[data-testid=row]')).toHaveCount(1); // only the plain entry's issue -- the unresolvable snapshot contributed nothing
    await expect(frame.locator('[data-testid=row]')).toContainText('Plain entry survives');
  });

  test('a corrupted/tampered blob (hash mismatch) is discarded exactly the same way -- never partially or incorrectly decrypted', async ({ page }) => {
    const { manifestEvent, mediaBlob } = await snapshotEvent({ projectId: 'snap-project', snapshotId: 'snap-1', items: [{ scope: 'issue', issueId: 'si1', entry: { id: 'sh1', field: 'title', value: 'Should be discarded', sortKey: 1, origin: 'authored' }, projectId: 'snap-project' }], cutoffSortKey: 1, mxc: 'mxc://example.org/corrupted1' });
    const tamperedBytes = new Uint8Array(mediaBlob.bytes);
    tamperedBytes[0] ^= 0xff; // flip a bit after "upload" -- corrupted in transit/at rest
    const plainEntry = entryEvent({ issueId: 'si2', entry: { id: 'ph1', field: 'title', value: 'Plain entry survives', sortKey: 5, origin: 'authored' }, projectId: 'snap-project' });
    h.mockMatrixClientApi(page, {
      homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room',
      initialEntries: [manifestEvent, plainEntry], seedMediaBlobs: [{ mxc: mediaBlob.mxc, bytes: tamperedBytes }]
    });

    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.locator('#frame')).toBeVisible();

    const frame = page.frameLocator('#frame');
    await expect(frame.locator('[data-testid=row]')).toHaveCount(1);
    await expect(frame.locator('[data-testid=row]')).toContainText('Plain entry survives');
  });

  test('a bulk-adopted (imported) project automatically gets a snapshot written for it, in just one upload and one manifest event', async ({ page }) => {
    const state = h.mockMatrixClientApi(page, {
      homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room',
      initialEntries: [entryEvent({ issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'Room issue', sortKey: 1, origin: 'authored' } })]
    });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.locator('#frame')).toBeVisible();

    // 40 issues -- large enough that the OLD chunked design (25/chunk)
    // would have needed 2+ chunk events plus a manifest; the media-blob
    // design needs exactly one upload and one manifest regardless of size
    // (tracker f6b39bf0's actual rate-limit fix).
    const issueLines = [];
    for (let i = 1; i <= 40; i++) {
      issueLines.push(JSON.stringify({ type: 'issue', id: 'si' + i, num: i, fieldRefs: {}, values: { title: 'Issue ' + i }, comments: [], history: [] }));
    }
    const pastedJsonl = [
      JSON.stringify({ type: 'fields', fields: { title: { label: 'Issue', type: 'text' } }, id: 'imported-for-snapshot', name: 'Imported For Snapshot' }),
      ...issueLines
    ].join('\n');
    const frame = page.frameLocator('#frame');
    await frame.locator('[data-testid=btn-import-merge]').first().click();
    await page.waitForTimeout(150);
    const [fc] = await Promise.all([
      page.waitForEvent('filechooser'),
      frame.locator('[data-testid=btn-paste-merge-open-file]').click(),
    ]);
    await fc.setFiles({ name: 'snapshot-test.jsonl', mimeType: 'application/octet-stream', buffer: Buffer.from(pastedJsonl) });
    await expect(frame.locator('[data-testid=confirm-dialog-modal]')).toBeVisible();
    await frame.locator('[data-testid=btn-confirm-dialog-confirm]').click();
    await page.waitForTimeout(500);

    expect(state.sentSnapshotManifests.length).toBe(1);
    expect(state.uploadedSnapshotBlobs.length).toBe(1); // one upload, not one-per-chunk
    const manifest = state.sentSnapshotManifests[0];
    expect(manifest.projectId).toBe('imported-for-snapshot');
    expect(manifest.mxc).toBe(state.uploadedSnapshotBlobs[0].mxc);
    expect(manifest.encryption).toBeTruthy();
    expect(manifest.encryption.key).toBeTruthy(); // real key material, not squashed/plaintext
  });

  // Live-reported (Tom, tracker f6b39bf0 follow-up): the snapshot rework
  // only ever covered a BRAND NEW project's one-time bulk adopt
  // (adoptOneLocalProject -> pushSnapshotForProject); a large paste-merge
  // import into a project that's already bridged went through the
  // ordinary per-edit path (pushNewLocalEntries) instead, which had no
  // size check at all -- reintroducing exactly the hundreds-of-individual-
  // sends problem the snapshot mechanism exists to solve, just for a
  // different trigger than the one originally tested above.
  test('a large paste-merge import into a project that is ALREADY bridged sends a single snapshot, not hundreds of individual entries', async ({ page }) => {
    const state = h.mockMatrixClientApi(page, {
      homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room',
      initialEntries: [entryEvent({ issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'Room issue', sortKey: 1, origin: 'authored' } })]
    });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.locator('#frame')).toBeVisible();
    await page.waitForTimeout(300);

    const existingProjectId = await page.evaluate(() =>
      JSON.parse(window.__wigwagHostStorage.getItem('git_native_tracker_milestones_v1')).milestones[0].id);

    const issueLines = [];
    for (let i = 1; i <= 250; i++) {
      issueLines.push(JSON.stringify({ type: 'issue', id: 'bi' + i, num: i + 1, fieldRefs: {}, values: { title: 'Bulk issue ' + i }, comments: [], history: [] }));
    }
    const pastedJsonl = [
      JSON.stringify({ type: 'fields', fields: { title: { label: 'Issue', type: 'text' } }, id: existingProjectId, name: 'Room issue project' }),
      ...issueLines
    ].join('\n');
    const frame = page.frameLocator('#frame');
    await frame.locator('[data-testid=btn-import-merge]').first().click();
    await page.waitForTimeout(150);
    const [fc] = await Promise.all([
      page.waitForEvent('filechooser'),
      frame.locator('[data-testid=btn-paste-merge-open-file]').click(),
    ]);
    await fc.setFiles({ name: 'bulk-merge.jsonl', mimeType: 'application/octet-stream', buffer: Buffer.from(pastedJsonl) });
    // Pasting content whose declared project id matches one that ALREADY
    // exists locally goes through the diff3 "Merge review" flow (distinct
    // from the "confirm-dialog-modal" a genuinely new project's import
    // shows), which is exactly the scenario this test needs -- merging
    // INTO an already-bridged project, not creating a new one.
    await expect(frame.locator('[data-testid=merge-card]')).toBeVisible();
    await frame.locator('[data-testid=btn-merge-primary]').click();
    await page.waitForTimeout(700);

    expect(state.sentSnapshotManifests.length).toBe(1);
    expect(state.uploadedSnapshotBlobs.length).toBe(1);
    expect(state.sentEntries.length).toBeLessThan(10); // definitely not one per new issue
    const manifest = state.sentSnapshotManifests[0];
    expect(manifest.projectId).toBe(existingProjectId);
  });

  // Tracker f6b39bf0's cadence-floor follow-up: a quiet project that never
  // crosses SNAPSHOT_STALENESS_ENTRY_THRESHOLD (200) would otherwise never get
  // snapshotted at all, accumulating an ever-larger tail over time.
  // Faking real wall-clock elapse across the real 24h floor isn't
  // practical here (Playwright's clock API virtualizes this file's own 5s
  // poll interval too once installed, so bridging a 24h gap would mean
  // firing it thousands of times) -- shrinks the floor itself instead, via
  // the same test-only override every other test-introspection hook in
  // this file already uses (window.__wigwagHostStorage etc).
  test('a quiet project well under the entry-count threshold still gets snapshotted once the age floor is crossed', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'timer-dependent, one browser is enough to prove the mechanism');
    await page.addInitScript(() => { window.__wigwagSnapshotMaxAgeMsOverride = 100; });
    const state = h.mockMatrixClientApi(page, {
      homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room',
      initialEntries: [entryEvent({ issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'Quiet issue', sortKey: 1, origin: 'authored' } })] // one entry, nowhere near the 200-entry threshold, no pre-existing snapshot
    });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.locator('#frame')).toBeVisible();

    // First real poll tick (~5s after connect): lazily seeds this
    // project's "last snapshotted at" clock to roughly now (never having
    // been snapshotted before) and checks it in the very same pass, well
    // under even the shrunk 100ms floor -- must NOT itself trigger a
    // snapshot yet.
    await page.waitForTimeout(5500);
    expect(state.sentSnapshotManifests.length).toBe(0);

    // Second real poll tick (~5s later still): now several real seconds
    // have elapsed since that seed, comfortably past the shrunk floor.
    await page.waitForTimeout(5500);
    expect(state.sentSnapshotManifests.length).toBe(1);
    expect(state.sentSnapshotManifests[0].cutoffSortKey).toBe(1);
  });

  // Live design discussion (Tom, 2026-09-29): SNAPSHOT_ENTRY_THRESHOLD
  // (200) used to gate BOTH a single pending batch about to fire as
  // individual send_event calls AND the slow-accumulating count since the
  // last snapshot -- two different concerns (write-burst safety vs.
  // bounding a fresh client's replay-page count) that happened to share
  // one number. Split into SNAPSHOT_BURST_ENTRY_THRESHOLD (10, sized to a
  // Matrix homeserver's typical default rate-limit burst allowance) and
  // SNAPSHOT_STALENESS_ENTRY_THRESHOLD (kept at 200). This covers the
  // burst path specifically: an ordinary bulk field-set on an
  // ALREADY-bridged project (not an import/bulk-adopt, which always
  // snapshots regardless of size) with a batch comfortably between the
  // new burst threshold and the old 200 -- exactly the range that used to
  // fire individual sends and would have collided with a real
  // homeserver's rate limiter.
  test('an ordinary bulk field-set past the burst threshold (but nowhere near 200) still collapses to one snapshot', async ({ page }) => {
    const initialEntries = [];
    for (let i = 1; i <= 15; i++) {
      initialEntries.push(entryEvent({ issueId: 'bi' + i, entry: { id: 'h' + i, field: 'title', value: 'Bulk issue ' + i, sortKey: i, origin: 'authored' } }));
    }
    const state = h.mockMatrixClientApi(page, { homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room', initialEntries });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    const frame = page.frameLocator('#frame');
    await expect(frame.locator('[data-testid=row]')).toHaveCount(15);

    await frame.locator('[data-testid=header-select-checkbox]').click();
    await frame.locator('[data-testid=widget-bulk-action-bar] [data-testid=bulk-set-field-btn]').click();
    await frame.locator('[data-testid=bulk-field-row][data-col=type]').click({ timeout: 5000 });
    await frame.locator('[data-testid=bulk-value-option]').first().click({ timeout: 5000 });
    await page.waitForTimeout(700);

    expect(state.sentSnapshotManifests.length).toBe(1);
    expect(state.sentEntries.length).toBeLessThan(15); // not one send_event per issue
  });

  // Live-reported (Tom, 2026-09-28): a mass bulk-edit produced two
  // DIFFERENT work.wigwag.snapshot manifests (distinct snapshotId/mxc/
  // encryption key, same cutoffSortKey, ~1.6s apart) -- a genuine, damaging
  // duplicate, not the deliberately-idempotent "two viewers independently
  // cross the threshold around the same time" case this file's own
  // comments already accept as harmless. Root cause: pushSnapshotForProject
  // had no reentrancy guard of its own (unlike pushNewLocalEntries's
  // pushInFlight/pushAgainRequested) -- THREE independent call sites
  // (pushNewLocalEntries's own threshold branch, pushSnapshotIfDue's
  // periodic floor check, and adoptOneLocalProject's initial bulk push)
  // could each decide "this project needs a snapshot now" and start a
  // fully separate upload before any of them updated
  // lastSnapshotEntryCount/lastSnapshotAt. Verified via a test-only hook
  // (window.__wigwagTestForcePushSnapshot) rather than trying to time-align
  // a real concurrent overlap via wall-clock delays -- deterministic, and
  // exercises the exact race (two calls for the same project, neither
  // awaited before the other starts) directly.
  test('two concurrent calls to push a snapshot for the same project never produce two uploads', async ({ page }) => {
    const state = h.mockMatrixClientApi(page, {
      homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room',
      initialEntries: [entryEvent({ issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'Room issue', sortKey: 1, origin: 'authored' } })]
    });
    await page.route('**/_matrix/media/v3/upload*', async (route) => {
      await new Promise(r => setTimeout(r, 500)); // wide enough that both calls are definitely still racing when the second one checks the lock
      await route.fallback();
    });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.locator('#frame')).toBeVisible();
    await page.waitForTimeout(300);

    const projectId = await page.evaluate(() =>
      JSON.parse(window.__wigwagHostStorage.getItem('git_native_tracker_milestones_v1')).milestones[0].id);

    await page.evaluate((pid) => {
      window.__wigwagRaceCall1 = window.__wigwagTestForcePushSnapshot(pid);
      window.__wigwagRaceCall2 = window.__wigwagTestForcePushSnapshot(pid);
    }, projectId);
    await page.evaluate(() => Promise.all([window.__wigwagRaceCall1, window.__wigwagRaceCall2]));
    await page.waitForTimeout(300);

    expect(state.sentSnapshotManifests.length).toBe(1);
    expect(state.uploadedSnapshotBlobs.length).toBe(1);
  });

  test('a homeserver rejecting the upload (e.g. rate-limited) is retried, same shared retry mechanics as any other Matrix write', async ({ page }) => {
    const state = h.mockMatrixClientApi(page, {
      homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room',
      initialEntries: [entryEvent({ issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'Room issue', sortKey: 1, origin: 'authored' } })],
      rejectUploadTimes: 2
    });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.locator('#frame')).toBeVisible();

    // Tracker #149, live-reported: this exact scenario (a large import
    // hitting real homeserver rate limiting) used to drop the project's
    // own __project_name__ entry silently -- whichever request happened to
    // carry it lost the race under the OLD per-entry/per-chunk send model.
    // A single retried upload has no such race: either the whole blob
    // (every entry, atomically) lands, or it doesn't.
    const pastedJsonl = [
      JSON.stringify({
        type: 'fields', fields: { title: { label: 'Issue', type: 'text' } }, id: 'retry-project', name: 'Retry Project',
        projectHistory: [{ id: 'rp1', field: '__project_name__', value: 'Retry Project', sortKey: 1, origin: 'authored', time: '', actor: 'Someone', email: '' }]
      }),
      JSON.stringify({ type: 'issue', id: 'ii1', num: 1, fieldRefs: {}, values: { title: 'An issue' }, comments: [], history: [] })
    ].join('\n');
    const frame = page.frameLocator('#frame');
    await frame.locator('[data-testid=btn-import-merge]').first().click();
    await page.waitForTimeout(150);
    const [fc] = await Promise.all([
      page.waitForEvent('filechooser'),
      frame.locator('[data-testid=btn-paste-merge-open-file]').click(),
    ]);
    await fc.setFiles({ name: 'retry-test.jsonl', mimeType: 'application/octet-stream', buffer: Buffer.from(pastedJsonl) });
    await expect(frame.locator('[data-testid=confirm-dialog-modal]')).toBeVisible();
    await frame.locator('[data-testid=btn-confirm-dialog-confirm]').click();
    await page.waitForTimeout(1000);

    // Still exactly one snapshot manifest/upload once retries succeed --
    // the earlier rejected attempts never produced a real upload.
    expect(state.uploadedSnapshotBlobs.length).toBe(1);
    expect(state.sentSnapshotManifests.length).toBe(1);
    const manifest = state.sentSnapshotManifests[0];
    expect(manifest.projectId).toBe('retry-project');
    const items = await decryptedSnapshotItems(state, manifest);
    const namePush = items.find(i => i.entry.field === '__project_name__');
    expect(namePush, 'the project-name entry must survive rate limiting, not silently vanish').toBeTruthy();
    expect(namePush.entry.value).toBe('Retry Project');
  });

  test('full round trip: a bulk-adopted project\'s auto-written snapshot is what a genuinely separate reconnecting session actually reads back', async ({ page }) => {
    h.mockMatrixClientApi(page, {
      homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room',
      initialEntries: [entryEvent({ issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'Room issue', sortKey: 1, origin: 'authored' } })]
    });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.locator('#frame')).toBeVisible();

    // A real, SIGNED field:__project_name__ history entry, not just the
    // local-only PROJECTS_KEY.milestones[].name metadata a bare `name:`
    // header produces -- a genuinely fresh reconnect only ever knows a
    // project by its shared, signed history, exactly like discoverProjects
    // already documents (a project with no real name entry falls back to
    // a generic "Project <short-id>" label -- correct, pre-existing
    // behavior, not something this test should be tripped up by).
    const pastedJsonl = [
      JSON.stringify({
        type: 'fields', fields: { title: { label: 'Issue', type: 'text' } }, id: 'roundtrip-project', name: 'Roundtrip Project',
        projectHistory: [{ id: 'rtph1', field: '__project_name__', value: 'Roundtrip Project', sortKey: 1, origin: 'authored', time: '', actor: 'Someone', email: '' }]
      }),
      JSON.stringify({ type: 'issue', id: 'ii1', num: 1, fieldRefs: {}, values: { title: 'Roundtrip issue' }, comments: [], history: [] })
    ].join('\n');
    const frame = page.frameLocator('#frame');
    await frame.locator('[data-testid=btn-import-merge]').first().click();
    await page.waitForTimeout(150);
    const [fc] = await Promise.all([
      page.waitForEvent('filechooser'),
      frame.locator('[data-testid=btn-paste-merge-open-file]').click(),
    ]);
    await fc.setFiles({ name: 'roundtrip.jsonl', mimeType: 'application/octet-stream', buffer: Buffer.from(pastedJsonl) });
    await expect(frame.locator('[data-testid=confirm-dialog-modal]')).toBeVisible();
    await frame.locator('[data-testid=btn-confirm-dialog-confirm]').click();
    await page.waitForTimeout(500); // let the auto-snapshot push land

    // A genuinely fresh reconnect -- new mock state object, but the SAME
    // pendingEntries-fed room (mockMatrixClientApi's own route handlers
    // from above are still installed on `page` and keep serving what was
    // already sent). Re-registering avoids double-routing surprises.
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.locator('#frame')).toBeVisible();

    const frame2 = page.frameLocator('#frame');
    await frame2.locator('[data-testid=btn-switcher]').first().click();
    await expect(frame2.locator('[data-testid=switcher-project-row]').filter({ hasText: 'Roundtrip Project' })).toHaveCount(1);
    await frame2.locator('[data-testid=switcher-project-row]').filter({ hasText: 'Roundtrip Project' }).click();
    await expect(frame2.locator('[data-testid=row]')).toHaveCount(1);
    await expect(frame2.locator('[data-testid=row]')).toContainText('Roundtrip issue');
  });
});

// Tracker #149, live-reported: a deleted issue used to come back after
// reconnecting, because deletion was a hard, unlogged removal and the
// bridge replays the room's full timeline on every reconnect. Fixed by
// making deletion a real tombstone (field: '__deleted__') in the issue's
// own history -- it travels through the wire format like any other field
// entry, so this needs no special-case code in this file at all.
//
// mockMatrixClientApi only returns initialEntries on the very FIRST
// /messages call (by design, for testing live-poll deltas within one
// session) -- a real homeserver has no such memory: a genuine reconnect
// re-fetches the room's full backwards-paginated history again, every
// time. This local mock matches that real behavior, since it's exactly
// what a "close and reopen the widget in Element" reconnect exercises.
function mockRealHomeserverReconnect(page, { entries, roomName }) {
  const base = HOMESERVER;
  const roomPath = base + '/_matrix/client/v3/rooms/' + encodeURIComponent(ROOM_ID);
  page.route(roomPath + '/messages*', async (route) => {
    const isProbe = new URL(route.request().url()).searchParams.get('limit') === '0';
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ chunk: isProbe ? [] : entries, end: 'cursor' }) });
  });
  page.route(roomPath + '/state/m.room.name', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: roomName }) });
  });
  page.route(roomPath + '/send/work.wigwag.entry/*', async (route) => {
    const content = JSON.parse(route.request().postData());
    entries.push({ type: 'work.wigwag.entry', content });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ event_id: '$evt' + entries.length }) });
  });
  page.route(base + '/_matrix/client/v3/account/whoami', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user_id: '@test-user:example.org' }) });
  });
}

test.describe('wigwag-matrix-host.html: a deleted issue survives a real reconnect', () => {
  test('deleting an issue, then fully reconnecting, does not resurrect it', async ({ page }) => {
    const entries = [entryEvent({ issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'Delete me and stay deleted', sortKey: 1, origin: 'authored' } })];
    mockRealHomeserverReconnect(page, { entries, roomName: 'Bridge Room' });

    const connect = async () => {
      await page.locator('#homeserverUrl').fill(HOMESERVER);
      await page.locator('#accessToken').fill('tok123');
      await page.locator('#roomId').fill(ROOM_ID);
      await page.locator('#connectBtn').click();
      await expect(page.locator('#frame')).toBeVisible();
      await page.waitForTimeout(300);
    };

    await page.goto('/bridges/wigwag-matrix-host.html');
    await connect();

    const frame = page.frameLocator('#frame');
    await frame.locator('[data-testid=row]').first().locator('[data-testid=title-cell] span').first().click();
    await page.waitForTimeout(150);
    await frame.locator('[data-testid=slideover-delete-btn]').click();
    await page.waitForTimeout(150);
    await frame.locator('[data-testid=btn-confirm-dialog-confirm]').click();
    await page.waitForTimeout(500); // let the tombstone push out to the room
    await expect(frame.locator('[data-testid=row]')).toHaveCount(0);

    // Full reconnect -- mirrors closing and reopening the widget in Element.
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await connect();

    const frame2 = page.frameLocator('#frame');
    await expect(frame2.locator('[data-testid=row]')).toHaveCount(0);
  });
});

// Tracker #149, live-reported: widget mode has no local-only/private
// project concept -- the room IS the container (unlike Tauri/browser
// mode, where identity is the container and "Shared with you" is a real
// holding state). Importing a project inside the widget used to land it
// in that limbo (identityId: null) with no way back to the room's own
// scope, and never pushed it to the room at all. Now any project that
// shows up in this browser's local project list while connected is
// adopted: its identityId is normalized onto the room's own bootstrapped
// identity, and its full history is bulk-pushed tagged with its own id.
test.describe('wigwag-matrix-host.html: a locally-imported project is adopted into the room', () => {
  test('an imported project (identityId: null, simulating wigwag.html\'s own import flow) gets its identity corrected and its history pushed to the room', async ({ page }) => {
    const state = h.mockMatrixClientApi(page, {
      homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room',
      initialEntries: [entryEvent({ issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'Room issue', sortKey: 1, origin: 'authored' } })]
    });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.locator('#frame')).toBeVisible();
    await page.waitForTimeout(300);

    // Drives wigwag.html's REAL import flow (same file-based "genuinely
    // new project" path as tests/milestones.spec.js), rather than poking
    // storage directly -- a direct localStorage.setItem() from outside
    // the app's own script can no longer simulate this at all (that would
    // hit real browser storage, which the app's own script never reads
    // content from in Room Mode; page.evaluate()'s injected code can't
    // see the shadowed `localStorage` createRoomModeStorageShim installs,
    // by design). Going through the real UI also means the identityId:
    // null this test cares about is genuinely what the app produces, not
    // an assumption baked into the test.
    const importedId = 'imported-proj-1';
    const pastedJsonl = [
      JSON.stringify({ type: 'fields', fields: { title: { label: 'Issue', type: 'text' } }, id: importedId, name: 'Imported project' }),
      JSON.stringify({ type: 'issue', id: 'ii1', num: 1, fieldRefs: {}, values: { title: 'Imported issue' }, comments: [], history: [] })
    ].join('\n');
    const frame = page.frameLocator('#frame');
    await frame.locator('[data-testid=btn-import-merge]').first().click();
    await page.waitForTimeout(150);
    const [fc] = await Promise.all([
      page.waitForEvent('filechooser'),
      frame.locator('[data-testid=btn-paste-merge-open-file]').click(),
    ]);
    await fc.setFiles({ name: 'imported.jsonl', mimeType: 'application/octet-stream', buffer: Buffer.from(pastedJsonl) });
    await expect(frame.locator('[data-testid=confirm-dialog-modal]')).toBeVisible();
    await frame.locator('[data-testid=btn-confirm-dialog-confirm]').click();
    await page.waitForTimeout(500); // let adoptLocalProjects react to the wigwag:local-write and push

    // identityId corrected -- no more "Shared with you" limbo.
    const projectsAfter = await page.evaluate(() => JSON.parse(window.__wigwagHostStorage.getItem('git_native_tracker_milestones_v1')));
    const importedMeta = projectsAfter.milestones.find(m => m.id === importedId);
    expect(importedMeta.identityId).toBeTruthy();

    // Its history was pushed to the room as a snapshot, tagged with its
    // own id -- a bulk-adopt sends a snapshot ONLY now, not a separate
    // batch send too (tracker f6b39bf0, live-reported: sending both used
    // to double the request volume for exactly this scenario).
    const manifest = state.sentSnapshotManifests.find(m => m.projectId === importedId);
    expect(manifest).toBeTruthy();
    const pushedForImported = await decryptedSnapshotItems(state, manifest);
    expect(pushedForImported.length).toBeGreaterThan(0);
    // scope: 'issue' distinguishes the issue's own title VALUE entry from
    // a project-scope field-definition backfill entry that happens to
    // share the same field name ('title' is both a fieldDefs key and an
    // issue field) -- a snapshot includes every current entry, unfiltered,
    // so both are present here (unlike the old knownEntryIds-filtered
    // batch push, which never disambiguated this either but rarely
    // surfaced it).
    const titlePush = pushedForImported.find(c => c.scope === 'issue' && c.entry.field === 'title');
    expect(titlePush.entry.value).toBe('Imported issue');
  });

  test('a second session connecting afterward discovers both the room\'s own project and the imported one', async ({ page }) => {
    const entries = [entryEvent({ issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'Room issue', sortKey: 1, origin: 'authored' } })];
    const base = HOMESERVER;
    const roomPath = base + '/_matrix/client/v3/rooms/' + encodeURIComponent(ROOM_ID);
    await page.route(roomPath + '/messages*', async (route) => {
      const isProbe = new URL(route.request().url()).searchParams.get('limit') === '0';
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ chunk: isProbe ? [] : entries, end: 'cursor' }) });
    });
    await page.route(roomPath + '/state/m.room.name', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'Bridge Room' }) });
    });
    await page.route(roomPath + '/send/work.wigwag.entry/*', async (route) => {
      const content = JSON.parse(route.request().postData());
      entries.push({ type: 'work.wigwag.entry', content });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ event_id: '$evt' + entries.length }) });
    });
    // Bulk-adoption sends a snapshot -- without mocking this too, the
    // import's push silently fails (no route -> a network error), so the
    // imported project never actually reaches "the room" and the
    // reconnect below only ever finds the room's original project.
    await page.route(roomPath + '/send/work.wigwag.snapshot/*', async (route) => {
      const content = JSON.parse(route.request().postData());
      entries.push({ type: 'work.wigwag.snapshot', content });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ event_id: '$evt' + entries.length }) });
    });
    await page.route(roomPath + '/send/work.wigwag.snapshot.chunk/*', async (route) => {
      const content = JSON.parse(route.request().postData());
      entries.push({ type: 'work.wigwag.snapshot.chunk', content });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ event_id: '$evt' + entries.length }) });
    });
    // Project index (tracker f6b39bf0): bulk-adopting the imported project
    // must first create its moderator-gated state event -- without mocking
    // this too, adoptOneLocalProject's createProject call fails (no route)
    // and the import is rejected/rolled back before anything else about it
    // is ever pushed, so the reconnect below would only ever find the
    // room's original project.
    const projectStateEventsByKey = new Map();
    await page.route(roomPath + '/state/work.wigwag.project/*', async (route) => {
      const url = new URL(route.request().url());
      const projectId = decodeURIComponent(url.pathname.split('/').pop());
      const content = JSON.parse(route.request().postData());
      projectStateEventsByKey.set(projectId, content);
      entries.push({ type: 'work.wigwag.project', state_key: projectId, content });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ event_id: '$projstate' + projectStateEventsByKey.size }) });
    });
    await page.route(roomPath + '/state', async (route) => {
      const events = [...projectStateEventsByKey.entries()].map(([projectId, content]) => ({ type: 'work.wigwag.project', state_key: projectId, content }));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(events) });
    });
    await page.route(base + '/_matrix/client/v3/account/whoami', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user_id: '@test-user:example.org' }) });
    });

    const connect = async () => {
      await page.locator('#homeserverUrl').fill(HOMESERVER);
      await page.locator('#accessToken').fill('tok123');
      await page.locator('#roomId').fill(ROOM_ID);
      await page.locator('#connectBtn').click();
      await page.waitForTimeout(400);
    };

    await page.goto('/bridges/wigwag-matrix-host.html');
    await connect();

    // Real import UI (same pattern as the previous describe block) --
    // direct storage manipulation from outside the app's own script can no
    // longer simulate this (see that test's own comment for why).
    const secondProjectId = 'imported-proj-2';
    const pastedJsonl = [
      JSON.stringify({ type: 'fields', fields: { title: { label: 'Issue', type: 'text' } }, id: secondProjectId, name: 'Second project' }),
      JSON.stringify({ type: 'issue', id: 'ii2', num: 1, fieldRefs: {}, values: { title: 'Second project issue' }, comments: [], history: [] })
    ].join('\n');
    const firstFrame = page.frameLocator('#frame');
    await firstFrame.locator('[data-testid=btn-import-merge]').first().click();
    await page.waitForTimeout(150);
    const [fc] = await Promise.all([
      page.waitForEvent('filechooser'),
      firstFrame.locator('[data-testid=btn-paste-merge-open-file]').click(),
    ]);
    await fc.setFiles({ name: 'second.jsonl', mimeType: 'application/octet-stream', buffer: Buffer.from(pastedJsonl) });
    await expect(firstFrame.locator('[data-testid=confirm-dialog-modal]')).toBeVisible();
    await firstFrame.locator('[data-testid=btn-confirm-dialog-confirm]').click();
    await page.waitForTimeout(500);

    // Fresh reconnect, same room, in the same browser context -- pulls
    // the full (now two-project) history back from the "room" and must
    // bootstrap both immediately (no picker prompt), both switchable.
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await connect();

    const frame = page.frameLocator('#frame');
    await frame.locator('[data-testid=btn-switcher]').first().click();
    await expect(frame.locator('[data-testid=switcher-project-row]')).toHaveCount(2);
  });
});


// Tracker #149, live-reported: PROJECTS_KEY used to be a single, shared-
// origin localStorage key -- every room this browser ever connected to as
// a widget read and wrote the SAME one, so opening the widget in a
// second, unrelated room found the first room's adopted project still
// sitting there and wrongly re-adopted it, leaking room A's content into
// room B. Originally fixed via a persistent projectId -> roomId registry
// (MATRIX_BRIDGED_ROOMS_KEY); superseded (tracker f6b39bf0/#153) by a
// stronger fix that removes the shared bucket entirely -- each room's
// bridge instance now holds its own private in-memory shim (this file's
// own `localStorage` above), so there is structurally nothing left for a
// second room to collide with, regardless of any registry.
// Live-reported (Tom): cosmetic/metadata prefs (column order, sort, etc.)
// are real, durable, per-browser localStorage keyed by projectId ALONE --
// correct for Local Mode (one browser, many unrelated projects) but
// surprising in Room Scoped Widget Mode, where a project id can
// legitimately repeat across two different rooms (more so now that
// Receive-a-project reuses an original id when there's no local
// collision): opening "the same" project id in a different room
// shouldn't inherit the first room's sort/column prefs. Fixed by
// composing roomId into the storage key (storagePrefKey) whenever
// ROOM_MODE_ROOM_ID is set.
test.describe('wigwag-matrix-host.html: cosmetic prefs are scoped per room, not just per project', () => {
  test('a sort preference set for a project id in one room does not apply to the same project id opened in a different room', async ({ page }) => {
    const ROOM_A = '!roomA:example.org';
    const ROOM_B = '!roomB:example.org';
    const SHARED_PROJECT_ID = 'shared-proj-id';
    // A real project always defines a field before using it (starterFieldHistory,
    // same as createBlankProject) -- a bare value entry with no matching
    // definition entry only ever worked before by accident, riding a
    // fallback (core.defaultFieldDefs()) that's since been correctly
    // scoped to the room's own legacy/untagged-entries default project
    // only (tracker f6b39bf0).
    const priorityFieldDef = {
      type: 'work.wigwag.entry',
      content: { v: 1, scope: 'project', projectId: SHARED_PROJECT_ID, entry: { id: 'pdef1', field: 'priority', value: { label: 'Priority', type: 'select', options: [{ id: 'low', label: 'Low', color: 'green', emoji: '' }, { id: 'high', label: 'High', color: 'red', emoji: '' }] }, sortKey: 0, origin: 'authored' } }
    };
    h.mockMatrixClientApi(page, {
      homeserverUrl: HOMESERVER, roomId: ROOM_A, roomName: 'Room A',
      initialEntries: [
        priorityFieldDef,
        entryEvent({ issueId: 'a1', entry: { id: 'ha1', field: 'title', value: 'Room A issue', sortKey: 1, origin: 'authored' }, projectId: SHARED_PROJECT_ID }),
        entryEvent({ issueId: 'a1', entry: { id: 'ha1b', field: 'priority', value: 'low', sortKey: 2, origin: 'authored' }, projectId: SHARED_PROJECT_ID })
      ]
    });
    h.mockMatrixClientApi(page, {
      homeserverUrl: HOMESERVER, roomId: ROOM_B, roomName: 'Room B',
      initialEntries: [
        priorityFieldDef,
        entryEvent({ issueId: 'b1', entry: { id: 'hb1', field: 'title', value: 'Room B issue', sortKey: 1, origin: 'authored' }, projectId: SHARED_PROJECT_ID }),
        entryEvent({ issueId: 'b1', entry: { id: 'hb1b', field: 'priority', value: 'high', sortKey: 2, origin: 'authored' }, projectId: SHARED_PROJECT_ID })
      ]
    });

    const connectTo = async (roomId) => {
      await page.locator('#homeserverUrl').fill(HOMESERVER);
      await page.locator('#accessToken').fill('tok123');
      await page.locator('#roomId').fill(roomId);
      await page.locator('#connectBtn').click();
      await expect(page.locator('#frame')).toBeVisible();
      await page.waitForTimeout(300);
    };

    await page.goto('/bridges/wigwag-matrix-host.html');
    await connectTo(ROOM_A);
    const frameA = page.frameLocator('#frame');
    // The header's own "Sort" icon only ever appears once a column IS the
    // active sort (an indicator, not a toggle) -- the "..." menu's "Sort
    // ascending" is the real trigger, same as h.sortByColumn's own Local
    // Mode pattern. The header markup is duplicate-rendered (desktop +
    // an offscreen/mobile variant), so .last() picks the real visible one.
    await frameA.locator('[data-testid=col-header][data-col=priority]').last().locator('span', { hasText: '⋯' }).click();
    await page.waitForTimeout(150);
    await frameA.getByText('Sort ascending', { exact: true }).click();
    await page.waitForTimeout(300);
    // The header's own Sort-indicator span only renders while THIS column
    // is the active sort (seg.col.isSorted) -- its presence, not any text
    // content (sortArrow is computed but never actually rendered), is the
    // real signal here.
    await expect(frameA.locator('[data-testid=col-header][data-col=priority]').last().locator('span[title=Sort]')).toBeVisible();

    // Real, unshimmed browser localStorage (this project-keyed cosmetic
    // store was never room-mode content in the first place) -- same
    // origin as the iframe, so directly readable from here.
    const sortStoreAfterA = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_sort_v1') || '{}'));
    expect(sortStoreAfterA[SHARED_PROJECT_ID]).toBeUndefined(); // never the bare, room-unaware key
    expect(sortStoreAfterA[ROOM_A + ':' + SHARED_PROJECT_ID]).toEqual({ colId: 'priority', dir: 'asc' });

    // Now open the SAME project id in a completely different room.
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await connectTo(ROOM_B);
    const frameB = page.frameLocator('#frame');

    // Room B's own view of this project id must show no sort applied --
    // room A's preference must not have bled across.
    await expect(frameB.locator('[data-testid=col-header][data-col=priority]').last().locator('span[title=Sort]')).toHaveCount(0);

    const sortStoreAfterB = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_sort_v1') || '{}'));
    // Room A's own entry survives untouched (durable, per-room). Room B
    // gets its own separate, default-state entry under its own compound
    // key (componentDidUpdate persists whatever the current sort is,
    // unconditionally, on every update) -- the point is it's the DEFAULT,
    // never room A's 'priority'/'asc'.
    expect(sortStoreAfterB[ROOM_A + ':' + SHARED_PROJECT_ID]).toEqual({ colId: 'priority', dir: 'asc' });
    expect(sortStoreAfterB[ROOM_B + ':' + SHARED_PROJECT_ID]).toEqual({ colId: null, dir: 'asc' });
  });
});

test.describe('wigwag-matrix-host.html: a project adopted in one room never leaks into a different room', () => {
  test('room B never sees room A\'s locally-adopted project -- structurally impossible now that each room\'s bridge has its own private in-memory storage', async ({ page }) => {
    const ROOM_A = '!roomA:example.org';
    const ROOM_B = '!roomB:example.org';
    const stateA = h.mockMatrixClientApi(page, {
      homeserverUrl: HOMESERVER, roomId: ROOM_A, roomName: 'Room A',
      initialEntries: [entryEvent({ issueId: 'a1', entry: { id: 'ha1', field: 'title', value: 'Room A issue', sortKey: 1, origin: 'authored' } })]
    });
    const stateB = h.mockMatrixClientApi(page, {
      homeserverUrl: HOMESERVER, roomId: ROOM_B, roomName: 'Room B',
      initialEntries: [entryEvent({ issueId: 'b1', entry: { id: 'hb1', field: 'title', value: 'Room B issue', sortKey: 1, origin: 'authored' } })]
    });

    const connectTo = async (roomId) => {
      await page.locator('#homeserverUrl').fill(HOMESERVER);
      await page.locator('#accessToken').fill('tok123');
      await page.locator('#roomId').fill(roomId);
      await page.locator('#connectBtn').click();
      await expect(page.locator('#frame')).toBeVisible();
      await page.waitForTimeout(300);
    };

    // Connect to room A, then locally import a project via the REAL
    // import UI (identityId: null, the same shape wigwag.html's own
    // import flow produces) -- room A adopts it. A direct
    // localStorage.setItem() from outside the app's own script can no
    // longer simulate this (see the earlier "locally-imported project"
    // describe block's own comment for why).
    await page.goto('/bridges/wigwag-matrix-host.html');
    await connectTo(ROOM_A);
    const importedId = 'room-a-imported-proj';
    const pastedJsonl = [
      JSON.stringify({ type: 'fields', fields: { title: { label: 'Issue', type: 'text' } }, id: importedId, name: 'Room A Import' }),
      JSON.stringify({ type: 'issue', id: 'iax', num: 1, fieldRefs: {}, values: { title: 'Room A\'s own imported issue' }, comments: [], history: [] })
    ].join('\n');
    const frameA = page.frameLocator('#frame');
    await frameA.locator('[data-testid=btn-import-merge]').first().click();
    await page.waitForTimeout(150);
    const [fcA] = await Promise.all([
      page.waitForEvent('filechooser'),
      frameA.locator('[data-testid=btn-paste-merge-open-file]').click(),
    ]);
    await fcA.setFiles({ name: 'room-a.jsonl', mimeType: 'application/octet-stream', buffer: Buffer.from(pastedJsonl) });
    await expect(frameA.locator('[data-testid=confirm-dialog-modal]')).toBeVisible();
    await frameA.locator('[data-testid=btn-confirm-dialog-confirm]').click();
    await page.waitForTimeout(800); // let room A's adoption push land

    // Room A's own adoption now pushes a snapshot (tracker f6b39bf0's
    // double-send fix), not plain batch entries.
    const manifestA = stateA.sentSnapshotManifests.find(m => m.projectId === importedId);
    expect(manifestA).toBeTruthy(); // sanity: room A really did adopt it
    // The real media repo is homeserver-wide, not room-scoped (no room id
    // in its URL at all) -- both mocked "rooms" here share the same
    // homeserver and so the same underlying upload/download routes;
    // whichever blob landed could be recorded on either mock's own state
    // object depending on Playwright's route-registration order, so check
    // both rather than assuming stateA's own list has it.
    const pushedToRoomA = await decryptedSnapshotItems({ uploadedSnapshotBlobs: [...stateA.uploadedSnapshotBlobs, ...stateB.uploadedSnapshotBlobs] }, manifestA);
    expect(pushedToRoomA.length).toBeGreaterThan(0);

    // Now connect to a COMPLETELY DIFFERENT room, in the SAME browser.
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await connectTo(ROOM_B);
    await page.waitForTimeout(800); // give a wrongly-firing adoption a chance to happen

    // Room B must never have received room A's imported project.
    const manifestB = stateB.sentSnapshotManifests.find(m => m.projectId === importedId);
    expect(manifestB).toBeFalsy();

    // Room B's own switcher must not list it either.
    const frameB = page.frameLocator('#frame');
    await frameB.locator('[data-testid=btn-switcher]').first().click();
    const rows = frameB.locator('[data-testid=switcher-project-row]');
    const rowTexts = await rows.allInnerTexts();
    expect(rowTexts.some(t => t.includes('Room A Import'))).toBe(false);
  });
});

// Tracker #169/4f07e72b, design handoff table_layout.zip: a moderator
// captures the current column set/order/widths/freeze point and proposes
// it to the room as a real Matrix STATE event (work.wigwag.layout-
// proposal) -- moderator-gating rides Matrix's own power-level check
// (isModeratorForStateEvent in wigwag-core.js), and state_key is the
// PROJECT id (never a single fixed room-wide key), since a room can hold
// more than one wigwag project (tracker #149) and proposals must never
// cross-contaminate between them. Applying an accepted proposal is purely
// a local cosmetic-pref change -- never a new signed history entry,
// never exported/merged.
test.describe('wigwag-matrix-host.html: moderator-proposed table layouts', () => {
  const PROJ = 'layout-proj';

  function fieldDefEntry(field, value, sortKey) {
    return { type: 'work.wigwag.entry', content: { v: 1, scope: 'project', projectId: PROJ, entry: { id: 'def-' + field, field, value, sortKey, origin: 'authored' } } };
  }
  function seedProjectEntries() {
    return [
      fieldDefEntry('priority', { label: 'Priority', type: 'select', options: [{ id: 'low', label: 'Low', color: 'green', emoji: '' }, { id: 'high', label: 'High', color: 'red', emoji: '' }] }, 0),
      fieldDefEntry('status', { label: 'Status', type: 'select', options: [{ id: 'open', label: 'Open', color: 'blue', emoji: '' }] }, 1),
      entryEvent({ issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'Issue one', sortKey: 2, origin: 'authored' }, projectId: PROJ })
    ];
  }
  async function connect(page, opts = {}) {
    const state = h.mockMatrixClientApi(page, { homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room', initialEntries: seedProjectEntries(), ...opts });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.locator('#frame')).toBeVisible();
    await page.waitForTimeout(300);
    return state;
  }

  test('the propose-layout icon is shown for a real moderator and entirely absent (not just disabled) for a non-moderator', async ({ page }) => {
    await connect(page, { powerLevels: MODERATOR_LEVELS });
    const frame = page.frameLocator('#frame');
    await expect(frame.locator('[data-testid=btn-propose-layout]')).toBeVisible();
  });

  test('a non-moderator never sees the icon at all', async ({ page }) => {
    await connect(page, { powerLevels: NON_MODERATOR_LEVELS });
    const frame = page.frameLocator('#frame');
    await expect(frame.locator('[data-testid=btn-propose-layout]')).toHaveCount(0);
  });

  test('a room with no power_levels event at all fails closed -- no moderator, no icon', async ({ page }) => {
    await connect(page); // powerLevels omitted entirely
    const frame = page.frameLocator('#frame');
    await expect(frame.locator('[data-testid=btn-propose-layout]')).toHaveCount(0);
  });

  test('a moderator sending a layout proposal PUTs a real state event keyed by the project id, with a confirm step first', async ({ page }) => {
    const state = await connect(page, { powerLevels: MODERATOR_LEVELS });
    const frame = page.frameLocator('#frame');
    await frame.locator('[data-testid=btn-propose-layout]').click();
    await expect(frame.locator('[data-testid=propose-layout-confirm-popover]')).toBeVisible();
    await frame.locator('[data-testid=btn-confirm-propose-layout]').click();
    await page.waitForTimeout(200);

    expect(state.sentLayoutProposals.length).toBe(1);
    expect(state.sentLayoutProposals[0].projectId).toBe(PROJ);
    const content = state.sentLayoutProposals[0].content;
    expect(Array.isArray(content.columnOrder)).toBe(true);
    expect(content.columnOrder.length).toBeGreaterThan(0);
    expect(content.columnWidths).toBeTruthy();
    // Never a signed, portable history entry -- purely a local cosmetic
    // snapshot riding the state-event wire, nothing else changed.
    expect(state.sentEntries.length).toBe(0);
  });

  test('a proposal already live when a recipient connects shows a banner with a preview and Accept/Dismiss, labeled with the sender', async ({ page }) => {
    const proposalContent = core.matrixStateEventContentFromLayoutProposal({
      columnOrder: ['__title__', 'priority', '__comments__'],
      columnWidths: { priority: 222 },
      hiddenFieldIds: ['status'],
      freezeColId: 'priority',
      proposedBy: 'Alex',
      proposedAt: 555
    });
    await connect(page, { initialLayoutProposals: { [PROJ]: proposalContent } });
    const frame = page.frameLocator('#frame');
    await expect(frame.locator('[data-testid=layout-proposal-banner]')).toBeVisible();
    await expect(frame.locator('[data-testid=layout-proposal-banner]')).toContainText('Alex');
    await expect(frame.locator('[data-testid=layout-proposal-preview]').locator('div')).not.toHaveCount(0);
    await expect(frame.locator('[data-testid=btn-accept-layout]')).toBeVisible();
    await expect(frame.locator('[data-testid=btn-dismiss-layout]')).toBeVisible();
  });

  test('Accept applies the layout locally (order/widths/hidden fields/freeze) with zero new signed history and zero change to fieldDefs -- never exported/merged', async ({ page }) => {
    const proposalContent = core.matrixStateEventContentFromLayoutProposal({
      columnOrder: ['__title__', 'priority', '__comments__'],
      columnWidths: { priority: 222 },
      hiddenFieldIds: ['status'],
      freezeColId: 'priority',
      proposedBy: 'Alex',
      proposedAt: 555
    });
    const state = await connect(page, { initialLayoutProposals: { [PROJ]: proposalContent } });
    const frame = page.frameLocator('#frame');
    await expect(frame.locator('[data-testid=layout-proposal-banner]')).toBeVisible();
    // status is still visible before accepting -- the proposal hasn't
    // been applied yet, just offered.
    await expect(frame.locator('[data-testid=col-header][data-col="status"]')).not.toHaveCount(0);

    await frame.locator('[data-testid=btn-accept-layout]').click();
    await page.waitForTimeout(300);

    await expect(frame.locator('[data-testid=layout-proposal-banner]')).toHaveCount(0);
    await expect(frame.locator('[data-testid=col-header][data-col="status"]')).toHaveCount(0);
    // freezeColId has no persistence key of its own (plain in-memory state,
    // same as a manual "Freeze up to here") and the freeze-pill indicator
    // is desktop-only chrome, never shown in widget mode -- but the actual
    // sticky-column geometry it drives is computed independently of widget
    // mode, so this is the real, mode-independent signal that freeze took.
    await expect(frame.locator('[data-testid=col-header][data-col="priority"]').last()).toHaveCSS('position', 'sticky');

    const widths = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_col_widths_v1') || '{}'));
    expect(widths[ROOM_ID + ':' + PROJ].priority).toBe(222);
    const hidden = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_hidden_fields_v1') || '{}'));
    expect(hidden[ROOM_ID + ':' + PROJ]).toEqual(['status']);

    // Nothing was ever sent to the room over this whole flow -- Accept is
    // purely local, never a portable/signed change.
    expect(state.sentEntries.length).toBe(0);
    expect(state.sentProjectStateEvents.length).toBe(0);
  });

  test('Dismiss clears the banner without applying anything', async ({ page }) => {
    const proposalContent = core.matrixStateEventContentFromLayoutProposal({
      columnOrder: ['__title__', 'priority', '__comments__'],
      columnWidths: { priority: 222 },
      hiddenFieldIds: ['status'],
      freezeColId: null,
      proposedBy: 'Alex',
      proposedAt: 555
    });
    await connect(page, { initialLayoutProposals: { [PROJ]: proposalContent } });
    const frame = page.frameLocator('#frame');
    await expect(frame.locator('[data-testid=layout-proposal-banner]')).toBeVisible();
    await frame.locator('[data-testid=btn-dismiss-layout]').click();
    await page.waitForTimeout(200);

    await expect(frame.locator('[data-testid=layout-proposal-banner]')).toHaveCount(0);
    // Never applied -- status is still visible, nothing was hidden.
    await expect(frame.locator('[data-testid=col-header][data-col="status"]')).not.toHaveCount(0);
  });

  // The core protocol guarantee (WIGWAG_MATRIX_LAYOUT_PROPOSAL_TYPE's own
  // comment in wigwag-core.js): state_key is the project id, so two
  // projects sharing a room never see each other's proposals.
  test('two different projects in the same room have fully independent proposals -- a proposal for one never shows on the other', async ({ page }) => {
    const OTHER_PROJ = 'second-project';
    const proposalForOtherProj = core.matrixStateEventContentFromLayoutProposal({
      columnOrder: ['__title__', '__comments__'], proposedBy: 'Alex', proposedAt: 1
    });
    const entries = seedProjectEntries().concat([
      { type: 'work.wigwag.entry', content: { v: 1, scope: 'project', projectId: OTHER_PROJ, entry: { id: 'other-def', field: 'title', value: { label: 'Issue', type: 'issue' }, sortKey: 0, origin: 'authored' } } },
      entryEvent({ issueId: 'j1', entry: { id: 'hj1', field: 'title', value: 'Other project issue', sortKey: 1, origin: 'authored' }, projectId: OTHER_PROJ })
    ]);
    // Only OTHER_PROJ has a live proposal. Neither project is the room's
    // legacy default (no untagged entries at all), so whichever opens
    // first, both are already bootstrapped and listed in the switcher
    // (same precedent as "a room with two explicitly-tagged projects
    // bootstraps both immediately" above) -- switch to PROJ explicitly via
    // its own switcher row and confirm it shows no banner at all.
    await connect(page, { initialEntries: entries, initialLayoutProposals: { [OTHER_PROJ]: proposalForOtherProj } });
    const frame = page.frameLocator('#frame');
    await frame.locator('[data-testid=btn-switcher]').first().click();
    await page.waitForTimeout(150);
    await frame.locator('[data-testid=switcher-project-row]').filter({ hasText: PROJ.slice(-8) }).click();
    await page.waitForTimeout(300);

    await expect(frame.locator('[data-testid=layout-proposal-banner]')).toHaveCount(0);

    // Switching to OTHER_PROJ, by contrast, does show its own banner.
    await frame.locator('[data-testid=btn-switcher]').first().click();
    await page.waitForTimeout(150);
    await frame.locator('[data-testid=switcher-project-row]').filter({ hasText: OTHER_PROJ.slice(-8) }).click();
    await page.waitForTimeout(300);
    await expect(frame.locator('[data-testid=layout-proposal-banner]')).toBeVisible();
  });
});

// Tracker #169/4f07e72b follow-up (Tom, live): now that isRoomModerator is
// a real, live power-level check (built for the layout-proposal feature),
// "+ New project" / "Receive a project" -- already moderator-gated
// server-side via Matrix's own power-level check -- are hidden entirely
// for a non-moderator too, in both places they appear: the empty-room
// screen and the project switcher's "New project in..." row. Local Mode
// (no ROOM_MODE_CAPABILITIES) is completely unaffected -- these are
// Room-Mode-only surfaces to begin with.
test.describe('wigwag-matrix-host.html: "+ New project" is hidden for a non-moderator too', () => {
  test('the empty-room screen shows Create/Receive for a moderator, and only a plain hint for a non-moderator', async ({ page }) => {
    h.mockMatrixClientApi(page, { homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room', initialEntries: [], powerLevels: MODERATOR_LEVELS });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    const frame = page.frameLocator('#frame');
    await expect(frame.locator('[data-testid=room-no-projects]')).toBeVisible();
    await expect(frame.locator('[data-testid=btn-create-first-room-project]')).toBeVisible();
    await expect(frame.locator('[data-testid=btn-receive-first-room-project]')).toBeVisible();
  });

  test('a non-moderator sees neither button, just a hint to ask a moderator', async ({ page }) => {
    h.mockMatrixClientApi(page, { homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room', initialEntries: [], powerLevels: NON_MODERATOR_LEVELS });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    const frame = page.frameLocator('#frame');
    await expect(frame.locator('[data-testid=room-no-projects]')).toBeVisible();
    await expect(frame.locator('[data-testid=btn-create-first-room-project]')).toHaveCount(0);
    await expect(frame.locator('[data-testid=btn-receive-first-room-project]')).toHaveCount(0);
    await expect(frame.locator('[data-testid=room-no-projects]')).toContainText('Ask a room moderator');
  });

  test('the switcher\'s "New project in..." row is hidden for a non-moderator', async ({ page }) => {
    const entries = [entryEvent({ issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'Existing issue', sortKey: 1, origin: 'authored' } })]; // untagged -- room already has a project
    h.mockMatrixClientApi(page, { homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room', initialEntries: entries, powerLevels: NON_MODERATOR_LEVELS });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.locator('#frame')).toBeVisible();
    await page.waitForTimeout(300);
    const frame = page.frameLocator('#frame');
    await frame.locator('[data-testid=btn-switcher]').first().click();
    await expect(frame.locator('[data-testid=btn-switcher-new-project]')).toHaveCount(0);
  });

  test('the switcher\'s "New project in..." row is shown for a real moderator', async ({ page }) => {
    const entries = [entryEvent({ issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'Existing issue', sortKey: 1, origin: 'authored' } })]; // untagged -- room already has a project
    h.mockMatrixClientApi(page, { homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room', initialEntries: entries, powerLevels: MODERATOR_LEVELS });
    await page.goto('/bridges/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.locator('#frame')).toBeVisible();
    await page.waitForTimeout(300);
    const frame = page.frameLocator('#frame');
    await frame.locator('[data-testid=btn-switcher]').first().click();
    await expect(frame.locator('[data-testid=btn-switcher-new-project]')).toBeVisible();
  });
});
