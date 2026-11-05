import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chmod, mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  buildProbeEnvironment,
  descendantsOf,
  isExactDirectChild,
  parseProcessTable,
  persistProbeResult,
  runVersionProbe,
  validatePrivateRunRoot,
} from "../e2e/native-version-probe.mjs";

function fakeStream() {
  const stream = new EventEmitter();
  stream.setEncoding = () => {};
  return stream;
}

function fakeChild(pid = 4242) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = fakeStream();
  child.stderr = fakeStream();
  child.kill = (signal) => {
    child.signalCode = signal;
    child.exitCode = null;
    child.emit("exit", null, signal);
    return true;
  };
  return child;
}

function fakeExecFile({
  supervisorPid,
  childPid,
  executable,
  childAlive = true,
  startTime = "Mon Nov  4 12:00:00 2026",
} = {}) {
  return async (command, args) => {
    const isChildAlive = typeof childAlive === "function" ? childAlive() : childAlive;
    assert.equal(command, "/bin/ps");
    if (args[0] === "-p") {
      const pid = Number(args[1]);
      if (pid === supervisorPid) {
        return { stdout: `${supervisorPid} 100 ${supervisorPid} ${startTime} /opt/homebrew/bin/node supervisor.mjs\n` };
      }
      if (pid === childPid && isChildAlive) {
        return { stdout: `${childPid} ${supervisorPid} ${childPid} ${startTime} ${executable} --version\n` };
      }
      const error = new Error("process not found");
      error.code = 1;
      throw error;
    }
    if (args[0] === "-axo") {
      return {
        stdout: isChildAlive
          ? `${supervisorPid} 100 ${supervisorPid} ${startTime} /opt/homebrew/bin/node supervisor.mjs\n${childPid} ${supervisorPid} ${childPid} ${startTime} ${executable} --version\n`
          : `${supervisorPid} 100 ${supervisorPid} ${startTime} /opt/homebrew/bin/node supervisor.mjs\n`,
      };
    }
    throw new Error("unexpected ps invocation");
  };
}

test("removes only Electron override variables from the inherited environment", () => {
  const environment = buildProbeEnvironment({
    PATH: "/usr/bin",
    TMPDIR: "/tmp/",
    ELECTRON_RUN_AS_NODE: "1",
    ELECTRON_MIRROR: "https://invalid.example",
  });

  assert.deepEqual(environment, { PATH: "/usr/bin", TMPDIR: "/tmp/" });
});

test("parses process ownership records and descendants without using a process group", () => {
  const records = parseProcessTable(
    "100 1 100 Mon Nov  4 12:00:00 2026 /bin/zsh\n200 100 100 Mon Nov  4 12:00:01 2026 /opt/Electron --version\n300 200 100 Mon Nov  4 12:00:02 2026 /opt/Electron Helper\n",
  );
  assert.equal(isExactDirectChild(records[1], {
    childPid: 200,
    supervisorPid: 100,
    executable: "/opt/Electron",
  }), true);
  assert.deepEqual(descendantsOf(200, records).map((record) => record.pid), [300]);
  assert.equal(records[1].pgid, 100);
  assert.equal(records[1].startTime, "Mon Nov  4 12:00:01 2026");
});

test("validates a private mode-700 run root", async () => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), "harbor-version-root-test-"));
  try {
    await chmod(runRoot, 0o700);
    const resolved = await validatePrivateRunRoot(runRoot);
    assert.equal(resolved, await realpath(runRoot));
  } finally {
    await rm(runRoot, { recursive: true, force: true });
  }
});

test("returns PASS for an exact version with verified direct-child cleanup", async () => {
  const child = fakeChild();
  let childAlive = true;
  const executable = "/opt/Electron";
  const provenance = { status: true, toolchain: { electron: "44.7.0" } };
  const result = await runVersionProbe({
    repoRoot: "/repo",
    electronExecutable: executable,
    provenance,
    runRoot: "/private/run-root",
    supervisorPid: 100,
    spawnFn: () => {
      setImmediate(() => {
        childAlive = false;
        child.exitCode = 0;
        child.signalCode = null;
        child.stdout.emit("data", "v44.7.0\n");
        child.emit("exit", 0, null);
      });
      return child;
    },
    execFileFn: fakeExecFile({
      supervisorPid: 100,
      childPid: child.pid,
      executable,
      childAlive: () => childAlive,
    }),
    validateRunRootFn: async () => "/private/run-root",
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.disposition, "PASS");
  assert.equal(result.process.ownership, "direct-child-handle");
  assert.equal(result.process.termination.length, 0);
});

test("times out and signals only the verified child PID, never its process group", async () => {
  const child = fakeChild();
  let childAlive = true;
  const signals = [];
  const executable = "/opt/Electron";
  child.kill = (signal) => {
    childAlive = false;
    child.signalCode = signal;
    child.emit("exit", null, signal);
    return true;
  };
  const result = await runVersionProbe({
    repoRoot: "/repo",
    electronExecutable: executable,
    provenance: { status: true, toolchain: { electron: "44.7.0" } },
    runRoot: "/private/run-root",
    supervisorPid: 100,
    timeoutMs: 1,
    graceMs: 1,
    spawnFn: () => child,
    killFn: (pid, signal) => signals.push({ pid, signal }),
    execFileFn: fakeExecFile({
      supervisorPid: 100,
      childPid: child.pid,
      executable,
      childAlive: () => childAlive,
    }),
    validateRunRootFn: async () => "/private/run-root",
  });

  assert.equal(result.outcome, "TIMEOUT");
  assert.deepEqual(signals, []);
  assert.deepEqual(result.process.termination, []);
  assert.equal(child.signalCode, "SIGTERM");
});

test("classifies a direct-child spawn error as FAILURE rather than TIMEOUT", async () => {
  const child = fakeChild();
  let childAlive = true;
  const executable = "/opt/Electron";
  const result = await runVersionProbe({
    repoRoot: "/repo",
    electronExecutable: executable,
    provenance: { status: true, toolchain: { electron: "44.7.0" } },
    runRoot: "/private/run-root",
    supervisorPid: 100,
    timeoutMs: 50,
    graceMs: 1,
    spawnFn: () => {
      setImmediate(() => {
        childAlive = false;
        const error = new Error("spawn denied");
        error.code = "EACCES";
        child.emit("error", error);
      });
      return child;
    },
    execFileFn: fakeExecFile({
      supervisorPid: 100,
      childPid: child.pid,
      executable,
      childAlive: () => childAlive,
    }),
    validateRunRootFn: async () => "/private/run-root",
  });

  assert.equal(result.outcome, "FAILURE");
  assert.equal(result.disposition, "FAILURE");
  assert.match(result.errors.join("\n"), /spawn denied/);
});

test("classifies diagnostics-write failure and never leaves a stale PASS", async () => {
  const result = await persistProbeResult({
    runRoot: "/private/run-root",
    outcome: "PASS",
    disposition: "PASS",
    errors: [],
  }, {
    writeFileFn: async () => {
      throw new Error("diagnostic disk failure");
    },
  });

  assert.equal(result.outcome, "INCONCLUSIVE");
  assert.equal(result.disposition, "CLEANUP_FAILURE");
  assert.match(result.errors.join("\n"), /diagnostic disk failure/);
});

test("downgrades a run when a verified descendant remains after child exit", async () => {
  const child = fakeChild();
  const executable = "/opt/Electron";
  const startTime = "Mon Nov  4 12:00:00 2026";
  const descendantPid = 4343;
  const processLine = (pid, ppid, command) => (
    String(pid) + " " + String(ppid) + " " + String(pid) + " " + startTime + " " + command + "\n"
  );
  const execFileFn = async (command, args) => {
    assert.equal(command, "/bin/ps");
    if (args[0] === "-p") {
      const pid = Number(args[1]);
      if (pid === 100) return { stdout: processLine(100, 1, "/opt/homebrew/bin/node supervisor.mjs") };
      if (pid === child.pid) return { stdout: processLine(child.pid, 100, executable + " --version") };
      if (pid === descendantPid) return { stdout: processLine(descendantPid, child.pid, executable + " Helper") };
      const error = new Error("process not found");
      error.code = 1;
      throw error;
    }
    if (args[0] === "-axo") {
      return {
        stdout: processLine(100, 1, "/opt/homebrew/bin/node supervisor.mjs")
          + processLine(child.pid, 100, executable + " --version")
          + processLine(descendantPid, child.pid, executable + " Helper"),
      };
    }
    throw new Error("unexpected ps invocation");
  };
  const result = await runVersionProbe({
    repoRoot: "/repo",
    electronExecutable: executable,
    provenance: { status: true, toolchain: { electron: "44.7.0" } },
    runRoot: "/private/run-root",
    supervisorPid: 100,
    spawnFn: () => {
      setImmediate(() => {
        child.exitCode = 0;
        child.stdout.emit("data", "44.7.0\n");
        child.emit("exit", 0, null);
      });
      return child;
    },
    execFileFn,
    killFn: () => {},
    validateRunRootFn: async () => "/private/run-root",
  });

  assert.equal(result.outcome, "INCONCLUSIVE");
  assert.equal(result.disposition, "CLEANUP_FAILURE");
  assert.deepEqual(result.process.descendants.map((record) => record.pid), [descendantPid]);
});
