import { mkdir as defaultMkdir, rm as defaultRm, writeFile as defaultWriteFile } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_PROCESS_EXIT_TIMEOUT_MS = 15_000;
export const DEFAULT_KILL_VERIFICATION_TIMEOUT_MS = 2_000;
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const SENSITIVE_KEY_PATTERN = /(?:authorization|cookie|password|passphrase|secret|token|api[_-]?key)/i;
const SENSITIVE_ASSIGNMENT_PATTERN = /(\b(?:cookie|password|passphrase|secret|token|api[_-]?key)\b\s*[:=]\s*)([^\s,;]+)/gi;
const AUTHORIZATION_PATTERN = /(\bauthorization\b\s*[:=]\s*)[^\r\n;]*/gi;
const BEARER_PATTERN = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function sanitizeDiagnosticsText(value) {
  return String(value)
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(BEARER_PATTERN, "$1[REDACTED]")
    .replace(AUTHORIZATION_PATTERN, "$1[REDACTED]")
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, (match, prefix) => `${prefix}[REDACTED]`);
}

export function sanitizeDiagnosticsValue(value, key = "") {
  if (SENSITIVE_KEY_PATTERN.test(key)) return "[REDACTED]";
  if (typeof value === "string") return sanitizeDiagnosticsText(value);
  if (Array.isArray(value)) return value.map((entry) => sanitizeDiagnosticsValue(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeDiagnosticsValue(entryValue, entryKey),
      ]),
    );
  }
  return value;
}

export function diagnosticsText(diagnostics) {
  return JSON.stringify(sanitizeDiagnosticsValue(diagnostics), null, 2);
}

export function errorDiagnostics(error) {
  return {
    name: error instanceof Error ? error.name : "Error",
    message: sanitizeDiagnosticsText(errorMessage(error)),
    stack: error instanceof Error && error.stack
      ? sanitizeDiagnosticsText(error.stack)
      : undefined,
  };
}

export function launchProcessDiagnostics(error, { probe = (pid) => process.kill(pid, 0) } = {}) {
  const text = sanitizeDiagnosticsText(errorMessage(error));
  const pidMatch = text.match(/<launched> pid=(\d+)/);
  const exitMatch = text.match(/<process did exit: exitCode=([^,]+), signal=([^)>]+)>/);
  const diagnostics = {
    source: "playwright-error-log",
    ownership: "unverified",
    pid: undefined,
    exitCode: exitMatch?.[1] ?? undefined,
    signal: exitMatch?.[2] ?? undefined,
    exitObservation: exitMatch ? "reported-by-playwright-log" : "not-reported",
    liveness: "not-observed",
  };

  if (!pidMatch) return diagnostics;

  const pid = Number(pidMatch[1]);
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    diagnostics.liveness = "inaccessible";
    return diagnostics;
  }

  diagnostics.pid = pid;
  try {
    probe(pid);
    diagnostics.liveness = "present";
  } catch (probeError) {
    diagnostics.liveness = probeError?.code === "ESRCH" ? "absent" : "inaccessible";
  }
  return diagnostics;
}

export async function persistDiagnostics(
  diagnostics,
  {
    mkdirFn = defaultMkdir,
    writeFileFn = defaultWriteFile,
  } = {},
) {
  const diagnosticsPath = path.join(diagnostics.artifactsDir, "electron-e2e-diagnostics.json");
  diagnostics.diagnosticsPath = diagnosticsPath;
  await mkdirFn(diagnostics.artifactsDir, { recursive: true });
  await writeFileFn(diagnosticsPath, diagnosticsText(diagnostics), "utf8");
  return diagnosticsPath;
}

export function isProcessExited(child) {
  return Boolean(child && (child.exitCode !== null || child.signalCode !== null));
}

export function waitForProcessExit(
  child,
  timeout = DEFAULT_PROCESS_EXIT_TIMEOUT_MS,
  { setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout } = {},
) {
  if (isProcessExited(child)) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const onClose = () => {
      clearTimeoutFn(timer);
      resolve();
    };
    const timer = setTimeoutFn(() => {
      child.removeListener?.("close", onClose);
      reject(new Error(`Electron child process did not exit within ${timeout}ms`));
    }, timeout);
    child.once("close", onClose);
  });
}

function recordDiagnosticError(diagnostics, error) {
  diagnostics.processErrors.push(sanitizeDiagnosticsText(errorMessage(error)));
}

export async function finalizeDiagnostics({
  diagnostics,
  electronApp,
  child,
  passed,
  profileRoot,
  timeout = DEFAULT_PROCESS_EXIT_TIMEOUT_MS,
  killVerificationTimeout = DEFAULT_KILL_VERIFICATION_TIMEOUT_MS,
  persist = persistDiagnostics,
  removeProfile = defaultRm,
  waitForExit = waitForProcessExit,
  kill = (target) => target.kill(),
}) {
  const cleanupErrors = [];
  let persistenceError;
  let diagnosticsPath = diagnostics.diagnosticsPath
    ?? path.join(diagnostics.artifactsDir, "electron-e2e-diagnostics.json");
  let removedProfile = false;

  const persistCurrentDiagnostics = async () => {
    try {
      diagnosticsPath = await persist(diagnostics);
    } catch (error) {
      persistenceError ??= error;
      recordDiagnosticError(diagnostics, error);
    }
  };

  if (electronApp) {
    diagnostics.cleanup.closeRequested = true;
    try {
      await electronApp.close();
    } catch (error) {
      cleanupErrors.push(error);
      recordDiagnosticError(diagnostics, error);
    }

    if (child && !isProcessExited(child)) {
      try {
        await waitForExit(child, timeout);
      } catch (error) {
        cleanupErrors.push(error);
        recordDiagnosticError(diagnostics, error);
      }
    }

    if (child && !isProcessExited(child)) {
      diagnostics.cleanup.killAttempted = true;
      try {
        const killResult = kill(child);
        if (killResult === false) {
          throw new Error("Electron child process kill request was not accepted");
        }
      } catch (error) {
        cleanupErrors.push(error);
        recordDiagnosticError(diagnostics, error);
      }
    }

    if (child && !isProcessExited(child)) {
      try {
        await waitForExit(child, killVerificationTimeout);
      } catch (error) {
        cleanupErrors.push(error);
        recordDiagnosticError(diagnostics, error);
      }
    }

    diagnostics.cleanup.verifiedExit = isProcessExited(child);
    if (!diagnostics.cleanup.verifiedExit) {
      const verificationError = new Error("Electron child process exit could not be verified");
      cleanupErrors.push(verificationError);
      recordDiagnosticError(diagnostics, verificationError);
    }
  }

  await persistCurrentDiagnostics();

  const cleanupSucceeded = !electronApp || (
    cleanupErrors.length === 0 && diagnostics.cleanup.verifiedExit
  );
  if (passed && cleanupSucceeded && !persistenceError) {
    try {
      await removeProfile(profileRoot, { recursive: true, force: true });
      removedProfile = true;
    } catch (error) {
      cleanupErrors.push(error);
      recordDiagnosticError(diagnostics, error);
      await persistCurrentDiagnostics();
    }
  }

  return {
    cleanupErrors,
    diagnosticsPath,
    persistenceError,
    removedProfile,
  };
}

export function buildFailureError({
  primaryError,
  diagnosticsPath,
  cleanupErrors = [],
  persistenceError,
}) {
  const secondaryErrors = [
    ...cleanupErrors,
    ...(persistenceError ? [persistenceError] : []),
  ];
  if (!primaryError && secondaryErrors.length === 0) return undefined;

  const cause = primaryError ?? secondaryErrors[0];
  const baseMessage = primaryError
    ? errorMessage(primaryError)
    : `Electron E2E finalization failed: ${errorMessage(cause)}`;
  const message = `${sanitizeDiagnosticsText(baseMessage)}\nElectron E2E diagnostics: ${diagnosticsPath ?? "unavailable"}`;
  const failure = new Error(message, { cause });
  failure.secondaryErrors = secondaryErrors.map(errorDiagnostics);
  return failure;
}
