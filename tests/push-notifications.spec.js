// Tracker issue #72 (67fa1ba2): "What's the quickest way to get a version
// of this running on my phone that works with push notifications and
// syncs through to the github backend?" Tom's answer (comment on that
// issue): an installed-to-home-screen iOS PWA that can receive real Web
// Push, via a self-hosted push-relay.js (repo root) since this app is a
// static file with no backend of its own -- see that file's own header
// comment for the full design. This covers the CLIENT side only: PWA
// installability tags, service worker registration, and the
// enablePushNotifications() subscribe flow. push-relay.js's own server
// logic (VAPID handling, GitHub polling, mention detection, sending)
// isn't covered here -- it has no DOM/browser surface to drive through
// Playwright; verify it manually (curl its endpoints, run it against a
// real repo) if changed.
//
// Real Web Push can't be driven end-to-end in a headless browser (a real
// subscribe() call would try to reach an actual push service over the
// network, which this sandboxed environment can't do, and there's no way
// to receive a real push in a test anyway) -- serviceWorker.register/
// ready and pushManager are stubbed, mirroring how stubNotifications
// already stubs window.Notification elsewhere in this suite.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

const REPO = 'acme/tracker-data';

async function stubPush(page, { standalone = true, permission = 'granted', subscribeShouldFail = false } = {}) {
  await page.addInitScript(({ standalone, permission, subscribeShouldFail }) => {
    window.__pushSubscribeCalls = [];
    class FakeNotification {
      static permission = permission;
      static requestPermission() { return Promise.resolve(permission); }
    }
    window.Notification = FakeNotification;

    window.navigator.standalone = standalone;
    const realMatchMedia = window.matchMedia ? window.matchMedia.bind(window) : null;
    window.matchMedia = (query) => {
      if (query === '(display-mode: standalone)') return { matches: standalone };
      return realMatchMedia ? realMatchMedia(query) : { matches: false };
    };

    window.PushManager = function PushManager() {};

    const fakeSubscription = {
      endpoint: 'https://fake-push-service.example/abc123',
      toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'fake-p256dh', auth: 'fake-auth' } }; }
    };
    const fakeRegistration = {
      pushManager: {
        getSubscription: () => Promise.resolve(null),
        subscribe: (opts) => {
          window.__pushSubscribeCalls.push(opts);
          if (subscribeShouldFail) return Promise.reject(new Error('subscribe failed'));
          return Promise.resolve(fakeSubscription);
        }
      }
    };
    Object.defineProperty(window.navigator, 'serviceWorker', {
      configurable: true,
      value: {
        register: () => Promise.resolve(fakeRegistration),
        ready: Promise.resolve(fakeRegistration)
      }
    });
  }, { standalone, permission, subscribeShouldFail });
}

test.describe('PWA installability tags', () => {
  test('the real rendered head has a manifest link, apple touch icon, and iOS PWA meta tags', async ({ page }) => {
    await h.gotoTracker(page);
    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(manifestHref).toBe('manifest.json');
    const touchIconHref = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
    expect(touchIconHref).toBe('icon-512.png');
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'wigwag');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#EF4755');
  });

  test('manifest.json is fetchable and describes a standalone-display app', async ({ page }) => {
    await h.gotoTracker(page);
    const manifest = await page.evaluate(async () => {
      const res = await fetch('manifest.json');
      return res.json();
    });
    expect(manifest.display).toBe('standalone');
    expect(manifest.name).toBe('wigwag');
    expect(Array.isArray(manifest.icons) && manifest.icons.length).toBeGreaterThan(0);
  });

  test('the service worker registers on a served (non-file:) origin', async ({ page }) => {
    await h.gotoTracker(page);
    await page.waitForFunction(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return !!reg;
    }, { timeout: 5000 });
    const scriptUrl = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return reg.active ? reg.active.scriptURL : (reg.installing ? reg.installing.scriptURL : null);
    });
    expect(scriptUrl).toContain('sw.js');
  });
});

test.describe('Settings: push notifications', () => {
  test('shows the push relay URL/secret fields with sensible defaults', async ({ page }) => {
    await h.gotoTracker(page);
    await h.openSettingsSection(page, 'notifications');
    await expect(page.locator('[data-testid=settings-push-relay-url]')).toHaveValue('http://localhost:8939');
    await expect(page.locator('[data-testid=settings-push-relay-secret]')).toHaveValue('');
    await expect(page.locator('[data-testid=settings-enable-push-notifications]')).toBeVisible();
  });

  test('refuses to enable push notifications from a plain (non-installed) tab', async ({ page }) => {
    await stubPush(page, { standalone: false });
    await h.gotoTracker(page);
    await h.openSettingsSection(page, 'notifications');
    await page.locator('[data-testid=settings-enable-push-notifications]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=settings-push-notifications-result]')).toContainText('Add wigwag to your home screen first');
  });

  test('subscribes successfully from a standalone (installed) context, posting the right details to the relay', async ({ page }) => {
    await stubPush(page, { standalone: true });
    await h.gotoTracker(page);

    // Give this project a real GitHub connection so the subscribe payload
    // carries a real repo/path/branch, the same thing push-relay.js polls.
    await h.setGithubRepoSync(page, { repo: REPO });

    await h.openSettingsSection(page, 'notifications');
    await page.locator('[data-testid=settings-push-relay-url]').fill('http://localhost:8939');
    await page.locator('[data-testid=settings-push-relay-secret]').fill('test-secret');

    let subscribeRequestBody = null;
    await page.route('http://localhost:8939/vapid-public-key', (route) => {
      expect(route.request().headers()['x-wigwag-proxy-secret']).toBe('test-secret');
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ publicKey: 'dGhpcy1pcy1hLWZha2UtdmFwaWQtcHVibGljLWtleS1mb3ItdGVzdGluZy1vbmx5' }) });
    });
    await page.route('http://localhost:8939/subscribe', (route) => {
      subscribeRequestBody = JSON.parse(route.request().postData());
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    await page.locator('[data-testid=settings-enable-push-notifications]').click();
    await page.waitForTimeout(200);

    await expect(page.locator('[data-testid=settings-push-notifications-result]')).toContainText('Subscribed');
    expect(subscribeRequestBody).toBeTruthy();
    expect(subscribeRequestBody.email).toBe('tom@example.com');
    expect(subscribeRequestBody.repo).toBe(REPO);
    expect(subscribeRequestBody.subscription.endpoint).toBe('https://fake-push-service.example/abc123');
    expect(typeof subscribeRequestBody.origin).toBe('string');
    expect(subscribeRequestBody.origin.length).toBeGreaterThan(0);

    const subscribeCalls = await page.evaluate(() => window.__pushSubscribeCalls);
    expect(subscribeCalls.length).toBe(1);
    expect(subscribeCalls[0].userVisibleOnly).toBe(true);
  });

  test('surfaces a clear error when the relay is unreachable', async ({ page }) => {
    await stubPush(page, { standalone: true });
    await h.gotoTracker(page);
    await h.openSettingsSection(page, 'notifications');
    await page.locator('[data-testid=settings-push-relay-url]').fill('http://localhost:8939');
    await page.route('http://localhost:8939/vapid-public-key', (route) => route.fulfill({ status: 500, body: 'boom' }));
    await page.locator('[data-testid=settings-enable-push-notifications]').click();
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=settings-push-notifications-result]')).toContainText('Failed');
  });

  test('surfaces denied notification permission distinctly', async ({ page }) => {
    await stubPush(page, { standalone: true, permission: 'denied' });
    await h.gotoTracker(page);
    await h.openSettingsSection(page, 'notifications');
    await page.locator('[data-testid=settings-enable-push-notifications]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=settings-push-notifications-result]')).toContainText('permission was not granted');
  });
});
