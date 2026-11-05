# Harbor Audio

Harbor Audio is a private, personal-use Electron application for exploring a
small, fixture-backed workflow parity scaffold. It provides a deterministic
local shell for the Browser, Converting, and Converted views. It is an
original implementation informed by bounded observations of an external
application; it is not an official AudFree product or integration.

## Current maturity

The project is a functional local scaffold, not a production media
converter. The renderer, domain projections, synthetic Converted dataset,
build pipeline, Node tests, and isolated Electron E2E harness are implemented.
The repository deliberately keeps unverified product behavior as unknown
instead of inventing it.

## Implemented features

- Local Electron main, preload, and renderer layers with a narrow fixture IPC
  boundary.
- Browser, Converting, and Converted fixture views.
- Converting status filtering and fixture-local Search behavior.
- Converted Artist and Album filtering, Search composition, contextual empty
  states, and in-session selection preservation.
- Explicit Converted sorting by Title, Artist, Album, and Duration with
  deterministic tie-breaking and source-order fallback.
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

## Requirements

- macOS with a working desktop session for Electron E2E runs.
- Node.js `>=24.0.0 <27`.
- pnpm `12.12.1`.
- The pinned Electron `44.7.0` native runtime for desktop launch and E2E.

The native Electron artifact and dependency tree are governed by the project
dependency policy. Do not install or acquire dependencies outside an approved,
reviewed workflow.

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

From an authorized physical macOS Aqua/Terminal session, run the bounded
version probe before the full GUI suite:

```zsh
env \
  HARBOR_NATIVE_EXPECTED_BASE_REF='feature/harbor-clo-159' \
  HARBOR_NATIVE_EXPECTED_BASE_SHA='<approved-base-sha>' \
  HARBOR_NATIVE_EXPECTED_HEAD_SHA='<approved-exact-head-sha>' \
  HARBOR_NATIVE_EXPECTED_ELECTRON_ARCHITECTURE='<approved-artifact-architecture>' \
  HARBOR_NATIVE_EXPECTED_ELECTRON_UUID='<approved-artifact-uuid>' \
  HARBOR_NATIVE_EXPECTED_ELECTRON_SHA256='<approved-executable-sha256>' \
  HARBOR_NATIVE_EXPECTED_ELECTRON_PACKAGE_SHA256='<approved-electron-package-sha256>' \
  HARBOR_NATIVE_EXPECTED_PLAYWRIGHT_PACKAGE_SHA256='<approved-playwright-package-sha256>' \
  HARBOR_NATIVE_EXPECTED_PACKAGE_SHA256='<approved-package-json-sha256>' \
  HARBOR_NATIVE_EXPECTED_LOCKFILE_SHA256='<approved-lockfile-sha256>' \
  HARBOR_NATIVE_EXPECTED_BRANCH_STATUS='## <approved-branch-status>' \
  /opt/homebrew/bin/node e2e/native-version-probe.mjs
```

The probe verifies the exact worktree and Electron artifact, creates a private
mode-700 evidence root, preserves the normal macOS environment while removing
only Electron override variables, and launches only the direct child
`Electron --version` process. It records individual PID/PPID/PGID observations
but never signals a process group or matches process names. Every placeholder
must be replaced with independently recorded values for the exact approved
worktree/head; missing or mismatched values fail closed before launch. `PASS`
requires exact version output, observed process `close`, and verified
child/descendant cleanup. `FAILURE`, `TIMEOUT`, `INCONCLUSIVE`, or `HOLD`
retains the evidence root and stops the native sequence; do not proceed to the
full GUI suite until the probe is a verified `PASS`.

The E2E harness launches the physically resolved Electron executable, creates
test-owned temporary `userData` and `sessionData` paths, and cleans up only
processes and profiles owned by the test. Diagnostics are sanitized before
persistence. The harness removes a profile only after a passing callback,
verified child exit, and successful diagnostic persistence; failed or uncertain
cleanup retains the profile and diagnostic path for review. A pre-renderer
launch abort remains native acceptance HOLD rather than an application-test
failure or a native pass.

In a fresh exact-pinned dependency tree, Electron 44 may have package metadata
without its native bundle until the package is required. Treat native artifact
materialization as a separate approved dependency-bootstrap step before direct
executable E2E; record the resulting executable path, UUID, architecture, and
SHA-256. Do not make the acceptance harness download or replace dependencies.
For example, from the approved bootstrap environment:

```zsh
/opt/homebrew/bin/node -e "console.log(require('electron'))"
```

This command is dependency materialization evidence, not native acceptance.

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

Read [AGENTS.md](AGENTS.md) before making repository changes. Prefer bounded
SDD/TDD work with focused diffs, exact dependency pins, and evidence-backed
validation. Dependency or lockfile changes, remote mutation, pushes, commits,
destructive Git actions, and publication require explicit authorization.

Report the exact commands and results used for validation; do not claim a test
or runtime check was performed without execution evidence.

## Private-use and distribution status

This repository and application are private personal-use work. No public
distribution, commercial release, license grant, packaging identity, signing
identity, or official association with AudFree is claimed here. Historical
references to AudFree describe the external application used as bounded parity
evidence only.
