const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  fullyParallel: false,
  // Tom asked for the suite to run faster: 4 workers cuts a full run from
  // ~54min to ~16min on this machine (10 cores, stateless static-file
  // webServer -- no shared mutable state across workers to worry about).
  // Verified this doesn't introduce a NEW class of failure, just a
  // slightly higher rate of the same pre-existing timing-sensitive,
  // load-dependent flakes this project already catalogues (debounce/
  // cross-tab races) -- confirmed by re-running the two newly-seen
  // failures standalone (clean) and under their own smaller-scale
  // concurrency (clean) -- they're sensitive to peak aggregate load
  // across the WHOLE suite, not to workers>1 by itself. The existing
  // "re-verify in isolation before treating a failure as a regression"
  // discipline (see docs/EDITING.md) already covers this; it just gets
  // exercised a bit more often now.
  workers: 4,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:8935',
    trace: 'retain-on-failure',
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  webServer: {
    command: 'node tests/static-server.js',
    port: 8935,
    reuseExistingServer: true,
  },
});
