// Tracker #147 (320b4b08), Phase 2: wigwag-matrix-host.html's standalone
// (direct-homeserver) transport. Drives the HOST file directly, not
// wigwag.html -- verifying the bootstrap seeding, the localStorage
// bridge in both directions, and reconnect-merges-not-clobbers, all
// against a mocked homeserver (see helpers.mockMatrixClientApi). Real
// Element/widget-embedded verification is Phase 3 and, per the plan,
// can't be meaningfully automated here at all -- not attempted in this
// file.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');
const core = require('../wigwag-core.js');

const HOMESERVER = 'https://matrix.example.org';
const ROOM_ID = '!room123:example.org';

function entryEvent({ issueId, stream, entry, projectId }) {
  const content = { v: 1, scope: 'issue', issueId, stream: stream || null, entry };
  if (projectId) content.projectId = projectId;
  return { type: 'dev.wigwag.entry', content };
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
    await page.goto('/wigwag-matrix-host.html');
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
    await page.goto('/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.frameLocator('#frame').locator('[data-testid=tracker-name-title]')).toHaveText('Matrix room ' + ROOM_ID);
  });

  test('an account not joined to the room (403) surfaces a clear error and never shows the iframe', async ({ page }) => {
    h.mockMatrixClientApi(page, { homeserverUrl: HOMESERVER, roomId: ROOM_ID, accessDenied: true });
    await page.goto('/wigwag-matrix-host.html');
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
    await page.goto('/wigwag-matrix-host.html');
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
    await page.goto('/wigwag-matrix-host.html');
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
    await page.goto('/wigwag-matrix-host.html');
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
    await page.goto('/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.locator('#frame')).toBeVisible();
    return state;
  }

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
    await frame.locator('[data-testid=btn-switcher]').click();
    await expect(frame.locator('[data-testid=switcher-project-row]')).toHaveCount(1);
    await frame.locator('[data-testid=btn-switcher]').click(); // close it again

    state.pendingEntries.push(
      { type: 'dev.wigwag.entry', content: { v: 1, scope: 'project', projectId: 'mid-session-import', entry: { id: 'mph1', field: '__project_name__', value: 'Imported Mid-Session', sortKey: 1, origin: 'authored' } } },
      entryEvent({ issueId: 'mi1', entry: { id: 'mh1', field: 'title', value: 'Mid-session issue', sortKey: 2, origin: 'authored' }, projectId: 'mid-session-import' })
    );

    await expect(async () => {
      await frame.locator('[data-testid=btn-switcher]').click();
      await expect(frame.locator('[data-testid=switcher-project-row]')).toHaveCount(2);
      await frame.locator('[data-testid=btn-switcher]').click();
    }).toPass({ timeout: 8000 }); // next 5s poll tick picks it up, no reconnect needed
  });

  test('reconnecting to the same room resolves to the same local project, not a duplicate', async ({ page }) => {
    await connect(page);
    const milestonesKey = 'git_native_tracker_milestones_v1';
    const projectCountAfterFirst = await page.evaluate((key) => JSON.parse(window.__wigwagHostStorage.getItem(key)).milestones.length, milestonesKey);

    await page.goto('/wigwag-matrix-host.html');
    h.mockMatrixClientApi(page, { homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room', initialEntries: seedLegacyEntries() });
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.locator('#frame')).toBeVisible();

    const projectCountAfterSecond = await page.evaluate((key) => JSON.parse(window.__wigwagHostStorage.getItem(key)).milestones.length, milestonesKey);
    expect(projectCountAfterSecond).toBe(projectCountAfterFirst);
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
    await page.goto('/wigwag-matrix-host.html');
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
    await expect(widget.frameLocator('#frame').locator('[data-testid=tracker-name-title]')).toHaveText('Widget Room');
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
    await frame.locator('[data-testid=btn-import-merge]').click();
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
      'org.matrix.msc2762.receive.event:dev.wigwag.entry',
      'org.matrix.msc2762.send.event:dev.wigwag.entry',
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
    await page.goto('/wigwag-matrix-host.html');
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
    await page.goto('/wigwag-matrix-host.html');
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
    await frame.locator('[data-testid=btn-switcher]').click();
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
    await page.goto('/wigwag-matrix-host.html');
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
    await frame.locator('[data-testid=btn-switcher]').click();
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
      type: 'dev.wigwag.entry',
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
    await page.goto('/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.locator('#frame')).toBeVisible();
    await page.waitForTimeout(300);

    const frame = page.frameLocator('#frame');
    await frame.locator('[data-testid=btn-switcher]').click();
    const rows = frame.locator('[data-testid=switcher-project-row]');
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: 'Real Project Name' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'proj-unnamed'.slice(-8) })).toHaveCount(1);

    await rows.filter({ hasText: 'Real Project Name' }).click();
    await page.waitForTimeout(200);
    await expect(frame.locator('[data-testid=row]')).toHaveCount(1);
    await expect(frame.locator('[data-testid=row]')).toContainText('In the named project');
  });
});

// Tracker f6b39bf0, live-reported rate-limit incident: project creation is
// now a moderator-gated Matrix state event (dev.wigwag.project), not an
// unconditional local-then-bridged action. Room Scoped Widget Mode has a
// real "no projects yet" state instead of always synthesizing a default
// project the moment a room is empty.
test.describe('wigwag-matrix-host.html: moderator-gated project creation', () => {
  test('a moderator\'s "+ New project" from the empty-room screen succeeds and shows the new project', async ({ page }) => {
    h.mockMatrixClientApi(page, { homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room', initialEntries: [] });
    await page.goto('/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    const frame = page.frameLocator('#frame');
    await expect(frame.locator('[data-testid=room-no-projects]')).toBeVisible();

    await frame.locator('[data-testid=btn-create-first-room-project]').click();
    await page.waitForTimeout(300);
    await expect(frame.locator('[data-testid=room-no-projects]')).toBeHidden();
    await expect(frame.locator('[data-testid=tracker-name-title]')).toBeVisible();
  });

  test('a non-moderator\'s attempt to create the first project is rejected (403), rolled back locally, and shown as a real error -- never silently dropped', async ({ page }) => {
    h.mockMatrixClientApi(page, { homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room', initialEntries: [], projectCreationForbidden: true });
    await page.goto('/wigwag-matrix-host.html');
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

  test('an existing room\'s legacy project (grandfathered, predates this feature) is discovered without needing a state event', async ({ page }) => {
    h.mockMatrixClientApi(page, {
      homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room',
      initialEntries: [entryEvent({ issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'Pre-existing issue', sortKey: 1, origin: 'authored' } })] // untagged, no dev.wigwag.project event anywhere
    });
    await page.goto('/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    const frame = page.frameLocator('#frame');
    await expect(frame.locator('[data-testid=room-no-projects]')).toBeHidden();
    await expect(frame.locator('[data-testid=row]')).toContainText('Pre-existing issue');
  });

  test('the project index is found via a real current-state fetch, not by how far a timeline pull happens to reach', async ({ page }) => {
    // messagesReturnsProjectStateEvents: false -- the dev.wigwag.project
    // event exists ONLY in room state (getMatrixRoomState), never in the
    // /messages timeline this test's connect() actually pulls from. If
    // discovery only ever scanned the timeline (the old mechanism), this
    // project would be invisible; the real current-state fetch must be
    // what actually finds it.
    const state = h.mockMatrixClientApi(page, {
      homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room', initialEntries: [], messagesReturnsProjectStateEvents: false
    });
    await page.goto('/wigwag-matrix-host.html');
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
      type: 'dev.wigwag.entry',
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

    await page.goto('/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.locator('#frame')).toBeVisible();

    const frame = page.frameLocator('#frame');
    await frame.locator('[data-testid=btn-switcher]').click();
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
  const manifestEvent = { type: 'dev.wigwag.snapshot', content: core.matrixEventContentFromSnapshotManifest({ projectId, snapshotId, cutoffSortKey, mxc, size: ciphertext.length, encryption }) };
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

    await page.goto('/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.locator('#frame')).toBeVisible();

    const frame = page.frameLocator('#frame');
    await frame.locator('[data-testid=btn-switcher]').click();
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

    await page.goto('/wigwag-matrix-host.html');
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

    await page.goto('/wigwag-matrix-host.html');
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

    await page.goto('/wigwag-matrix-host.html');
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
    await page.goto('/wigwag-matrix-host.html');
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
    await frame.locator('[data-testid=btn-import-merge]').click();
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

  test('a homeserver rejecting the upload (e.g. rate-limited) is retried, same shared retry mechanics as any other Matrix write', async ({ page }) => {
    const state = h.mockMatrixClientApi(page, {
      homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room',
      initialEntries: [entryEvent({ issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'Room issue', sortKey: 1, origin: 'authored' } })],
      rejectUploadTimes: 2
    });
    await page.goto('/wigwag-matrix-host.html');
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
    await frame.locator('[data-testid=btn-import-merge]').click();
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
    await page.goto('/wigwag-matrix-host.html');
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
    await frame.locator('[data-testid=btn-import-merge]').click();
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
    await frame2.locator('[data-testid=btn-switcher]').click();
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
  page.route(roomPath + '/send/dev.wigwag.entry/*', async (route) => {
    const content = JSON.parse(route.request().postData());
    entries.push({ type: 'dev.wigwag.entry', content });
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

    await page.goto('/wigwag-matrix-host.html');
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
    await page.goto('/wigwag-matrix-host.html');
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
    await frame.locator('[data-testid=btn-import-merge]').click();
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
    await page.route(roomPath + '/send/dev.wigwag.entry/*', async (route) => {
      const content = JSON.parse(route.request().postData());
      entries.push({ type: 'dev.wigwag.entry', content });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ event_id: '$evt' + entries.length }) });
    });
    // Bulk-adoption uses the batch event type (tracker #149) -- a newly
    // imported project's whole history goes out as one dev.wigwag.entries
    // send, not one dev.wigwag.entry per item. Without mocking this too,
    // adoptLocalProjects's push silently fails against Playwright's
    // default unhandled-route behavior and the import never actually
    // reaches "the room".
    await page.route(roomPath + '/send/dev.wigwag.entries/*', async (route) => {
      const content = JSON.parse(route.request().postData());
      for (const item of (content.items || [])) entries.push({ type: 'dev.wigwag.entry', content: item });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ event_id: '$evt' + entries.length }) });
    });
    // Bulk-adoption now sends a snapshot directly (not the batch route
    // above) -- without mocking these too, the import's push silently
    // fails (no route -> a network error), so the imported project never
    // actually reaches "the room" and the reconnect below only ever finds
    // the room's original project.
    await page.route(roomPath + '/send/dev.wigwag.snapshot/*', async (route) => {
      const content = JSON.parse(route.request().postData());
      entries.push({ type: 'dev.wigwag.snapshot', content });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ event_id: '$evt' + entries.length }) });
    });
    await page.route(roomPath + '/send/dev.wigwag.snapshot.chunk/*', async (route) => {
      const content = JSON.parse(route.request().postData());
      entries.push({ type: 'dev.wigwag.snapshot.chunk', content });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ event_id: '$evt' + entries.length }) });
    });
    // Project index (tracker f6b39bf0): bulk-adopting the imported project
    // must first create its moderator-gated state event -- without mocking
    // this too, adoptOneLocalProject's createProject call fails (no route)
    // and the import is rejected/rolled back before anything else about it
    // is ever pushed, so the reconnect below would only ever find the
    // room's original project.
    const projectStateEventsByKey = new Map();
    await page.route(roomPath + '/state/dev.wigwag.project/*', async (route) => {
      const url = new URL(route.request().url());
      const projectId = decodeURIComponent(url.pathname.split('/').pop());
      const content = JSON.parse(route.request().postData());
      projectStateEventsByKey.set(projectId, content);
      entries.push({ type: 'dev.wigwag.project', state_key: projectId, content });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ event_id: '$projstate' + projectStateEventsByKey.size }) });
    });
    await page.route(roomPath + '/state', async (route) => {
      const events = [...projectStateEventsByKey.entries()].map(([projectId, content]) => ({ type: 'dev.wigwag.project', state_key: projectId, content }));
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

    await page.goto('/wigwag-matrix-host.html');
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
    await firstFrame.locator('[data-testid=btn-import-merge]').click();
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
    await frame.locator('[data-testid=btn-switcher]').click();
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
    await page.goto('/wigwag-matrix-host.html');
    await connectTo(ROOM_A);
    const importedId = 'room-a-imported-proj';
    const pastedJsonl = [
      JSON.stringify({ type: 'fields', fields: { title: { label: 'Issue', type: 'text' } }, id: importedId, name: 'Room A Import' }),
      JSON.stringify({ type: 'issue', id: 'iax', num: 1, fieldRefs: {}, values: { title: 'Room A\'s own imported issue' }, comments: [], history: [] })
    ].join('\n');
    const frameA = page.frameLocator('#frame');
    await frameA.locator('[data-testid=btn-import-merge]').click();
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
    await frameB.locator('[data-testid=btn-switcher]').click();
    const rows = frameB.locator('[data-testid=switcher-project-row]');
    const rowTexts = await rows.allInnerTexts();
    expect(rowTexts.some(t => t.includes('Room A Import'))).toBe(false);
  });
});
