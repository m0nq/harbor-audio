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

> A user deliberately initiates a fixture-only session completion for one eligible selected job through one clearly labeled **Simulate completion** action. That operation follows the validated Waiting → Analyzing → Converting → Converted transition order internally, without presenting artificial timed progress or requiring a distinct user action at each intermediate status. It must preserve immutable state, stable identity and insertion order and may change only the selected job. Unknown IDs, duplicate or terminal actions are non-mutating; no real media processing or output occurs. On successful completion, render one truthful completion outcome and no duplicated announcement.

The existing statements prohibiting automatic media processing, timers, progress percentages, failure injection and side effects remain binding. The internal transitions must remain independently testable.

### WF-AC04 — Replacement criterion

> One explicit **Simulate completion** activation for an eligible selected session job applies the validated intermediate state transitions exactly once, without changing any other job; successful completion is reflected once in Converted. Subsequent or terminal activation is non-mutating.

**Verification:** domain transition tests, renderer journey, real Electron E2E.

### WF-AC11 — QA cadence clarification (conditional)

Preserve accessible completion announcements, focus recovery, semantics and native keyboard automation. Apply [HARBOR-NATIVE-01 v0.3](HARBOR-NATIVE-01-v0.3.md) *only when independently approved and effective*, including targeted human discovery QA for the major UX change and milestone VoiceOver review as warranted. Until that policy amendment takes effect, the manual accessibility requirements in v0.3.1 and v0.2 remain controlling.

### WF-AC13 — No waiver

Maintain exact-head typecheck/build, complete applicable Node/JSDOM tests, real Electron E2E and provenance. Missing required native proof is HOLD; no documented QA claim is upgraded retroactively. Independent review and human merge approval remain separate.

## 3. All other requirements remain

WF-AC01–03, WF-AC05–10, WF-AC12, all source/session metadata, multiple independent jobs, insertion-order history, duplicate prevention, navigation lifetime, canonical/demo isolation, security, accessible copy and non-media-output invariants remain unchanged. The standalone lifecycle demonstration may remain a separately presented developer/sample aid; its own internal transitions are not silently modified.

## 4. Review and approval boundary

Review the proposed single-action behavior adversarially for accidental auto-processing claims, lost focus, double announcements, stale actions and unintended history mutations. Obtain explicit human acceptance of the exact versioned contract before Codex application changes. Install as a prospective amendment, not a rewrite of v0.3.1.
