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
| `PARITY_MATRIX.md` | Capability ledger | Current | Reference status, implementation status, acceptance evidence, and open gaps |
| `EVIDENCE_CAPTURE_PLAN.md` | Evidence procedure | Current | Bounded, non-destructive reference observation rules |
| `evidence/evidence-manifest.json` | Evidence register | Append-only | Evidence provenance, confidence, unresolved behavior, and safety boundaries |

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
