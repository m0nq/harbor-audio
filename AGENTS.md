# Harbor Audio Working Agreement

Harbor Audio is an internal Cloud City desktop product pursuing comprehensive
functional parity within authorized boundaries. The current delivery stage is
a deterministic, fixture-only Electron scaffold; fixture-only behavior is the
present implementation stage, not the permanent product mission.

The product is informed by bounded observations of an external application. It
is not an official AudFree product, integration, provider client, or production
media converter.

## Product and security boundaries

- Keep the current implementation local-first and deterministic.
- Do not add real media import, conversion, export, download, DRM, provider,
  account, authentication, network, persistence, signing, packaging, or
  publication behavior without separate authorization.
- Keep the Electron main, preload, and renderer layers connected through the
  existing narrow read-only fixture IPC boundary.
- Protect canonical workflow fixtures and the synthetic Converted dataset.
- Preserve reviewed identities, source order, statuses, metadata, and
  membership relationships.
- Session queue additions are session-local simulation records. They do not
  enter the synthetic Converted dataset and do not create media output.
- Keep the standalone lifecycle demonstration separate from session queue
  state.

Authoritative details belong in the supporting specifications rather than being
duplicated here:

- `README.md` — ownership, mission, capabilities, boundaries, and commands
- `SPEC_INDEX.md` — specification and evidence navigation
- `DEPENDENCY_POLICY.md` — dependency, install, and supply-chain policy
- `CONVERTED_RENDERER_SDD.md` — historical Converted filtering contract
- `PARITY_MATRIX.md` — capability ledger and reference/implementation status
- `EVIDENCE_CAPTURE_PLAN.md` — bounded reference observation rules
- `evidence/evidence-manifest.json` — provenance-backed evidence records

## Outcome-Driven Three-Loop Engineering

### Loop 1 — Specify

Define the intended outcome, bounded scope, protected invariants, evidence
classification, acceptance scenarios, security constraints, and unresolved
questions before implementation. Unknown reference behavior remains unknown;
it is not converted into a product requirement by inference.

### Loop 2 — Deliver

After the implementation scope is authorized, Codex may choose ordinary
technical details, write focused failing tests, implement the smallest bounded
change, refactor, review the diff, and repair ordinary failures.

Use existing TypeScript, pnpm, JSDOM, Electron, and test conventions. Do not
introduce dependencies, abstractions, IPC, network behavior, or unrelated
refactors without separate authorization.

### Loop 3 — Verify and review

Independently and adversarially review the actual PR, specification, evidence,
diff, tests, security boundaries, and acceptance claims. Classify findings as
accepted, failed, blocked, historical, unavailable, or requiring follow-up.
Perform QA, record lessons learned, and issue the final GO/HOLD acceptance
recommendation. Do not accept intent, a green local check, or a historical
result as proof of a broader claim.

## Change-control authority

- Read-only investigation and recommendations do not authorize edits.
- One explicit bounded batch authorization may cover creation of a dedicated
  branch, implementation, commit, push, pull-request creation, and in-scope
  PR repair. Do not request individual approval for each already-authorized
  Git operation in that batch.
- Merge, branch protection, GitHub Actions settings, Linear records, releases,
  and production-impacting changes remain separately authorized operations.
- Stay on the authorized branch and stop on unexplained provenance, scope,
  dependency, security, or acceptance divergence.
- Never reset, discard, force-push, rewrite history, or silently broaden scope.

## Dependency and security controls

- Use exact direct dependency pins and the committed pnpm lockfile.
- Use the pinned `pnpm@12.12.1` and supported Node range.
- Follow `DEPENDENCY_POLICY.md` for ordinary verification, clean bootstrap,
  CI installation, lifecycle scripts, and native Electron artifact setup.
- Do not bypass dependency safety hooks or weaken script controls.
- Do not commit credentials, tokens, personal paths, generated binaries, or
  personal application data.
- Keep test profiles isolated from real user data.
- Keep CI permissions least-privileged and avoid privileged pull-request
  triggers or repository secrets unless explicitly authorized.

## Evidence and acceptance contract

Every review must distinguish:

- bounded reference observations;
- fixture simulations;
- source implementation;
- automated Node/JSDOM acceptance;
- native Electron acceptance; and
- independent manual keyboard, VoiceOver, and accessibility QA.

Report exact commands and results, fresh versus historical evidence, unavailable
checks, provenance, and remaining risks. Do not claim HARBOR-CI-01 hosted-CI
validation until an actual GitHub-hosted run has completed successfully.

## Verification commands

Use the pinned project toolchain as applicable:

```zsh
pnpm --version
pnpm run typecheck
pnpm run build
pnpm test
/opt/homebrew/bin/node --test test/*.test.mjs
/opt/homebrew/bin/node --test e2e/converted-electron.test.mjs
```

The native Electron suite is separate from Node/JSDOM CI. Physical keyboard,
VoiceOver, screen-reader, and other manual acceptance must be reported
separately and must never be inferred from JSDOM.

## Repository guidance

Read `README.md` and the relevant supporting specifications before making
changes. Preserve the historical scope of `CONVERTED_RENDERER_SDD.md`: it is
the accepted Converted filtering SDD and does not claim to have originally
specified later sorting or session lifecycle work.

Report the exact starting branch and commit, worktree and index state, changed
paths, validation results, and final disposition for every bounded change.
