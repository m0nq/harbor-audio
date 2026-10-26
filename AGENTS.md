# AudFree Parity Project Guidance

AudFree Parity is a personal-use, fixture-backed Electron application. Keep
the implementation local-only and focused on deterministic functional parity.

## Architecture and behavior

- The Electron main/preload/renderer layers use local TypeScript domain and
  fixture modules; do not add provider, account, DRM, or real media behavior
  without separate authorization.
- Keep Converting status behavior separate from Converted filtering, search,
  and sorting behavior.
- Protect the canonical workflow fixtures. Synthetic Converted fixtures may
  be extended only when identities, source order, statuses, and membership
  relationships remain intentional and reviewed.
- Converted sorting is explicit and renderer-local: Title, Artist, Album, and
  Duration start ascending; repeated clicks toggle; a new column starts
  ascending. Artist/Album/Duration ties use Title A-Z, Title ties use Artist
  A-Z, and exact ties retain source order. Durations use validated numeric
  seconds; missing or invalid values sort last in either direction.
- Sorting must not mutate fixture data, must preserve Search and filter
  membership, must survive in-session view navigation, and must reset on a
  fresh launch. Clear sort is shown only while active and preserves Search and
  Artist/Album selections. Dropdown ordering remains alphabetical.

## Local verification

Use the pinned project toolchain (`pnpm@12.12.1`, supported Node `>=24 <27`):

```zsh
pnpm run typecheck
pnpm run build
pnpm test
/opt/homebrew/bin/node --test test/*.test.mjs
/opt/homebrew/bin/node --test e2e/converted-electron.test.mjs
```

The Electron E2E command is a local macOS GUI check. Use the existing harness,
the physically resolved native Electron executable, isolated test-owned
`userData` and `sessionData` paths, and cleanup that terminates only processes
owned by the test. Preserve failed diagnostics when the harness requires it.

## Change and security rules

- Prefer bounded SDD/TDD changes with focused diffs and execution evidence.
- Do not add or change dependencies or lockfiles without explicit review and
  authorization; never bypass the hardened dependency and safety hooks.
- Do not access real AudFree accounts, credentials, or personal application
  profiles. Do not introduce unapproved network operations or publication.
- Do not modify signing, Electron distribution artifacts, security hooks, or
  global Codex configuration without separate authorization.
- Destructive Git actions, remote mutation, pushes, and commits require
  explicit authorization. Never force-push or rewrite history.
- Report exact commands and results. Do not claim validation without execution
  evidence, and stop when provenance, scope, or safety conditions diverge.
