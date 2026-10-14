# Evidence capture plan

Capture baseline: `fixture-baseline-2026-10-12`

This plan is limited to read-only observation of the installed reference app. It does not authorize queue insertion, Retry, Cancel, Stop, login, account, download, export, conversion, or save actions. If a precondition is not met or a control cannot be observed without activation, stop and retain the capability as unknown.

## Complete live filter option set

- Preconditions: Reference app is already open on the converting or converted view; no account or source interaction is required.
- Safe observation: Read the accessibility tree or screenshot while the filter control is closed; if a non-activating focus or hover state exposes the option list, record only visible labels.
- Prohibited action: Do not select a filter option, type into Search, or activate any queue control.
- Expected evidence artifact: Sanitized accessibility snapshot or screenshot listing the complete live filter labels, with no account/session data.
- Stop condition: The menu does not expose its options without activation, or two observation attempts leave the state unclear.
- Current status: Partial but vocabulary-confirmed for one state; the October 14, 2026 human-reviewed screenshot showed the expanded Converting-view filter with `All`, `Artist`, and `Album` in that order while the selected value remained `All` and the queue displayed `Files: 0` (`EV-FILTER-003`). No option was selected and no conversion or other application-data mutation occurred. The earlier closed-state observations remain historical and unchanged (`EV-FILTER-001`, `EV-FILTER-002`).
- Interpretation boundary: Record `All`, `Artist`, and `Album` as visible filter vocabulary only; do not interpret them as conversion statuses or infer filtering/grouping behavior.
- Remaining unknowns: What `Artist` and `Album` do, filtering versus grouping semantics, behavior with populated queues, whether other views expose identical options, and whether selection persists across navigation.

## Retry and cancellation affordances

- Preconditions: A reference row is already in an active or failed state; do not create a new task.
- Safe observation: Inspect the accessibility tree and screenshot for visible or focusable Retry, Cancel, Stop, or equivalent controls.
- Prohibited action: Do not activate any action, open a confirmation dialog, remove a row, or change queue state.
- Expected evidence artifact: Sanitized row-level accessibility snapshot showing control presence or absence and its state.
- Stop condition: The control is only visible after activation, hover, or a state-changing gesture.
- Current status: Unknown; failed rows were visible but no safe Retry or cancellation affordance was confirmed (`EV-WORKFLOW-001`).

## Output settings, filename/path rules, and lyrics representation

- Preconditions: A read-only settings surface is already available without account or conversion state changes.
- Safe observation: Inspect labels, default values, and static help text only; record whether lyrics are described as embedded, sidecar, optional, or unavailable.
- Prohibited action: Do not open a folder chooser, change a setting, save settings, export a file, or start conversion.
- Expected evidence artifact: Sanitized settings accessibility snapshot or static evidence excerpt with paths, personal directories, and tokens removed.
- Stop condition: Accessing the settings surface requires a mutating control or exposes user-specific paths.
- Current status: Inferred from static evidence only; exact path, filename expansion, and lyrics representation remain unresolved (`EV-OUTPUT-001`).

## Keyboard focus order and accessibility semantics

- Preconditions: Reference app is open on a stable view; start from a non-mutating tab or document surface.
- Safe observation: Use only read-only accessibility snapshots and keyboard focus traversal on the fixture shell; for the reference app, record the existing AX role/name/value data without activating controls.
- Prohibited action: Do not press Enter, Space, Return, or any shortcut that could play, queue, remove, convert, save, log in, or change settings.
- Expected evidence artifact: Sanitized focus sequence and role/name/value map, with no session data or provider URLs.
- Stop condition: Focus enters a state-changing control or the traversal cannot be observed without activation.
- Current status: Partial; static fixture inspection confirms semantic navigation, filter/search controls, table structure, and a polite root live region, but runtime focus order, keyboard semantics, and announcements remain unverified because sanitized diagnostics place Electron launch SIGABRT in AppKit/LaunchServices before renderer startup (`EV-A11Y-002`, `EV-A11Y-003`, `EV-RUNTIME-002`).
