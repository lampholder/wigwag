# Remote-connect: deferred work

The `remotes.zip` design handoff (Claude Design) had two connected parts:
**Part 1 — Connect a remote** and **Part 2 — the `wigwag:` URL scheme**.
Both shipped in staged commits (Stage 1+2: grammar rework + unknown-project
screens; Stage 3: the Connect Remote flow itself — address parsing,
per-identity/anonymous probing, and the three outcomes). This file tracks
what the handoff specified but this pass deliberately left out, so it
doesn't get lost. Nothing here is blocking; each item stands on its own
and can be picked up independently.

## 13c — No access screen

Right now a repo nothing can read just leaves the Connect button disabled
in the 13a probe sheet — no explanation of *why*, no next step. The
handoff's own 13c frame specifies a richer screen for this case:

- Per-identity failure reasons surfaced individually (expired token vs.
  never had access vs. repo doesn't exist — `probeGithubRepoAccess`
  already returns a `reason` field for this, just unused downstream).
- A "Re-authorize" action for an identity whose token expired, presumably
  looping back into whatever token-refresh flow Settings > GitHub access
  already has.
- A "Request access" action — needs its own design pass, since nothing
  in this codebase sends outbound requests to a repo owner today.
- Reusing a credential that's already proven itself against a different
  remote (the handoff's own "same-repo credential reuse" idea) — not
  designed in the source material either, would need scoping first.

## 13d — First write on a read-only project

A project connected as public-read-only (or via a single identity that
can read but not write) has no path today from "I have this open" to
"I want to change something here." The handoff frames this as an
evolution of the existing first-write attribution gate
(`requireAttribution`, see `identity-attribution.spec.js`) rather than a
new mechanism: the first edit on a read-only project should prompt for
which identity is making the change, the same way a `null`-identity
"Shared with you" project's first write already does, but then actually
needs a *write path* — a fork, a PR, a queued-change-for-someone-with-push
model — that doesn't exist yet. Worth scoping once the underlying
write-elsewhere mechanism is picked.

## `remotes[]` plural data model

A project's connection info is currently singular (`githubRepo` /
`githubRepoPath` / `githubRepoBranch` on the doc, one `identityId` on the
project record). Genuine fork/mirror support — the same project reachable
at two different addresses, or a local copy tracking an upstream it
diverged from — needs a plural `remotes[]` shape instead, with the
existing "two copies are the same project when their UUIDs match, not
when their addresses do" dedup rule extended to say which remote is
"home." `connectRemoteFinish`'s existing UUID-match-merges-in behavior
(see `tests/connect-remote.spec.js`) is the right foundation for this,
not a replacement.

## OS-level protocol handler for `wigwag:`

The `wigwag:` URI scheme (Stage 1+2) is fully specified and resolves
correctly inside the app, but nothing registers wigwag.html as the actual
OS handler for `wigwag:` links clicked outside the app (an email, a Slack
message, another tool). Relevant once there's a packaged/installable form
of the app to register a handler *from* — the Tauri wrapper work
(see project memory) is the natural point to pick this up.

## HTTPS mirror for Copy Link

Explicitly punted at the start of this handoff (see the
`AskUserQuestion` decision in this session): Copy Link emits a bare
`wigwag:/project/...` URI, not an `https://` mirror a chat client could
render/preview. The handoff's README flagged this as needing a real
decision (what serves the mirror, how it maps back to a local project)
before building the button around it — still undecided, still bare
`wigwag:` for now.
