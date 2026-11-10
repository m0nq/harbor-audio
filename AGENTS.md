# Harbor Audio Working Agreement

Harbor Audio is an original, privately developed desktop application pursuing
workflow parity with bounded observations of AudFree, within authorized
security and media-use boundaries. Its present implementation is a deterministic,
fixture-only Electron scaffold, not a finished media product; a future real-media
workflow requires separate specification and explicit authorization. Tracking
work in Cloud City's CLO workspace does not by itself establish product ownership.

The product is informed by bounded observations of an external application. It
is not an official AudFree product, integration, provider client, or production
media converter.

Do not access real AudFree accounts, credentials, personal application
profiles, or personal media. AudFree references are bounded external evidence
only; they do not authorize access to AudFree systems or expand Harbor Audio's
implementation scope.

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
- Preserve the approved Converted sorting behavior: Title, Artist, Album, and
  Duration sort ascending first and toggle on repeated activation; Artist,
  Album, and Duration ties use Title A-Z, Title ties use Artist A-Z, exact
  ties retain source order, invalid or missing durations sort last, sorting
  does not mutate fixtures or filter membership, and sort state resets on a
  fresh launch. This is current implementation and acceptance behavior, not
  retroactive scope for the historical filtering SDD.

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

Codex may also perform ordinary, justified, in-scope refactoring when it
preserves the approved contracts and file scope. New frameworks, dependencies,
security-policy changes, or material architectural changes require separate
authorization.

Use existing TypeScript, pnpm, JSDOM, Electron, and test conventions. Ordinary
internal abstractions and refactoring are allowed when justified, in scope, and
contract-preserving. Do not introduce new frameworks, dependencies, IPC,
network behavior, security-boundary changes, material architecture, or
unrelated refactors without separate authorization.

### Loop 3 — Verify and review

A fresh, independent reviewer must adversarially inspect the actual current PR,
approved specification revision, implementation evidence, diff, tests,
security boundaries, and acceptance claims. Implementer intent and reports are
inputs, not proof. Classify findings as **Blocker**, **Should fix**, or
**Observation**. Return implementation defects to Loop 2 and material
requirement or authority changes to Loop 1. Reverify the updated PR head and
base SHAs and all affected required checks before issuing acceptance. Perform
risk-based QA, record lessons learned, and issue a human-facing GO/HOLD
recommendation; human merge approval remains separate.

## Automated-first QA cadence

For routine, low-risk, explicitly authorized development slices, run exact-SHA
typecheck, build, all applicable domain/Node/JSDOM/regression tests, and the
**complete applicable isolated real Electron E2E suite**, including all affected
native workflows, before fresh independent review. Targeted scenarios support
diagnosis but never replace the complete required suite. Missing required native
checks are HOLD, not PASS. Do not weaken or skip tests to achieve a favorable
disposition. A non-draft PR is the normal review-ready handoff when required
gates are satisfied; drafts require explicit direction.

Consolidate physical keyboard, VoiceOver where warranted, visual/usability, and
separately authorized real-I/O QA at a named feature-complete or release-candidate
milestone. Require an earlier *targeted* human check for consequential risk
that automation cannot sufficiently address, including data loss, security,
OS integration, major UX changes, confusing primary journeys, or major
regressions. Record the rationale, owner, exact affected revision, and expected
milestone. Report omitted or deferred manual checks as NOT TESTED or DEFERRED,
never PASS. A **required** early human check that fails, is unperformed, or remains
unresolved is **HOLD** unless a separately human-approved, evidence-backed scoped
exception explicitly changes that gate. Deferral alone cannot establish GO.
A green development slice is not milestone product acceptance.

The **approved versioned feature/native acceptance contract still controls**.
HARBOR-NATIVE-01 v0.2 remains binding for its existing scope until a
human-approved v0.3 amendment or documented exception becomes effective.
Prospective proposals in CLO-175 and CLO-176 do not retroactively satisfy
PR #3/#4 manual gates or authorize changed application behavior. Hosted CI,
branch protection, integration and human merge approval remain separate.

## Change-control authority

- Read-only investigation and recommendations do not authorize edits.
- One explicit, traceable human authorization for a bounded batch must identify
  the approved outcome, file and behavior scope, permitted operations, and
  applicable restrictions. It may cover creation of a dedicated branch,
  implementation, commit, push, pull-request creation, and ordinary in-scope
  PR repair without requiring fresh approval for each correction. Escalate new
  requirements, consequential scope expansion, unauthorized Git operations,
  and changes to security or architecture boundaries. A safety hook may still
  require direct confirmation for an exact remote export; that requirement
  remains controlling.
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

Every implementation handoff must identify the approved specification revision,
explicit implementation authorization, exact base and current PR head SHAs,
affected checks, and the independent Loop 3 acceptance boundary. A draft PR,
implementer report, or passing local check is not independent acceptance.

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
