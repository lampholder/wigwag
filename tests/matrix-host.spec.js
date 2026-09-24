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

const HOMESERVER = 'https://matrix.example.org';
const ROOM_ID = '!room123:example.org';

function entryEvent({ issueId, stream, entry }) {
  return { type: 'dev.wigwag.entry', content: { v: 1, scope: 'issue', issueId, stream: stream || null, entry } };
}

test.describe('wigwag-matrix-host.html: connecting', () => {
  test('a successful connect hides the setup form, shows the iframe, and seeds a project named after the room', async ({ page }) => {
    h.mockMatrixClientApi(page, { homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'My Delivery Room', initialEntries: [] });
    await page.goto('/wigwag-matrix-host.html');
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();

    await expect(page.locator('#setup')).toBeHidden();
    await expect(page.locator('#frame')).toBeVisible();
    await expect(page.frameLocator('#frame').locator('[data-testid=tracker-name-title]')).toHaveText('My Delivery Room');
  });

  test('a room with no name set falls back to a placeholder rather than failing', async ({ page }) => {
    h.mockMatrixClientApi(page, { homeserverUrl: HOMESERVER, roomId: ROOM_ID, initialEntries: [] }); // roomName omitted -> 404
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
    h.mockMatrixClientApi(page, { homeserverUrl: HOMESERVER, roomId: ROOM_ID, initialEntries: [], whoamiFails: true });
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
    h.mockMatrixClientApi(page, { homeserverUrl: HOMESERVER, roomId: ROOM_ID, initialEntries: [] });
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
    const state = h.mockMatrixClientApi(page, { homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room', initialEntries: [], ...opts });
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

  test('reconnecting to the same room resolves to the same local project, not a duplicate', async ({ page }) => {
    await connect(page);
    const projectCountAfterFirst = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1')).milestones.length);

    await page.goto('/wigwag-matrix-host.html');
    h.mockMatrixClientApi(page, { homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room', initialEntries: [] });
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.locator('#frame')).toBeVisible();

    const projectCountAfterSecond = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1')).milestones.length);
    expect(projectCountAfterSecond).toBe(projectCountAfterFirst);
  });

  test('a pre-existing local edit from an earlier session is not clobbered by the initial remote pull on reconnect', async ({ page }) => {
    await connect(page);
    const frame = page.frameLocator('#frame');
    await frame.locator('body').click();
    await page.keyboard.down('Control');
    await page.keyboard.press('Space');
    await page.keyboard.up('Control');
    await page.waitForTimeout(200);
    await page.keyboard.type('Local-only edit not yet round-tripped');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await expect(frame.locator('[data-testid=row]')).toHaveCount(1);

    // Simulate a fresh page load (a new session) reconnecting to the same
    // room -- the mocked homeserver's initial pull deliberately does NOT
    // include the entry we just made locally (it never "sent" in this
    // reload, matching a browser that closed before its send fired).
    await page.goto('/wigwag-matrix-host.html');
    h.mockMatrixClientApi(page, { homeserverUrl: HOMESERVER, roomId: ROOM_ID, roomName: 'Bridge Room', initialEntries: [] });
    await page.locator('#homeserverUrl').fill(HOMESERVER);
    await page.locator('#accessToken').fill('tok123');
    await page.locator('#roomId').fill(ROOM_ID);
    await page.locator('#connectBtn').click();
    await expect(page.locator('#frame')).toBeVisible();

    await expect(page.frameLocator('#frame').locator('[data-testid=row]')).toHaveCount(1); // the earlier local edit survived the reconnect's merge
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
    await h.gotoFakeWidgetHost(page, { roomId: '!widgetroom:example.org', roomName: 'Widget Room', initialEntries: [] });
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
    await h.gotoFakeWidgetHost(page, { roomId: '!widgetroom:example.org', roomName: 'Widget Room', initialEntries: [] });
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
    const ids = state.sentEntries.map(c => c.entry.id);
    expect(new Set(ids).size).toBe(ids.length); // same reentrancy guard as the direct transport, exercised through send_event this time
  });

  test('a remote entry arriving via read_events on a later poll is merged into the widget-embedded iframe live', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'timer-dependent, one browser is enough to prove the mechanism');
    await h.gotoFakeWidgetHost(page, { roomId: '!widgetroom:example.org', roomName: 'Widget Room', initialEntries: [] });
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
    await h.gotoFakeWidgetHost(page, { roomId: '!widgetroom:example.org', roomName: 'Widget Room', initialEntries: [], rejectReadEventsTimes: 2 });
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
    await h.gotoFakeWidgetHost(page, { roomId: '!widgetroom:example.org', roomName: 'Widget Room', initialEntries: [], dropReadEventsTimes: 1 });
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
    await h.gotoFakeWidgetHost(page, { roomId: '!widgetroom:example.org', roomName: 'Widget Room', initialEntries: [] });
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
    await h.gotoFakeWidgetHost(page, { roomId: '!widgetroom:example.org', roomName: 'Widget Room', initialEntries: [] });
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
// shared room). See wigwag-matrix-host.html's own bootstrapLocalStorage
// comment for the full reasoning.
const IDENTITIES_LS_KEY = 'git_native_tracker_identities_v1';
async function readIdentities(page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw).identities : null;
  }, IDENTITIES_LS_KEY);
}

test.describe('wigwag-matrix-host.html: MXID-keyed identity bootstrap', () => {
  test('two different Matrix users connecting from the same browser each get their own identity', async ({ page }) => {
    await h.gotoFakeWidgetHost(page, { roomId: '!widgetroom:example.org', userId: '@alice:example.org', roomName: 'Widget Room', initialEntries: [] });
    await expect(page.frameLocator('#widget').locator('#frame')).toBeVisible();
    const afterAlice = await readIdentities(page);
    expect(afterAlice).toHaveLength(1);
    expect(afterAlice[0].matrixUserId).toBe('@alice:example.org');

    await h.gotoFakeWidgetHost(page, { roomId: '!widgetroom:example.org', userId: '@bob:example.org', roomName: 'Widget Room', initialEntries: [] });
    await expect(page.frameLocator('#widget').locator('#frame')).toBeVisible();
    const afterBob = await readIdentities(page);
    expect(afterBob).toHaveLength(2); // Alice's own identity is untouched, not overwritten
    expect(afterBob.map(i => i.matrixUserId).sort()).toEqual(['@alice:example.org', '@bob:example.org']);
  });

  test('reconnecting as the same Matrix user reuses the same identity and signing key, not a fresh one', async ({ page }) => {
    await h.gotoFakeWidgetHost(page, { roomId: '!widgetroom:example.org', userId: '@tom:lant.uk', roomName: 'Widget Room', initialEntries: [] });
    await expect(page.frameLocator('#widget').locator('#frame')).toBeVisible();
    const first = (await readIdentities(page))[0];

    await h.gotoFakeWidgetHost(page, { roomId: '!widgetroom:example.org', userId: '@tom:lant.uk', roomName: 'Widget Room', initialEntries: [] });
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
    await h.gotoFakeWidgetHost(page, { roomId: '!widgetroom:example.org', userId: '@tom:lant.uk', roomName: 'Widget Room', initialEntries: [] });
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
    await h.gotoFakeWidgetHost(page, { roomId: '!widgetroom:example.org', userId: '@tom:lant.uk', displayName: 'Tom', roomName: 'Widget Room', initialEntries: [] });
    await expect(page.frameLocator('#widget').locator('#frame')).toBeVisible();
    const identities = await readIdentities(page);
    expect(identities).toHaveLength(1); // adopted, not duplicated
    expect(identities[0].id).toBe('legacy-1');
    expect(identities[0].signingPublicKeyJwk).toEqual({ kty: 'EC', x: 'legacy-x' }); // the pre-existing key survives
    expect(identities[0].matrixUserId).toBe('@tom:lant.uk'); // backfilled
    expect(identities[0].label).toBe('Tom'); // refreshed from the current display name
  });

  test('a widget with no resolvable Matrix user id fails loudly instead of writing a shared "unknown-matrix-user" placeholder', async ({ page }) => {
    await h.gotoFakeWidgetHost(page, { roomId: '!widgetroom:example.org', userId: '', roomName: 'Widget Room', initialEntries: [] });
    const widget = page.frameLocator('#widget');
    await expect(widget.locator('#status')).toBeVisible();
    await expect(widget.locator('#status')).toContainText('Matrix user id');
    await expect(widget.locator('#frame')).toBeHidden();
    const identities = await readIdentities(page);
    expect(identities).toBeNull(); // nothing written at all -- no placeholder identity
  });
});
