import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  buildFailureError,
  collectRunProvenance,
  DEFAULT_COMMAND_TIMEOUT_MS,
  diagnosticsText,
  finalizeDiagnostics,
  expectedProvenanceFromEnvironment,
  launchProcessDiagnostics,
  persistDiagnostics,
  sanitizeDiagnosticsText,
  validateExpectedProvenance,
  waitForProcessExit,
} from "../e2e/launch-diagnostics.mjs";

function diagnosticsFixture() {
  return {
    artifactsDir: "/tmp/harbor-diagnostics-artifacts",
    processErrors: [],
    cleanup: {
      verifiedExit: false,
      killAttempted: false,
    },
  };
}

test("sanitizes sensitive diagnostic values while retaining failure context", async () => {
  const artifactsDir = await mkdtemp(path.join(os.tmpdir(), "harbor-diagnostics-test-"));
  const diagnostics = {
    artifactsDir,
    launchError: {
      message: "Authorization: Bearer secret-token token=raw-token; Authorization: Basic raw-basic; Authorization: Token raw-token-2; Authorization: Digest username=alice, realm=secret, nonce=raw; access_token=raw-access; refresh_token=raw-refresh; client_secret=raw-secret; oauth_access_token=raw-oauth; db_client_secret=raw-db; authorization_token=raw-auth; password: raw secret phrase; https://example.test/?token=url-token",
      apiKey: "raw-api-key",
    },
  };

  const diagnosticsPath = await persistDiagnostics(diagnostics);
  const contents = await readFile(diagnosticsPath, "utf8");

  assert.match(contents, /Authorization: \[REDACTED\]/);
  assert.match(contents, /token=\[REDACTED\]/);
  assert.match(contents, /"apiKey": "\[REDACTED\]"/);
  assert.match(contents, /Authorization: \[REDACTED\]/);
  assert.doesNotMatch(contents, /secret-token|raw-token|raw-basic|raw-token-2|realm=secret|nonce=raw|raw-access|raw-refresh|raw-secret|raw-oauth|raw-db|raw-auth|secret phrase|url-token|raw-api-key/);
});

test("redacts complete delimiter and authorization credential forms", () => {
  const sanitized = sanitizeDiagnosticsText(
    'token=first,second; password="first;second"; Authorization Basic basic-secret; Authorization Token token-secret; Authorization Custom custom-secret; Authorization Foo+Bar plus-secret; Authorization 123 numeric-secret; Authorization !custom punctuation-secret',
  );

  assert.match(sanitized, /token=\[REDACTED\]/);
  assert.match(sanitized, /password="\[REDACTED\]"/);
  assert.match(sanitized, /Authorization Basic \[REDACTED\]/);
  assert.match(sanitized, /Authorization Token \[REDACTED\]/);
  assert.match(sanitized, /Authorization Custom \[REDACTED\]/);
  assert.match(sanitized, /Authorization Foo\+Bar \[REDACTED\]/);
  assert.match(sanitized, /Authorization 123 \[REDACTED\]/);
  assert.match(sanitized, /Authorization !custom \[REDACTED\]/);
  assert.doesNotMatch(sanitized, /first,second|first;second|basic-secret|token-secret|custom-secret|plus-secret|numeric-secret|punctuation-secret/);
});

test("redacts nested and escaped JSON credentials in diagnostic text", () => {
  const sanitized = sanitizeDiagnosticsText(
    '{"outer":{"token":"RAW-NESTED","apiKey":"RAW-API"},"ok":"retained"} '
      + '{\\"token\\":\\"RAW-ESCAPED\\"}',
  );

  assert.match(sanitized, /\[REDACTED\]/);
  assert.match(sanitized, /retained/);
  assert.doesNotMatch(sanitized, /RAW-NESTED|RAW-API|RAW-ESCAPED/);
});

test("redacts credentials split across diagnostic chunks", () => {
  const sanitized = diagnosticsText({
    processErrors: ["Authorization ", "Foo+Bar split-secret"],
    pageErrors: ["token=", "split-token"],
  });

  assert.match(sanitized, /Authorization Foo\+Bar \[REDACTED\]/);
  assert.match(sanitized, /token=\[REDACTED\]/);
  assert.doesNotMatch(sanitized, /split-secret|split-token/);
});

test("preserves ordinary provenance array structure while sanitizing stream arrays", () => {
  const sanitized = JSON.parse(diagnosticsText({
    changedFiles: ["README.md", "e2e/launch-diagnostics.mjs"],
    invocation: { command: ["node", "e2e/native-version-probe.mjs"] },
    processErrors: ["token=", "split-token"],
  }));

  assert.deepEqual(sanitized.changedFiles, ["README.md", "e2e/launch-diagnostics.mjs"]);
  assert.deepEqual(sanitized.invocation.command, ["node", "e2e/native-version-probe.mjs"]);
  assert.equal(sanitized.processErrors, "token=[REDACTED]");
});

test("requires an independently supplied canonical worktree expectation", () => {
  const { expected, missing } = expectedProvenanceFromEnvironment({
    worktree: "/derived/worktree",
    executable: "/derived/worktree/Electron",
    electronVersion: "44.7.0",
    environment: {
      HARBOR_NATIVE_EXPECTED_WORKTREE: "/approved/worktree",
      HARBOR_NATIVE_EXPECTED_BASE_SHA: "1".repeat(40),
      HARBOR_NATIVE_EXPECTED_HEAD_SHA: "2".repeat(40),
      HARBOR_NATIVE_EXPECTED_NODE_VERSION: "v26.13.0",
      HARBOR_NATIVE_EXPECTED_PNPM_VERSION: "12.12.1",
      HARBOR_NATIVE_EXPECTED_MACOS_VERSION: "26.7.2",
      HARBOR_NATIVE_EXPECTED_HOST_ARCHITECTURE: "arm64",
      HARBOR_NATIVE_EXPECTED_PLAYWRIGHT_VERSION: "1.64.1",
      HARBOR_NATIVE_EXPECTED_ELECTRON_ARCHITECTURE: "arm64",
      HARBOR_NATIVE_EXPECTED_ELECTRON_UUID: "4C4C44AF-5555-3144-A1E7-7E571B4F50E9",
      HARBOR_NATIVE_EXPECTED_ELECTRON_SHA256: "3".repeat(64),
      HARBOR_NATIVE_EXPECTED_ELECTRON_PACKAGE_SHA256: "4".repeat(64),
      HARBOR_NATIVE_EXPECTED_PLAYWRIGHT_PACKAGE_SHA256: "5".repeat(64),
      HARBOR_NATIVE_EXPECTED_PACKAGE_SHA256: "6".repeat(64),
      HARBOR_NATIVE_EXPECTED_LOCKFILE_SHA256: "7".repeat(64),
      HARBOR_NATIVE_EXPECTED_BRANCH_STATUS: "## approved",
    },
  });

  assert.equal(expected.worktree, "/approved/worktree");
  assert.equal(expected.invocationCwd, "/approved/worktree");
  assert.equal(missing.length, 0);
});

test("compares worktree and invocation paths by realpath", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "harbor-provenance-realpath-"));
  const alias = path.join(root, "alias");
  await symlink(root, alias, "dir");

  assert.deepEqual(validateExpectedProvenance({
    worktree: alias,
    invocation: { cwd: alias },
  }, {
    worktree: root,
    invocationCwd: root,
  }), []);
});

test("collects exact-head and artifact provenance for retained diagnostics", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "harbor-provenance-test-"));
  const electronExecutable = path.join(repoRoot, "Electron");
  const electronPackageJson = path.join(repoRoot, "electron-package.json");
  const playwrightPackageJson = path.join(repoRoot, "playwright-package.json");
  await writeFile(electronExecutable, "electron-bytes");
  await writeFile(electronPackageJson, '{"version":"44.7.0"}');
  await writeFile(playwrightPackageJson, '{"version":"1.64.1"}');
  await writeFile(path.join(repoRoot, "package.json"), '{"name":"harbor-audio"}');
  await writeFile(path.join(repoRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

  const outputs = new Map([
    ["git rev-parse HEAD", "58901715f55799243bd0085c9c675665fcc38df4\n"],
    ["git rev-parse --verify feature/harbor-clo-159^{commit}", "51b7580ac26b670309425b78bafaa6ad80ed3fb5\n"],
    ["git diff --name-only feature/harbor-clo-159...HEAD", "README.md\ne2e/launch-diagnostics.mjs\n"],
    ["git status --short --branch", "## mw/harbor-clo-160\n"],
    ["pnpm --version", "12.12.1\n"],
    ["sw_vers -productVersion", "15.0\n"],
    ["uname -m", "arm64\n"],
    [`file ${electronExecutable}`, `${electronExecutable}: Mach-O 64-bit executable arm64\n`],
    [`otool -l ${electronExecutable}`, "cmd LC_UUID\n    uuid 4C4C44AF-5555-3144-A1E7-7E571B4F50E9\n"],
  ]);

  const provenance = await collectRunProvenance({
    repoRoot,
    electronExecutable,
    electronPackageJson,
    playwrightPackageJson,
    baseRef: "feature/harbor-clo-159",
    command: ["node", "--test", "e2e/converted-electron.test.mjs"],
    execFileFn: async (command, args, options) => {
      assert.equal(options.timeout, DEFAULT_COMMAND_TIMEOUT_MS);
      return {
      stdout: outputs.get([command, ...args].join(" ")) ?? "",
      };
    },
  });

  assert.equal(provenance.status, true);
  assert.equal(provenance.baseSha, "51b7580ac26b670309425b78bafaa6ad80ed3fb5");
  assert.equal(provenance.headSha, "58901715f55799243bd0085c9c675665fcc38df4");
  assert.deepEqual(provenance.changedFiles, ["README.md", "e2e/launch-diagnostics.mjs"]);
  assert.equal(provenance.artifact.architecture, "arm64");
  assert.equal(provenance.artifact.uuid, "4C4C44AF-5555-3144-A1E7-7E571B4F50E9");
  assert.equal(provenance.toolchain.electron, "44.7.0");
  assert.equal(provenance.toolchain.playwright, "1.64.1");
  assert.match(provenance.artifact.sha256, /^[0-9a-f]{64}$/);
  assert.equal(provenance.toolchain.pnpm, "12.12.1");
  assert.deepEqual(validateExpectedProvenance(provenance, {
    worktree: repoRoot,
    baseRef: "feature/harbor-clo-159",
    baseSha: provenance.baseSha,
    headSha: provenance.headSha,
    nodeVersion: provenance.toolchain.node,
    pnpmVersion: provenance.toolchain.pnpm,
    macOSVersion: provenance.toolchain.macOS,
    hostArchitecture: provenance.toolchain.hostArchitecture,
    executable: electronExecutable,
    electronVersion: "44.7.0",
    playwrightVersion: provenance.toolchain.playwright,
    electronArchitecture: "arm64",
    electronUuid: "4C4C44AF-5555-3144-A1E7-7E571B4F50E9",
    electronSha256: provenance.artifact.sha256,
    electronPackageJsonSha256: provenance.artifact.packageJsonSha256,
    playwrightPackageJsonSha256: provenance.artifact.playwrightPackageJsonSha256,
    packageJsonSha256: provenance.artifact.repositoryPackageJsonSha256,
    lockfileSha256: provenance.artifact.lockfileSha256,
    invocationCwd: process.cwd(),
    branchStatus: "## mw/harbor-clo-160",
    requireCleanWorkingTree: true,
  }), []);
  assert.match(
    validateExpectedProvenance(provenance, { headSha: "f".repeat(40) }).join("\n"),
    /head SHA expected/,
  );
  assert.match(
    validateExpectedProvenance(provenance, { pnpmVersion: "12.12.0" }).join("\n"),
    /pnpm version expected/,
  );
});

test("fails closed when provenance command output is empty or malformed", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "harbor-provenance-invalid-"));
  const electronExecutable = path.join(repoRoot, "Electron");
  const electronPackageJson = path.join(repoRoot, "electron-package.json");
  const playwrightPackageJson = path.join(repoRoot, "playwright-package.json");
  await writeFile(electronExecutable, "electron-bytes");
  await writeFile(electronPackageJson, '{"version":"44.7.0"}');
  await writeFile(playwrightPackageJson, '{"version":"1.64.1"}');
  await writeFile(path.join(repoRoot, "package.json"), '{"name":"harbor-audio"}');
  await writeFile(path.join(repoRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

  const provenance = await collectRunProvenance({
    repoRoot,
    electronExecutable,
    electronPackageJson,
    playwrightPackageJson,
    baseRef: "feature/harbor-clo-159",
    execFileFn: async () => ({ stdout: "   \n" }),
  });

  assert.equal(provenance.status, false);
  assert.ok(provenance.errors.some((error) => /head SHA/.test(error)));
  assert.ok(provenance.errors.some((error) => /changed-files output/.test(error)));
});

test("records a bounded provenance-command timeout as evidence failure", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "harbor-provenance-timeout-"));
  const electronExecutable = path.join(repoRoot, "Electron");
  const electronPackageJson = path.join(repoRoot, "electron-package.json");
  const playwrightPackageJson = path.join(repoRoot, "playwright-package.json");
  await writeFile(electronExecutable, "electron-bytes");
  await writeFile(electronPackageJson, '{"version":"44.7.0"}');
  await writeFile(playwrightPackageJson, '{"version":"1.64.1"}');
  await writeFile(path.join(repoRoot, "package.json"), '{"name":"harbor-audio"}');
  await writeFile(path.join(repoRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

  const timeoutError = new Error("command timed out");
  timeoutError.code = "ETIMEDOUT";
  const provenance = await collectRunProvenance({
    repoRoot,
    electronExecutable,
    electronPackageJson,
    playwrightPackageJson,
    execFileFn: async (_command, _args, options) => {
      assert.equal(options.timeout, DEFAULT_COMMAND_TIMEOUT_MS);
      throw timeoutError;
    },
  });

  assert.equal(provenance.status, false);
  assert.ok(provenance.errors.some((error) => /timed out/.test(error)));
});

test("accepts a valid empty changed-file list while rejecting malformed versions", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "harbor-provenance-empty-diff-"));
  const electronExecutable = path.join(repoRoot, "Electron");
  const electronPackageJson = path.join(repoRoot, "electron-package.json");
  const playwrightPackageJson = path.join(repoRoot, "playwright-package.json");
  await writeFile(electronExecutable, "electron-bytes");
  await writeFile(electronPackageJson, '{"version":"44.7.0"}');
  await writeFile(playwrightPackageJson, '{"version":"1.64.1"}');
  await writeFile(path.join(repoRoot, "package.json"), '{"name":"harbor-audio"}');
  await writeFile(path.join(repoRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

  const outputs = new Map([
    ["git rev-parse HEAD", "a".repeat(40)],
    ["git rev-parse --verify feature/harbor-clo-159^{commit}", "b".repeat(40)],
    ["git diff --name-only feature/harbor-clo-159...HEAD", ""],
    ["git status --short --branch", "## mw/harbor-clo-160\n"],
    ["pnpm --version", "12.12.1\n"],
    ["sw_vers -productVersion", "26.7.2\n"],
    ["uname -m", "arm64\n"],
    [`file ${electronExecutable}`, `${electronExecutable}: Mach-O 64-bit executable arm64\n`],
    [`otool -l ${electronExecutable}`, "cmd LC_UUID\n    uuid 4C4C44AF-5555-3144-A1E7-7E571B4F50E9\n"],
  ]);

  const validEmptyDiff = await collectRunProvenance({
    repoRoot,
    electronExecutable,
    electronPackageJson,
    playwrightPackageJson,
    baseRef: "feature/harbor-clo-159",
    execFileFn: async (command, args) => ({
      stdout: outputs.get([command, ...args].join(" ")) ?? "",
    }),
  });
  assert.equal(validEmptyDiff.status, true);
  assert.deepEqual(validEmptyDiff.changedFiles, []);

  const malformedVersion = await collectRunProvenance({
    repoRoot,
    electronExecutable,
    electronPackageJson,
    playwrightPackageJson,
    baseRef: "feature/harbor-clo-159",
    execFileFn: async (command, args) => ({
      stdout: [command, ...args].join(" ") === "sw_vers -productVersion"
        ? "not-a-version\n"
        : outputs.get([command, ...args].join(" ")) ?? "",
    }),
  });
  assert.equal(malformedVersion.status, false);
  assert.ok(malformedVersion.errors.some((error) => /macOS version/.test(error)));
});

test("labels Playwright PID observations as unverified and parses ANSI log markers", () => {
  const error = new Error(
    "\u001b[2m - <launched> pid=4242\u001b[22m\n"
      + "\u001b[2m - [pid=4242] <process did exit: exitCode=null, signal=SIGABRT>\u001b[22m",
  );
  const result = launchProcessDiagnostics(error, {
    probe() {
      const probeError = new Error("process is absent");
      probeError.code = "ESRCH";
      throw probeError;
    },
  });

  assert.deepEqual(result, {
    source: "playwright-error-log",
    ownership: "unverified",
    pid: 4242,
    exitCode: "null",
    signal: "SIGABRT",
    exitObservation: "reported-by-playwright-log",
    liveness: "absent",
  });
});

test("early launch errors without a PID remain unverified", () => {
  assert.deepEqual(
    launchProcessDiagnostics(new Error("Failed to launch")),
    {
      source: "playwright-error-log",
      ownership: "unverified",
      pid: undefined,
      exitCode: undefined,
      signal: undefined,
      exitObservation: "not-reported",
      liveness: "not-observed",
    },
  );
});

test("forced termination is followed by bounded exit verification before cleanup", async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  let waits = 0;
  let killCalls = 0;
  let removed = false;
  const diagnostics = diagnosticsFixture();

  const result = await finalizeDiagnostics({
    diagnostics,
    electronApp: { close: async () => {} },
    child,
    passed: true,
    profileRoot: "/tmp/harbor-profile",
    timeout: 1,
    killVerificationTimeout: 1,
    waitForExit: async () => {
      waits += 1;
      if (waits === 1) throw new Error("initial exit timeout");
      child.exitCode = null;
      child.signalCode = "SIGTERM";
      diagnostics.cleanup.closeObserved = true;
      child.emit("close");
    },
    kill: () => {
      killCalls += 1;
      return true;
    },
    persist: async (diagnostics) => {
      diagnostics.diagnosticsPath = "/tmp/diagnostics.json";
      return diagnostics.diagnosticsPath;
    },
    removeProfile: async () => {
      removed = true;
    },
  });

  assert.equal(waits, 2);
  assert.equal(killCalls, 1);
  assert.equal(result.cleanupErrors.length, 1);
  assert.equal(result.removedProfile, false);
  assert.equal(removed, false);
});

test("waits for close even when the child exit code is already available", async () => {
  const child = new EventEmitter();
  child.exitCode = 0;
  child.signalCode = null;
  let closeObserved = false;
  const pending = waitForProcessExit(child, 50, {
    isClosed: () => closeObserved,
  });
  setImmediate(() => {
    closeObserved = true;
    child.emit("close");
  });
  await pending;
});

test("persistence failure retains the profile after an otherwise successful callback", async () => {
  const diagnostics = { ...diagnosticsFixture(), disposition: "PASS" };
  let removed = false;
  const result = await finalizeDiagnostics({
    diagnostics,
    passed: true,
    profileRoot: "/tmp/harbor-profile",
    persist: async () => {
      throw new Error("diagnostic disk failure");
    },
    removeProfile: async () => {
      removed = true;
    },
  });

  assert.equal(result.persistenceError.message, "diagnostic disk failure");
  assert.equal(result.removedProfile, false);
  assert.equal(removed, false);
  assert.equal(diagnostics.disposition, "CLEANUP_FAILURE");
});

test("profile-removal failure is persisted before the profile is retained", async () => {
  const writes = [];
  const diagnostics = { ...diagnosticsFixture(), disposition: "PASS" };
  const result = await finalizeDiagnostics({
    diagnostics,
    passed: true,
    profileRoot: "/tmp/harbor-profile",
    persist: async (diagnostics) => {
      diagnostics.diagnosticsPath = "/tmp/diagnostics.json";
      writes.push(JSON.stringify(diagnostics));
      return diagnostics.diagnosticsPath;
    },
    removeProfile: async () => {
      throw new Error("profile removal failed");
    },
  });

  assert.equal(result.removedProfile, false);
  assert.equal(result.cleanupErrors.length, 1);
  assert.equal(writes.length, 2);
  assert.match(writes[1], /profile removal failed/);
  assert.equal(diagnostics.disposition, "CLEANUP_FAILURE");
});

test("primary failure remains the cause when cleanup and persistence also fail", () => {
  const primary = new Error("renderer assertion failed");
  const cleanup = new Error("close failed");
  const persistence = new Error("write failed");
  const failure = buildFailureError({
    primaryError: primary,
    diagnosticsPath: "/tmp/diagnostics.json",
    cleanupErrors: [cleanup],
    persistenceError: persistence,
  });

  assert.equal(failure.cause, primary);
  assert.match(failure.message, /renderer assertion failed/);
  assert.match(failure.message, /diagnostics\.json/);
  assert.deepEqual(
    failure.secondaryErrors.map((error) => error.message),
    ["close failed", "write failed"],
  );
});
