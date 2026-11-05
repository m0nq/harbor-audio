import { spawn as defaultSpawn, execFile as defaultExecFile } from "node:child_process";
import { chmod, lstat, mkdtemp, realpath, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  collectRunProvenance,
  diagnosticsText,
  expectedProvenanceFromEnvironment,
  sanitizeDiagnosticsText,
  validateExpectedProvenance,
} from "./launch-diagnostics.mjs";

export const EXPECTED_ELECTRON_VERSION = "44.7.0";
export const VERSION_PROBE_TIMEOUT_MS = 15_000;
export const VERSION_PROBE_TERMINATION_GRACE_MS = 2_000;
export const PROCESS_INSPECTION_TIMEOUT_MS = 5_000;
export const ELECTRON_OVERRIDE_NAMES = [
  "ELECTRON_CACHE",
  "ELECTRON_MIRROR",
  "ELECTRON_OVERRIDE_DIST_PATH",
  "ELECTRON_RUN_AS_NODE",
  "NPM_CONFIG_ELECTRON_MIRROR",
  "npm_config_electron_mirror",
];

const execFile = promisify(defaultExecFile);

function processDiagnosticEnvironment() {
  return { ...process.env, LC_ALL: "C" };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function recordFromLine(line) {
  const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
  if (!match) return undefined;
  const startMatch = match[4].match(/^([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/);
  if (!startMatch) return undefined;
  return {
    pid: Number(match[1]),
    ppid: Number(match[2]),
    pgid: Number(match[3]),
    startTime: startMatch[1],
    command: startMatch[2].trim(),
  };
}

export function parseProcessTable(stdout) {
  return String(stdout)
    .split("\n")
    .map(recordFromLine)
    .filter(Boolean);
}

export function descendantsOf(rootPid, records) {
  const children = new Map();
  for (const record of records) {
    const siblings = children.get(record.ppid) ?? [];
    siblings.push(record);
    children.set(record.ppid, siblings);
  }

  const descendants = [];
  const queue = [...(children.get(rootPid) ?? [])];
  while (queue.length > 0) {
    const record = queue.shift();
    descendants.push(record);
    queue.push(...(children.get(record.pid) ?? []));
  }
  return descendants;
}

export function isExactDirectChild(record, { childPid, supervisorPid, executable }) {
  if (!record || record.pid !== childPid || record.ppid !== supervisorPid || record.pgid <= 0 || !record.startTime) return false;
  return record.command === executable
    || record.command.startsWith(`${executable} `)
    || record.command.startsWith(`"${executable}" `);
}

export function buildProbeEnvironment(baseEnvironment = process.env) {
  const environment = Object.fromEntries(
    Object.entries(baseEnvironment).filter(([, value]) => value !== undefined),
  );
  for (const name of ELECTRON_OVERRIDE_NAMES) delete environment[name];
  return environment;
}

export async function validatePrivateRunRoot(
  runRoot,
  {
    lstatFn = lstat,
    realpathFn = realpath,
    statFn = stat,
    uid = process.getuid?.(),
  } = {},
) {
  if (!Number.isInteger(uid)) throw new Error("private run-root ownership cannot be established");
  const linkInfo = await lstatFn(runRoot);
  if (linkInfo.isSymbolicLink()) throw new Error("private run-root must not be a symlink");
  const resolvedRoot = await realpathFn(runRoot);
  const rootInfo = await statFn(resolvedRoot);
  if (!rootInfo.isDirectory()) throw new Error("private run-root is not a directory");
  if (rootInfo.uid !== uid) throw new Error("private run-root is not owned by the supervisor");
  if ((rootInfo.mode & 0o777) !== 0o700) throw new Error("private run-root permissions are not 0700");
  return resolvedRoot;
}

export async function createPrivateRunRoot({ tmpRoot = os.tmpdir() } = {}) {
  const runRoot = await mkdtemp(path.join(tmpRoot, "harbor-native-version-"));
  await chmod(runRoot, 0o700);
  return validatePrivateRunRoot(runRoot);
}

async function processRecord(pid, execFileFn) {
  try {
    const result = await execFileFn("/bin/ps", ["-p", String(pid), "-o", "pid=,ppid=,pgid=,lstart=,command="], {
      env: processDiagnosticEnvironment(),
      maxBuffer: 1024 * 1024,
      timeout: PROCESS_INSPECTION_TIMEOUT_MS,
    });
    return parseProcessTable(result.stdout)[0];
  } catch (error) {
    if (error?.code === 1) return undefined;
    throw error;
  }
}

async function processTable(execFileFn) {
  const result = await execFileFn("/bin/ps", ["-axo", "pid=,ppid=,pgid=,lstart=,command="], {
    env: processDiagnosticEnvironment(),
    maxBuffer: 4 * 1024 * 1024,
    timeout: PROCESS_INSPECTION_TIMEOUT_MS,
  });
  return parseProcessTable(result.stdout);
}

async function verifySupervisor(execFileFn, supervisorPid = process.pid) {
  const record = await processRecord(supervisorPid, execFileFn);
  if (!record || record.pid !== supervisorPid || record.ppid <= 0 || record.pgid <= 0) {
    throw new Error("supervisor PID/PPID/PGID could not be verified");
  }
  return record;
}

function childExited(child) {
  return Boolean(child && (child.exitCode !== null || child.signalCode !== null));
}

function observeChildLifecycle(child) {
  const state = {
    exitObserved: childExited(child),
    exitObservation: childExited(child)
      ? { code: child.exitCode, signal: child.signalCode }
      : undefined,
    closeObserved: false,
    error: undefined,
  };
  const onExit = (code, signal) => {
    state.exitObserved = true;
    state.exitObservation = { code, signal };
  };
  const onClose = (code, signal) => {
    state.closeObserved = true;
    if (!state.exitObserved && (code !== undefined || signal !== undefined)) {
      state.exitObservation = { code, signal };
    }
  };
  const onError = (error) => {
    state.error ??= error;
  };
  child.on?.("exit", onExit);
  child.on?.("close", onClose);
  child.on?.("error", onError);
  state.dispose = () => {
    child.removeListener?.("exit", onExit);
    child.removeListener?.("close", onClose);
    child.removeListener?.("error", onError);
  };
  return state;
}

function waitForChild(
  child,
  timeoutMs,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  lifecycle,
) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let exitObservation = lifecycle?.exitObservation ?? (childExited(child)
      ? { code: child.exitCode, signal: child.signalCode }
      : undefined);
    const cleanupListeners = () => {
      clearTimeoutFn(timer);
      child.removeListener?.("exit", onExit);
      child.removeListener?.("close", onClose);
      child.removeListener?.("error", onError);
    };
    const onExit = (code, signal) => {
      exitObservation = { code, signal };
    };
    const onClose = (code, signal) => {
      if (exitObservation === undefined) {
        if (code !== undefined || signal !== undefined) {
          exitObservation = { code, signal };
        } else {
          if (!settled) {
            settled = true;
            cleanupListeners();
            reject(new Error("Electron version probe closed before exit was observed"));
          }
          return;
        }
      }
      if (!settled) {
        settled = true;
        cleanupListeners();
        resolve({ ...exitObservation, closeObserved: true, exitObserved: true });
      } else {
        cleanupListeners();
      }
    };
    const onError = (error) => {
      if (!settled) {
        settled = true;
        cleanupListeners();
        reject(error);
      }
    };
    if (lifecycle?.error) {
      settled = true;
      reject(lifecycle.error);
      return;
    }
    if (lifecycle?.closeObserved) {
      settled = true;
      if (lifecycle.exitObserved || exitObservation !== undefined) {
        resolve({ ...exitObservation, closeObserved: true, exitObserved: true });
      } else {
        reject(new Error("Electron version probe closed before exit was observed"));
      }
      return;
    }
    const timer = setTimeoutFn(() => {
      if (!settled) {
        settled = true;
        const error = new Error(`Electron version probe exceeded ${timeoutMs}ms`);
        error.code = "ERR_VERSION_PROBE_TIMEOUT";
        cleanupListeners();
        reject(error);
      }
    }, timeoutMs);
    child.on("exit", onExit);
    child.on("close", onClose);
    child.on("error", onError);
  });
}

function captureOutput(stream, chunks) {
  const state = { errors: [] };
  if (!stream) return state;
  try {
    stream.setEncoding?.("utf8");
    stream.on("data", (chunk) => chunks.push(String(chunk)));
    stream.on("error", (error) => state.errors.push(sanitizeDiagnosticsText(errorMessage(error))));
  } catch (error) {
    state.errors.push(`output capture setup failed: ${sanitizeDiagnosticsText(errorMessage(error))}`);
  }
  return state;
}

async function ownedProcessRecords({ childPid, supervisorPid, executable, execFileFn }) {
  const records = await processTable(execFileFn);
  const childRecord = records.find((record) => record.pid === childPid);
  const directChildVerified = isExactDirectChild(childRecord, {
    childPid,
    supervisorPid,
    executable,
  });
  return {
    records,
    childRecord,
    directChildVerified,
    descendants: directChildVerified ? descendantsOf(childPid, records) : [],
  };
}

function sortForTermination(records) {
  const byPid = new Map(records.map((record) => [record.pid, record]));
  const depth = (record) => {
    let current = record;
    let count = 0;
    while (byPid.has(current.ppid)) {
      count += 1;
      current = byPid.get(current.ppid);
    }
    return count;
  };
  return [...records].sort((left, right) => depth(right) - depth(left));
}

function killDirectChildHandle(child, signal, errors) {
  if (childExited(child)) return;
  try {
    const accepted = child.kill?.(signal);
    if (accepted === false || typeof child.kill !== "function") {
      errors.push(`direct child handle did not accept ${signal}`);
    }
  } catch (error) {
    errors.push(sanitizeDiagnosticsText(errorMessage(error)));
  }
}

function sameProcessIdentity(current, record, allowReparented = false) {
  return current
    && current.pid === record.pid
    && current.pgid === record.pgid
    && current.startTime === record.startTime
    && current.command === record.command
    && (allowReparented || current.ppid === record.ppid);
}

async function signalVerifiedDescendants({
  records,
  signal,
  killFn,
  execFileFn,
  allowReparented = false,
}) {
  const errors = [];
  for (const record of sortForTermination(records)) {
    try {
      const current = await processRecord(record.pid, execFileFn);
      if (!sameProcessIdentity(current, record, allowReparented)) {
        errors.push("descendant PID " + record.pid + " failed identity recheck; no " + signal + " sent");
        continue;
      }
      killFn(record.pid, signal);
    } catch (error) {
      errors.push(sanitizeDiagnosticsText(errorMessage(error)));
    }
  }
  return errors;
}

async function recheckDescendants(records, execFileFn) {
  const errors = [];
  const remaining = [];
  for (const record of records) {
    try {
      const current = await processRecord(record.pid, execFileFn);
      if (sameProcessIdentity(current, record, true)) {
        remaining.push(current);
      } else if (current) {
        errors.push("descendant PID " + record.pid + " failed final identity recheck");
      }
    } catch (error) {
      errors.push(sanitizeDiagnosticsText(errorMessage(error)));
    }
  }
  return { errors, remaining };
}

async function terminateOwnedTree({
  child,
  childPid,
  supervisorPid,
  executable,
  execFileFn,
  killFn,
  graceMs,
  setTimeoutFn,
  clearTimeoutFn,
  lifecycle,
  initialDescendants = [],
  initialDirectChildVerified = false,
}) {
  const errors = [];
  let ownership;
  try {
    ownership = await ownedProcessRecords({ childPid, supervisorPid, executable, execFileFn });
    const descendantSnapshot = new Map(
      [...initialDescendants, ...(ownership.directChildVerified ? ownership.descendants : [])]
        .map((record) => [record.pid, record]),
    );
    if (!ownership.directChildVerified && childExited(child) && !initialDirectChildVerified) {
      errors.push("direct child ownership was not verified; no PID signal sent");
    } else if (!ownership.directChildVerified && !initialDirectChildVerified) {
      if (!childExited(child)) {
        errors.push("direct child identity could not be reverified; no descendant PID signal sent");
        if (!ownership.childRecord) {
          killDirectChildHandle(child, "SIGTERM", errors);
        } else {
          errors.push("conflicting direct-child process identity; no handle signal sent");
        }
      } else {
        errors.push("direct child ownership was not verified; no PID signal sent");
      }
    } else {
      errors.push(...await signalVerifiedDescendants({
        records: [...descendantSnapshot.values()],
        signal: "SIGTERM",
        killFn,
        execFileFn,
        allowReparented: true,
      }));
      if ((ownership.directChildVerified || initialDirectChildVerified) && !childExited(child)) {
        killDirectChildHandle(child, "SIGTERM", errors);
      }
    }
  } catch (error) {
    errors.push(sanitizeDiagnosticsText(errorMessage(error)));
    if (!childExited(child)) {
      errors.push("process table unavailable; no descendant PID signal sent");
      killDirectChildHandle(child, "SIGTERM", errors);
    }
  }

  if (!childExited(child)) {
    try {
      await waitForChild(child, graceMs, setTimeoutFn, clearTimeoutFn, lifecycle);
    } catch (error) {
      errors.push(sanitizeDiagnosticsText(errorMessage(error)));
      if (!childExited(child)) {
        errors.push("process table unavailable for escalation; no descendant PID signal sent");
        killDirectChildHandle(child, "SIGKILL", errors);
      }
    }
  }

  if (!childExited(child)) {
    try {
      const current = await ownedProcessRecords({ childPid, supervisorPid, executable, execFileFn });
      if (current.directChildVerified) {
        const descendantSnapshot = new Map(
          [...initialDescendants, ...current.descendants].map((record) => [record.pid, record]),
        );
        errors.push(...await signalVerifiedDescendants({
          records: [...descendantSnapshot.values()],
          signal: "SIGKILL",
          killFn,
          execFileFn,
          allowReparented: true,
        }));
        killDirectChildHandle(child, "SIGKILL", errors);
      } else if (initialDescendants.length > 0) {
        errors.push(...await signalVerifiedDescendants({
          records: initialDescendants,
          signal: "SIGKILL",
          killFn,
          execFileFn,
          allowReparented: true,
        }));
        if (initialDirectChildVerified && !childExited(child)) {
          killDirectChildHandle(child, "SIGKILL", errors);
        }
      } else if (!current.childRecord) {
        killDirectChildHandle(child, "SIGKILL", errors);
      } else {
        errors.push("direct child identity could not be verified for escalation; no SIGKILL sent");
      }
    } catch (error) {
      errors.push(sanitizeDiagnosticsText(errorMessage(error)));
      if (!childExited(child)) {
        errors.push("process table unavailable for escalation; no descendant PID signal sent");
        killDirectChildHandle(child, "SIGKILL", errors);
      }
    }
  }

  if (!childExited(child)) {
    try {
      await waitForChild(child, graceMs, setTimeoutFn, clearTimeoutFn, lifecycle);
    } catch (error) {
      errors.push(sanitizeDiagnosticsText(errorMessage(error)));
    }
  }

  let verifiedExit = childExited(child);
  let remainingDescendants = [];
  try {
    const remaining = await ownedProcessRecords({ childPid, supervisorPid, executable, execFileFn });
    verifiedExit = verifiedExit
      && !remaining.directChildVerified
      && !remaining.childRecord
      && remaining.descendants.length === 0;
    remainingDescendants = remaining.descendants;
    if (remainingDescendants.length > 0) {
      errors.push("owned descendant processes remain after bounded cleanup");
    }
  } catch (error) {
    verifiedExit = false;
    errors.push(sanitizeDiagnosticsText(errorMessage(error)));
  }

  if (initialDescendants.length > 0) {
    const snapshot = await recheckDescendants(initialDescendants, execFileFn);
    const byPid = new Map(remainingDescendants.map((record) => [record.pid, record]));
    for (const record of snapshot.remaining) byPid.set(record.pid, record);
    remainingDescendants = [...byPid.values()];
    errors.push(...snapshot.errors);
    if (snapshot.remaining.length > 0) {
      verifiedExit = false;
      errors.push("owned descendant snapshot remains after bounded cleanup");
    }
  }

  verifiedExit = verifiedExit && errors.length === 0;
  return { errors, verifiedExit, remainingDescendants };
}

export async function runVersionProbe({
  repoRoot,
  electronExecutable,
  provenance,
  runRoot,
  expectedVersion = EXPECTED_ELECTRON_VERSION,
  expectedProvenance,
  timeoutMs = VERSION_PROBE_TIMEOUT_MS,
  graceMs = VERSION_PROBE_TERMINATION_GRACE_MS,
  spawnFn = defaultSpawn,
  execFileFn = execFile,
  killFn = (pid, signal) => process.kill(pid, signal),
  supervisorPid = process.pid,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  validateRunRootFn = validatePrivateRunRoot,
} = {}) {
  const result = {
    outcome: "HOLD",
    startupPhase: "preflight",
    disposition: "HOLD",
    runRoot,
    command: {
      executable: electronExecutable,
      args: ["--version"],
      cwd: repoRoot,
      environmentOverridesRemoved: ELECTRON_OVERRIDE_NAMES,
    },
    provenance,
    process: {
      supervisorPid,
      supervisorPgid: undefined,
      directChildPid: undefined,
      directChildPgid: undefined,
      ownership: "not-established",
      ownershipSource: "none",
      descendants: [],
      termination: [],
    },
    stdout: "",
    stderr: "",
    errors: [],
  };

  try {
    const supervisor = await verifySupervisor(execFileFn, supervisorPid);
    result.process.supervisorPgid = supervisor.pgid;
    if (!provenance?.status) throw new Error("exact native provenance is incomplete");
    if (provenance.toolchain?.electron !== expectedVersion) {
      throw new Error(`Electron package version is not ${expectedVersion}`);
    }
    const provenanceMismatches = validateExpectedProvenance(provenance, expectedProvenance);
    if (provenanceMismatches.length > 0) {
      throw new Error(`exact native provenance mismatch: ${provenanceMismatches.join("; ")}`);
    }
    await validateRunRootFn(runRoot);
  } catch (error) {
    result.errors.push(sanitizeDiagnosticsText(errorMessage(error)));
    return result;
  }

  let child;
  try {
    child = spawnFn(electronExecutable, ["--version"], {
      cwd: repoRoot,
      env: buildProbeEnvironment(),
      shell: false,
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    result.startupPhase = "electron-launch";
    result.outcome = "FAILURE";
    result.disposition = "FAILURE";
    result.errors.push(sanitizeDiagnosticsText(errorMessage(error)));
    return result;
  }
  if (!child || typeof child !== "object") {
    result.startupPhase = "electron-launch";
    result.outcome = "FAILURE";
    result.disposition = "FAILURE";
    result.errors.push("spawn did not return a child-process handle");
    return result;
  }
  const lifecycle = observeChildLifecycle(child);
  const stdout = [];
  const stderr = [];
  const stdoutState = captureOutput(child.stdout, stdout);
  const stderrState = captureOutput(child.stderr, stderr);
  const finalizeOutput = () => {
    const rawStdout = stdout.join("");
    const rawStderr = stderr.join("");
    result.stdout = sanitizeDiagnosticsText(rawStdout);
    result.stderr = sanitizeDiagnosticsText(rawStderr);
    return { rawStdout, rawStderr };
  };
  const appendOutputErrors = () => {
    const outputErrors = [...stdoutState.errors, ...stderrState.errors];
    for (const outputError of outputErrors) {
      if (!result.errors.includes(outputError)) result.errors.push(outputError);
    }
    return outputErrors;
  };
  let initialDescendants = [];
  let initialDirectChildVerified = false;
  if (!Number.isSafeInteger(child.pid) || child.pid <= 0) {
    result.startupPhase = "electron-launch";
    result.outcome = "INCONCLUSIVE";
    result.disposition = "INCONCLUSIVE";
    result.errors.push("direct child PID was not provided");
    try {
      child.kill?.("SIGTERM");
      await waitForChild(child, graceMs, setTimeoutFn, clearTimeoutFn, lifecycle);
    } catch (error) {
      result.errors.push(sanitizeDiagnosticsText(errorMessage(error)));
    }
    result.outcome = "INCONCLUSIVE";
    result.disposition = "CLEANUP_FAILURE";
    appendOutputErrors();
    finalizeOutput();
    result.errors.push("direct child PID was unavailable; descendant cleanup could not be verified");
    lifecycle.dispose?.();
    return result;
  }

  result.startupPhase = "electron-launch";
  result.process.directChildPid = child.pid;
  result.process.ownership = "direct-child-handle";
  result.process.ownershipSource = "node-child-process-handle plus ps PID/PPID/command verification";

  const cleanupChild = async () => {
    appendOutputErrors();
    finalizeOutput();
    let cleanup;
    try {
      cleanup = await terminateOwnedTree({
        child,
        childPid: child.pid,
        supervisorPid,
        executable: electronExecutable,
        execFileFn,
        killFn,
        graceMs,
        setTimeoutFn,
        clearTimeoutFn,
        lifecycle,
        initialDescendants,
        initialDirectChildVerified,
      });
    } catch (error) {
      cleanup = {
        errors: [sanitizeDiagnosticsText(errorMessage(error))],
        verifiedExit: false,
        remainingDescendants: [],
      };
    } finally {
      lifecycle.dispose?.();
    }
    appendOutputErrors();
    finalizeOutput();
    result.process.termination = cleanup.errors;
    result.process.descendants = cleanup.remainingDescendants;
    for (const error of cleanup.errors) {
      if (!result.errors.includes(error)) result.errors.push(error);
    }
    if (!cleanup.verifiedExit) {
      result.outcome = "INCONCLUSIVE";
      result.disposition = "CLEANUP_FAILURE";
      result.errors.push("direct child exit and descendant cleanup could not be verified");
    }
    return cleanup;
  };

  try {
    const ownership = await ownedProcessRecords({
      childPid: child.pid,
      supervisorPid,
      executable: electronExecutable,
      execFileFn,
    });
    result.process.directChildPgid = ownership.childRecord?.pgid;
    initialDescendants = ownership.directChildVerified ? ownership.descendants : [];
    initialDirectChildVerified = ownership.directChildVerified;
    if (!ownership.directChildVerified) {
      result.outcome = "INCONCLUSIVE";
      result.disposition = "INCONCLUSIVE";
      result.startupPhase = "ownership-verification";
      result.errors.push("direct child PID/PPID/command verification failed");
      await cleanupChild();
      return result;
    }

    result.startupPhase = "version-probe";
    let exit;
    try {
      exit = await waitForChild(child, timeoutMs, setTimeoutFn, clearTimeoutFn, lifecycle);
    } catch (error) {
      const timedOut = error?.code === "ERR_VERSION_PROBE_TIMEOUT";
      result.outcome = timedOut ? "TIMEOUT" : "FAILURE";
      result.disposition = result.outcome;
      result.startupPhase = timedOut ? "timeout" : "electron-error";
      result.errors.push(sanitizeDiagnosticsText(errorMessage(error)));
      await cleanupChild();
      return result;
    }

    result.processExit = exit;
    const { rawStdout } = finalizeOutput();
    const version = rawStdout.trim().replace(/^v/, "");
    const outputErrors = appendOutputErrors();
    if (exit.code !== 0 || exit.signal !== null || version !== expectedVersion || outputErrors.length > 0) {
      result.outcome = "FAILURE";
      result.disposition = "FAILURE";
      result.startupPhase = "version-probe";
      result.errors.push(`version probe did not return ${expectedVersion}`);
    } else {
      result.outcome = "PASS";
      result.startupPhase = "version-probe-complete";
      result.disposition = "PASS";
    }

    await cleanupChild();
  } catch (error) {
    result.outcome = "INCONCLUSIVE";
    result.disposition = "INCONCLUSIVE";
    result.startupPhase = "diagnostic-failure";
    result.errors.push(sanitizeDiagnosticsText(errorMessage(error)));
    await cleanupChild();
  }

  finalizeOutput();
  return result;
}

export async function persistProbeResult(result, { writeFileFn = writeFile } = {}) {
  if (!result.runRoot) return result;
  const diagnosticsPath = path.join(result.runRoot, "electron-version-probe.json");
  result.diagnosticsPath = diagnosticsPath;
  try {
    await writeFileFn(diagnosticsPath, diagnosticsText(result), "utf8");
  } catch (error) {
    if (result.outcome === "PASS") result.outcome = "INCONCLUSIVE";
    result.disposition = "CLEANUP_FAILURE";
    result.errors = [
      ...(result.errors ?? []),
      sanitizeDiagnosticsText(errorMessage(error)),
      "version-probe diagnostics could not be persisted; evidence root retained",
    ];
  }
  return result;
}

async function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const electronPackageRoot = path.join(
    repoRoot,
    "node_modules/.pnpm/electron@44.7.0/node_modules/electron",
  );
  const electronExecutable = path.join(
    electronPackageRoot,
    "dist/Electron.app/Contents/MacOS/Electron",
  );
  let runRoot;
  let result;
  try {
    runRoot = await createPrivateRunRoot();
    const { expected: expectedProvenance, missing: missingExpectedProvenance } = expectedProvenanceFromEnvironment({
      worktree: repoRoot,
      executable: electronExecutable,
      electronVersion: EXPECTED_ELECTRON_VERSION,
    });
    if (missingExpectedProvenance.length > 0) {
      throw new Error(`exact native provenance expectations are missing: ${missingExpectedProvenance.join(", ")}`);
    }
    const provenance = await collectRunProvenance({
      repoRoot,
      electronExecutable,
      baseRef: expectedProvenance.baseRef,
      electronPackageJson: path.join(electronPackageRoot, "package.json"),
      playwrightPackageJson: path.join(
        repoRoot,
        "node_modules/.pnpm/playwright-core@1.64.1/node_modules/playwright-core/package.json",
      ),
      command: process.argv,
    });
    result = await runVersionProbe({
      repoRoot,
      electronExecutable,
      provenance,
      runRoot,
      expectedProvenance,
    });
  } catch (error) {
    result = {
      outcome: "HOLD",
      startupPhase: "preflight",
      disposition: "HOLD",
      runRoot,
      errors: [sanitizeDiagnosticsText(errorMessage(error))],
    };
  }

  result = await persistProbeResult(result);
  process.stdout.write(`${diagnosticsText(result)}\n`);
  process.exitCode = result.outcome === "PASS" ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
