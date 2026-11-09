# HARBOR-NATIVE-01 v0.3 — Automated-First Native and Milestone Acceptance

**Status:** Loop 1 amendment candidate; authorized for specification installation and independent review on November 9, 2026. Exact wording and amendment acceptance remain subject to human approval after review. **Not an implementation, merge, or retrospective acceptance authorization.**

**Linear:** [CLO-175](https://linear.app/cloud-city-fest/issue/CLO-175/adopt-automated-first-qa-cadence-with-milestone-based-manual), [CLO-160](https://linear.app/cloud-city-fest/issue/CLO-160/restore-repeatable-native-electron-and-accessibility-acceptance).  
**Baseline:** [HARBOR-NATIVE-01 v0.2](HARBOR-NATIVE-01-v0.2.md) from PR #4, head `18d59022203759c627f88b7d246d79c60b614823`.  
**Contract relationship:** This amendment changes the prospective *timing and disposition* of manual usability/accessibility checks only. It does not erase v0.2 evidence or relax its native runtime, provenance, process-cleanup, or security requirements. Until approved and effective, v0.2 controls.

## 1. Outcome and acceptance layers

Deliver routine, low-risk application slices using rigorous automated-first proof, avoiding repeated human keyboard/VoiceOver handoffs while preserving human acceptance of the overall product.

1. **Review-ready:** Implementation is complete, tests and evidence are assembled, and a non-draft PR is suitable for fresh independent review. This is not independent approval.
2. **Development-slice GO:** An independent reviewer examines the exact current PR head/base, approved behavior contract, complete diff, automated/native evidence, security, accessibility and regression risks, and unresolved findings. All required technical gates pass and any targeted early manual exception is resolved or explicitly dispositioned. GO does not equal product milestone acceptance.
3. **Milestone product acceptance:** The owner reviews the named feature-complete or release-candidate journey, including consolidated usability and warranted human accessibility checks. This is separate from integration and merge.
4. **Integration:** Human merge authorization remains distinct. Reverify review head/base, protections and required checks before merging; after merge verify the target SHA and checks.

## 2. Mandatory exact-SHA development gate

At the final reviewed commit:

- Record repository/worktree, base and head SHAs, changed paths/status, approved spec revisions, platform, toolchain and actual commands/results. Identify fresh versus historical evidence.
- Pass full applicable TypeScript typecheck, build, Node/JSDOM unit/integration/regression tests, and **real isolated Electron E2E for every affected native workflow**. Include relevant negative cases, focus/keyboard automation, empty states, and semantic/accessibility regressions.
- Preserve existing native-artifact provenance and verification (physical executable path, architecture, UUID/SHA-256), isolated test-owned `userData`/`sessionData`, verified ownership of processes and safe cleanup, and retained sanitized diagnostics when appropriate, as specified in v0.2.
- Treat missing required native execution, pre-renderer abort, unsafe cleanup, unexplained provenance or persistent required-check failure as **HOLD**, not PASS. A Node binary/version probe does not establish GUI acceptance.
- Require fresh adversarial independent review, classifying findings **Blocker / Should Fix / Observation**; repair in-scope defects, rerun affected checks and re-review the current head. Hosted CI is not green if the required run/check never existed.
- Never weaken tests or expand dependency, network, media, credential, signing, sandbox or security authority to obtain a green outcome.

## 3. Manual QA cadence

**Default:** Human hands-on keyboard, VoiceOver and general usability testing are consolidated at the named **Primary Journey Feature-Complete** milestone and at any later release candidate, rather than automatically required for each otherwise-green low-risk PR.

**Early targeted exception:** A scoped human check is required when automation cannot responsibly resolve a material data-loss, credential/security, OS-integration, native permission, significant accessibility, major workflow-change, confusing primary journey, or high-severity regression risk. State the exact unautomatable question, owner, affected SHA, expected observations and stop conditions. CLO-176's first redesigned primary journey is a specific candidate for a *single targeted human usability check* once its automated/native implementation passes, before treating the major UX change as product-accepted.

**Manual evidence record:** For each relevant keyboard, VoiceOver, screen-reader, visual, real-I/O or usability lane, record **PASS / FAIL / NOT TESTED / DEFERRED**, the owner, risk/rationale, and next due milestone. Never infer physical keyboard or VoiceOver proof from JSDOM or Playwright events. No automatic substitution of manual evidence with native automation.

**Milestone acceptance:** A feature-complete/release-candidate review exercises the actual primary journey, discoverability, visual feedback, physical keyboard, focus behavior, VoiceOver where warranted, and authorized real-I/O only if separately in scope. Findings may reopen Loop 1 or Loop 2.

## 4. Historical records and scoped exceptions

The reported PR #4 `18d5902` results (157/157 Node/JSDOM and 16/16 real Electron E2E, plus two bounded physical keyboard passes) are historical reported evidence, not reruns under this amendment. Undiscoverable session workflow and unperformed VoiceOver remain **NOT TESTED / unresolved**, not PASS. PR #3/#4 preserve their v0.2-era requirements until this amendment or an expressly approved, evidence-backed scoped exception becomes effective. No retrospective acceptance or merge authority is granted.

## 5. Explicit non-goals and approval

No changes to Electron runtime, dependency policy, source/format support, fixture behavior, user profiles, app network behavior, security hooks, CI workflow, branch protections, release/signing, or application code. HARBOR-CI-01 and CLO-161 retain separate approvals.

**Review checklist:** Compare every v0.2 control; confirm no silent gate removal; verify that “review-ready,” “development GO,” “milestone accepted” and “integrated” remain distinct; resolve any conflict with HARBOR-WORKFLOW-02 WF-AC11/WF-AC13; identify owner of the Primary Journey Feature-Complete milestone; obtain human approval of the precise amendment before activation.
