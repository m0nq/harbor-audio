# HARBOR-WORKFLOW-02 v0.4 — Proposed Primary-Journey Amendment

**Status:** Loop 1 candidate for independent review and explicit human approval; **not effective** until approved. No implementation authorization.  
**Baseline:** [HARBOR-WORKFLOW-02 v0.3.1](HARBOR-WORKFLOW-02-v0.3.1.md), PR #3 head `51b7580ac26b670309425b78bafaa6ad80ed3fb5`.  
**Reason:** [CLO-176](https://linear.app/cloud-city-fest/issue/CLO-176/simplify-harbor-audios-primary-browser-to-converted-user-journey) and [HARBOR-UX-01 v0.1](HARBOR-UX-01-v0.1.md).  
**Historical rule:** v0.3.1 remains intact and controlling until this amendment is approved. Existing evidence, tests and integration obligations are not retroactively reclassified.

## 1. Intent

Replace the product requirement that a user activate the same session job three separate times to complete a fixture simulation. Retain the deterministic state machine, identity/order guarantees, accessibility, separate histories and truthfulness.

## 2. Exact proposed modifications

### Section 3.2 — User-facing transition behavior

**Supersede only these sentences once this amendment is approved:**

> A session job advances only through an explicit user action.  
> Each action advances exactly one eligible job by one state.

**Proposed replacement:**

> A user deliberately initiates a fixture-only session completion for one eligible selected job through one clearly labeled **Simulate completion** action. An eligible job may currently be Waiting, Analyzing, or Converting. The operation follows **only the remaining valid forward transitions** from that job's current state through Converted, using the validated Waiting → Analyzing → Converting → Converted state machine; it must not rewind or reapply previously completed transitions. The selected job alone changes immutably, retaining stable identity and insertion order. Converted and Failed jobs are terminal: unknown IDs, repeated, stale, duplicate, Failed or Converted activations make no state change and no additional completion announcement. Do not display artificial timed progress, require an intermediate user action, or claim real media processing or output. Successful completion produces one truthful user-visible outcome and one meaningful announcement, without duplicate speech.

The existing statements prohibiting automatic media processing, timers, progress percentages, failure injection and side effects remain binding. The internal transitions must remain independently testable.

### WF-AC04 — Replacement criterion

> One explicit **Simulate completion** activation for a selected job in Waiting, Analyzing or Converting follows exactly the remaining valid forward transitions and completes that job only; its record appears exactly once in Converted, without mutating other jobs or duplicating an announcement. Already Converted, Failed, unknown and stale actions are non-mutating.

**Verification:** domain transition tests, renderer journey, real Electron E2E.

### WF-AC11 — QA cadence clarification (conditional)

Preserve accessible completion announcements, focus recovery, semantics and native keyboard automation. A targeted human first-use check of the redesigned primary journey must include physical keyboard behavior after automated/native proof; assess the known possible duplicate completion-announcement risk, including focus moving to a live status region. Before the targeted check, explicitly decide whether VoiceOver is required at this early gate. If warranted, test and record its actual result; if deferred under the binding approved QA contract, record NOT TESTED / DEFERRED, responsible human owner, risk rationale and named milestone. Do not claim assistive-technology PASS from JSDOM or Playwright. Apply [HARBOR-NATIVE-01 v0.3 proposal on CLO-175](https://linear.app/cloud-city-fest/issue/CLO-175/adopt-automated-first-qa-cadence-with-milestone-based-manual) *only when independently approved and effective*. Until then, manual accessibility requirements in v0.3.1 and v0.2 remain controlling; any required unresolved early manual gate is HOLD absent a separate approved exception.

### WF-AC13 — No waiver

Maintain exact-head typecheck/build, complete applicable Node/JSDOM tests, real Electron E2E and provenance. Missing required native proof is HOLD; no documented QA claim is upgraded retroactively. Independent review and human merge approval remain separate.

## 3. All other requirements remain

WF-AC01–03, WF-AC05–10, WF-AC12, all source/session metadata, multiple independent jobs, insertion-order history, duplicate prevention, navigation lifetime, canonical/demo isolation, security, accessible copy and non-media-output invariants remain unchanged. The standalone lifecycle demonstration may remain a separately presented developer/sample aid; its own internal transitions are not silently modified.

## 4. Review and approval boundary

Review the proposed single-action behavior adversarially for accidental auto-processing claims, lost focus, double announcements, stale actions and unintended history mutations. Obtain explicit human acceptance of the exact versioned contract before Codex application changes. Install as a prospective amendment, not a rewrite of v0.3.1.
