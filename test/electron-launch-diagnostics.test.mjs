import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import {
  buildFailureError,
  commandError,
  collectRunProvenance,
  createBoundedDiagnosticsCapture,
  createNativeScenarioSelector,
  currentInvocationCommand,
  DEFAULT_COMMAND_TIMEOUT_MS,
  diagnosticsText,
  finalizeDiagnostics,
  expectedProvenanceFromEnvironment,
  launchProcessDiagnostics,
  nodeTestInvocationContract,
  persistDiagnostics,
  prepareIsolatedElectronProfile,
  recordProcessError,
  sanitizeDiagnosticsText,
  utf8Prefix,
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
      message: "Authorization: Bearer secret-token token=raw-token; Authorization: Basic raw-basic; Authorization: Token raw-token-2; Authorization: Digest username=alice, realm=secret, nonce=raw; access_token=raw-access; refresh_token=raw-refresh; client_secret=raw-secret; clientSecret=raw-camel-secret; authToken=raw-camel-token; authorizationToken=raw-camel-authorization; oauth_access_token=raw-oauth; db_client_secret=raw-db; authorization_token=raw-auth; password: raw secret phrase; https://example.test/?token=url-token",
      apiKey: "raw-api-key",
    },
  };

  const diagnosticsPath = await persistDiagnostics(diagnostics);
  const contents = await readFile(diagnosticsPath, "utf8");

  assert.match(contents, /Authorization: \[REDACTED\]/);
  assert.match(contents, /token=\[REDACTED\]/);
  assert.match(contents, /"apiKey": "\[REDACTED\]"/);
  assert.match(contents, /Authorization: \[REDACTED\]/);
  assert.doesNotMatch(contents, /secret-token|raw-token|raw-basic|raw-token-2|realm=secret|nonce=raw|raw-access|raw-refresh|raw-secret|raw-camel-secret|raw-camel-token|raw-camel-authorization|raw-oauth|raw-db|raw-auth|secret phrase|url-token|raw-api-key/);
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

test("redacts space-delimited CLI credential arguments", () => {
  const sanitized = sanitizeDiagnosticsText(
    "--token raw-cli-token --clientSecret raw-cli-secret --authorization-token=raw-cli-auth --keep retained",
  );

  assert.match(sanitized, /--token \[REDACTED\]/);
  assert.match(sanitized, /--clientSecret \[REDACTED\]/);
  assert.match(sanitized, /--authorization-token=\[REDACTED\]/);
  assert.match(sanitized, /--keep retained/);
  assert.doesNotMatch(sanitized, /raw-cli-token|raw-cli-secret|raw-cli-auth/);
});

test("redacts escaped quotes in free-form CLI credential text", () => {
  const sanitized = sanitizeDiagnosticsText(
    'node --password "raw multi word \\"quoted\\" secret" --keep retained',
  );

  assert.match(sanitized, /node --password \[REDACTED\] --keep retained/);
  assert.doesNotMatch(sanitized, /raw multi word|quoted|secret/);
});

test("redacts credentials in structured command argument arrays", () => {
  const sanitized = JSON.parse(diagnosticsText({
    invocation: { command: ["node", "--token", "raw-array-token", "--keep", "retained", "--secret", "--starts-with-dashes"] },
  }));

  assert.deepEqual(sanitized.invocation.command, [
    "node",
    "--token",
    "[REDACTED]",
    "--keep",
    "retained",
    "--secret",
    "[REDACTED]",
  ]);
  assert.doesNotMatch(JSON.stringify(sanitized), /raw-array-token/);
  assert.doesNotMatch(JSON.stringify(sanitized), /starts-with-dashes/);
});

test("does not consume a later option when a sensitive value begins with dashes", () => {
  const sanitized = JSON.parse(diagnosticsText({
    invocation: { command: ["node", "--token", "--secret-value", "--keep", "retained"] },
  }));

  assert.deepEqual(sanitized.invocation.command, [
    "node",
    "--token",
    "[REDACTED]",
    "--keep",
    "retained",
  ]);
});

test("quotes multi-word command arguments before sanitizing command errors", () => {
  const sanitized = commandError(
    "node",
    ["--password", "raw multi word \"quoted\" secret"],
    new Error("command failed"),
  );

  assert.match(sanitized, /node --password "\[REDACTED\]"/);
  assert.doesNotMatch(sanitized, /raw multi word|quoted/);
});

test("bounds UTF-8 diagnostic capture and records truncation", () => {
  let truncation;
  const capture = createBoundedDiagnosticsCapture("Page console", {
    maxBytes: 64,
    onTruncate: (error) => { truncation = error; },
  });

  capture.append("é".repeat(100));

  assert.equal(capture.truncated, true);
  assert.ok(capture.bytes <= 64);
  assert.match(capture.values.join(""), /capture truncated/);
  assert.match(truncation.message, /Page console capture exceeded 64 bytes/);
});

test("cleans an isolated profile when user-data setup fails", async () => {
  let removedPath;
  await assert.rejects(
    prepareIsolatedElectronProfile({
      tmpRoot: "/tmp",
      mkdtempFn: async () => "/tmp/harbor-profile-setup-failure",
      mkdirFn: async () => { throw new Error("user-data mkdir failed"); },
      rmFn: async (profileRoot) => { removedPath = profileRoot; },
    }),
    /isolated Electron profile setup failed: user-data mkdir failed/,
  );
  assert.equal(removedPath, "/tmp/harbor-profile-setup-failure");
});

test("cleans an isolated profile when realpath setup fails", async () => {
  let removedPath;
  await assert.rejects(
    prepareIsolatedElectronProfile({
      tmpRoot: "/tmp",
      mkdtempFn: async () => "/tmp/harbor-profile-realpath-failure",
      mkdirFn: async () => {},
      realpathFn: async () => { throw new Error("user-data realpath failed"); },
      rmFn: async (profileRoot) => { removedPath = profileRoot; },
    }),
    /isolated Electron profile setup failed: user-data realpath failed/,
  );
  assert.equal(removedPath, "/tmp/harbor-profile-realpath-failure");
});

test("surfaces an isolated profile when setup cleanup fails", async () => {
  let error;
  try {
    await prepareIsolatedElectronProfile({
      tmpRoot: "/tmp",
      mkdtempFn: async () => "/tmp/harbor-profile-retained",
      mkdirFn: async () => { throw new Error("user-data mkdir failed token=raw-setup-secret"); },
      rmFn: async () => { throw new Error("profile cleanup failed password=raw-cleanup-secret"); },
    });
  } catch (caught) {
    error = caught;
  }

  assert.equal(error?.profileRoot, "/tmp/harbor-profile-retained");
  assert.equal(error?.cleanupError?.message, "profile cleanup failed password=[REDACTED]");
  assert.equal(error?.cause?.message, "user-data mkdir failed token=[REDACTED]");
  assert.doesNotMatch(error?.stack ?? "", /raw-setup-secret|raw-cleanup-secret/);
  assert.doesNotMatch(error?.cause?.stack ?? "", /raw-setup-secret/);
  assert.doesNotMatch(error?.cleanupError?.stack ?? "", /raw-cleanup-secret/);
  assert.match(error?.message ?? "", /profile root retained at \/tmp\/harbor-profile-retained/);
});

test("records the Node exec arguments and resolves the test script path", () => {
  assert.deepEqual(currentInvocationCommand({
    execPath: "/opt/homebrew/bin/node",
    execArgv: ["--test"],
    argv: ["/opt/homebrew/bin/node", "e2e/converted-electron.test.mjs"],
    cwd: "/approved/worktree",
  }), [
    "/opt/homebrew/bin/node",
    "--test",
    "/approved/worktree/e2e/converted-electron.test.mjs",
  ]);
});

test("matches the operator test command to a Node worker contract without comparing generated defaults", () => {
  const nodeExecutable = "/opt/homebrew/Cellar/node/26.13.0_2/bin/node";
  const testFile = "/approved/worktree/e2e/converted-electron.test.mjs";
  const operatorCommand = [
    nodeExecutable,
    "--test",
    "--test-name-pattern=^Converted Slice 1 functional Electron acceptance$",
    testFile,
  ];
  const workerCommand = [
    nodeExecutable,
    "--heap-prof-interval=524288",
    "--test-timeout=0",
    "--test-isolation=process",
    "--inspect-port=127.0.0.1:9229",
    "--node-snapshot",
    "--test-name-pattern=^Converted Slice 1 functional Electron acceptance$",
    testFile,
  ];

  assert.notDeepEqual(workerCommand, operatorCommand);
  const workerContract = nodeTestInvocationContract(workerCommand);
  assert.deepEqual(workerContract.unmodeledOptions, []);
  assert.ok(workerContract.generatedDefaultOptions.includes("--node-snapshot"));
  assert.deepEqual(
    validateExpectedProvenance(
      { invocation: { command: workerCommand, contract: workerContract } },
      { invocationCommand: operatorCommand },
    ),
    [],
  );
  assert.match(
    validateExpectedProvenance(
      { invocation: { command: [nodeExecutable, "--test-isolation=none", ...workerCommand.slice(1)] } },
      { invocationCommand: operatorCommand },
    ).join("\n"),
    /invocation testIsolation expected "process" but was "none"/,
  );
  assert.match(
    validateExpectedProvenance(
      { invocation: { command: [nodeExecutable, "--watch", ...workerCommand.slice(1)] } },
      { invocationCommand: operatorCommand },
    ).join("\n"),
    /invocation watch expected false but was true/,
  );
  assert.match(
    validateExpectedProvenance(
      { invocation: { command: [nodeExecutable, "--test-name-pattern=wrong", testFile] } },
      { invocationCommand: operatorCommand },
    ).join("\n"),
    /invocation testNamePatterns expected/,
  );
  assert.match(
    validateExpectedProvenance(
      { invocation: { command: ["/wrong/node", ...workerCommand.slice(1)] } },
      { invocationCommand: operatorCommand },
    ).join("\n"),
    /invocation executable expected/,
  );
  assert.match(
    validateExpectedProvenance(
      { invocation: { command: [nodeExecutable, "--test-name-pattern=^Converted Slice 1 functional Electron acceptance$", "/wrong/test.mjs"] } },
      { invocationCommand: operatorCommand },
    ).join("\n"),
    /invocation testFiles expected/,
  );
  const unmodeled = [nodeExecutable, "--require=/tmp/loader.mjs", ...workerCommand.slice(1)];
  const unmodeledContract = nodeTestInvocationContract(unmodeled);
  assert.deepEqual(unmodeledContract.unmodeledOptions, ["--require"]);
  assert.match(
    validateExpectedProvenance(
      { invocation: { command: unmodeled, contract: unmodeledContract } },
      { invocationCommand: operatorCommand },
    ).join("\n"),
    /invocation contains unmodeled options: --require/,
  );
});

test("compares every modeled Node test control while rejecting changed values", () => {
  const nodeExecutable = "/opt/homebrew/Cellar/node/26.13.0_2/bin/node";
  const testFile = "/approved/worktree/e2e/converted-electron.test.mjs";
  const controls = [
    ["--test-skip-pattern=skip", "--test-skip-pattern=changed", /testSkipPatterns/],
    ["--test-shard=1/2", "--test-shard=2/2", /testShard/],
    ["--test-global-setup=/approved/setup.mjs", "--test-global-setup=/wrong/setup.mjs", /testGlobalSetup/],
    ["--test-rerun-failures=2", "--test-rerun-failures=3", /testRerunFailures/],
    ["--test-randomize", "", /testRandomize/],
    ["--test-random-seed=42", "--test-random-seed=43", /testRandomSeed/],
    ["--test-only", "", /testOnly/],
    ["--watch-path=/approved/watch", "--watch-path=/wrong/watch", /watchPaths/],
    ["--watch-preserve-output", "", /watchPreserveOutput/],
    ["--experimental-test-module-mocks", "", /moduleMocks/],
    ["--test-force-exit", "", /forceExit/],
  ];
  const operatorControls = controls.map(([positive]) => positive).filter(Boolean);
  const operatorCommand = [nodeExecutable, "--test", ...operatorControls, testFile];
  const workerCommand = [nodeExecutable, ...operatorControls, testFile];

  assert.deepEqual(validateExpectedProvenance(
    { invocation: { command: workerCommand } },
    { invocationCommand: operatorCommand },
  ), []);

  for (const [index, [, changed, mismatchPattern]] of controls.entries()) {
    const changedControls = operatorControls.slice();
    const control = controls[index][0];
    const controlIndex = changedControls.indexOf(control);
    if (changed) changedControls[controlIndex] = changed;
    else changedControls.splice(controlIndex, 1);
    const mismatches = validateExpectedProvenance(
      { invocation: { command: [nodeExecutable, ...changedControls, testFile] } },
      { invocationCommand: operatorCommand },
    );
    assert.match(mismatches.join("\n"), mismatchPattern);
  }
});

test("captures a real Node test-worker invocation and validates its stable contract", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "harbor-worker-contract-"));
  const testFile = path.join(root, "worker-contract.test.mjs");
  const diagnosticsModule = pathToFileURL(path.resolve("e2e/launch-diagnostics.mjs")).href;
  await writeFile(testFile, [
    `import { test } from "node:test";`,
    `import { currentInvocationCommand, nodeTestInvocationContract } from ${JSON.stringify(diagnosticsModule)};`,
    "test(\"worker contract\", () => {",
    "  const command = currentInvocationCommand();",
    "  console.log(`HARBOR_WORKER_CONTRACT=${JSON.stringify({ command, contract: nodeTestInvocationContract(command), context: process.env.NODE_TEST_CONTEXT ?? null })}`);",
    "});",
    "",
  ].join("\n"), "utf8");

  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  try {
    const result = spawnSync(process.execPath, [
      "--test",
      "--test-name-pattern=worker contract",
      testFile,
    ], {
      cwd: path.resolve("."),
      env: environment,
      encoding: "utf8",
      timeout: 10_000,
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    assert.equal(result.status, 0, output);
    const match = output.match(/HARBOR_WORKER_CONTRACT=(\{[^\n]+\})/);
    assert.ok(match, output);
    const report = JSON.parse(match[1]);
    assert.match(report.context, /^child/);
    assert.ok(report.command.length > 4, JSON.stringify(report));
    assert.deepEqual(report.contract.testFiles, [testFile]);
    assert.deepEqual(report.contract.testNamePatterns, ["worker contract"]);
    assert.equal(report.contract.testIsolation, "process");
    assert.deepEqual(report.contract.unmodeledOptions, []);
    assert.ok(report.contract.generatedDefaultOptions.includes("--node-snapshot"));
    assert.deepEqual(
      validateExpectedProvenance(
        { invocation: report },
        { invocationCommand: [process.execPath, "--test", "--test-name-pattern=worker contract", testFile] },
      ),
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("selects exactly one native scenario and fails closed for invalid selectors", () => {
  const defaultSelector = createNativeScenarioSelector(undefined);
  assert.deepEqual(defaultSelector.select("first"), { selected: true });
  assert.deepEqual(defaultSelector.select("second"), { selected: true });
  assert.doesNotThrow(() => defaultSelector.assertMatched());

  const focusedSelector = createNativeScenarioSelector("  second  ");
  assert.deepEqual(focusedSelector.select("first"), {
    selected: false,
    skipReason: "not selected by HARBOR_NATIVE_SCENARIO",
  });
  assert.deepEqual(focusedSelector.select("second"), { selected: true });
  assert.doesNotThrow(() => focusedSelector.assertMatched());

  const unknownSelector = createNativeScenarioSelector("optional diagnostic");
  assert.deepEqual(unknownSelector.select("first"), {
    selected: false,
    skipReason: "not selected by HARBOR_NATIVE_SCENARIO",
  });
  assert.throws(
    () => unknownSelector.assertMatched(),
    /did not match a registered native scenario/,
  );

  assert.throws(
    () => createNativeScenarioSelector("  \t  "),
    /must be a non-empty scenario name/,
  );
});

test("applies native scenario selection at the nested Node test boundary", () => {
  const convertedTestPath = path.resolve("e2e/converted-electron.test.mjs");
  const testRunnerArgs = [
    "--test",
    "--test-name-pattern=^Converted Slice 1 functional Electron acceptance$",
    convertedTestPath,
  ];
  const runSelection = (selection, { enableNativeSelectDiagnostics = false } = {}) => {
    const environment = { ...process.env, HARBOR_NATIVE_SCENARIO: selection };
    for (const name of Object.keys(environment)) {
      if (name.startsWith("HARBOR_NATIVE_EXPECTED_")) delete environment[name];
    }
    delete environment.NODE_TEST_CONTEXT;
    if (enableNativeSelectDiagnostics) environment.HARBOR_RUN_NATIVE_SELECT_DIAGNOSTICS = "1";
    else delete environment.HARBOR_RUN_NATIVE_SELECT_DIAGNOSTICS;
    const result = spawnSync(process.execPath, testRunnerArgs, {
      cwd: path.resolve("."),
      env: environment,
      encoding: "utf8",
      timeout: 10_000,
    });
    return { ...result, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
  };

  const focused = runSelection("filters Converted rows by Album with a conditional selector");
  assert.equal(focused.status, 1, focused.output);
  assert.match(focused.output, /skipped 14/);
  assert.match(focused.output, /filters Converted rows by Album with a conditional selector/);
  assert.match(focused.output, /Native run provenance is incomplete; refusing Electron launch/);

  const unknown = runSelection("does-not-exist");
  assert.equal(unknown.status, 1, unknown.output);
  assert.match(unknown.output, /skipped 15/);
  assert.match(unknown.output, /did not match a registered native scenario/);

  const optionalWithoutGate = runSelection(
    "diagnoses native Converted dimension activation paths without cross-platform keyboard assumptions",
  );
  assert.equal(optionalWithoutGate.status, 1, optionalWithoutGate.output);
  assert.match(optionalWithoutGate.output, /did not match a registered native scenario/);

  const optionalWithGate = runSelection(
    "diagnoses native Converted dimension activation paths without cross-platform keyboard assumptions",
    { enableNativeSelectDiagnostics: true },
  );
  assert.equal(optionalWithGate.status, 1, optionalWithGate.output);
  assert.doesNotMatch(optionalWithGate.output, /did not match a registered native scenario/);
  assert.match(optionalWithGate.output, /Native run provenance is incomplete; refusing Electron launch/);

  const blank = runSelection("   ");
  assert.equal(blank.status, 1, blank.output);
  assert.match(blank.output, /must be a non-empty scenario name/);
});

test("records asynchronous process-stream errors as sanitized diagnostics", () => {
  const diagnostics = diagnosticsFixture();
  recordProcessError(diagnostics, new Error("stderr stream failed token=raw-stream-secret"));

  assert.equal(diagnostics.processErrors.length, 1);
  assert.match(diagnostics.processErrors[0], /stderr stream failed token=\[REDACTED\]/);
  assert.doesNotMatch(diagnostics.processErrors[0], /raw-stream-secret/);
});

test("retains a failed profile when a process error arrives before finalization", async () => {
  const diagnostics = diagnosticsFixture();
  diagnostics.processFailure = true;
  diagnostics.disposition = "FAILURE";
  let removed = false;

  await finalizeDiagnostics({
    diagnostics,
    passed: true,
    profileRoot: "/tmp/harbor-profile",
    persist: async () => "/tmp/harbor-diagnostics.json",
    removeProfile: async () => {
      removed = true;
    },
  });

  assert.equal(removed, false);
  assert.equal(diagnostics.disposition, "FAILURE");
});

test("settles late process errors before persisting and removing a passing profile", async () => {
  const diagnostics = { ...diagnosticsFixture(), disposition: "PASS", processFailure: false };
  const child = new EventEmitter();
  child.exitCode = 0;
  child.signalCode = null;
  diagnostics.cleanup.closeObserved = true;
  let removed = false;
  let persistedFailure;

  await finalizeDiagnostics({
    diagnostics,
    electronApp: { close: async () => {} },
    child,
    passed: true,
    profileRoot: "/tmp/harbor-profile",
    persist: async (current) => {
      persistedFailure = current.processFailure;
      return "/tmp/harbor-diagnostics.json";
    },
    settleAfterClose: async () => {
      diagnostics.processFailure = true;
      diagnostics.processErrors.push("late child error");
    },
    removeProfile: async () => {
      removed = true;
    },
  });

  assert.equal(persistedFailure, true);
  assert.equal(removed, false);
  assert.equal(diagnostics.disposition, "FAILURE");
});

test("keeps UTF-8 diagnostic prefixes within the byte bound", () => {
  const prefix = utf8Prefix("x".repeat(3) + "é", 4);
  assert.ok(Buffer.byteLength(prefix, "utf8") <= 4);
  assert.equal(prefix, "xxx");
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
      HARBOR_NATIVE_EXPECTED_BASE_REF: "feature/harbor-clo-159",
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
      HARBOR_NATIVE_EXPECTED_INVOCATION: "[\"/opt/homebrew/bin/node\",\"e2e/native-version-probe.mjs\"]",
    },
  });

  assert.equal(expected.worktree, "/approved/worktree");
  assert.equal(expected.invocationCwd, "/approved/worktree");
  assert.equal(expected.baseRef, "feature/harbor-clo-159");
  assert.deepEqual(expected.invocationCommand, ["/opt/homebrew/bin/node", "e2e/native-version-probe.mjs"]);
  assert.equal(missing.length, 0);
});

test("requires an independently supplied expected base ref", () => {
  const { missing } = expectedProvenanceFromEnvironment({
    environment: {},
  });

  assert.ok(missing.includes("HARBOR_NATIVE_EXPECTED_BASE_REF"));
});

test("rejects an invalid expected invocation", () => {
  const { missing } = expectedProvenanceFromEnvironment({
    environment: { HARBOR_NATIVE_EXPECTED_INVOCATION: "not-json" },
  });

  assert.ok(missing.includes("HARBOR_NATIVE_EXPECTED_INVOCATION"));
});

test("rejects an invocation command mismatch", () => {
  assert.match(
    validateExpectedProvenance({ invocation: { command: ["node", "actual.mjs"] } }, {
      invocationCommand: ["node", "expected.mjs"],
    }).join("\n"),
    /invocation command expected/,
  );
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
  assert.deepEqual(provenance.commands.map(({ argv, cwd, outcome }) => ({ argv, cwd, outcome })), [
    { argv: ["git", "rev-parse", "HEAD"], cwd: repoRoot, outcome: "PASS" },
    { argv: ["git", "rev-parse", "--verify", "feature/harbor-clo-159^{commit}"], cwd: repoRoot, outcome: "PASS" },
    { argv: ["git", "diff", "--name-only", "feature/harbor-clo-159...HEAD"], cwd: repoRoot, outcome: "PASS" },
    { argv: ["git", "status", "--short", "--branch"], cwd: repoRoot, outcome: "PASS" },
    { argv: ["pnpm", "--version"], cwd: repoRoot, outcome: "PASS" },
    { argv: ["sw_vers", "-productVersion"], cwd: repoRoot, outcome: "PASS" },
    { argv: ["uname", "-m"], cwd: repoRoot, outcome: "PASS" },
    { argv: ["file", electronExecutable], cwd: repoRoot, outcome: "PASS" },
    { argv: ["otool", "-l", electronExecutable], cwd: repoRoot, outcome: "PASS" },
  ]);
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

test("bounds Electron close before attempting exit verification", async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  const diagnostics = diagnosticsFixture();
  let removed = false;

  const result = await finalizeDiagnostics({
    diagnostics,
    electronApp: { close: () => new Promise(() => {}) },
    child,
    passed: true,
    profileRoot: "/tmp/harbor-profile",
    timeout: 1,
    killVerificationTimeout: 1,
    waitForExit: async () => {
      child.exitCode = 0;
      diagnostics.cleanup.closeObserved = true;
      child.emit("close");
    },
    removeProfile: async () => {
      removed = true;
    },
  });

  assert.match(result.cleanupErrors.map((error) => error.message).join("\n"), /Electron close exceeded/);
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
  const primary = new Error("renderer assertion failed token=raw-secret");
  const cleanup = new Error("close failed");
  const persistence = new Error("write failed");
  const failure = buildFailureError({
    primaryError: primary,
    diagnosticsPath: "/tmp/diagnostics.json",
    cleanupErrors: [cleanup],
    persistenceError: persistence,
  });

  assert.notEqual(failure.cause, primary);
  assert.match(failure.cause.message, /renderer assertion failed token=\[REDACTED\]/);
  assert.doesNotMatch(failure.cause.message, /raw-secret/);
  assert.doesNotMatch(failure.cause.stack ?? "", /raw-secret/);
  assert.match(failure.message, /renderer assertion failed token=\[REDACTED\]/);
  assert.match(failure.message, /diagnostics\.json/);
  assert.deepEqual(
    failure.secondaryErrors.map((error) => error.message),
    ["close failed", "write failed"],
  );
});
