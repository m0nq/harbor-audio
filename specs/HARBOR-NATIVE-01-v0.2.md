# HARBOR-NATIVE-01 v0.2 — Native Electron Acceptance

Status: approved Loop 1 contract; implementation and execution evidence are
recorded separately.

## Purpose

Establish a safe, repeatable native Electron acceptance lane for the local,
fixture-backed Harbor Audio workflow. Native acceptance is independent of
Node/JSDOM acceptance and does not claim real media, provider, account, DRM,
network, or filesystem conversion behavior.

## Provenance gate

Every native run records the exact worktree, base SHA, tested HEAD SHA, changed
files, repository status, Node and pnpm versions, macOS version and architecture,
Electron executable path, architecture, UUID, SHA-256, and the exact commands.

The Electron executable must be physically resolved from the dependency tree or
from an independently recorded byte-identical artifact. A historical native
pass without exact-head provenance is not current acceptance evidence.

If a fresh frozen-lockfile install has only Electron package metadata, native
artifact materialization is a separate approved bootstrap step. Its command,
resolved path, UUID, architecture, and SHA-256 are recorded before acceptance;
the E2E harness must not silently download or replace dependencies.

## Runtime and security gate

The run uses an authorized macOS desktop context, the pinned Electron 44.7.0
artifact, and test-owned temporary `userData` and `sessionData` paths. Process
cleanup must prove ownership through launch handles or verified PID, ancestry,
and process identity. Broad process termination, process-name matching, sandbox
bypass, signing changes, quarantine removal, fuse changes, LaunchServices repair,
and global security changes are prohibited.

If the runtime aborts before renderer startup, preserve diagnostics and classify
native acceptance as HOLD. Do not reinterpret the failure as an application test
failure or as successful acceptance.

## Required workflow acceptance

The native suite must verify the actual synthetic Browser → Converting →
Converted workflow:

- Browser source insertion, duplicate prevention, stable source/session identity,
  and insertion order.
- Waiting → Analyzing → Converting → Converted transitions.
- Removal of completed items from the active session presentation.
- Exactly one completed-session record in Converted.
- Preservation of demonstration history, Search, filtering, sorting, and result
  count boundaries.
- Navigation preservation and fresh-launch reset.
- Simulated-completion and no-output-file communication.
- Existing regressions, empty states, focus behavior, and fixture boundaries.

The complete applicable Electron E2E suite is mandatory. Optional diagnostic
instrumentation is run when useful and recorded separately.

## Accessibility lanes

Physical keyboard and VoiceOver verification are independent acceptance lanes;
JSDOM and simulated Playwright key events cannot substitute for them.

Manual evidence records focus order, native control behavior, labels, status
updates, focus recovery, and empty states. A single lifecycle transition must
produce one meaningful completion announcement identifying the item, Converted,
and the simulated/no-output boundary. Terminal or duplicate activation must not
produce a new announcement.

The possible duplicate completion-announcement behavior remains an Observation
until actual assistive-technology evidence establishes its impact. Unperformed
or blocked manual checks remain unverified and require explicit risk disposition.

## Evidence and disposition

Evidence distinguishes reference observation, fixture simulation, source
implementation, automated acceptance, native acceptance, manual accessibility
QA, historical evidence, current exact-head evidence, inference, and unresolved
hypotheses.

Root-cause conclusions are bounded as execution-context restriction,
runtime/artifact compatibility, application/harness defect, or unresolved. The
existing pre-renderer AppKit/LaunchServices SIGABRT, corrected ASAR-header match,
disabled integrity fuse, and unresolved development-signature observation are
not silently collapsed into one conclusion.

## Exclusions and gates

No new dependency or Electron version, provider/network/media capability,
credential, DRM behavior, signing or security configuration, persistent history,
or unrelated PR/worktree change is in scope.

GO requires exact provenance, safe profile/process cleanup, complete applicable
automated verification, and native runtime evidence. Physical keyboard and
VoiceOver results are reported separately. Missing native or manual evidence is
HOLD, not a pass. Integration and merge remain separately authorized decisions.
