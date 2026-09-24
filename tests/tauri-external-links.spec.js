// Tracker #85: every rendered link in wigwag.html already carried
// target="_blank" rel="noopener noreferrer" (see tests/issue-field.spec.js
// and tests/project-notes.spec.js for that existing coverage) -- that
// works natively in a plain browser/PWA, but a Tauri desktop webview has
// no browser chrome to open a "new tab" in and won't route target=_blank
// to the system browser without the opener plugin. This suite covers the
// click-intercept that bridges the two: only active when window.__TAURI__
// is present (real Tauri only exposes it via withGlobalTauri), otherwise
// a complete no-op so the plain-browser/PWA path is untouched.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

async function addTauriStub(page) {
  await page.addInitScript(() => {
    window.__TAURI__ = {
      core: {
        invoke: (cmd, args) => {
          window.__testInvokeCalls = window.__testInvokeCalls || [];
          window.__testInvokeCalls.push({ cmd, args });
          return Promise.resolve();
        }
      }
    };
  });
}

async function addTestLink(page, id, href) {
  await page.evaluate(({ id, href }) => {
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = 'test link';
    a.id = id;
    document.body.appendChild(a);
  }, { id, href });
}

test.describe('Tauri external link handling', () => {
  test('inside Tauri, clicking a target=_blank link calls the opener plugin and does not open a native popup', async ({ page }) => {
    await addTauriStub(page);
    await h.gotoTracker(page);
    await addTestLink(page, 'link-1', 'https://example.com/an-issue');

    const [popup] = await Promise.all([
      page.waitForEvent('popup', { timeout: 1000 }).catch(() => null),
      page.locator('#link-1').click(),
    ]);
    expect(popup).toBeNull();

    const calls = await page.evaluate(() => window.__testInvokeCalls);
    expect(calls).toEqual([{ cmd: 'plugin:opener|open_url', args: { url: 'https://example.com/an-issue' } }]);
  });

  test('outside Tauri (plain browser/PWA), a target=_blank click still opens a real new tab -- the intercept is a no-op', async ({ page, context }) => {
    await h.gotoTracker(page);
    await addTestLink(page, 'link-2', 'https://example.com/another-issue');

    const [popup] = await Promise.all([
      context.waitForEvent('page', { timeout: 3000 }),
      page.locator('#link-2').click(),
    ]);
    // The sandboxed test network can't actually reach example.com -- what
    // matters is that a real page/tab got created at all, proving native
    // target=_blank handling wasn't intercepted.
    expect(popup).not.toBeNull();
  });

  test('a link without target=_blank is left completely alone even inside Tauri', async ({ page }) => {
    await addTauriStub(page);
    await h.gotoTracker(page);
    await page.evaluate(() => {
      const a = document.createElement('a');
      a.href = '#somewhere';
      a.id = 'link-3';
      a.textContent = 'in-page link';
      document.body.appendChild(a);
    });
    await page.locator('#link-3').click();
    await page.waitForTimeout(100);
    const calls = await page.evaluate(() => window.__testInvokeCalls || []);
    expect(calls).toEqual([]);
  });

  test('the wigwag: cross-project reference pill is untouched by the Tauri intercept -- it stays in-app navigation, not routed through the opener plugin', async ({ page }) => {
    await addTauriStub(page);
    await h.gotoTracker(page);
    await h.clickTitleToEdit(page, 1);
    await h.pasteText(page, 'See wigwag:/project/demo-milestone/issue/i2/ before shipping');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(400);

    const pill = h.titleCell(page, 1).locator('[data-testid=wigwag-title-pill]');
    await expect(pill).toHaveCount(1);
    await pill.click();
    await page.waitForTimeout(150);
    const calls = await page.evaluate(() => window.__testInvokeCalls || []);
    expect(calls).toEqual([]);
  });
});
