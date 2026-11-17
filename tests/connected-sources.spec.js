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

// GitHub token provisioning Commit 3 (tracker 1e557816): a bare "#123"
// paste resolves against the builtin GitHub connector's OWN confirmed-
// repos list (set by confirmGithubCredentialRepos, Commit 2) rather than
// ever guessing which repo it means -- zero confirmed repos is a
// non-match (same as today, before this connector existed at all); one
// resolves directly; 2+ opens the existing ambiguous-match picker,
// generalized to show repo-qualified rows. Deliberately does NOT reuse
// h.mockGithubApi -- that closes over its own fixed GITHUB_FIXTURES
// table (only one repo) and the `window.__TAURI__.core = ... || ...`
// guard inside it means whichever addInitScript runs first wins, so a
// test needing a different set of repos/fixtures must supply its own,
// self-contained like this one, not try to layer on top.
function seedGithubBuiltinWithRepos(page, { confirmedRepos, issueFixtures = {}, force401 = false } = {}) {
  return page.addInitScript(({ confirmedRepos, issueFixtures, force401 }) => {
    localStorage.setItem('git_native_tracker_connected_sources_v1', JSON.stringify({
      connectors: [{ id: '__builtin_github', key: 'github', kind: 'github', name: 'GitHub', builtin: true, rootUrl: 'https://api.github.com', credentialConfigured: true, confirmedRepos, enabled: true }]
    }));
    window.__fetchHeaderLog = [];
    window.__TAURI__ = window.__TAURI__ || {};
    window.__TAURI__.core = {
      invoke: (cmd, args) => {
        if (cmd === 'connected_source_get_credential') return Promise.resolve('a-real-secret');
        if (cmd === 'connected_source_fetch') {
          window.__fetchHeaderLog.push(args.headers);
          if (force401) return Promise.resolve({ status: 401, headers: {}, body: JSON.stringify({ message: 'Bad credentials' }) });
          const m = args.url.match(/\/repos\/([^/]+\/[^/]+\/issues\/\d+)$/);
          const fixture = m && issueFixtures[m[1]];
          if (fixture) return Promise.resolve({ status: 200, headers: {}, body: JSON.stringify(fixture) });
          return Promise.resolve({ status: 404, headers: {}, body: JSON.stringify({ message: 'Not Found' }) });
        }
        if (cmd === 'plugin:opener|open_url') { window.open(args.url, '_blank'); return Promise.resolve(null); }
        return Promise.resolve(null);
      }
    };
  }, { confirmedRepos, issueFixtures, force401 });
}

test.describe('GitHub token provisioning: bare "#N" disambiguation against a connector\'s confirmed repos', () => {
  test('zero confirmed repos: a bare #N is left as plain text, same as no connector configured at all', async ({ page }) => {
    await seedGithubBuiltinWithRepos(page, { confirmedRepos: [] });
    await h.gotoTracker(page);
    await h.clickTitleToEdit(page, 3);
    await h.pasteText(page, '#42');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(400);

    await expect(page.locator('[data-testid=connector-picker-popover]')).toHaveCount(0);
    const doc = await h.readActiveMilestoneDoc(page);
    const issue = doc.issues.find(i => i.id === 'i3');
    expect(h.latestFieldValue(issue, 'title')).toBe('#42');
    expect(h.latestFieldRef(issue, 'title')).toBeFalsy();
  });

  test('exactly one confirmed repo: a bare #N resolves directly against it, no picker', async ({ page }) => {
    await seedGithubBuiltinWithRepos(page, {
      confirmedRepos: ['acme/app'],
      issueFixtures: { 'acme/app/issues/42': { title: 'Fix the login button', state: 'open', labels: [] } }
    });
    await h.gotoTracker(page);
    await h.clickTitleToEdit(page, 3);
    await h.pasteText(page, '#42');
    await page.keyboard.press('Tab');
    await h.waitForTitleResolved(page, 3);

    await expect(page.locator('[data-testid=connector-picker-popover]')).toHaveCount(0);
    const anchor = h.titleCell(page, 3).locator('a');
    await expect(anchor).toHaveAttribute('href', 'https://github.com/acme/app/issues/42');

    // Live-reported (Tom): the identical token/endpoint 200s via plain
    // curl (which sends its own default User-Agent) but 403s through
    // wigwag's own fetch, which never set one -- GitHub's edge rejects
    // any request with no User-Agent at all.
    const headerLog = await page.evaluate(() => window.__fetchHeaderLog || []);
    expect(headerLog.length).toBeGreaterThan(0);
    for (const headers of headerLog) expect(headers['User-Agent']).toBeTruthy();
  });

  test('two confirmed repos: a bare #N opens the picker with repo-qualified rows; picking one resolves against that repo specifically', async ({ page }) => {
    await seedGithubBuiltinWithRepos(page, {
      confirmedRepos: ['acme/app', 'acme/infra'],
      issueFixtures: {
        'acme/app/issues/42': { title: 'App-side issue', state: 'open', labels: [] },
        'acme/infra/issues/42': { title: 'Infra-side issue', state: 'open', labels: [] }
      }
    });
    await h.gotoTracker(page);
    await h.clickTitleToEdit(page, 3);
    await h.pasteText(page, '#42');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);

    const popover = page.locator('[data-testid=connector-picker-popover]');
    await expect(popover).toBeVisible();
    await expect(popover).toContainText('GitHub · acme/app');
    await expect(popover).toContainText('GitHub · acme/infra');

    await popover.locator('div', { hasText: 'GitHub · acme/infra' }).last().click();
    await h.waitForTitleResolved(page, 3);
    const anchor = h.titleCell(page, 3).locator('a');
    await expect(anchor).toHaveAttribute('href', 'https://github.com/acme/infra/issues/42');
  });
});

// Two real GitHub connector instances (e.g. a main PAT plus a second one
// narrowly scoped to a private repo the main one can't see) -- unlike
// Jira/Salesforce, a GitHub connector's rootUrl is its API base
// (api.github.com for both, always), never the browse host a stored
// href/paste actually uses (github.com), so host-matching can never
// tell two GitHub instances apart; resolveRefSystem/connectorMatches
// disambiguate by confirmedRepos instead (wigwag-core.js). gh_main is
// listed FIRST and deliberately can't see the private repo -- the old
// "first candidate wins" fallback would silently use its credential
// (secret-main) and 403 against the private repo; this only passes if
// the repo-match genuinely picks gh_private (secret-private).
function seedTwoGithubInstances(page, { confirmedReposMain, confirmedReposPrivate, issueFixtures = {} } = {}) {
  return page.addInitScript(({ confirmedReposMain, confirmedReposPrivate, issueFixtures }) => {
    localStorage.setItem('git_native_tracker_connected_sources_v1', JSON.stringify({
      connectors: [
        { id: 'gh_main', key: 'github', kind: 'github', name: 'GitHub', builtin: true, rootUrl: 'https://api.github.com', credentialConfigured: true, confirmedRepos: confirmedReposMain, enabled: true },
        { id: 'gh_private', key: 'github', kind: 'github', name: 'GitHub (internal tools)', builtin: false, rootUrl: 'https://api.github.com', credentialConfigured: true, confirmedRepos: confirmedReposPrivate, enabled: true }
      ]
    }));
    window.__credCallLog = [];
    window.__TAURI__ = window.__TAURI__ || {};
    window.__TAURI__.core = {
      invoke: (cmd, args) => {
        if (cmd === 'connected_source_get_credential') {
          window.__credCallLog.push(args.connectorId);
          return Promise.resolve(args.connectorId === 'gh_main' ? 'secret-main' : 'secret-private');
        }
        if (cmd === 'connected_source_fetch') {
          const auth = (args.headers && args.headers.Authorization) || '';
          if (auth !== 'Bearer secret-private') return Promise.resolve({ status: 403, headers: {}, body: JSON.stringify({ message: 'Resource not accessible by personal access token' }) });
          const m = args.url.match(/\/repos\/([^/]+\/[^/]+\/issues\/\d+)$/);
          const fixture = m && issueFixtures[m[1]];
          return Promise.resolve(fixture ? { status: 200, headers: {}, body: JSON.stringify(fixture) } : { status: 404, headers: {}, body: JSON.stringify({ message: 'Not Found' }) });
        }
        return Promise.resolve(null);
      }
    };
  }, { confirmedReposMain, confirmedReposPrivate, issueFixtures });
}

test.describe('GitHub repo-aware disambiguation across multiple instances', () => {
  test('refreshing a field already linked to a repo only the second instance confirmed uses that instance\'s own credential, not the first-listed one\'s', async ({ page }) => {
    await seedTwoGithubInstances(page, {
      confirmedReposMain: ['acme/app'],
      confirmedReposPrivate: ['acme/internal-tools'],
      issueFixtures: { 'acme/internal-tools/issues/1752': { title: 'Harden turnstile auth', state: 'open', labels: [] } }
    });
    await h.gotoTracker(page);
    const idx = { activeMilestoneId: await h.activeMilestoneId(page) };
    {
      const doc = await h.idbGetProjectDoc(page, idx.activeMilestoneId);
      h.pushFieldEntry(doc.issues[0], 'title', 'Old title', { id: 'test-link', href: h.githubHref('acme', 'internal-tools', 1752) });
      await h.idbSetProjectDoc(page, idx.activeMilestoneId, doc);
    }
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    await h.refreshRow(page, 1);
    await h.waitForTitleResolved(page, 1);
    await expect(h.titleCell(page, 1)).toContainText('Harden turnstile auth'); // would still read "Old title" if gh_main's credential (no repo access) had been used instead
    const credCalls = await page.evaluate(() => window.__credCallLog || []);
    expect(credCalls).toContain('gh_private');
    expect(credCalls).not.toContain('gh_main');
  });

  test('pasting owner/repo#N for a repo only the second instance confirmed resolves silently, no ambiguous-match picker', async ({ page }) => {
    await seedTwoGithubInstances(page, {
      confirmedReposMain: ['acme/app'],
      confirmedReposPrivate: ['acme/internal-tools'],
      issueFixtures: { 'acme/internal-tools/issues/1752': { title: 'Harden turnstile auth', state: 'open', labels: [] } }
    });
    await h.gotoTracker(page);
    await h.clickTitleToEdit(page, 3);
    await h.pasteText(page, 'acme/internal-tools#1752');
    await page.keyboard.press('Tab');
    await h.waitForTitleResolved(page, 3);

    await expect(page.locator('[data-testid=connector-picker-popover]')).toHaveCount(0);
    await expect(h.titleCell(page, 3)).toContainText('Harden turnstile auth');
  });
});

// ensureGithubRepoConfirmed: confirmedRepos only gets (re-)confirmed
// when a credential is typed and saved, so a repo added to the org/PAT
// afterward goes stale until the user thinks to re-save the same
// token. This re-confirms lazily -- only on an actual dispatch MISS
// (the repo genuinely isn't in the connector's list yet), not on every
// fetch -- and persists the result so the very next fetch is a no-op.
function seedGithubConnectorMissingARepo(page, { confirmedRepos, confirmedReposAt, newlyConfirmedRepos, issueFixtures = {} } = {}) {
  return page.addInitScript(({ confirmedRepos, confirmedReposAt, newlyConfirmedRepos, issueFixtures }) => {
    localStorage.setItem('git_native_tracker_connected_sources_v1', JSON.stringify({
      connectors: [{ id: '__builtin_github', key: 'github', kind: 'github', name: 'GitHub', builtin: true, rootUrl: 'https://api.github.com', credentialConfigured: true, confirmedRepos, confirmedReposAt: confirmedReposAt || null, enabled: true }]
    }));
    window.__fetchCallLog = [];
    window.__TAURI__ = window.__TAURI__ || {};
    window.__TAURI__.core = {
      invoke: (cmd, args) => {
        if (cmd === 'connected_source_get_credential') return Promise.resolve('a-real-secret');
        if (cmd === 'connected_source_fetch') {
          window.__fetchCallLog.push(args.url);
          if (args.url.includes('/user/repos')) {
            return Promise.resolve({ status: 200, headers: {}, body: JSON.stringify((newlyConfirmedRepos || []).map(full_name => ({ full_name }))) });
          }
          const m = args.url.match(/\/repos\/([^/]+\/[^/]+\/issues\/\d+)$/);
          const fixture = m && issueFixtures[m[1]];
          return Promise.resolve(fixture ? { status: 200, headers: {}, body: JSON.stringify(fixture) } : { status: 404, headers: {}, body: JSON.stringify({ message: 'Not Found' }) });
        }
        return Promise.resolve(null);
      }
    };
  }, { confirmedRepos, confirmedReposAt, newlyConfirmedRepos, issueFixtures });
}

test.describe('GitHub confirmedRepos: lazy re-confirm on a dispatch miss', () => {
  test('a repo missing from confirmedRepos triggers exactly one re-confirm call, resolves correctly, and persists so the next fetch is a no-op', async ({ page }) => {
    await seedGithubConnectorMissingARepo(page, {
      confirmedRepos: ['acme/app'], // does NOT include acme/internal-tools yet
      newlyConfirmedRepos: ['acme/app', 'acme/internal-tools'], // what the real /user/repos call now reveals
      issueFixtures: { 'acme/internal-tools/issues/1752': { title: 'Harden turnstile auth', state: 'open', labels: [] } }
    });
    const idx = {};
    await h.gotoTracker(page);
    idx.activeMilestoneId = await h.activeMilestoneId(page);
    {
      const doc = await h.idbGetProjectDoc(page, idx.activeMilestoneId);
      h.pushFieldEntry(doc.issues[0], 'title', 'Old title', { id: 'test-link', href: h.githubHref('acme', 'internal-tools', 1752) });
      await h.idbSetProjectDoc(page, idx.activeMilestoneId, doc);
    }
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    await h.refreshRow(page, 1);
    await h.waitForTitleResolved(page, 1);
    await expect(h.titleCell(page, 1)).toContainText('Harden turnstile auth');

    const calls = await page.evaluate(() => window.__fetchCallLog || []);
    expect(calls.filter(u => u.includes('/user/repos')).length).toBe(1); // exactly one re-confirm, not one per retry/attempt

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_connected_sources_v1')));
    expect(stored.connectors[0].confirmedRepos).toContain('acme/internal-tools'); // persisted -- the next fetch won't need to re-confirm at all
  });

  test('a repo still missing after a RECENT confirm is not re-confirmed again (throttled), and the fetch fails plainly instead of looping', async ({ page }) => {
    await seedGithubConnectorMissingARepo(page, {
      confirmedRepos: ['acme/app'], // still doesn't include acme/internal-tools
      confirmedReposAt: Date.now(), // just confirmed moments ago -- a persistently-inaccessible repo must not re-pay this every attempt
      newlyConfirmedRepos: ['acme/app', 'acme/internal-tools'] // would reveal it if re-confirmed, but shouldn't be called at all
    });
    const idx = {};
    await h.gotoTracker(page);
    idx.activeMilestoneId = await h.activeMilestoneId(page);
    {
      const doc = await h.idbGetProjectDoc(page, idx.activeMilestoneId);
      h.pushFieldEntry(doc.issues[0], 'title', 'Old title', { id: 'test-link', href: h.githubHref('acme', 'internal-tools', 1752) });
      await h.idbSetProjectDoc(page, idx.activeMilestoneId, doc);
    }
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    await h.refreshRow(page, 1);
    await page.waitForTimeout(500);

    const calls = await page.evaluate(() => window.__fetchCallLog || []);
    expect(calls.filter(u => u.includes('/user/repos')).length).toBe(0); // throttled -- no re-confirm call at all
    await expect(h.titleCell(page, 1)).toContainText('Old title'); // refresh failed plainly (404, unconfirmed repo) -- title unchanged, not stuck/looping
  });
});

// An internal ticket id (a made-up org-specific numbering convention)
// that's secretly
// just a GitHub issue in one specific repo -- Settings' Alias section
// (github-kind only, see githubAliasFormError/connectorMatches'
// aliasPattern branch) recognizes the alias text directly and resolves
// to a plain, portable github.com/owner/repo/issues/N href (no url-
// shape trickery to retain this connector's own identity), keeping the
// alias text itself as a durable title prefix instead.
function seedGithubWithAlias(page, { aliasPattern, aliasRepo, issueFixtures = {} } = {}) {
  return page.addInitScript(({ aliasPattern, aliasRepo, issueFixtures }) => {
    localStorage.setItem('git_native_tracker_connected_sources_v1', JSON.stringify({
      connectors: [{ id: '__builtin_github', key: 'github', kind: 'github', name: 'GitHub', builtin: true, rootUrl: 'https://api.github.com', credentialConfigured: true, aliasPattern, aliasRepo, enabled: true }]
    }));
    window.__TAURI__ = window.__TAURI__ || {};
    window.__TAURI__.core = {
      invoke: (cmd, args) => {
        if (cmd === 'connected_source_get_credential') return Promise.resolve('a-real-secret');
        if (cmd === 'connected_source_fetch') {
          const m = args.url.match(/\/repos\/([^/]+\/[^/]+\/issues\/\d+)$/);
          const fixture = m && issueFixtures[m[1]];
          return Promise.resolve(fixture ? { status: 200, headers: {}, body: JSON.stringify(fixture) } : { status: 404, headers: {}, body: JSON.stringify({ message: 'Not Found' }) });
        }
        return Promise.resolve(null);
      }
    };
  }, { aliasPattern, aliasRepo, issueFixtures });
}

test.describe('GitHub Alias: an internal ticket id convention resolved against one specific repo', () => {
  test('pasting an alias id resolves to the aliased repo\'s real issue, with the alias text kept as a title prefix and a plain portable href', async ({ page }) => {
    await seedGithubWithAlias(page, {
      aliasPattern: 'TICKET-\\d+-(\\d+)', aliasRepo: 'acme/internal-tools',
      issueFixtures: { 'acme/internal-tools/issues/1752': { title: 'Harden turnstile auth', state: 'open', labels: [] } }
    });
    await h.gotoTracker(page);
    await h.clickTitleToEdit(page, 3);
    await h.pasteText(page, 'TICKET-2026-1752');
    await page.keyboard.press('Tab');
    await h.waitForTitleResolved(page, 3);

    await expect(page.locator('[data-testid=connector-picker-popover]')).toHaveCount(0);
    await expect(h.titleCell(page, 3)).toContainText('TICKET-2026-1752: Harden turnstile auth');
    const anchor = h.titleCell(page, 3).locator('a');
    await expect(anchor).toHaveAttribute('href', 'https://github.com/acme/internal-tools/issues/1752'); // no #fragment or other url-shape trick needed
  });

  test('refreshing an alias-linked field keeps the alias prefix even though the href itself carries no trace of it', async ({ page }) => {
    await seedGithubWithAlias(page, {
      aliasPattern: 'TICKET-\\d+-(\\d+)', aliasRepo: 'acme/internal-tools',
      issueFixtures: { 'acme/internal-tools/issues/1752': { title: 'Harden turnstile auth (v2)', state: 'open', labels: [] } }
    });
    const idx = {};
    await h.gotoTracker(page);
    idx.activeMilestoneId = await h.activeMilestoneId(page);
    {
      const doc = await h.idbGetProjectDoc(page, idx.activeMilestoneId);
      h.pushFieldEntry(doc.issues[0], 'title', 'TICKET-2026-1752: Harden turnstile auth', { id: 'test-alias-link', href: h.githubHref('acme', 'internal-tools', 1752) });
      await h.idbSetProjectDoc(page, idx.activeMilestoneId, doc);
    }
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    await h.refreshRow(page, 1);
    await h.waitForTitleResolved(page, 1);
    await expect(h.titleCell(page, 1)).toContainText('TICKET-2026-1752: Harden turnstile auth (v2)');
  });

  test('a title that merely happens to contain ": " is never mistaken for a recovered alias prefix', async ({ page }) => {
    await seedGithubWithAlias(page, {
      aliasPattern: 'TICKET-\\d+-(\\d+)', aliasRepo: 'acme/internal-tools',
      issueFixtures: { 'acme/internal-tools/issues/1752': { title: 'Fresh title', state: 'open', labels: [] } }
    });
    const idx = {};
    await h.gotoTracker(page);
    idx.activeMilestoneId = await h.activeMilestoneId(page);
    {
      const doc = await h.idbGetProjectDoc(page, idx.activeMilestoneId);
      h.pushFieldEntry(doc.issues[0], 'title', 'Note: not an alias', { id: 'test-plain-link', href: h.githubHref('acme', 'internal-tools', 1752) });
      await h.idbSetProjectDoc(page, idx.activeMilestoneId, doc);
    }
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    await h.refreshRow(page, 1);
    await h.waitForTitleResolved(page, 1);
    await expect(h.titleCell(page, 1)).toContainText('Fresh title');
    await expect(h.titleCell(page, 1)).not.toContainText('Note:');
  });

  // Live-reported (Tom): a first-attempt fetch failure (e.g. the real
  // token missing GitHub's own "Issues: Read" permission on the
  // aliased repo) left the field BLANK, not the typed alias text --
  // applyLinkToField's catch-block fallback (`value: matchedId`) was
  // written assuming matchedId is always a plain string (true for
  // jira/salesforce/a custom connector's own capture group), but
  // github's matchedId is always {owner, repo, num[, akaText]} -- an
  // object, which deriveIssueValues correctly refuses to leak through
  // as a display value (see its own "legacy {href}-only" hardening),
  // silently becoming '' instead of a useful placeholder.
  test('a first-attempt fetch failure falls back to the typed alias text, not blank', async ({ page }) => {
    await seedGithubWithAlias(page, { aliasPattern: 'TICKET-\\d+-(\\d+)', aliasRepo: 'acme/internal-tools' }); // no issueFixtures -- every fetch 404s
    await h.gotoTracker(page);
    await h.clickTitleToEdit(page, 3);
    await h.pasteText(page, 'TICKET-2026-1752');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);

    await expect(h.titleCell(page, 3)).toContainText('TICKET-2026-1752');
  });

  // Live-reported (Tom): with 2+ GitHub connectors configured, a 403 in
  // devtools wasn't enough to tell WHICH connector/credential was
  // actually tried, or why (vs. a bad token, a wrong repo, etc).
  // fetchGithubData now reads GitHub's own real error body instead of
  // discarding it, and applyLinkToField's console.error names the
  // connector id/kind + the exact owner/repo/num dispatched.
  test('a fetch failure logs the real GitHub error body plus which connector/matchedId was actually tried', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    await page.addInitScript(() => {
      localStorage.setItem('git_native_tracker_connected_sources_v1', JSON.stringify({
        connectors: [{ id: 'conn_second_gh', key: 'github2', kind: 'github', name: 'GitHub (internal)', builtin: false, rootUrl: 'https://api.github.com', credentialConfigured: true, enabled: true, aliasPattern: 'TICKET-\\d+-(\\d+)', aliasRepo: 'acme/internal-tools' }]
      }));
      window.__TAURI__ = window.__TAURI__ || {};
      window.__TAURI__.core = window.__TAURI__.core || {
        invoke: (cmd, args) => {
          if (cmd === 'connected_source_get_credential') return Promise.resolve('a-bad-token');
          if (cmd === 'connected_source_fetch') return Promise.resolve({ status: 404, headers: {}, body: JSON.stringify({ message: 'Not Found' }) });
          return Promise.resolve(null);
        }
      };
    });
    await h.gotoTracker(page);
    await h.clickTitleToEdit(page, 3);
    await h.pasteText(page, 'TICKET-2026-1752');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);

    const logged = consoleErrors.find(e => e.includes('link fetch failed'));
    expect(logged).toBeTruthy();
    expect(logged).toContain('conn_second_gh'); // which connector
    expect(logged).toContain('kind=github');
    expect(logged).toContain('acme'); // the matchedId actually dispatched against
    expect(logged).toContain('internal-tools');
    expect(logged).toContain('Not Found'); // GitHub's own real error body, not just a bare status code
  });
});

// GitHub token provisioning Commit 4 (tracker 1e557816): a rejected
// token on a REFRESH of an already-linked field must behave exactly
// like any other refresh failure -- the existing resolved title is
// preserved, not regressed to a bare placeholder (same contract
// external-auth.spec.js's Jira equivalent already covers; this is the
// GitHub-specific, 401-specific case stageFieldRefresh's new branch
// handles). The improved error message itself has no UI surface to
// assert against today (fetch errors were already never written to
// visible history or the bulk-refresh-progress panel -- console.error
// only, per Format v2) -- this test covers the one thing that IS
// user-visible: nothing regresses.
test.describe('GitHub token provisioning: a rejected token on refresh never regresses an already-resolved title', () => {
  test('refreshing a linked field against a 401-returning credential keeps the existing resolved title', async ({ page }) => {
    await seedGithubBuiltinWithRepos(page, {
      confirmedRepos: ['acme/app'],
      issueFixtures: { 'acme/app/issues/42': { title: 'Fix the login button', state: 'open', labels: [] } }
    });
    await h.gotoTracker(page);
    await h.clickTitleToEdit(page, 3);
    await h.pasteText(page, '#42');
    await page.keyboard.press('Tab');
    await h.waitForTitleResolved(page, 3);
    await expect(h.titleCell(page, 3)).toContainText('acme/app#42');

    await page.evaluate(() => { window.__TAURI__.core.invoke = (cmd) => cmd === 'connected_source_get_credential' ? Promise.resolve('a-real-secret') : cmd === 'connected_source_fetch' ? Promise.resolve({ status: 401, headers: {}, body: JSON.stringify({ message: 'Bad credentials' }) }) : Promise.resolve(null); });
    await h.refreshRow(page, 3);
    await page.waitForTimeout(500);

    await expect(h.titleCell(page, 3)).toContainText('acme/app#42');
    const anchor = h.titleCell(page, 3).locator('a');
    await expect(anchor).toHaveAttribute('href', 'https://github.com/acme/app/issues/42');
  });
});
