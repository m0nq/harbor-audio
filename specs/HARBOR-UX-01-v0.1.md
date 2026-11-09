# HARBOR-UX-01 v0.1 — Simple Synthetic Browser-to-Converted Journey

**Status:** Loop 1 specification candidate; authorized for documentation and independent review November 9, 2026. Exact behavioral contract and implementation remain subject to separate approval.  
**Linear:** [CLO-176](https://linear.app/cloud-city-fest/issue/CLO-176/simplify-harbor-audios-primary-browser-to-converted-user-journey).  
**Implementation baseline:** PR #4 head `18d59022203759c627f88b7d246d79c60b614823`, incorporating PR #3 head `51b7580ac26b670309425b78bafaa6ad80ed3fb5`.  
**Related approved contract:** [HARBOR-WORKFLOW-02 v0.3.1](HARBOR-WORKFLOW-02-v0.3.1.md); proposed companion amendment [v0.4](HARBOR-WORKFLOW-02-v0.4-amendment.md).

## 1. Outcome

A first-time user recognizes how to add a local sample item, finds the current-session queue, explicitly completes a **simulation**, and sees a single truthful completed-session record in Converted. The experience must not require knowing engineering fixtures, navigating competing lifecycle demonstrations or performing repeated status-debug actions.

The application performs **no audio conversion or file output**. “Completed” describes only a simulated session record.

## 2. Evidence and epistemic boundary

- **Observed reference:** EV-UI-001/002 show Browser and separate Converting/Converted areas; EV-CONVERSION-001 shows partial conversion and history; EV-WORKFLOW-001 leaves retry/cancel unknown.
- **Observed Harbor usability:** The owner passed bounded navigation and Converted interactions at PR #4's exact head but could not confidently find the add/advance journey.
- **Implemented Harbor source:** Converting simultaneously shows a canonical fixture list, separate session queue additions, and standalone “Demo lifecycle”; Converted separates completed-session results from synthetic demonstration history.
- **Unknown reference:** Original source-to-queue gesture, full transition sequence, timing/progress, keyboard behavior and retry/cancel semantics. The proposed UX is an **original Harbor decision**, not proof of AudFree parity.

## 3. Candidate primary journey

### Browser — select and add

- Each sample source has one clear, consistently placed primary **Add to queue** action, with a source-specific accessible name.
- Success shows inline feedback and a discoverable **View queue** destination. Repeated insertion does not create duplicates; the row communicates “Added” without relying only on color.
- No automatic progression or hidden media access.

### Converting — current session first

- The **Current session** section is visually and semantically primary; present active session items and one action per eligible item: **Simulate completion**.
- One activation applies the validated Waiting → Analyzing → Converting → Converted *domain transition sequence* to that selected item, without a fake timer, auto-progress claim or intermediate user-action requirement.
- Perform one visible completion update and one meaningful accessible announcement. The completed row leaves the active view, authoritative `SessionQueueState` retains it, and focus moves predictably to a surviving action or status/destination.
- Existing canonical queue data and standalone lifecycle demo remain available but visually secondary and explicitly labeled **Example data / Developer demonstration**. Avoid adding a new tab, framework or data model.
- An empty current session offers a clear route to Browser; an all-completed session offers a route to Converted.

### Converted — session result first

- Display **Completed this session** first, with stable title, source association, session insertion order and **“Simulated only — no output file created.”**
- Synthetic demonstration history remains separately labeled. Its existing Artist/Album filtering, Search, sorting, counts, focus/caret and source order are not changed by current-session results.
- Do not imply that a result is playable, downloadable, processed or persisted.

## 4. Protected invariants, negative states and errors

- `SessionQueueState` remains the single authority; completion history is a projection, not another mutable collection. Keep stable `id`, `sourceItemId`, immutable transitions and deterministic insertion order.
- Invalid/unknown IDs, repeated additions, repeated or terminal completion attempts, and stale actions are non-mutating; don't double-announce completion.
- Multiple jobs progress independently; completion order can differ from insertion order without changing Completed-this-session ordering.
- Navigation preserves the session; fresh launch resets session records. Existing canonical fixture identities, status projections and demonstration datasets remain intact.
- Respect semantic headings, tables, labels and buttons; keyboard operability, visible focus, predictable focus recovery, scoped live announcements, clear empty states and non-color-only state communication.
- No new dependency, framework, IPC, filesystem, network, provider, account, DRM, real-media import/export, download, persistence, signing or packaging capability.

## 5. Acceptance criteria

| ID | Requirement | Minimum proof |
| --- | --- | --- |
| UX-AC01 | Obvious accessible sample-add action and feedback; contextual queue path | Renderer and native E2E |
| UX-AC02 | Duplicate/invalid add leaves session unchanged and provides understandable state | Domain and renderer |
| UX-AC03 | Current-session primary action completes **only selected item** in one explicit gesture, preserving validated internal transition order | Domain, renderer and native E2E |
| UX-AC04 | Exactly one record is derived in Converted; active row disappears without lost focus or duplicate speech | Domain, renderer, native and focused a11y checks |
| UX-AC05 | No output file is claimed; empty/reset/completion messages are truthful and actionable | Renderer, native |
| UX-AC06 | Multi-item ordering, IDs, canonical fixtures and independent demo history/filter/search/sort do not regress | Domain and regression tests |
| UX-AC07 | Labels, focus, keyboard and announcement behavior are accessible under automated and risk-based manual gates | JSDOM, native, milestone/human exception |
| UX-AC08 | Full exact-head typecheck, build, Node/JSDOM tests, applicable real Electron E2E, independent review, and explicit evidence provenance | Loop 3 |
| UX-AC09 | A targeted human first-journey discovery check after automated/native acceptance confirms usability, followed by named milestone review | Human, separately recorded |

## 6. Integration and human decisions

This change explicitly amends the per-activation behavior of HARBOR-WORKFLOW-02 v0.3.1 §3.2 / WF-AC04; see the companion v0.4 amendment. No implementation until the human approves that change and the narrow file/behavior scope. Keep PR #3/#4 unmodified during discovery and preserve their test and acceptance provenance. Implement as a separate bounded slice against a reconciled integration base.

After the primary journey direction is approved, CLO-176 calls for a **separate specification-only Linear issue** for the first authorized real user-owned, DRM-free local media source-to-output workflow. It is not included here and must not be created before that explicit trigger.

**Open review questions:** Whether a single action is more discoverable than repeated advancement; whether secondary fixture surfaces should remain visible or use accessible disclosure; whether screen-reader announcement duplication is prevented on the actual macOS runtime; and whether the targeted usability check demonstrates successful first-use discovery without prompting.
