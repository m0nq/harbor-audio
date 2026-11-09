# Harbor Audio specification index

Harbor Audio is an internal Cloud City desktop product in the Cloud City
workspace and CLO team. This index distinguishes normative repository rules,
current implementation contracts, historical reference evidence, and
verification records. It does not replace the linked documents.

| Document | Authority | Status | Scope |
| --- | --- | --- | --- |
| `AGENTS.md` | Repository working contract | Normative | Three-loop engineering, authorization, security, and evidence rules |
| `README.md` | Project overview | Current | Ownership, mission, capabilities, boundaries, and commands |
| `DEPENDENCY_POLICY.md` | Dependency policy | Normative | Exact pins, lockfiles, installs, lifecycle scripts, and native artifact boundaries |
| `CONVERTED_RENDERER_SDD.md` | Accepted feature SDD | Historical, scope-limited | Converted Artist/Album filtering contract and its bounded acceptance criteria |
| `PARITY_MATRIX.md` | Capability ledger | Current; implementation-status reconciliation required | Reference status, implementation status, acceptance evidence, and open gaps |
| `EVIDENCE_CAPTURE_PLAN.md` | Evidence procedure | Current | Bounded, non-destructive reference observation rules |
| `evidence/evidence-manifest.json` | Evidence register | Append-only, traceability-preserving | Evidence provenance, confidence, unresolved behavior, and safety boundaries |

## Cross-branch versioned contracts (not yet integrated)

The approved [HARBOR-WORKFLOW-02 v0.3.1 contract in PR #3](https://github.com/m0nq/harbor-audio/pull/3)
and [HARBOR-NATIVE-01 v0.2 in PR #4](https://github.com/m0nq/harbor-audio/pull/4)
currently reside on open, unmerged feature branches; they are not repository-relative
files in `main` or this governance PR. Their absence here does not cancel their
approved acceptance obligations. Proposed [native v0.3 in PR #5](https://github.com/m0nq/harbor-audio/pull/5)
and [UX/workflow v0.1/v0.4 in PR #6](https://github.com/m0nq/harbor-audio/pull/6)
are separate **unapproved** amendments, not active contract replacements.
Use the exact reviewed PR revisions for provenance and update this index with
repository-relative paths only after a separately authorized integration.

The parity matrix remains valid historical reference evidence where it records
reference observations and linked evidence IDs. Its implementation-status
fields require reconciliation against current source and acceptance evidence
before they are treated as current status. This reconciliation must not
invalidate or silently rewrite the historical reference observations.

The evidence manifest is preserved as a traceable historical register. A record
that is genuinely erroneous may be corrected only through explicit review with
an auditable reason and provenance; silent rewriting is not permitted.

## Evidence vocabulary

Use separate classifications in reviews and capability records:

- **Reference observation** — bounded evidence captured from the external
  reference application or its static artifacts.
- **Simulation** — deterministic fixture behavior that models a product state
  without performing the real operation.
- **Source implementation** — behavior present in Harbor Audio code, regardless
  of whether it has been independently accepted.
- **Automated acceptance** — a passing domain, Node, JSDOM, or scripted test.
- **Native acceptance** — a passing isolated Electron desktop harness run.
- **Manual accessibility QA** — physical keyboard, VoiceOver, screen-reader,
  or other human acceptance; never inferred from JSDOM.

These classifications must not be collapsed into a single parity claim.
Unknown reference behavior remains unknown even when a local simulation exists.

## Linear continuity

Harbor Audio belongs in the existing Cloud City workspace and CLO team. Its
proposed initiative is **Harbor Audio — Verified Functional Parity**. Future
Linear records should receive native `CLO-*` identifiers from Linear and retain
historical `HARBOR-*` milestone references in their descriptions. This index
does not create or update Linear records.

`CONVERTED_RENDERER_SDD.md` remains historically scoped to Converted filtering.
It does not claim to have originally specified later sorting, Browser session
queue insertion, or lifecycle work.

Converted sorting is a later current implementation and acceptance contract,
supported by source behavior and tests. This index does not invent or
retroactively attribute a sorting specification to the historical filtering
SDD. A future dedicated sorting specification or decision record requires
explicit authorization.

## Review handoff and acceptance boundary

Each implementation handoff records the approved specification revision,
explicit implementation authorization, exact base SHA and current PR head SHA,
affected checks, and the independent Loop 3 acceptance status. A draft PR or
implementer report does not constitute independent acceptance; human merge
approval remains a separate decision.
