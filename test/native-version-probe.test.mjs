import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chmod, mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  buildProbeEnvironment,
  createPrivateRunRoot,
  descendantsOf,
  isExactDirectChild,
  MAX_CAPTURED_OUTPUT_BYTES,
  parseProcessTable,
  persistProbeResult,
  PROCESS_INSPECTION_TIMEOUT_MS,
  resolveElectronHelperExecutables,
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
    child.emit("close", null, signal);
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
  return async (command, args, options) => {
    const isChildAlive = typeof childAlive === "function" ? childAlive() : childAlive;
    assert.equal(command, "/bin/ps");
    assert.equal(options.env.LC_ALL, "C");
    assert.equal(options.timeout, PROCESS_INSPECTION_TIMEOUT_MS);
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

test("resolves the pinned Electron helper executable paths", async () => {
  const electronExecutable = "/opt/Electron.app/Contents/MacOS/Electron";
  const helperPaths = [];
  const helperNames = [
    "Electron Helper (Renderer).app",
    "Electron Helper.app",
    "Unrelated.app",
  ];
  const helperExecutables = await resolveElectronHelperExecutables(electronExecutable, {
    readdirFn: async () => helperNames.map((name) => ({
      name,
      isDirectory: () => true,
    })),
    statFn: async (helperPath) => {
      helperPaths.push(helperPath);
      return { isFile: () => true };
    },
  });

  assert.deepEqual(helperExecutables, [
    "/opt/Electron.app/Contents/Frameworks/Electron Helper (Renderer).app/Contents/MacOS/Electron Helper (Renderer)",
    "/opt/Electron.app/Contents/Frameworks/Electron Helper.app/Contents/MacOS/Electron Helper",
  ]);
  assert.deepEqual(helperPaths, helperExecutables);
});

test("surfaces a retained native run root when setup cleanup fails", async () => {
  let error;
  try {
    await createPrivateRunRoot({
      tmpRoot: "/tmp",
      mkdtempFn: async () => "/tmp/harbor-native-root-retained",
      chmodFn: async () => {},
      validateFn: async () => { throw new Error("run-root validation failed token=raw-run-secret"); },
      rmFn: async () => { throw new Error("run-root cleanup failed password=raw-root-secret"); },
    });
  } catch (caught) {
    error = caught;
  }

  assert.equal(error?.runRoot, "/tmp/harbor-native-root-retained");
  assert.equal(error?.cleanupError?.message, "run-root cleanup failed password=[REDACTED]");
  assert.equal(error?.cause?.message, "run-root validation failed token=[REDACTED]");
  assert.doesNotMatch(error?.stack ?? "", /raw-run-secret|raw-root-secret/);
  assert.match(error?.message ?? "", /run root retained at \/tmp\/harbor-native-root-retained/);
});

test("does not report PASS when a late Electron helper appears after the initial snapshot", async () => {
  const child = fakeChild();
  const executable = "/opt/Electron";
  const helperExecutable = "/opt/Electron.app/Contents/Frameworks/Electron Helper (Renderer).app/Contents/MacOS/Electron Helper (Renderer)";
  const startTime = "Mon Nov  4 12:00:00 2026";
  const helperPid = 4343;
  let phase = "child";
  const processLine = (pid, ppid, command) => (
    String(pid) + " " + String(ppid) + " " + String(pid) + " " + startTime + " " + command + "\n"
  );
  const execFileFn = async (command, args) => {
    assert.equal(command, "/bin/ps");
    if (args[0] === "-p") {
      const pid = Number(args[1]);
      if (pid === 100) return { stdout: processLine(100, 1, "/opt/homebrew/bin/node supervisor.mjs") };
      if (pid === child.pid && phase === "child") return { stdout: processLine(child.pid, 100, executable + " --version") };
      if (pid === helperPid && phase === "helper") return { stdout: processLine(helperPid, 1, helperExecutable) };
      const error = new Error("process not found");
      error.code = 1;
      throw error;
    }
    if (args[0] === "-axo") {
      return {
        stdout: processLine(100, 1, "/opt/homebrew/bin/node supervisor.mjs")
          + (phase === "child" ? processLine(child.pid, 100, executable + " --version") : "")
          + (phase === "helper" ? processLine(helperPid, 1, helperExecutable) : ""),
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
    helperExecutables: [helperExecutable],
    spawnFn: () => {
      setImmediate(() => {
        phase = "helper";
        child.exitCode = 0;
        child.signalCode = null;
        child.stdout.emit("data", "44.7.0\n");
        child.emit("exit", 0, null);
        child.emit("close", 0, null);
      });
      return child;
    },
    execFileFn,
    validateRunRootFn: async () => "/private/run-root",
  });

  assert.equal(result.outcome, "INCONCLUSIVE");
  assert.equal(result.disposition, "CLEANUP_FAILURE");
  assert.deepEqual(result.process.descendants, []);
  assert.deepEqual(result.process.unattributedElectronProcesses.map((record) => record.pid), [helperPid]);
  assert.match(result.errors.join("\n"), /unattributed matching Electron process records remain/);
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
        child.emit("close", 0, null);
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

test("downgrades a version result when a lifecycle error arrives after close", async () => {
  const child = fakeChild();
  let childAlive = true;
  const executable = "/opt/Electron";
  const result = await runVersionProbe({
    repoRoot: "/repo",
    electronExecutable: executable,
    provenance: { status: true, toolchain: { electron: "44.7.0" } },
    runRoot: "/private/run-root",
    supervisorPid: 100,
    spawnFn: () => {
      setImmediate(() => {
        childAlive = false;
        child.exitCode = 0;
        child.signalCode = null;
        child.stdout.emit("data", "v44.7.0\n");
        child.emit("exit", 0, null);
        child.emit("close", 0, null);
        setTimeout(() => child.emit("error", new Error("late child error")), 30);
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
  assert.match(result.errors.join("\n"), /late child error/);
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
    child.emit("close", null, signal);
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

test("uses the verified launch handle when ps temporarily omits the child during escalation", async () => {
  const child = fakeChild();
  const executable = "/opt/Electron";
  const startTime = "Mon Nov  4 12:00:00 2026";
  const descendantPid = 4343;
  let tableCalls = 0;
  let descendantAlive = true;
  const childSignals = [];
  const processLine = (pid, ppid, command) => (
    `${pid} ${ppid} ${pid} ${startTime} ${command}\n`
  );

  child.kill = (signal) => {
    childSignals.push(signal);
    if (signal === "SIGKILL") {
      child.signalCode = signal;
      child.emit("exit", null, signal);
      child.emit("close", null, signal);
    }
    return true;
  };

  const execFileFn = async (command, args) => {
    assert.equal(command, "/bin/ps");
    if (args[0] === "-p") {
      const pid = Number(args[1]);
      if (pid === 100) return { stdout: processLine(100, 1, "/opt/homebrew/bin/node supervisor.mjs") };
      if (pid === descendantPid && descendantAlive) {
        return { stdout: processLine(descendantPid, child.pid, executable + " Helper") };
      }
      const error = new Error("process not found");
      error.code = 1;
      throw error;
    }
    if (args[0] === "-axo") {
      tableCalls += 1;
      if (tableCalls === 1) {
        return {
          stdout: processLine(100, 1, "/opt/homebrew/bin/node supervisor.mjs")
            + processLine(child.pid, 100, executable + " --version")
            + processLine(descendantPid, child.pid, executable + " Helper"),
        };
      }
      return { stdout: processLine(100, 1, "/opt/homebrew/bin/node supervisor.mjs") };
    }
    throw new Error("unexpected ps invocation");
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
    execFileFn,
    killFn: (_pid, signal) => {
      if (signal === "SIGTERM" || signal === "SIGKILL") descendantAlive = false;
    },
    validateRunRootFn: async () => "/private/run-root",
  });

  assert.equal(result.outcome, "INCONCLUSIVE");
  assert.equal(result.disposition, "CLEANUP_FAILURE");
  assert.deepEqual(childSignals, ["SIGTERM", "SIGKILL"]);
});

test("classifies an asynchronous child error as failure when cleanup is verified", async () => {
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
      queueMicrotask(() => {
        childAlive = false;
        const error = new Error("spawn denied");
        error.code = "EACCES";
        child.stderr.emit("error", new Error("stderr capture failed before child error"));
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
  assert.match(result.errors.join("\n"), /stderr capture failed before child error/);
  assert.equal(child.listenerCount("error"), 1);
  assert.equal(child.listenerCount("exit"), 0);
  assert.equal(child.listenerCount("close"), 0);
});

test("retains stream capture errors when a version probe times out", async () => {
  const child = fakeChild();
  let childAlive = true;
  const executable = "/opt/Electron";
  child.kill = (signal) => {
    childAlive = false;
    child.signalCode = signal;
    child.emit("exit", null, signal);
    child.emit("close", null, signal);
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
    spawnFn: () => {
      setImmediate(() => child.stderr.emit("error", new Error("stderr capture failed during timeout")));
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

  assert.equal(result.outcome, "TIMEOUT");
  assert.match(result.errors.join("\n"), /stderr capture failed during timeout/);
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
        child.emit("close", 0, null);
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

test("does not report PASS when a verified descendant is reparented after child exit", async () => {
  const child = fakeChild();
  let phase = "alive";
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
      if (pid === child.pid && phase === "alive") return { stdout: processLine(child.pid, 100, executable + " --version") };
      if (pid === descendantPid) {
        return { stdout: processLine(descendantPid, phase === "alive" ? child.pid : 1, executable + " Helper") };
      }
      const error = new Error("process not found");
      error.code = 1;
      throw error;
    }
    if (args[0] === "-axo") {
      return {
        stdout: processLine(100, 1, "/opt/homebrew/bin/node supervisor.mjs")
          + (phase === "alive" ? processLine(child.pid, 100, executable + " --version") : "")
          + processLine(descendantPid, phase === "alive" ? child.pid : 1, executable + " Helper"),
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
        phase = "reparented";
        child.exitCode = 0;
        child.signalCode = null;
        child.stdout.emit("data", "44.7.0\n");
        child.emit("exit", 0, null);
        child.emit("close", 0, null);
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
  assert.match(result.errors.join("\n"), /owned descendant snapshot remains/);
});

test("classifies a synchronous spawn exception without leaking an unhandled failure", async () => {
  const result = await runVersionProbe({
    repoRoot: "/repo",
    electronExecutable: "/opt/Electron",
    provenance: { status: true, toolchain: { electron: "44.7.0" } },
    runRoot: "/private/run-root",
    supervisorPid: 100,
    spawnFn: () => {
      const error = new Error("spawn denied synchronously");
      error.code = "EACCES";
      throw error;
    },
    execFileFn: fakeExecFile({ supervisorPid: 100, childPid: 4242, executable: "/opt/Electron" }),
    validateRunRootFn: async () => "/private/run-root",
  });

  assert.equal(result.outcome, "FAILURE");
  assert.equal(result.disposition, "FAILURE");
  assert.equal(result.startupPhase, "electron-launch");
  assert.match(result.errors.join("\n"), /spawn denied synchronously/);
});

test("treats a missing child PID as inconclusive and does not claim cleanup verification", async () => {
  const child = fakeChild(0);
  const result = await runVersionProbe({
    repoRoot: "/repo",
    electronExecutable: "/opt/Electron",
    provenance: { status: true, toolchain: { electron: "44.7.0" } },
    runRoot: "/private/run-root",
    supervisorPid: 100,
    graceMs: 1,
    spawnFn: () => child,
    execFileFn: fakeExecFile({ supervisorPid: 100, childPid: 0, executable: "/opt/Electron" }),
    validateRunRootFn: async () => "/private/run-root",
  });

  assert.equal(result.outcome, "INCONCLUSIVE");
  assert.equal(result.disposition, "CLEANUP_FAILURE");
  assert.equal(child.signalCode, "SIGTERM");
  assert.match(result.errors.join("\n"), /descendant cleanup could not be verified/);
});

test("waits for close after exit so delayed output is retained before success", async () => {
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
        child.exitCode = 0;
        child.signalCode = null;
        child.emit("exit", 0, null);
        setTimeout(() => {
          child.stdout.emit("data", "v44.7.0\n");
          child.emit("close", 0, null);
        }, 5);
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
  assert.equal(result.processExit.closeObserved, true);
  assert.equal(result.stdout, "v44.7.0\n");
});

test("joins and sanitizes complete stdout and stderr streams before retaining them", async () => {
  const child = fakeChild();
  let childAlive = true;
  const executable = "/opt/Electron";
  const result = await runVersionProbe({
    repoRoot: "/repo",
    electronExecutable: executable,
    provenance: { status: true, toolchain: { electron: "44.7.0" } },
    runRoot: "/private/run-root",
    supervisorPid: 100,
    spawnFn: () => {
      setImmediate(() => {
        childAlive = false;
        child.exitCode = 0;
        child.signalCode = null;
        child.stdout.emit("data", "Authorization ");
        child.stdout.emit("data", "Foo+Bar split-secret\n");
        child.stderr.emit("data", "clientSecret=");
        child.stderr.emit("data", "stderr-secret\n");
        child.emit("exit", 0, null);
        child.emit("close", 0, null);
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
  assert.match(result.stdout, /Authorization Foo\+Bar \[REDACTED\]/);
  assert.match(result.stderr, /clientSecret=\[REDACTED\]/);
  assert.doesNotMatch(result.stdout + result.stderr, /split-secret|stderr-secret/);
});

test("bounds retained version-probe output and records truncation", async () => {
  const child = fakeChild();
  let childAlive = true;
  const executable = "/opt/Electron";
  const result = await runVersionProbe({
    repoRoot: "/repo",
    electronExecutable: executable,
    provenance: { status: true, toolchain: { electron: "44.7.0" } },
    runRoot: "/private/run-root",
    supervisorPid: 100,
    spawnFn: () => {
      setImmediate(() => {
        childAlive = false;
        child.exitCode = 0;
        child.signalCode = null;
        child.stdout.emit("data", "x".repeat(MAX_CAPTURED_OUTPUT_BYTES - 1) + "éé");
        child.emit("exit", 0, null);
        child.emit("close", 0, null);
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
  assert.ok(Buffer.byteLength(result.stdout, "utf8") <= MAX_CAPTURED_OUTPUT_BYTES);
  assert.match(result.errors.join("\n"), /stdout capture exceeded/);
});

test("treats a stdout capture error as a primary failure and still verifies cleanup", async () => {
  const child = fakeChild();
  let childAlive = true;
  const executable = "/opt/Electron";
  const result = await runVersionProbe({
    repoRoot: "/repo",
    electronExecutable: executable,
    provenance: { status: true, toolchain: { electron: "44.7.0" } },
    runRoot: "/private/run-root",
    supervisorPid: 100,
    spawnFn: () => {
      setImmediate(() => {
        childAlive = false;
        child.exitCode = 0;
        child.signalCode = null;
        child.stdout.emit("error", new Error("stdout capture failed"));
        child.stdout.emit("data", "v44.7.0\n");
        child.emit("exit", 0, null);
        child.emit("close", 0, null);
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
  assert.equal(result.process.termination.length, 0);
  assert.match(result.errors.join("\n"), /stdout capture failed/);
});

test("classifies nonzero, signal, and malformed version results as failures", async (t) => {
  const cases = [
    { name: "nonzero", code: 2, signal: null, stdout: "v44.7.0\n" },
    { name: "signal", code: null, signal: "SIGABRT", stdout: "" },
    { name: "malformed", code: 0, signal: null, stdout: "not-electron\n" },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const child = fakeChild();
      let childAlive = true;
      const executable = "/opt/Electron";
      const result = await runVersionProbe({
        repoRoot: "/repo",
        electronExecutable: executable,
        provenance: { status: true, toolchain: { electron: "44.7.0" } },
        runRoot: "/private/run-root",
        supervisorPid: 100,
        execFileFn: fakeExecFile({
          supervisorPid: 100,
          childPid: child.pid,
          executable,
          childAlive: () => childAlive,
        }),
        spawnFn: () => {
          setImmediate(() => {
            childAlive = false;
            child.exitCode = scenario.code;
            child.signalCode = scenario.signal;
            if (scenario.stdout) child.stdout.emit("data", scenario.stdout);
            child.emit("exit", scenario.code, scenario.signal);
            child.emit("close", scenario.code, scenario.signal);
          });
          return child;
        },
        validateRunRootFn: async () => "/private/run-root",
      });

      assert.equal(result.outcome, "FAILURE");
      assert.equal(result.disposition, "FAILURE");
      assert.match(result.errors.join("\n"), /version probe did not return 44\.7\.0/);
    });
  }
});

test("preserves an inspection failure and still attempts only the direct child handle", async () => {
  const child = fakeChild();
  const signals = [];
  child.kill = (signal) => {
    signals.push(signal);
    child.signalCode = signal;
    child.emit("exit", null, signal);
    child.emit("close", null, signal);
    return true;
  };
  let processTableCalls = 0;
  const result = await runVersionProbe({
    repoRoot: "/repo",
    electronExecutable: "/opt/Electron",
    provenance: { status: true, toolchain: { electron: "44.7.0" } },
    runRoot: "/private/run-root",
    supervisorPid: 100,
    graceMs: 1,
    spawnFn: () => child,
    execFileFn: async (command, args, options) => {
      assert.equal(command, "/bin/ps");
      assert.equal(options.timeout, PROCESS_INSPECTION_TIMEOUT_MS);
      if (args[0] === "-p" && Number(args[1]) === 100) {
        return { stdout: "100 1 100 Mon Nov  4 12:00:00 2026 /opt/homebrew/bin/node supervisor.mjs\n" };
      }
      processTableCalls += 1;
      throw new Error("ps inspection unavailable");
    },
    validateRunRootFn: async () => "/private/run-root",
  });

  assert.equal(result.outcome, "INCONCLUSIVE");
  assert.equal(result.disposition, "CLEANUP_FAILURE");
  assert.deepEqual(signals, ["SIGTERM"]);
  assert.ok(processTableCalls >= 1);
  assert.match(result.errors.join("\n"), /ps inspection unavailable/);
  assert.doesNotMatch(result.errors.join("\n"), /process-group signal/);
});

test("uses the launch handle when ps has no record for the still-live direct child", async () => {
  const child = fakeChild();
  const signals = [];
  child.kill = (signal) => {
    signals.push(signal);
    child.signalCode = signal;
    child.emit("exit", null, signal);
    child.emit("close", null, signal);
    return true;
  };
  const execFileFn = async (command, args) => {
    assert.equal(command, "/bin/ps");
    if (args[0] === "-p" && Number(args[1]) === 100) {
      return { stdout: "100 1 100 Mon Nov  4 12:00:00 2026 /opt/homebrew/bin/node supervisor.mjs\n" };
    }
    if (args[0] === "-axo") {
      return { stdout: "100 1 100 Mon Nov  4 12:00:00 2026 /opt/homebrew/bin/node supervisor.mjs\n" };
    }
    const error = new Error("process not found");
    error.code = 1;
    throw error;
  };
  const result = await runVersionProbe({
    repoRoot: "/repo",
    electronExecutable: "/opt/Electron",
    provenance: { status: true, toolchain: { electron: "44.7.0" } },
    runRoot: "/private/run-root",
    supervisorPid: 100,
    graceMs: 1,
    spawnFn: () => child,
    execFileFn,
    validateRunRootFn: async () => "/private/run-root",
  });

  assert.equal(result.outcome, "INCONCLUSIVE");
  assert.equal(result.disposition, "CLEANUP_FAILURE");
  assert.deepEqual(signals, ["SIGTERM"]);
  assert.match(result.errors.join("\n"), /direct child identity could not be reverified/);
});

test("never signals the launch handle after a conflicting child identity appears", async () => {
  const child = fakeChild();
  const signals = [];
  const executable = "/opt/Electron";
  let tableCalls = 0;
  child.kill = (signal) => {
    signals.push(signal);
    return true;
  };
  const processLine = (pid, ppid, command) => (
    `${pid} ${ppid} ${pid} Mon Nov  4 12:00:00 2026 ${command}\n`
  );
  const execFileFn = async (command, args) => {
    assert.equal(command, "/bin/ps");
    if (args[0] === "-p" && Number(args[1]) === 100) {
      return { stdout: processLine(100, 1, "/opt/homebrew/bin/node supervisor.mjs") };
    }
    if (args[0] === "-axo") {
      tableCalls += 1;
      const childPpid = tableCalls === 1 ? 100 : 999;
      return {
        stdout: processLine(100, 1, "/opt/homebrew/bin/node supervisor.mjs")
          + processLine(child.pid, childPpid, executable + " --version"),
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
    timeoutMs: 1,
    graceMs: 1,
    spawnFn: () => child,
    execFileFn,
    validateRunRootFn: async () => "/private/run-root",
  });

  assert.equal(result.outcome, "INCONCLUSIVE");
  assert.equal(result.disposition, "CLEANUP_FAILURE");
  assert.deepEqual(signals, []);
  assert.match(result.errors.join("\n"), /conflicting direct-child process identity/);
});

test("never escalates the launch handle after a conflicting identity with descendants", async () => {
  const child = fakeChild();
  const signals = [];
  const executable = "/opt/Electron";
  const descendantPid = 4343;
  let tableCalls = 0;
  child.kill = (signal) => {
    signals.push(signal);
    return true;
  };
  const processLine = (pid, ppid, command) => (
    `${pid} ${ppid} ${pid} Mon Nov  4 12:00:00 2026 ${command}\n`
  );
  const execFileFn = async (command, args) => {
    assert.equal(command, "/bin/ps");
    if (args[0] === "-p" && Number(args[1]) === 100) {
      return { stdout: processLine(100, 1, "/opt/homebrew/bin/node supervisor.mjs") };
    }
    if (args[0] === "-p" && Number(args[1]) === descendantPid) {
      const error = new Error("process not found");
      error.code = 1;
      throw error;
    }
    if (args[0] === "-axo") {
      tableCalls += 1;
      if (tableCalls === 1) {
        return {
          stdout: processLine(100, 1, "/opt/homebrew/bin/node supervisor.mjs")
            + processLine(child.pid, 100, executable + " --version")
            + processLine(descendantPid, child.pid, executable + " Helper"),
        };
      }
      if (tableCalls === 2) {
        return {
          stdout: processLine(100, 1, "/opt/homebrew/bin/node supervisor.mjs")
            + processLine(child.pid, 999, executable + " --version"),
        };
      }
      return { stdout: processLine(100, 1, "/opt/homebrew/bin/node supervisor.mjs") };
    }
    throw new Error("unexpected ps invocation");
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
    execFileFn,
    validateRunRootFn: async () => "/private/run-root",
  });

  assert.equal(result.outcome, "INCONCLUSIVE");
  assert.equal(result.disposition, "CLEANUP_FAILURE");
  assert.deepEqual(signals, []);
  assert.match(result.errors.join("\n"), /conflicting direct-child process identity/);
});

test("does not report PASS when the child exits before ownership can be observed", async () => {
  const child = fakeChild();
  child.exitCode = 0;
  child.signalCode = null;
  const result = await runVersionProbe({
    repoRoot: "/repo",
    electronExecutable: "/opt/Electron",
    provenance: { status: true, toolchain: { electron: "44.7.0" } },
    runRoot: "/private/run-root",
    supervisorPid: 100,
    spawnFn: () => child,
    execFileFn: fakeExecFile({
      supervisorPid: 100,
      childPid: child.pid,
      executable: "/opt/Electron",
      childAlive: false,
    }),
    validateRunRootFn: async () => "/private/run-root",
  });

  assert.equal(result.outcome, "INCONCLUSIVE");
  assert.notEqual(result.outcome, "PASS");
  assert.match(result.errors.join("\n"), /ownership was not verified/);
});

test("does not verify cleanup when child close is never observed", async () => {
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

  assert.equal(result.outcome, "INCONCLUSIVE");
  assert.equal(result.disposition, "CLEANUP_FAILURE");
  assert.match(result.errors.join("\n"), /close was not observed/);
});
