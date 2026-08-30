# Working on wigwag

## Backlog and TODOs live in the real wigwag tracker

This project's own backlog is tracked in a real, live wigwag instance
(`github.com/lampholder/wigwag`, its `tracker.jsonl`) — not in markdown
TODO files scattered through the repo. If you finish a design handoff,
find a bug you're deliberately not fixing now, or otherwise need to leave
a note for future work on wigwag itself, **file it as a real issue in
that tracker**, the same way any other user's backlog item would be
filed. Don't create a new `docs/*-TODO.md` file for it.

- **`wigwag_tracker`** (repo root, gitignored — holds a real credential,
  never commit it) has the tracker's `wigwag:` link and a persisted
  identity (`claude@lant.uk`, including its real signing keypair) to
  connect as. Reuse that identity rather than creating a new one each
  session — same email AND same keypair, so authorship stays verifiably
  consistent across sessions instead of minting an unrelated identity
  every time.
- **`wigwag-agent.js`** (repo root) is a small CLI wrapping a real
  headless instance of `wigwag.html` via Playwright — every read/write
  goes through the app's own logic (real signed history entries, real
  derived values, real gating), not direct JSONL manipulation. The
  interaction logic itself (browser lifecycle, the real Connect Remote
  flow, list/get/add/comment/set-field) lives in **`wigwag-client.js`**,
  a standalone library `wigwag-agent.js` is a thin CLI wrapper around —
  reuse that module directly if you need this from something other than
  a one-shot shell call. See the comment at the top of each file for the
  full rationale and usage:
  ```
  node wigwag-agent.js list
  node wigwag-agent.js show <num-or-id-prefix>
  node wigwag-agent.js add-issue "Title text"
  node wigwag-agent.js comment <num-or-id-prefix> "Comment text"
  node wigwag-agent.js set-field <num-or-id-prefix> "<Field label>" <value>
  ```
  Each call connects fresh and reconnects/re-syncs from GitHub every time
  — no stale local state, but ~10-20s per call (a real browser launch
  plus the real push debounce). Fine for backlog-grooming cadence; don't
  reach for it in a tight loop.
- This is someone else's live, actively-used tracker — other real users
  (including the repo owner) edit it concurrently. Don't be surprised by
  concurrent-edit latency (a conflict costs an immediate retry, not
  silent data loss — see `pushToGithub`'s own comment in `wigwag.html`),
  and don't delete or drastically rewrite issues that aren't yours to
  begin with. Refer to tracker issues by their UUID (the `[xxxxxxxx]`
  prefix `list`/`show` print), not their sequential number, which shifts
  and is easy to mis-pick. Issue `61822bcb` ("Test issue from Claude…")
  is explicitly marked safe to use for testing `wigwag-agent.js`/
  `wigwag-client.js` themselves.

## Everything else

See `README.md` for the project overview and `docs/EDITING.md` /
`docs/FORMAT.md` before touching `wigwag.html` or the `.jsonl` format —
both are load-bearing reading, not optional background.
