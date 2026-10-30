# Harbor Audio

Harbor Audio is an internal Cloud City desktop product pursuing comprehensive
functional parity within authorized boundaries. Its current implementation
stage is a deterministic, fixture-only Electron scaffold for the Browser,
Converting, and Converted views. It is an original implementation informed by
bounded observations of an external application; it is not an official AudFree
product or integration.

The intended portfolio home is the existing Cloud City workspace and CLO team.
No separate workspace or team is required. Future Linear tickets should use
native `CLO-*` identifiers while retaining historical `HARBOR-*` milestone
references for engineering continuity.

## Current maturity

The project is a functional local scaffold, not yet a production media
converter. The renderer, domain projections, synthetic Converted dataset,
session queue simulation, build pipeline, Node tests, and isolated Electron E2E
harness are implemented. Fixture-only behavior is the current stage of the
parity effort, not a permanent product limitation. The repository deliberately
keeps unverified product behavior as unknown instead of inventing it.

## Implemented features

- Local Electron main, preload, and renderer layers with a narrow fixture IPC
  boundary.
- Browser, Converting, and Converted fixture views.
- Converting status filtering and fixture-local Search behavior.
- Converted Artist and Album filtering, Search composition, contextual empty
  states, and in-session selection preservation.
- Explicit Converted sorting by Title, Artist, Album, and Duration with
  deterministic tie-breaking and source-order fallback.
- Browser source insertion into a session-local queue with duplicate
  prevention, stable session identities, and insertion-order preservation.
- Explicit per-item simulated lifecycle progression from Waiting through
  Analyzing, Converting, and Converted; completed session items remain outside
  the synthetic Converted dataset and create no media output.
- Node/JSDOM regression coverage and a Playwright Electron acceptance harness
  using isolated test profiles.

## Current limitations

- No real audio import, conversion, download, export, DRM handling, or media
  processing is implemented.
- No account, authentication, provider, remote-service, or network capability
  is implemented.
- Packaging, signing, notarization, updater behavior, and distribution are
  outside the current scope.
- Fixture behavior is bounded and does not claim complete AudFree parity,
  universal Search semantics, or real assistive-technology validation.
- Reference observations, fixture simulations, source implementation,
  automated acceptance, native acceptance, and manual accessibility QA are
  separate evidence classes.

## Requirements

- macOS with a working desktop session for Electron E2E runs.
- Node.js `>=24.0.0 <27`.
- pnpm `12.12.1`.
- The pinned Electron `44.7.0` native runtime for desktop launch and E2E.

The native Electron artifact and dependency tree are governed by the project
dependency policy. Do not install or acquire dependencies outside an approved,
reviewed workflow.

Hosted CI is intentionally narrower: it provisions the pinned Node and pnpm
toolchain, installs the lockfile with lifecycle scripts disabled, typechecks,
builds, and runs the Node/JSDOM suite. It does not establish native Electron,
physical keyboard, VoiceOver, or screen-reader acceptance. Do not claim
HARBOR-CI-01 hosted-CI validation until a real GitHub-hosted run passes.

## Installation and quick start

In a fresh environment, use the committed lockfile and follow the dependency
policy before installing. Then build and launch the local shell:

```zsh
pnpm install --frozen-lockfile
pnpm run build
pnpm start
```

The application is fixture-only and should be run without real accounts,
personal media, or personal application profiles.

## Development and validation commands

Type-check both TypeScript targets:

```zsh
pnpm run typecheck
```

Build the main process, renderer, and copied renderer assets:

```zsh
pnpm run build
```

Run the repository's Node regression suite. `pnpm test` builds first; the
direct command runs the existing tests against the current build:

```zsh
pnpm test
/opt/homebrew/bin/node --test test/*.test.mjs
```

Run the isolated Electron E2E suite from a macOS desktop session:

```zsh
/opt/homebrew/bin/node --test e2e/converted-electron.test.mjs
```

The E2E harness launches the physically resolved Electron executable, creates
test-owned temporary `userData` and `sessionData` paths, and cleans up only
processes and profiles owned by the test. Failed diagnostics may be retained
for review.

Native Electron acceptance is independent of hosted Node/JSDOM CI. Physical
keyboard, VoiceOver, screen-reader, and other manual accessibility checks must
be reported separately from automated JSDOM or Playwright results.

## Architecture

- `src/main.ts` creates the Electron window, applies the local renderer path,
  and exposes the fixture snapshot through the narrow preload boundary.
- `src/preload.ts` provides the context-isolated renderer bridge.
- `src/renderer/renderer.ts` renders navigation, Search, filters, Converted
  sorting, and view-specific results.
- `src/domain/` contains pure workflow, filtering, and sorting projections.
- `src/fixtures/` contains the canonical workflow snapshot and the separate
  synthetic Converted demonstration data.
- `test/` contains direct Node and JSDOM regression tests.
- `e2e/` contains local Electron acceptance tests.

## Fixture boundaries

The canonical workflow fixture is protected and represents the existing queue
and status contract. Converted filtering and sorting use a separate synthetic
dataset so demonstration changes do not mutate canonical workflow data.
Synthetic fixture changes must preserve reviewed identities, source order,
statuses, and membership relationships unless a bounded change explicitly
authorizes otherwise.

## Privacy and safety

Harbor Audio is local-only. It does not require an AudFree account, credentials,
remote providers, or personal media. Do not add secrets, absolute personal
paths, generated Electron binaries, or personal application data to Git.

Keep test profiles isolated from real user data. Preserve the hardened Codex
and dependency safety hooks. Do not modify signing, global Codex configuration,
or security policy as part of ordinary feature work.

## Repository guidance and maintenance

Read [AGENTS.md](AGENTS.md) before making repository changes. Use the
[specification index](SPEC_INDEX.md) to locate authoritative contracts and
evidence. Prefer bounded Three-Loop SDD/TDD work with focused diffs, exact
dependency pins, and evidence-backed validation. A single explicit bounded
batch may authorize branch, commit, push, pull-request creation, and in-scope
repair; merge, settings, branch protection, and Linear mutation remain
separately authorized.

Report the exact commands and results used for validation; do not claim a test
or runtime check was performed without execution evidence.

## Private-use and distribution status

This repository and application are internal Cloud City work for private,
authorized use. No public distribution, commercial release, license grant,
packaging identity, signing identity, or official association with AudFree is
claimed here. Historical references to AudFree describe the external
application used as bounded parity evidence only.
