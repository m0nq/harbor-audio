# Dependency Update Policy

Status: adopted for the fixture-backed Harbor Audio scaffold.

## Goals

- Keep builds reproducible and reviewable.
- Receive security and maintenance updates promptly.
- Separate the newest published release from the newest release verified by this project.
- Keep dependency changes inside the approved fixture-only, local-first boundary.

## Versioning and lockfiles

- Direct dependencies are exact-pinned in `package.json`; do not use `latest`, caret ranges, or floating tags.
- `pnpm-lock.yaml` is committed and reviewed with every dependency change.
- The project toolchain is pinned with `packageManager: pnpm@12.12.1` and the supported Node range in `package.json`.
- Project commands use bare pnpm, which must resolve to the pinned `12.12.1` version. CI and release checks must use the same pinned version.
- `save-exact=true` is enabled in `.npmrc` so newly added direct dependencies remain exact-pinned by default.

## Installation and bootstrap gate

- `pnpm install --frozen-lockfile` is conditional. Run it after `package.json` or `pnpm-lock.yaml` changes, or in a designated fresh-environment dependency-bootstrap loop.
- Do not repeat the frozen-lockfile install during every ordinary verification loop when dependency metadata is unchanged and the existing dependency tree is available.
- The desktop safety hook that blocks dependency mutation must not be bypassed or weakened. If it blocks the install gate, record the exact hook message as an install-gate limitation and continue only with safe checks that do not mutate dependencies.
- `npx --yes pnpm@12.12.1` is fallback-only, not a normal project command. Use it only in an explicitly approved recovery or bootstrap exception when bare pnpm is unavailable, and never to bypass the desktop safety hook.

## Verification outcome classification

- An install-gate limitation is distinct from an ordinary verification failure. A blocked or intentionally skipped frozen install does not invalidate independent results from `pnpm --version`, `pnpm run typecheck`, `pnpm test`, or `pnpm run build` when those commands complete against the existing dependency tree.
- Report the install-gate result and ordinary-check results separately. Do not label the project verification as failed solely because a conditional install was blocked before execution.

## Update cadence and urgency

- Security advisories affecting runtime, build, or transitive dependencies are triaged immediately. A fix is applied as soon as it passes the verification gate; if no safe fix is available, document the exception and mitigation.
- Patch and minor updates are reviewed at least monthly, with a weekly check preferred during active development.
- Major updates are handled in a dedicated branch or change set. They require release-note review, compatibility assessment, and an explicit decision record when they affect the Electron, TypeScript, Node, or pnpm toolchain.
- “Latest available” is not automatically “latest verified.” The verified version is the exact version recorded in `package.json` and `pnpm-lock.yaml` after the checks below pass.

## Review and verification gate

For every dependency update, and for a designated fresh-environment bootstrap:

1. Review the package release notes, supported runtime range, license/provenance, known advisories, and dependency graph impact.
2. Run `pnpm outdated` and `pnpm audit` as review inputs. Treat their output as evidence to investigate, not as permission to install blindly.
3. Update the dependency and lockfile in a focused change set.
4. Confirm the pinned toolchain and, when this is an install-gate run, install from the lockfile:

   ```zsh
   pnpm --version
   pnpm install --frozen-lockfile
   pnpm run typecheck
   pnpm test
   pnpm run build
   ```

   If dependency metadata is unchanged and this is an ordinary verification loop, omit the conditional install command and run only the ordinary checks.

5. Launch the desktop shell and confirm the Browser, Converting, and Converted fixture views render. Record the result in the change review.
6. Review the lockfile diff for unexpected packages, scripts, or registry changes before merging.

## Build-script and supply-chain controls

- Do not disable package lifecycle scripts globally as a substitute for review. Electron requires its postinstall artifact step; package scripts remain subject to dependency review and the pinned-lockfile gate.
- Do not introduce network access, login, credential handling, remote-provider adapters, DRM handling, or real media conversion as a side effect of a dependency update.
- Do not commit credentials, tokens, local absolute paths, generated Electron binaries, or unreviewed vendor bundles.
- Prefer the smallest update that resolves a security or compatibility need. Group unrelated updates into separate changes when practical.

## Rollback and exceptions

- Preserve the previous `package.json` and lockfile in version control so a failed update can be reverted as one change.
- If a dependency must be temporarily held, record the reason, affected versions, mitigation, owner, and next review date in the change request.
- A dependency update is not complete until the verification results and any exception are recorded.
