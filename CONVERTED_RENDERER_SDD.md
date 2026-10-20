# Converted Renderer Filtering SDD

## Objective and scope

Add a fixture-only, accessible Artist/Album filtering experience to the Converted view while preserving the Converting view's existing status filter and Search contract. Use the established pure Converted membership projection and existing fixture Search function. This is reference-informed functional parity, not pixel-for-pixel reproduction or proof of complete AudFree parity.

## Evidence and product decisions

| Classification | Contract |
| --- | --- |
| Reference-confirmed (`EV-FILTER-004`) | Converted exposes primary `All`, `Artist`, and `Album` dimensions; inclusive Artist/Album values preserve the tested membership and order; the tested specific Artist restricted membership and included collaborations. |
| Reference-confirmed (`EV-FILTER-006`) | The tested specific Album restricted membership, included tracks with different displayed artists, and preserved relative order. |
| Reference-confirmed (`EV-FILTER-007`, `EV-FILTER-008`) | Search intersected with the tested specific Album and Artist selections; the selected value remained active; clearing Search restored the tested membership. |
| Reference-confirmed, bounded | The tested no-match states displayed “It's empty here.” The message is not a universal empty-state contract. |
| Approved UX decision | Use visibly labeled native controls, a concise result count, distinct contextual empty states, and a Clear Search recovery action. Preserve focus/caret while Search results update. These are product choices, not observations of AudFree's visual design or accessibility. |
| Approved fixture-local decision | Use a separate synthetic Converted demonstration dataset; explicit Artist credits and a single Album value used for both display and filtering; sorted/deduplicated selector values; preserve Converted selection across in-session view navigation. No disk persistence. |
| Unresolved | Exact reference matching/normalization, broader Search semantics, universal empty-state/sort behavior, cross-view or relaunch persistence, and complete reference parity remain unknown. |

## Interaction contract

- Converted has a primary native select with `All`, `Artist`, and `Album`. `All` hides the secondary select. Artist shows `All Artists` followed by specific Artist credits; Album shows `All Albums` followed by specific Albums.
- Changing dimension chooses the corresponding inclusive value. Choosing a specific value filters only Converted demonstration entries. Search composes with that membership using the existing fixture-local title/creator/collection substring behavior; this does not assert that the algorithm matches AudFree.
- Clearing Search changes only the shared Search text. It preserves the Converted dimension/value and restores the membership projection in source order.
- The first Converted visit starts at `All`. Converted dimension/value state is in-memory renderer state and survives navigation among Browser, Converting, and Converted. It is separate from Converting's `QueueQuery.filter`. Existing Search text remains shared/persistent across navigation; Converting's status filter retains its existing navigation-reset behavior.
- A visible result count reflects the displayed rows. Empty presentation distinguishes: no Converted demo data; an empty selected membership; and a non-empty membership with zero Search matches. The Search-empty case includes a keyboard-operable Clear Search button.
- Specific selector values are deduplicated and ordered by a fixed `en-US` collator with base sensitivity, then raw code-unit order as a deterministic tie-breaker. Inclusive values are first. Track rows retain dataset source order; this slice adds no sorting control or sorting behavior.
- The Converted table, options, count, and empty state derive from one dedicated synthetic dataset. Its displayed Album is the same value as filter metadata; a missing Album is displayed as `—`. Artist membership uses explicit credits, never parsed creator text. The canonical workflow snapshot and its queue membership remain unchanged.

## Renderer and accessibility design

- Keep the existing Browser/Converting/Converted shell and single fixture IPC boundary. Do not add network, IPC, or provider capabilities.
- Keep full-shell rendering for navigation. On Search input, update only the Converted/Converting result region and the narrow result-status text; do not replace the Search node or its toolbar. On dimension changes, preserve the primary select, replace only the dependent secondary control, and update results. Bind control listeners to the current rendered elements without accumulating listeners.
- Use native `select`, `input type="search"`, `button`, `label`, `table`, and `caption` semantics. Keep visible focus styling and a logical DOM/tab order. The result count/status is a stable, concise `role="status"` region; the entire app root is not live. JSDOM verifies markup and DOM/focus behavior only; it is not real macOS screen-reader validation.
- Normative guidance: WCAG 2.2 keyboard access (2.1.1), logical focus order (2.4.3), visible focus (2.4.7), and status messages (4.1.3). Native HTML labels are preferred over custom ARIA where they meet the need. Apple HIG searching, labels, and focus guidance inform UX choices, not conformance claims.

## Acceptance and regression criteria

1. Synthetic Converted records demonstrate multiple Artists, explicit collaborator credits, shared Albums, one Artist across Albums, unrelated records, missing metadata, duplicate selector values, and a stable source order; displayed Album and filter Album agree.
2. All/All Artists/All Albums preserve Converted membership. Specific Artist/Album values return the expected records, exclude unrelated and non-Converted records, and preserve source order without mutating fixture data.
3. Primary/secondary option labels, inclusive-first placement, alphabetical specific values, deduplication, conditional secondary visibility, and selection changes are observable through the renderer.
4. Search intersects with both specific dimensions, preserves the selection, and clearing Search restores the selected membership and source order.
5. Converted selection survives view navigation; first visit is All. Converting retains its six existing status choices, filtering behavior, Search behavior, and separate state.
6. The visible result count matches rendered rows. Empty data, empty membership, and Search-no-match states are distinct; Search-no-match offers Clear Search and preserves the selected value.
7. Labels are associated with native controls; controls are keyboard-operable; Search input identity, focus, and caret remain stable across consecutive input events; repeated interactions do not create duplicate controls/listeners.
8. Existing fixture-only network/IPC guards and protected domain status/Search tests continue to pass. Existing renderer assertions that require a Converted status selector are explicitly migrated to the approved dimension/value contract.

## Out of scope and unresolved behavior

No table sorting controls or sorting infrastructure; no Search normalization/matching changes; no general filter framework; no real media, conversion, authentication, provider, DRM, network, or new IPC behavior; no disk persistence; no Electron launch remediation; no Browser/Converting redesign; no general responsive redesign; no claim of macOS runtime or screen-reader verification. AudFree's exact Artist/Album algorithms, general Search rules, universal empty-state presentation, and cross-view/relaunch persistence remain unresolved.

## Validation sequence

Write compiled-renderer acceptance tests first and demonstrate genuine failures against the current renderer. Then implement the smallest fixture, renderer, and style changes. Run focused renderer and domain tests, `pnpm run typecheck`, `pnpm test`, and `git diff --check`. Review the complete diff and verify only the SDD, promoted synthetic demo fixture/test adapter, renderer/assets, and relevant tests changed; do not stage or commit.

## Authoritative accessibility guidance

- [WCAG 2.2](https://www.w3.org/TR/WCAG22/), Success Criteria 2.1.1, 2.4.3, 2.4.7, and 4.1.3.
- [WAI-ARIA APG: Providing Accessible Names and Descriptions](https://www.w3.org/WAI/ARIA/apg/practices/names-and-descriptions/); prefer native labeling techniques.
- [WAI-ARIA technique ARIA22: `role="status"`](https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA22).
- [Apple HIG: Searching](https://developer.apple.com/design/human-interface-guidelines/searching), [Labels](https://developer.apple.com/design/human-interface-guidelines/labels), and [Focus and selection](https://developer.apple.com/design/human-interface-guidelines/focus-and-selection/).
