import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  buildFailureError,
  finalizeDiagnostics,
  launchProcessDiagnostics,
  persistDiagnostics,
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
      message: "Authorization: Bearer secret-token token=raw-token; Authorization: Basic raw-basic; Authorization: Token raw-token-2",
      apiKey: "raw-api-key",
    },
  };

  const diagnosticsPath = await persistDiagnostics(diagnostics);
  const contents = await readFile(diagnosticsPath, "utf8");

  assert.match(contents, /Authorization: Bearer \[REDACTED\]/);
  assert.match(contents, /token=\[REDACTED\]/);
  assert.match(contents, /"apiKey": "\[REDACTED\]"/);
  assert.match(contents, /Authorization: \[REDACTED\]/);
  assert.doesNotMatch(contents, /secret-token|raw-token|raw-basic|raw-token-2|raw-api-key/);
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

  const result = await finalizeDiagnostics({
    diagnostics: diagnosticsFixture(),
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

test("persistence failure retains the profile after an otherwise successful callback", async () => {
  let removed = false;
  const result = await finalizeDiagnostics({
    diagnostics: diagnosticsFixture(),
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
