# HARBOR-WORKFLOW-02 — Connected Synthetic Session Lifecycle

**Specification:** v0.3.1 — APPROVED FOR IMPLEMENTATION PLANNING / LOOP 2 AUTHORIZATION PENDING
**Original approval draft:** November 3, 2026
**Human specification approval:** November 3, 2026, in the Harbor Audio Control Center conversation
**Linear:** [CLO-159 — Show completed session jobs in Converted](<https://linear.app/cloud-city-fest/issue/CLO-159/show-completed-session-jobs-in-converted-without-mixing-them-with>)
**Project:** Harbor Audio — Desktop Product Delivery
**Baseline:** `main` at `07dc10b47dc2c4def5a86a0e74fbcd50ac607c39`
**Evidence:** HARBOR-AUDIT-02, November 3, 2026, and the Codex-reported v0.2/v0.3 integrity comparison
**Authority:** Human-approved Loop 1 specification only; no implementation, PR, or merge authorization.

## 1. Purpose and user outcome

Harbor Audio currently supports adding synthetic Browser sources to a session queue and manually advancing their simulated conversion status. However, completed session jobs never appear in the Converted view.

This leaves the primary Browser → Converting → Converted journey incomplete.

**Required outcome:** A user can add a synthetic source, advance its simulated conversion, and find the same completed record exactly once in Converted.

The feature must preserve source and session identity, existing demonstration data, accessible interaction, and the explicit distinction between simulated completion and actual media output.

## 2. Evidence and product authority

Relevant reference evidence from AudFree Apple Music Converter v4.1.1:

* `EV-UI-001/002`: Browser, Converting, and Converted/history surfaces were observed.
* `EV-CONVERSION-001`: Conversion-related states and completed history were partially observed; the full transition sequence was not established.
* `EV-FILTER-004` through `EV-FILTER-008`: Specific Converted Artist/Album filtering and Search intersections were observed.
* `EV-WORKFLOW-001`: Retry and cancellation semantics remain unknown.

**Product classification:** This connected synthetic lifecycle is original Harbor Audio functionality informed by observed reference views. It does not establish parity with AudFree's unobserved insertion, progression, completion, or recovery mechanisms.

Unknown reference behavior remains unknown.

## 3. Functional behavior

### 3.1 Browser source insertion

A user can add an existing synthetic Browser source to the current session queue.

A successful insertion must:

* Preserve the source's `sourceItemId` and metadata.
* Produce a stable, unique session queue ID.
* Start in Waiting status.
* Preserve insertion order.
* Leave canonical fixtures unchanged.

A source already present in the session queue cannot be inserted again, including after completion.

Invalid source IDs must produce no state mutation.

Existing Browser insertion feedback remains available.

### 3.2 Simulated conversion lifecycle

A session job advances only through an explicit user action.

The successful progression is:

**Waiting → Analyzing → Converting → Converted**

Each action advances exactly one eligible job by one state.

Advancing one job must not change another job's state, identity, metadata, or position.

Unknown IDs and terminal actions are non-mutating.

No automatic processing, conversion timer, progress percentage, failure injection, or media-processing side effect is introduced.

### 3.3 Converting presentation and completion

Converting's active session-job list displays only noncompleted session jobs.

**When a session job reaches Converted status:**

* The completed job is no longer displayed in the active session-job list.
* Its authoritative record remains in `SessionQueueState`.
* The same record becomes eligible for the Completed-this-session projection in Converted.
* Completion does not delete the record, create a second mutable copy, or modify canonical fixtures.
* The application does not automatically navigate away from Converting.
* A visible and accessible status announcement confirms simulated completion and indicates that the record can be found in Converted.

The existing workspace navigation must provide a discoverable path to Converted.

A contextual **View completed items** shortcut is permitted but is not required. If implemented, it must be keyboard-operable, avoid duplicate navigation semantics, and satisfy the same accessibility requirements as the existing navigation.

Canonical Converting fixtures, their existing status-filter behavior, and the standalone lifecycle demo remain independent.

### 3.4 Converted-session presentation

Converted contains a separately labeled section:

**Completed this session**

This section must:

* Include only current-session jobs whose status is Converted.
* Derive membership directly from authoritative session state.
* Preserve stable job identity and source association.
* Render each completed job exactly once.
* Preserve session insertion order, even when completion order differs.
* Display the existing title, creator, collection, and duration metadata.
* Clearly identify completion as simulated, with no generated audio output.

When the session contains no completed jobs, display an informative empty state.

The existing synthetic Converted demonstration dataset and its presentation remain separate and unchanged.

### 3.5 Filtering, Search, and sorting

Existing Converted Artist/Album filtering, Search, and sorting continue to apply exclusively to synthetic demonstration history.

They must not change completed-session:

* Membership.
* Order.
* Metadata.
* Status.
* Record identity.

Demonstration-only result counts must not include completed-session records.

Visible headings, labels, and related copy must make the distinction understandable.

Unified Search/filter/sort across session history is deferred.

### 3.6 Navigation and session lifetime

Navigating among Browser, Converting, and Converted preserves the current session queue and its derived completed records.

A fresh application session resets session additions and simulated completions.

No disk persistence is introduced.

Canonical fixtures, Converted demonstration history, and their existing state contracts remain unchanged.

## 4. Architectural invariants

**INV-01 — Single authority:** `SessionQueueState` is authoritative for session-job identity, status, and order.

**INV-02 — Derived completion:** Completed-session records are a projection of session state, not a second mutable collection.

**INV-03 — Stable identity:** Each session job retains its ID and `sourceItemId` across every transition and view.

**INV-04 — Immutable updates:** Valid transitions create new session state without mutating previous state or canonical fixtures.

**INV-05 — Separation:** Canonical queue data, current-session jobs, standalone lifecycle demo, and synthetic Converted history remain distinct.

**INV-06 — Truthful completion:** Simulated Converted status does not imply that a real audio file exists.

**INV-07 — Regression preservation:** Existing Converted Search, filtering, sorting, tie-breaking, focus, and reset behavior remain intact.

**INV-08 — Security:** No new filesystem, network, credential, provider, DRM, media, dependency, or IPC capability is introduced.

Small pure projection helpers and focused renderer changes are permitted within the implementation's normal architectural freedom.

A generalized event store, persistence layer, processing framework, or architectural redesign is not authorized.

## 5. Accessibility and interaction

All new interactive controls must support keyboard operation and have meaningful accessible names.

### Completion announcements

A completion announcement must:

* Identify the completed item meaningfully.
* State or clearly imply that completion is simulated.
* Identify Converted as the destination.
* Avoid claiming that an output file was created.
* Avoid duplicate or unnecessarily repeated announcements.

### Focus management

When completing a job removes its active row, focus must move to a predictable surviving control or an appropriate programmatically focusable status/destination element.

Focus must not be silently lost to the document body without a usable recovery path.

The implementation may choose the smallest accessible mechanism consistent with the existing renderer.

### Navigation and presentation

* The Completed-this-session heading and records must be discoverable through semantic navigation.
* Empty and completion states must be understandable without relying on color or icons alone.
* Existing Converted Search focus/caret preservation and native-control behavior must not regress.
* Any optional contextual navigation action must meet the same requirements.

Automated DOM tests are necessary but do not establish native keyboard or VoiceOver acceptance by themselves.

## 6. Negative and boundary behavior

The implementation must safely handle:

* Unknown source IDs.
* Duplicate insertion before and after completion.
* Unknown session-job IDs.
* Terminal activation.
* Multiple jobs at different lifecycle stages.
* Completion occurring in a different order from insertion.
* No active session jobs.
* No completed session jobs.
* Repeated navigation between all three views.
* Fresh application launch.
* Repeated interactions without duplicated listeners, records, or status announcements.

These cases must not mutate unrelated records, corrupt ordering, or create phantom completion history.

## 7. Acceptance criteria

| ID | Required outcome | Verification |
| -- | -- | -- |
| WF-AC01 | Fresh session shows no completed-session records; existing demonstration history is unchanged | Domain, renderer, native |
| WF-AC02 | Browser insertion produces one immutable Waiting job with stable source/session identity | Domain, renderer |
| WF-AC03 | Invalid or duplicate insertion does not mutate session membership | Domain, renderer |
| WF-AC04 | Explicit actions advance exactly one eligible job through the defined sequence | Domain, renderer, native |
| WF-AC05 | Completion removes a job from active session presentation and displays it once in Converted, retaining the authoritative record | Domain, renderer, native |
| WF-AC06 | Multiple jobs preserve independent state, identity, metadata, and deterministic insertion order | Domain, renderer |
| WF-AC07 | Unknown IDs and terminal actions are non-mutating | Domain, renderer |
| WF-AC08 | Canonical fixtures and the standalone lifecycle demonstration remain unchanged | Regression |
| WF-AC09 | Session completion cannot change demonstration-only filtering, Search, sorting, membership, or result counts | Domain, renderer, regression |
| WF-AC10 | In-session navigation preserves state; fresh application launch resets it | Renderer, native |
| WF-AC11 | Completion announcements, focus recovery, navigation, labels, and empty states remain accessible | DOM, native keyboard, manual accessibility |
| WF-AC12 | No media, filesystem, network, credential, provider, dependency, or new IPC capability is introduced | Diff, security and regression review |
| **WF-AC13** | **Full exact-revision automated verification and native acceptance evidence satisfy the required gate, or unavailable native acceptance is explicitly classified HOLD** | **Complete typecheck, build, Node/JSDOM suite, native E2E, evidence review** |

### WF-AC13 — Exact-revision verification contract

At the final proposed PR head SHA:

1. The complete TypeScript typecheck must pass.
2. The application build must pass.
3. The complete Node/JSDOM test suite must pass.
4. The isolated native Electron E2E suite must be executed, with successful applicable native verification required before native acceptance is claimed.
5. Evidence must identify the exact checkout, full SHA, relevant OS/runtime/toolchain, commands, results, and test counts.
6. Approved direct-command equivalents may be used when ordinary pnpm wrappers are blocked, but the substitution and its limitations must be documented.
7. Physical keyboard and VoiceOver checks must be recorded separately from automated tests. Any unperformed or blocked checks remain unverified and require an explicit risk disposition.
8. Historical passing tests and build-only results cannot substitute for current exact-revision native evidence.

If Electron fails before renderer startup, preserve diagnostics and classify native acceptance as HOLD rather than marking renderer scenarios passed or failed.

A feature may be **implemented and PR-reviewable** while native acceptance remains HOLD. This does not constitute permission to merge.

## 8. TDD and verification strategy

Implementation should begin with meaningful failing tests for the missing session-completion projection and cross-view behavior.

### Domain tests

Verify zero, one, and multiple completed records; identity; insertion ordering; immutability; duplicate prevention; unknown IDs; and terminal behavior.

### Renderer tests

Verify the complete Browser → Converting → Converted journey, including completed-row removal, preserved identity, scoped demonstration history, completion announcements, focus recovery, navigation, and empty states.

### Regression tests

Preserve canonical fixture integrity, independent lifecycle demo behavior, existing status filters, Converted Artist/Album membership, Search, sorting, and relevant focus/caret behavior.

### Native acceptance

Run the isolated Electron E2E suite at the exact proposed PR head, with test-owned user/session profiles and safe process cleanup.

Test the real cross-view interaction where the native runtime is available.

Record physical keyboard and VoiceOver results independently. Do not claim either based on JSDOM or simulated key events alone.

### Environment failures

HARBOR-AUDIT-02 reported an Electron 44.7.0 pre-renderer SIGABRT on macOS 26.7.2.

Treat this as an observed runtime limitation, not proof of a feature defect or permission to weaken native tests.

Any native remediation outside this feature's scope belongs in <issue id="7f2f1ab9-2272-43b0-b9de-e0a99c312c56" label="CLO-160" href="https://linear.app/cloud-city-fest/issue/CLO-160/restore-repeatable-native-electron-and-accessibility-acceptance" /> or another separately approved change.

## 9. Scope

### Included

* Pure completed-session projection.
* Active session-job presentation changes in Converting.
* Separate Completed-this-session presentation in Converted.
* Completion announcements and predictable focus recovery.
* Existing navigation integration and optional contextual shortcut.
* Domain, renderer, regression, and native acceptance coverage.
* Narrow documentation corrections where permitted and safely isolated.

### Excluded

* Real file import, conversion, decoding, encoding, or media output.
* Provider integrations, accounts, credentials, protected media, or DRM handling.
* New network, filesystem, or IPC capabilities.
* New dependencies and lockfile changes.
* Persistent history or storage migrations.
* New retry/cancellation behavior.
* General queue architecture replacement.
* Generalized Search/filter/sort redesign.
* Signing, packaging, notarization, updates, distribution, or release.
* Unrelated CI or governance implementation.
* Merge of existing pull requests.

## 10. Dependencies and worktree safety

Baseline: `main` at `07dc10b47dc2c4def5a86a0e74fbcd50ac607c39`, subject to fresh reconciliation before implementation.

Related work:

* <issue id="3898714c-6ead-418c-a8e0-7dc20d20c868" label="CLO-158" href="https://linear.app/cloud-city-fest/issue/CLO-158/establish-trustworthy-hosted-ci-for-harbor-audio-pull-requests" />: Hosted CI.
* <issue id="7f2f1ab9-2272-43b0-b9de-e0a99c312c56" label="CLO-160" href="https://linear.app/cloud-city-fest/issue/CLO-160/restore-repeatable-native-electron-and-accessibility-acceptance" />: Native Electron and accessibility acceptance.
* <issue id="bf3cd4bd-29b3-41ad-83b6-eb8ca11ab442" label="CLO-161" href="https://linear.app/cloud-city-fest/issue/CLO-161/establish-enforceable-private-repository-integration-protections" />: Private-repository integration protections.
* <issue id="eb8a3b18-4725-492d-be30-d76fd46e25d0" label="CLO-163" href="https://linear.app/cloud-city-fest/issue/CLO-163/restore-safe-codex-git-staging-and-github-connectivity-for-autonomous" />: Safe autonomous Git and GitHub delivery.

The existing governance PR #1 and duration-overflow PR #2 are separate, unmerged changes.

Before implementation, verify worktree provenance, committed and uncommitted state, and overlapping documentation files.

Preserve all unrelated branches, worktrees, untracked CI files, governance modifications, and PR #2 changes.

Documentation reconciliation must not overwrite or silently incorporate unrelated governance work.

## 11. Three-loop delivery requirements

### Loop 1 — Specify

Obtain human approval of this exact specification revision.

Approval defines intended behavior but does not authorize implementation.

### Loop 2 — Deliver

After separate batch authorization, Codex owns routine delivery within the approved scope:

* Safe isolated worktree preparation.
* Test-first implementation.
* Appropriate in-scope refactoring.
* Targeted and full verification.
* Adversarial self-review and repairs.
* Atomic commits and non-force push.
* A normal **non-draft PR** when review-ready.
* Monitoring and repair of in-scope hosted CI failures.

Existing security controls and environment denials must not be bypassed.

A genuinely blocked environment or authorization boundary requires a documented HOLD with preserved state.

### Loop 3 — Verify

A fresh independent reviewer examines the exact PR head and base, approved specification, diff, automated/native/manual evidence, security, accessibility, and regression risks.

Findings are classified as Blocker, Should Fix, or Observation.

Changes to requirements return to Loop 1. Implementation defects return to Loop 2.

Human authorization is required before merge.

After an authorized merge, verify the integrated commit and update the ledger/Linear records within authorized scope.

## 12. Approval record

### Approved product decisions

1. Completed jobs appear in a distinct Completed-this-session section.
2. Completed jobs are removed from the active session list but retained in authoritative session state.
3. No automatic navigation occurs on completion.
4. Existing Converted navigation provides the required destination; a contextual shortcut is optional.
5. Demonstration-only Search, filters, and sorting remain independent.
6. Session data survives navigation but resets on fresh application launch.
7. Native Electron verification remains a required independent acceptance gate.
8. Full exact-revision automated verification is required under WF-AC13.

### Current disposition

**Specification:** Human-approved v0.3.1, November 3, 2026; approval does not authorize code changes.

**Implementation:** Not authorized.

**PR/integration:** Not authorized.

**Reference provenance:** Historical observations remain bounded; no new AudFree behavior is asserted.

**Continuity:** The Codex-reported v0.2/v0.3 comparison identified the missing explicit verification criterion and completed-membership wording. Both are addressed in this revision. No independent line-by-line reproduction of the full v0.2 document is claimed here.
