import { createHash } from "node:crypto";
import { execFile as defaultExecFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdir as defaultMkdir, readFile as defaultReadFile, rm as defaultRm, writeFile as defaultWriteFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

export const DEFAULT_PROCESS_EXIT_TIMEOUT_MS = 15_000;
export const DEFAULT_KILL_VERIFICATION_TIMEOUT_MS = 2_000;
export const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const SENSITIVE_KEY_PATTERN = /(?:authorization|cookie|password|passphrase|secret|token|api[_-]?key)/i;
const SENSITIVE_NAME_PATTERN = "(?:(?:[A-Za-z0-9]+[_-])*(?:authorization|cookie|password|passphrase|secret|token|access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token|api[_-]?key)(?:[_-][A-Za-z0-9]+)*|[A-Za-z0-9]*?(?:authorization|cookie|password|passphrase|secret|token|access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token|api[_-]?key)[A-Za-z0-9]*)";
const SENSITIVE_ASSIGNMENT_PREFIX = "((?<!-)\\b" + SENSITIVE_NAME_PATTERN + "\\b\\s*[:=]\\s*)";
const DOUBLE_QUOTED_SENSITIVE_ASSIGNMENT_PATTERN = new RegExp(
  SENSITIVE_ASSIGNMENT_PREFIX + '("[^"]*")',
  "gi",
);
const JSON_SENSITIVE_ASSIGNMENT_PATTERN = new RegExp(
  '((?:\\\\)?"' + SENSITIVE_NAME_PATTERN + '(?:\\\\)?"\\s*:\\s*)(?:\\\\)?"(?:\\\\.|[^"\\\\])*(?:\\\\)?"',
  "gi",
);
const SINGLE_QUOTED_SENSITIVE_ASSIGNMENT_PATTERN = new RegExp(
  SENSITIVE_ASSIGNMENT_PREFIX + "('[^']*')",
  "gi",
);
const UNQUOTED_SENSITIVE_ASSIGNMENT_PATTERN = new RegExp(
  SENSITIVE_ASSIGNMENT_PREFIX + "(?![\"'])([^\\r\\n;]*)(?=;|\\r?\\n|$)",
  "gi",
);
const CLI_SENSITIVE_ARGUMENT_PATTERN = new RegExp(
  "(--" + SENSITIVE_NAME_PATTERN + "(?:=|\\s+))(\"[^\"]*\"|'[^']*'|[^\\s;\\r\\n]+)",
  "gi",
);
const AUTHORIZATION_PATTERN = /(\bauthorization(?=$|[\s:=])\s*[:=]\s*)[^\r\n;]*/gi;
const AUTHORIZATION_SCHEME_PATTERN = /(\bauthorization(?=$|[\s:=])\s+[^\s:;,]+\s+)[^\r\n;]*/gi;
const BEARER_PATTERN = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const STREAM_CHUNK_ARRAY_KEYS = new Set([
  "processErrors",
  "electronConsole",
  "pageConsole",
  "pageErrors",
]);
const execFile = promisify(defaultExecFile);

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function sanitizeDiagnosticsText(value) {
  return String(value)
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(JSON_SENSITIVE_ASSIGNMENT_PATTERN, "$1[REDACTED]")
    .replace(DOUBLE_QUOTED_SENSITIVE_ASSIGNMENT_PATTERN, '$1"[REDACTED]"')
    .replace(SINGLE_QUOTED_SENSITIVE_ASSIGNMENT_PATTERN, "$1'[REDACTED]'")
    .replace(UNQUOTED_SENSITIVE_ASSIGNMENT_PATTERN, "$1[REDACTED]")
    .replace(CLI_SENSITIVE_ARGUMENT_PATTERN, "$1[REDACTED]")
    .replace(BEARER_PATTERN, "$1[REDACTED]")
    .replace(AUTHORIZATION_SCHEME_PATTERN, "$1[REDACTED]")
    .replace(AUTHORIZATION_PATTERN, "$1[REDACTED]")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]");
}

export function sanitizeDiagnosticsValue(value, key = "") {
  if (SENSITIVE_KEY_PATTERN.test(key)) return "[REDACTED]";
  if (typeof value === "string") return sanitizeDiagnosticsText(value);
  if (Array.isArray(value)) {
    if (STREAM_CHUNK_ARRAY_KEYS.has(key) && value.length > 0 && value.every((entry) => typeof entry === "string")) {
      return sanitizeDiagnosticsText(value.join(""));
    }
    return value.map((entry) => sanitizeDiagnosticsValue(entry));
  }
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

function commandError(command, args, error) {
  return `${command} ${args.join(" ")}: ${sanitizeDiagnosticsText(errorMessage(error))}`;
}

async function runCommand(command, args, cwd, execFileFn) {
  try {
    const result = await execFileFn(command, args, {
      cwd,
      maxBuffer: 1024 * 1024,
      timeout: DEFAULT_COMMAND_TIMEOUT_MS,
    });
    return { value: result.stdout.trim() };
  } catch (error) {
    return { error: commandError(command, args, error) };
  }
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function firstMatch(value, pattern) {
  return value?.match(pattern)?.[1];
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function currentInvocationCommand({
  execPath = process.execPath,
  execArgv = process.execArgv,
  argv = process.argv,
  cwd = process.cwd(),
} = {}) {
  if (!Array.isArray(execArgv) || !Array.isArray(argv) || !isNonEmptyString(execPath)) return [];
  const [script, ...argumentsAfterScript] = argv.slice(1);
  const resolvedScript = isNonEmptyString(script) && !path.isAbsolute(script)
    ? path.resolve(cwd, script)
    : script;
  return [execPath, ...execArgv, ...(resolvedScript ? [resolvedScript, ...argumentsAfterScript] : argumentsAfterScript)];
}

function isSha(value, length) {
  return typeof value === "string" && new RegExp(`^[0-9a-f]{${length}}$`, "i").test(value);
}

function isVersion(value) {
  return typeof value === "string" && /^\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?$/.test(value);
}

function canonicalPath(value) {
  if (!isNonEmptyString(value)) return value;
  try {
    return realpathSync.native(value);
  } catch {
    return path.resolve(value);
  }
}

export function validateExpectedProvenance(provenance, expectations = {}) {
  const mismatches = [];
  const compare = (label, actual, expected) => {
    if (expected === undefined) return;
    const pathsMustMatchByRealpath = label === "worktree" || label === "invocation cwd";
    const comparedActual = pathsMustMatchByRealpath ? canonicalPath(actual) : actual;
    const comparedExpected = pathsMustMatchByRealpath ? canonicalPath(expected) : expected;
    if (comparedActual !== comparedExpected) {
      mismatches.push(`${label} expected ${expected} but was ${actual ?? "missing"}`);
    }
  };

  compare("worktree", provenance?.worktree, expectations.worktree);
  compare("base ref", provenance?.baseRef, expectations.baseRef);
  compare("base SHA", provenance?.baseSha, expectations.baseSha);
  compare("head SHA", provenance?.headSha, expectations.headSha);
  compare("Node version", provenance?.toolchain?.node, expectations.nodeVersion);
  compare("pnpm version", provenance?.toolchain?.pnpm, expectations.pnpmVersion);
  compare("macOS version", provenance?.toolchain?.macOS, expectations.macOSVersion);
  compare("host architecture", provenance?.toolchain?.hostArchitecture, expectations.hostArchitecture);
  compare("executable", provenance?.artifact?.executable, expectations.executable);
  compare("Electron version", provenance?.toolchain?.electron, expectations.electronVersion);
  compare("Playwright version", provenance?.toolchain?.playwright, expectations.playwrightVersion);
  compare("Electron architecture", provenance?.artifact?.architecture, expectations.electronArchitecture);
  compare("Electron UUID", provenance?.artifact?.uuid, expectations.electronUuid);
  compare("Electron executable SHA-256", provenance?.artifact?.sha256, expectations.electronSha256);
  compare("Electron package SHA-256", provenance?.artifact?.packageJsonSha256, expectations.electronPackageJsonSha256);
  compare("Playwright package SHA-256", provenance?.artifact?.playwrightPackageJsonSha256, expectations.playwrightPackageJsonSha256);
  compare("repository package SHA-256", provenance?.artifact?.repositoryPackageJsonSha256, expectations.packageJsonSha256);
  compare("lockfile SHA-256", provenance?.artifact?.lockfileSha256, expectations.lockfileSha256);
  compare("invocation cwd", provenance?.invocation?.cwd, expectations.invocationCwd);
  if (expectations.invocationCommand !== undefined) {
    if (!Array.isArray(expectations.invocationCommand)) {
      mismatches.push("invocation command expectation is invalid");
    } else if (JSON.stringify(provenance?.invocation?.command) !== JSON.stringify(expectations.invocationCommand)) {
      mismatches.push(`invocation command expected ${JSON.stringify(expectations.invocationCommand)} but was ${JSON.stringify(provenance?.invocation?.command)}`);
    }
  }
  compare("branch/status", provenance?.repositoryStatus?.split("\n", 1)[0], expectations.branchStatus);

  if (expectations.requireCleanWorkingTree) {
    const statusLines = String(provenance?.repositoryStatus ?? "").split("\n").filter(Boolean);
    if (statusLines.length !== 1 || !statusLines[0].startsWith("## ")) {
      mismatches.push("working tree is not clean");
    }
  }

  return mismatches;
}

export const EXACT_PROVENANCE_ENVIRONMENT_NAMES = [
  "HARBOR_NATIVE_EXPECTED_WORKTREE",
  "HARBOR_NATIVE_EXPECTED_BASE_REF",
  "HARBOR_NATIVE_EXPECTED_BASE_SHA",
  "HARBOR_NATIVE_EXPECTED_HEAD_SHA",
  "HARBOR_NATIVE_EXPECTED_NODE_VERSION",
  "HARBOR_NATIVE_EXPECTED_PNPM_VERSION",
  "HARBOR_NATIVE_EXPECTED_MACOS_VERSION",
  "HARBOR_NATIVE_EXPECTED_HOST_ARCHITECTURE",
  "HARBOR_NATIVE_EXPECTED_PLAYWRIGHT_VERSION",
  "HARBOR_NATIVE_EXPECTED_ELECTRON_ARCHITECTURE",
  "HARBOR_NATIVE_EXPECTED_ELECTRON_UUID",
  "HARBOR_NATIVE_EXPECTED_ELECTRON_SHA256",
  "HARBOR_NATIVE_EXPECTED_ELECTRON_PACKAGE_SHA256",
  "HARBOR_NATIVE_EXPECTED_PLAYWRIGHT_PACKAGE_SHA256",
  "HARBOR_NATIVE_EXPECTED_PACKAGE_SHA256",
  "HARBOR_NATIVE_EXPECTED_LOCKFILE_SHA256",
  "HARBOR_NATIVE_EXPECTED_BRANCH_STATUS",
  "HARBOR_NATIVE_EXPECTED_INVOCATION",
];

export function expectedProvenanceFromEnvironment({
  worktree,
  executable,
  electronVersion,
  baseRef = "feature/harbor-clo-159",
  environment = process.env,
} = {}) {
  const value = (name) => environment[name]?.trim();
  const expectedWorktree = value("HARBOR_NATIVE_EXPECTED_WORKTREE");
  const expectedInvocationRaw = value("HARBOR_NATIVE_EXPECTED_INVOCATION");
  let expectedInvocation;
  let invocationExpectationValid = false;
  if (expectedInvocationRaw) {
    try {
      const parsed = JSON.parse(expectedInvocationRaw);
      invocationExpectationValid = Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string");
      if (invocationExpectationValid) expectedInvocation = parsed;
    } catch {
      invocationExpectationValid = false;
    }
  }
  const expected = {
    worktree: expectedWorktree,
    baseRef: value("HARBOR_NATIVE_EXPECTED_BASE_REF"),
    baseSha: value("HARBOR_NATIVE_EXPECTED_BASE_SHA"),
    headSha: value("HARBOR_NATIVE_EXPECTED_HEAD_SHA"),
    nodeVersion: value("HARBOR_NATIVE_EXPECTED_NODE_VERSION"),
    pnpmVersion: value("HARBOR_NATIVE_EXPECTED_PNPM_VERSION"),
    macOSVersion: value("HARBOR_NATIVE_EXPECTED_MACOS_VERSION"),
    hostArchitecture: value("HARBOR_NATIVE_EXPECTED_HOST_ARCHITECTURE"),
    executable,
    electronVersion,
    playwrightVersion: value("HARBOR_NATIVE_EXPECTED_PLAYWRIGHT_VERSION"),
    electronArchitecture: value("HARBOR_NATIVE_EXPECTED_ELECTRON_ARCHITECTURE"),
    electronUuid: value("HARBOR_NATIVE_EXPECTED_ELECTRON_UUID"),
    electronSha256: value("HARBOR_NATIVE_EXPECTED_ELECTRON_SHA256"),
    electronPackageJsonSha256: value("HARBOR_NATIVE_EXPECTED_ELECTRON_PACKAGE_SHA256"),
    playwrightPackageJsonSha256: value("HARBOR_NATIVE_EXPECTED_PLAYWRIGHT_PACKAGE_SHA256"),
    packageJsonSha256: value("HARBOR_NATIVE_EXPECTED_PACKAGE_SHA256"),
    lockfileSha256: value("HARBOR_NATIVE_EXPECTED_LOCKFILE_SHA256"),
    invocationCwd: expectedWorktree,
    invocationCommand: expectedInvocation,
    branchStatus: value("HARBOR_NATIVE_EXPECTED_BRANCH_STATUS"),
    requireCleanWorkingTree: true,
  };
  const missing = EXACT_PROVENANCE_ENVIRONMENT_NAMES.filter((name) => !value(name));
  if (expectedInvocationRaw && !invocationExpectationValid) missing.push("HARBOR_NATIVE_EXPECTED_INVOCATION");
  return {
    expected,
    missing: [...new Set(missing)],
  };
}

export async function collectRunProvenance({
  repoRoot,
  electronExecutable,
  electronPackageJson,
  playwrightPackageJson,
  baseRef,
  command = currentInvocationCommand(),
  execFileFn = execFile,
  readFileFn = defaultReadFile,
} = {}) {
  const errors = [];
  const commandResult = async (commandName, args, { details = false } = {}) => {
    const result = await runCommand(commandName, args, repoRoot, execFileFn);
    if (result.error) errors.push(result.error);
    return details ? result : result.value;
  };
  const resolvedBaseRef = baseRef
    ?? process.env.HARBOR_NATIVE_BASE_REF
    ?? (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "feature/harbor-clo-159");
  const headSha = await commandResult("git", ["rev-parse", "HEAD"]);
  const baseSha = await commandResult("git", ["rev-parse", "--verify", `${resolvedBaseRef}^{commit}`]);
  const changedFilesResult = baseSha
    ? await commandResult("git", ["diff", "--name-only", `${resolvedBaseRef}...HEAD`], { details: true })
    : undefined;
  const changedFilesText = changedFilesResult?.value;
  const changedFilesOutputPresent = Boolean(
    changedFilesResult && !changedFilesResult.error && typeof changedFilesText === "string",
  );
  const repositoryStatus = await commandResult("git", ["status", "--short", "--branch"]);
  const pnpmVersion = await commandResult("pnpm", ["--version"]);
  const macOSVersion = await commandResult("sw_vers", ["-productVersion"]);
  const architecture = await commandResult("uname", ["-m"]);
  const electronFileDescription = await commandResult("file", [electronExecutable]);
  const electronLoadCommands = await commandResult("otool", ["-l", electronExecutable]);

  const files = [
    ["electronExecutable", electronExecutable],
    ["electronPackageJson", electronPackageJson],
    ["playwrightPackageJson", playwrightPackageJson],
    ["packageJson", path.join(repoRoot, "package.json")],
    ["lockfile", path.join(repoRoot, "pnpm-lock.yaml")],
  ];
  const hashes = {};
  for (const [name, filePath] of files) {
    try {
      hashes[name] = sha256(await readFileFn(filePath));
    } catch (error) {
      errors.push("sha256 " + name + ": " + sanitizeDiagnosticsText(errorMessage(error)));
    }
  }

  let electronVersion;
  let playwrightVersion;
  for (const [name, filePath] of [
    ["electronVersion", electronPackageJson],
    ["playwrightVersion", playwrightPackageJson],
  ]) {
    try {
      const packageJson = JSON.parse(await readFileFn(filePath, "utf8"));
      if (name === "electronVersion") electronVersion = packageJson.version;
      if (name === "playwrightVersion") playwrightVersion = packageJson.version;
    } catch (error) {
      errors.push("package metadata " + name + ": " + sanitizeDiagnosticsText(errorMessage(error)));
    }
  }

  const electronUuid = firstMatch(electronLoadCommands, /cmd LC_UUID[\s\S]*?uuid ([A-F0-9-]+)/i);
  const electronArchitecture = electronFileDescription?.match(/\b(arm64|x86_64|i386)\b/i)?.[1];
  const changedFiles = changedFilesText === undefined
    ? undefined
    : changedFilesText.split("\n").filter(Boolean);
  const required = [
    ["head SHA", () => isSha(headSha, 40)],
    ["base SHA", () => isSha(baseSha, 40)],
    ["repository status", () => isNonEmptyString(repositoryStatus)],
    ["pnpm version", () => isVersion(pnpmVersion)],
    ["macOS version", () => isVersion(macOSVersion)],
    ["host architecture", () => /^(arm64|x86_64)$/.test(architecture ?? "")],
    ["Electron file description", () => isNonEmptyString(electronFileDescription)],
    ["Electron UUID", () => /^[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}$/i.test(electronUuid ?? "")],
    ["Electron architecture", () => /^(arm64|x86_64)$/.test(electronArchitecture ?? "")],
    ["Electron executable SHA-256", () => isSha(hashes.electronExecutable, 64)],
    ["Electron package SHA-256", () => isSha(hashes.electronPackageJson, 64)],
    ["Playwright package SHA-256", () => isSha(hashes.playwrightPackageJson, 64)],
    ["repository package SHA-256", () => isSha(hashes.packageJson, 64)],
    ["lockfile SHA-256", () => isSha(hashes.lockfile, 64)],
    ["Electron version", () => isVersion(electronVersion)],
    ["Playwright version", () => isVersion(playwrightVersion)],
    ["changed-files output", () => changedFilesOutputPresent],
    ["changed-files list", () => Array.isArray(changedFiles)],
    ["invocation command", () => Array.isArray(command) && command.length > 0],
    ["invocation cwd", () => isNonEmptyString(process.cwd())],
    ["Node executable", () => isNonEmptyString(process.execPath)],
  ];
  const validationErrors = required
    .filter(([, check]) => !check())
    .map(([name]) => `provenance ${name} is missing or malformed`);
  errors.push(...validationErrors);

  return {
    status: errors.length === 0,
    worktree: repoRoot,
    baseRef: resolvedBaseRef,
    baseSha,
    headSha,
    changedFiles,
    repositoryStatus,
    invocation: {
      command,
      cwd: process.cwd(),
      nodeExecutable: process.execPath,
      electronOverridesRemoved: [
        "ELECTRON_CACHE",
        "ELECTRON_MIRROR",
        "ELECTRON_OVERRIDE_DIST_PATH",
        "ELECTRON_RUN_AS_NODE",
        "NPM_CONFIG_ELECTRON_MIRROR",
        "npm_config_electron_mirror",
      ],
    },
    toolchain: {
      node: process.version,
      pnpm: pnpmVersion,
      macOS: macOSVersion,
      hostArchitecture: architecture,
      electron: electronVersion,
      playwright: playwrightVersion,
    },
    artifact: {
      executable: electronExecutable,
      architecture: electronArchitecture,
      uuid: electronUuid,
      sha256: hashes.electronExecutable,
      electronVersion,
      playwrightVersion,
      packageJsonSha256: hashes.electronPackageJson,
      playwrightPackageJsonSha256: hashes.playwrightPackageJson,
      repositoryPackageJsonSha256: hashes.packageJson,
      lockfileSha256: hashes.lockfile,
    },
    errors,
  };
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
  {
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    isClosed = () => false,
  } = {},
) {
  if (isClosed()) return Promise.resolve();

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
  diagnostics.cleanup.closeObserved ??= false;

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
    const processNeedsCloseVerification = () => (
      child && (!isProcessExited(child) || !diagnostics.cleanup.closeObserved)
    );
    try {
      await electronApp.close();
    } catch (error) {
      cleanupErrors.push(error);
      recordDiagnosticError(diagnostics, error);
    }

    if (processNeedsCloseVerification()) {
      try {
        await waitForExit(child, timeout, {
          isClosed: () => diagnostics.cleanup.closeObserved,
        });
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

    if (processNeedsCloseVerification()) {
      try {
        await waitForExit(child, killVerificationTimeout, {
          isClosed: () => diagnostics.cleanup.closeObserved,
        });
      } catch (error) {
        cleanupErrors.push(error);
        recordDiagnosticError(diagnostics, error);
      }
    }

    diagnostics.cleanup.verifiedExit = isProcessExited(child) && diagnostics.cleanup.closeObserved;
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
  if (passed && (!cleanupSucceeded || persistenceError)) diagnostics.disposition = "CLEANUP_FAILURE";
  if (cleanupErrors.length > 0 || persistenceError) await persistCurrentDiagnostics();
  if (passed && cleanupSucceeded && !persistenceError) {
    try {
      await removeProfile(profileRoot, { recursive: true, force: true });
      removedProfile = true;
    } catch (error) {
      cleanupErrors.push(error);
      diagnostics.disposition = "CLEANUP_FAILURE";
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
