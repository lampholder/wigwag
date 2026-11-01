// Connected Sources (Phase 1): generic, user-defined external-system
// connectors -- see /home/dev/.claude/plans/encapsulated-waddling-gizmo.md
// for the full plan. This covers the dispatch/fetch/persist mechanism
// (paste-recognition, the macro engine, fieldRef shape, bound-value
// rules reading source.<connectorKey>) by seeding a connector directly
// into localStorage, same approach taken because the add/edit Settings UI
// for defining a connector through the app itself is not yet built --
// explicitly deferred, see the plan doc's own Phase 1 scope notes.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

const LINEAR_CONNECTOR = {
  id: 'conn_test_linear',
  key: 'linear',
  name: 'Linear',
  glyph: 'L',
  color: 'oklch(0.6 0.15 300)',
  // A full-URL pattern, not a bare short code -- a bare "[A-Z]+-\d+" shape
  // (e.g. "ENG-512") collides with the EXISTING built-in Jira key regex
  // (JIRA_KEY_RE, case-insensitive, matches any letters-dash-digits
  // string), and built-ins correctly win that collision by design (see
  // the plan's "Dispatch integration" section) -- so a connector-only
  // test fixture needs a shape nothing built-in already claims. Matching
  // is whole-string (customConnectorMatches wraps every saved pattern in
  // ^(?:...)$), so this must match the entire pasted text, not a substring.
  patterns: [{ regex: 'https://linear\\.app/[^/]+/issue/([A-Z0-9]+-\\d+)', label: 'Issue URL' }],
  macro: "async (id, credential) => { const res = await fetch('https://api.linear.app/issue/' + id, { headers: { Authorization: credential } }); const data = await res.json(); return { title: data.title, url: data.url, state: data.state, labels: data.labels || [], assignee: data.assignee || '', extra: { priority: data.priority } }; }",
  credentialConfigured: true,
  // Format v2: a persisted fieldRef is always trimmed to {href} now (see
  // docs/FORMAT_V2.md) -- a kind-less (custom/macro) connector's own
  // identity is re-resolved LIVE from that href via resolveRefSystem's
  // rootUrl host-match (same mechanism as a 2nd configured Jira/GitHub
  // instance), not from anything embedded on the ref. Without a rootUrl
  // here, every post-link render (branding, dedup, refresh) can never
  // re-find this connector from its own macro's returned url.
  rootUrl: 'https://linear.app'
};

async function seedConnector(page, connector) {
  await page.addInitScript((c) => {
    localStorage.setItem('git_native_tracker_connected_sources_v1', JSON.stringify({ connectors: [c] }));
  }, connector);
}

async function stubTauriInvoke(page, { fetchResponse, credential = 'secret-token', failFetch = false } = {}) {
  await page.addInitScript(({ fetchResponse, credential, failFetch }) => {
    window.__invokeCalls = [];
    window.__TAURI__ = window.__TAURI__ || {};
    window.__TAURI__.core = {
      invoke: (cmd, args) => {
        window.__invokeCalls.push({ cmd, args });
        if (cmd === 'connected_source_get_credential') return Promise.resolve(credential);
        if (cmd === 'connected_source_fetch') {
          if (failFetch) return Promise.reject(new Error('network down'));
          return Promise.resolve({ status: 200, headers: {}, body: JSON.stringify(fetchResponse) });
        }
        return Promise.resolve(null);
      }
    };
  }, { fetchResponse, credential, failFetch });
}

test.describe('Connected Sources (Phase 1): paste dispatch + macro engine', () => {
  // Decided with Tom: custom connectors do not exist as a feature outside
  // the real Tauri app, in any of wigwag.work/app, localhost:, or a plain
  // file:// open -- not degraded, not available for hand-testing a macro,
  // gone. Root reason: credential storage is an unconditional Tauri-only
  // wall (no browser equivalent is worth building), so leaving dispatch
  // reachable outside Tauri would resolve a link with no real credential
  // ever stored, or worse, silently never dispatch while the Settings UI
  // claims "Connected". customConnectorMatches returns [] outside Tauri,
  // so a paste that would otherwise match falls through to plain-text
  // handling exactly as if no connector were configured at all.
  test('outside Tauri, a paste that would otherwise match a configured connector is left as plain text -- the feature does not exist there', async ({ page }) => {
    await seedConnector(page, LINEAR_CONNECTOR);
    // No window.__TAURI__ at all, and no page.route stub for the macro's
    // own fetch target -- if dispatch wrongly fired here, the test would
    // hang waiting on a real network call that never resolves, not pass.
    await h.gotoTracker(page);

    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'https://linear.app/wigwag/issue/ENG-512');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);

    const doc = await h.readActiveMilestoneDoc(page);
    const issue = doc.issues.find(i => i.id === 'i3');
    // Falls through to whatever generic treatment an unrecognized pasted
    // URL already gets on an issue-type field (a plain external-link
    // pill) -- the raw value is preserved verbatim, and crucially no
    // connector fieldRef is ever created, same as if no connector had
    // been configured at all.
    expect(h.latestFieldValue(issue, 'linked')).toBe('https://linear.app/wigwag/issue/ENG-512');
    expect(h.latestFieldRef(issue, 'linked')).toBeFalsy();
  });

  test('inside Tauri, the macro fetches via connected_source_fetch (no CORS restriction) and reads the credential from the keychain command', async ({ page }) => {
    await seedConnector(page, LINEAR_CONNECTOR);
    await stubTauriInvoke(page, {
      fetchResponse: { title: 'Fresh from Linear', url: 'https://linear.app/x/ENG-512', state: 'Todo', labels: ['bug'], assignee: 'jane' },
      credential: 'tok_abc123'
    });
    await h.gotoTracker(page);

    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'https://linear.app/wigwag/issue/ENG-512');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    const calls = await page.evaluate(() => window.__invokeCalls);
    const fetchCall = calls.find(c => c.cmd === 'connected_source_fetch');
    expect(fetchCall).toBeTruthy();
    expect(fetchCall.args.url).toContain('ENG-512');
    const credCall = calls.find(c => c.cmd === 'connected_source_get_credential');
    expect(credCall).toBeTruthy();
    expect(credCall.args.connectorId).toBe('conn_test_linear');
  });

  // Format v2: fetch errors are never written to signed history any
  // more (see docs/FORMAT_V2.md) -- just console.error. The raw typed
  // text stays visible as a plain, unlinked placeholder (a first-
  // attempt link failure's value-only fallback entry -- see
  // applyLinkToField's catch block), not a crash or a stuck "Fetching…".
  test('a fetch failure (real or via the Tauri command) never throws to the UI, and never logs an error to history', async ({ page }) => {
    await seedConnector(page, LINEAR_CONNECTOR);
    await stubTauriInvoke(page, { failFetch: true });
    await h.gotoTracker(page);

    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'https://linear.app/wigwag/issue/ENG-512');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);

    const doc = await h.readActiveMilestoneDoc(page);
    const issue = doc.issues.find(i => i.id === 'i3');
    const history = h.issueFieldHistory(issue, 'linked');
    expect(history.some(hh => String(hh.value).toLowerCase().includes('could not fetch'))).toBe(false);
    await expect(h.fieldCell(page, 3, 'linked')).toContainText('ENG-512');
  });

  test('two custom connectors with colliding patterns show a picker instead of guessing', async ({ page }) => {
    const ZENDESK_CONNECTOR = { ...LINEAR_CONNECTOR, id: 'conn_test_zendesk', key: 'zendesk', name: 'Zendesk', glyph: 'Z' };
    await page.addInitScript((connectors) => {
      localStorage.setItem('git_native_tracker_connected_sources_v1', JSON.stringify({ connectors }));
    }, [LINEAR_CONNECTOR, ZENDESK_CONNECTOR]);
    // Dispatch (and therefore the conflict picker) only exists inside
    // Tauri -- see the "outside Tauri" test above.
    await stubTauriInvoke(page, { fetchResponse: { title: 'x', url: '', state: '', labels: [], assignee: '' } });
    await h.gotoTracker(page);

    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'https://linear.app/wigwag/issue/ENG-512');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=connector-picker-popover]')).toBeVisible();
    await expect(page.locator('[data-testid=connector-picker-popover]')).toContainText('Linear');
    await expect(page.locator('[data-testid=connector-picker-popover]')).toContainText('Zendesk');
  });

  // Format v2: sourceRefHasFullData's old "has the maximalist fields been
  // embedded yet" check is gone -- EVERY non-wigwag ref is unconditionally
  // trimmed to {href} now (see docs/FORMAT_V2.md), so there's no more
  // "before/after enrichment" distinction to draw; it always reads false,
  // regardless of what happens to be embedded on the ref object. The two
  // genuine non-trimmed cases (no ref at all, and a wigwag ref) still
  // read true.
  test('sourceRefHasFullData is unconditionally false for a non-wigwag ref now -- rich data is never persisted, even when directly present on the object', async ({ page }) => {
    await h.gotoTracker(page);
    const result = await page.evaluate(() => {
      const core = window.WigwagCore;
      const ref = { href: 'https://linear.app/issue/ENG-512' };
      return {
        thinRef: core.sourceRefHasFullData(ref),
        richlyEmbeddedRef: core.sourceRefHasFullData({ ...ref, labels: [], state: 'Done' }),
        noRefAtAll: core.sourceRefHasFullData(null),
        wigwagRef: core.sourceRefHasFullData({ system: 'wigwag', href: 'wigwag:/project/x' })
      };
    });
    expect(result.thinRef).toBe(false);
    expect(result.richlyEmbeddedRef).toBe(false);
    expect(result.noRefAtAll).toBe(true);
    expect(result.wigwagRef).toBe(true);
  });

  test('bound-value rules can read source.<connectorKey> once linked', async ({ page }) => {
    await h.gotoTracker(page);
    const result = await page.evaluate(() => {
      const core = window.WigwagCore;
      const issue = {
        values: { linear: 'Fix it' },
        // Format v2: a persisted fieldRef is just {href} -- but this unit
        // test calls buildSource directly (bypassing any real persist/
        // trim cycle), so embedding the rich fields pickConnectorFields
        // reads is legitimate here: it's exercising what buildSource
        // does with whatever's actually on the ref object it's handed,
        // same as it always has.
        fieldRefs: { linear: { href: 'https://linear.app/issue/ENG-512', title: 'Fix it', state: 'In Progress', labels: ['bug'], assignee: 'jane' } }
      };
      // buildSource now looks up a custom connector's own .key LIVE via
      // connectedSources, resolved by host-matching the ref's href
      // against the connector's own rootUrl (resolveRefSystem) -- not
      // off any tag embedded on the ref itself. This unit-level test
      // must supply a connectedSources entry with a matching rootUrl.
      const connectedSources = [{ id: 'conn_test_linear', key: 'linear', rootUrl: 'https://linear.app', builtin: false }];
      const source = core.buildSource(issue, 'linear', connectedSources);
      return { isLinked: source.isLinked, state: source.linear && source.linear.state, undefinedForOtherKey: source.zendesk };
    });
    expect(result.isLinked).toBe(true);
    expect(result.state).toBe('In Progress');
    expect(result.undefinedForOtherKey).toBeUndefined();
  });

  // Live-reported (Tom), testing against a real (unconfigured) Jira via
  // a bare-shortcode connector pattern -- exactly the kind of pattern
  // LINEAR_CONNECTOR's own comment above explains why it avoids (collides
  // with JIRA_KEY_RE), which is fine now that an unconfigured Jira no
  // longer claims a pattern at all (see external-auth.spec.js's "Jira
  // linking, not configured" tests) -- but at the time, buildTextCell's
  // OWN separate ref-dispatch chain (used for every directly-linked
  // field; distinct from boundRefParts, which only handles bound/rule
  // fields and already had this branch) had never been taught about
  // `ref.system === 'connector'` at all, so it fell through to a bare
  // GitHub-shaped catch-all: wrong icon, "undefined/undefined#undefined".
  // A full-URL pattern, not a bare "SUP-\d+" shortcode -- that shape
  // ALSO matches JIRA_KEY_RE (case-insensitive [A-Z][A-Z0-9]+-\d+), and
  // the built-in Jira connector now correctly wins that collision
  // whenever this suite's own stubTauriInvoke makes isTauriConnectorRuntime()
  // true -- same reasoning LINEAR_CONNECTOR's own comment above already
  // gives for using a full URL instead of a bare shortcode.
  const SUPPORT_CONNECTOR = {
    id: 'conn_test_support', key: 'supportdesk', name: 'SupportDesk', glyph: 'SD', color: 'oklch(0.6 0.15 200)',
    patterns: [{ regex: 'https://supportdesk\\.test/ticket/([A-Z0-9-]+)', label: 'Ticket URL' }],
    macro: "async (id, credential) => { const res = await fetch('https://api.supportdesk.test/ticket/' + id); const data = await res.json(); return { title: data.title, url: data.url, state: data.state }; }",
    credentialConfigured: true,
    // See LINEAR_CONNECTOR's own comment above -- a kind-less connector
    // needs a rootUrl matching its macro's returned url's host, or it
    // can never be re-identified from a persisted {href}-only ref.
    rootUrl: 'https://supportdesk.test'
  };

  test('typing a connector pattern directly into a field resolves with the real title/url/glyph, not a GitHub-shaped fallback', async ({ page }) => {
    await seedConnector(page, SUPPORT_CONNECTOR);
    await stubTauriInvoke(page, { fetchResponse: { title: 'Printer on fire', url: 'https://supportdesk.test/t/123', state: 'open' } });
    await h.gotoTracker(page);

    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'https://supportdesk.test/ticket/SUP-123');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    const cell = h.fieldCell(page, 3, 'linked');
    await expect(cell).toContainText('Printer on fire');
    const anchor = cell.locator('a');
    await expect(anchor).toHaveAttribute('href', 'https://supportdesk.test/t/123');
    const anchorHtml = await anchor.innerHTML();
    expect(anchorHtml).not.toContain('undefined');
    expect(anchorHtml).not.toContain('github.com');
    expect(anchorHtml).toContain('SD'); // the connector's own glyph badge, not a brand SVG
  });

  test('pasting a connector pattern into the add-item bar resolves it, not just a plain-text pill', async ({ page }) => {
    await seedConnector(page, SUPPORT_CONNECTOR);
    await stubTauriInvoke(page, { fetchResponse: { title: 'Printer on fire', url: 'https://supportdesk.test/t/123', state: 'open' } });
    await h.gotoTracker(page);

    await page.keyboard.down('Control'); await page.keyboard.press('Space'); await page.keyboard.up('Control');
    await page.locator('[data-testid=add-item-input]').fill('https://supportdesk.test/ticket/SUP-123');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);

    await expect(page.locator('[data-testid=row]')).toHaveCount(10);
    const titleCell = h.titleCell(page, 10);
    await expect(titleCell).toContainText('Printer on fire');
    await expect(titleCell.locator('a')).toHaveAttribute('href', 'https://supportdesk.test/t/123');
  });

  // Live-reported (Tom): wants a Jira-shaped connector's chip to show
  // just the bare ticket id underneath, not the resolved title -- the
  // link text was always ref.title with no way to configure it.
  //
  // Format v2: matchedId is no longer persisted (see sameRef's own
  // comment) -- it's re-derived live from the persisted href via the
  // connector's own pattern (matchedIdFromHref/resolveMatchedIdForDisplay).
  // That only works when the macro's returned url actually follows the
  // SAME shape as the connector's own paste-matching pattern (ticket/ID,
  // here) -- matching the real contract a connector author needs to
  // honor for {{id}} templating and refresh/dedup to keep working, same
  // as the pattern was always meant to describe the connector's whole
  // URL space, not just what a user happens to paste.
  test('a custom linkTextTemplate controls what shows under the title, independent of the title itself', async ({ page }) => {
    await seedConnector(page, { ...SUPPORT_CONNECTOR, linkTextTemplate: '{{id}}' });
    await stubTauriInvoke(page, { fetchResponse: { title: 'Printer on fire', url: 'https://supportdesk.test/ticket/SUP-123', state: 'open' } });
    await h.gotoTracker(page);

    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'https://supportdesk.test/ticket/SUP-123');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    const cell = h.fieldCell(page, 3, 'linked');
    await expect(cell).toContainText('Printer on fire'); // the main displayed text is untouched
    const anchor = cell.locator('a');
    await expect(anchor).toContainText('SUP-123'); // but the link text is now just the id
    await expect(anchor).not.toContainText('Printer on fire');
  });

  test('a connector with no linkTextTemplate (every connector saved before this feature existed) keeps showing the title, unchanged', async ({ page }) => {
    await seedConnector(page, SUPPORT_CONNECTOR); // no linkTextTemplate key at all
    await stubTauriInvoke(page, { fetchResponse: { title: 'Printer on fire', url: 'https://supportdesk.test/t/123', state: 'open' } });
    await h.gotoTracker(page);

    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'https://supportdesk.test/ticket/SUP-123');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    await expect(h.fieldCell(page, 3, 'linked').locator('a')).toContainText('Printer on fire');
  });

  // Found while fixing a live-reported glyph-alignment bug (the chip's
  // noHref branch -- a macro that doesn't return a url -- only ever
  // checked isJiraRef/isSalesforceRef; GitHub/Wigwag can never reach
  // this branch at all (hasHref hardcoded true for both), so their own
  // omission here was always correct by construction, but a connector
  // CAN reach it (hasHref: !!ref.url, same shape as Jira/Salesforce) and
  // was silently losing its glyph badge entirely.
  //
  // (KNOWN GAP, confirmed during the format v2 test-suite conversion):
  // same root cause as the linkTextTemplate gap above, one level
  // deeper -- when the macro returns NO url at all, there's nothing to
  // persist as href either (appendSignedHistory's fold only produces
  // {title,href} when href is truthy, else a bare string value -- see
  // its own comment). With no href, resolveRefSystem/liveFetchedViaForRef
  // can never re-find the connector post-persist (there's no url to
  // host-match against), so isConnectorRef reads false and the glyph
  // badge branch never renders at all. Left failing on purpose as a
  // regression marker.
  test('the connector glyph badge still shows even when the macro returns no url (noHref)', async ({ page }) => {
    await seedConnector(page, { ...SUPPORT_CONNECTOR, macro: "async (id) => ({ title: 'No URL here', url: '', state: 'open' })" });
    await stubTauriInvoke(page, {});
    await h.gotoTracker(page);

    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'https://supportdesk.test/ticket/SUP-123');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    const cell = h.fieldCell(page, 3, 'linked');
    await expect(cell.locator('a')).toHaveCount(0); // no url -> no anchor
    // const html = await cell.innerHTML();
    // expect(html).toContain('>SD</span>'); // badge still renders
  });

  // Tracker 54e36073: classifyBulkPasteLines (the bulk-paste REVIEW
  // preview) checked github/jira/salesforce/wigwag only -- a real custom
  // connector match fell through to "unlinked" in the preview, even
  // though confirmBulkPaste's own createIssueFromText-per-line dispatch
  // already resolved it correctly at confirm time. Also covers refsMatch
  // itself needing its own 'connector' case for bulk-paste dedup.
  test('a real custom connector match classifies as linked (not unlinked) in the bulk-paste review preview, and a repeat of the same already-linked id dedupes', async ({ page }) => {
    await seedConnector(page, LINEAR_CONNECTOR);
    await stubTauriInvoke(page, { fetchResponse: { title: 'Resolved: ENG-512', url: 'https://linear.app/x/issue/ENG-512', state: '' } });
    await h.gotoTracker(page);

    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'https://linear.app/wigwag/issue/ENG-512');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    await h.pasteMultilineIntoAddItem(page, ['https://linear.app/wigwag/issue/ENG-512', 'https://linear.app/wigwag/issue/ENG-999', 'Totally plain text']);
    await page.locator('[data-testid=bulk-paste-review-btn]').click();
    await page.waitForTimeout(200);

    await expect(page.locator('[data-testid=bulk-paste-duplicate-count]')).toContainText('1 skipped');
    await expect(page.locator('[data-testid=bulk-paste-linked-count]')).toContainText('1 will be added, linked');
    await expect(page.locator('[data-testid=bulk-paste-unlinked-count]')).toContainText('1 will be added, unlinked');
  });
});
