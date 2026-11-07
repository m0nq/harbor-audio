import { createHash } from "node:crypto";
import { execFile as defaultExecFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { lstat, mkdir as defaultMkdir, mkdtemp as defaultMkdtemp, readdir, readFile as defaultReadFile, realpath as defaultRealpath, rm as defaultRm, writeFile as defaultWriteFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

export const DEFAULT_PROCESS_EXIT_TIMEOUT_MS = 15_000;
export const DEFAULT_KILL_VERIFICATION_TIMEOUT_MS = 2_000;
export const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;
export const MAX_CAPTURED_STREAM_BYTES = 1024 * 1024;
export const POST_CLOSE_SETTLEMENT_TIMEOUT_MS = 100;
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const SENSITIVE_KEY_PATTERN = /(?:authorization|cookie|password|passphrase|secret|token|api[_-]?key)/i;
const SENSITIVE_NAME_PATTERN = "(?:(?:[A-Za-z0-9]+[_-])*(?:authorization|cookie|password|passphrase|secret|token|access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token|api[_-]?key)(?:[_-][A-Za-z0-9]+)*|[A-Za-z0-9]*?(?:authorization|cookie|password|passphrase|secret|token|access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token|api[_-]?key)[A-Za-z0-9]*)";
const SENSITIVE_ASSIGNMENT_PREFIX = "((?<!-)\\b" + SENSITIVE_NAME_PATTERN + "\\b\\s*[:=]\\s*)";
const DOUBLE_QUOTED_VALUE_PATTERN = String.raw`"(?:\\.|[^"\\])*"`;
const SINGLE_QUOTED_VALUE_PATTERN = String.raw`'(?:\\.|[^'\\])*'`;
const DOUBLE_QUOTED_SENSITIVE_ASSIGNMENT_PATTERN = new RegExp(
  SENSITIVE_ASSIGNMENT_PREFIX + `(${DOUBLE_QUOTED_VALUE_PATTERN})`,
  "gi",
);
const JSON_SENSITIVE_ASSIGNMENT_PATTERN = new RegExp(
  '((?:\\\\)?"' + SENSITIVE_NAME_PATTERN + '(?:\\\\)?"\\s*:\\s*)(?:\\\\)?"(?:\\\\.|[^"\\\\])*(?:\\\\)?"',
  "gi",
);
const SINGLE_QUOTED_SENSITIVE_ASSIGNMENT_PATTERN = new RegExp(
  SENSITIVE_ASSIGNMENT_PREFIX + `(${SINGLE_QUOTED_VALUE_PATTERN})`,
  "gi",
);
const UNQUOTED_SENSITIVE_ASSIGNMENT_PATTERN = new RegExp(
  SENSITIVE_ASSIGNMENT_PREFIX + "(?![\"'])([^\\r\\n;]*)(?=;|\\r?\\n|$)",
  "gi",
);
const CLI_SENSITIVE_ARGUMENT_PATTERN = new RegExp(
  String.raw`(--${SENSITIVE_NAME_PATTERN}(?:=|\s+))(${DOUBLE_QUOTED_VALUE_PATTERN}|${SINGLE_QUOTED_VALUE_PATTERN}|[^\s;\r\n]+)`,
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
const COMMAND_ARRAY_KEYS = new Set(["args", "argv", "command"]);
const execFile = promisify(defaultExecFile);

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function sanitizedPublicError(error) {
  const details = errorDiagnostics(error);
  const safeError = new Error(details.message);
  safeError.name = details.name;
  if (details.stack) safeError.stack = details.stack;
  return safeError;
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
    if (COMMAND_ARRAY_KEYS.has(key) && value.every((entry) => typeof entry === "string")) {
      const sanitized = [];
      let redactNext = false;
      for (const entry of value) {
        if (redactNext) {
          sanitized.push("[REDACTED]");
          redactNext = false;
          continue;
        }
        redactNext = false;
        const isSensitiveOption = /^--[A-Za-z0-9_-]*(?:token|secret|password|passphrase|authorization|cookie|api[_-]?key)[A-Za-z0-9_-]*$/i.test(entry);
        const sanitizedEntry = sanitizeDiagnosticsText(entry);
        sanitized.push(sanitizedEntry);
        if (isSensitiveOption) redactNext = true;
      }
      return sanitized;
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

function formatCommandArgument(value) {
  const text = String(value);
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(text) ? text : JSON.stringify(text);
}

export function commandError(command, args, error) {
  const sanitizedArgs = sanitizeDiagnosticsValue(args, "command");
  const commandText = [sanitizeDiagnosticsText(command), ...sanitizedArgs].map(formatCommandArgument).join(" ");
  return `${commandText}: ${sanitizeDiagnosticsText(errorMessage(error))}`;
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

function tokenizeProcessCommand(command) {
  const tokens = [];
  let token = "";
  let tokenStarted = false;
  let quote;
  let escaped = false;
  for (const character of command) {
    if (escaped) {
      token += character;
      tokenStarted = true;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      tokenStarted = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      else token += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      tokenStarted = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (tokenStarted) {
        tokens.push(token);
        token = "";
        tokenStarted = false;
      }
      continue;
    }
    token += character;
    tokenStarted = true;
  }
  if (quote || escaped) return undefined;
  if (tokenStarted) tokens.push(token);
  return tokens;
}

function isNodeTestRunnerCommand(command, executable) {
  if (!isNonEmptyString(command) || !isNonEmptyString(executable) || !path.isAbsolute(executable)) return false;
  const tokens = tokenizeProcessCommand(command);
  if (!tokens || !path.isAbsolute(tokens[0] ?? "")) return false;
  try {
    if (realpathSync.native(tokens[0]) !== realpathSync.native(executable)) return false;
  } catch {
    return false;
  }
  const contract = nodeTestInvocationContract(tokens, { context: "main-process" });
  return contract.valid && contract.testRunnerMode === "test-runner";
}

/**
 * Verifies a Node test-worker marker against the independently observed
 * direct parent command. An inherited NODE_TEST_CONTEXT value alone is not
 * trusted because an ordinary script can set it before launch.
 */
export async function resolveNodeTestWorkerContext({
  environment = process.env,
  execFileFn = execFile,
  parentPid = process.ppid,
  nodeExecutable = process.execPath,
  cwd = process.cwd(),
} = {}) {
  const contextValue = environment?.NODE_TEST_CONTEXT;
  const markerLooksLikeWorker = typeof contextValue === "string"
    && contextValue.startsWith("child");
  if (!markerLooksLikeWorker) {
    return {
      context: "main-process",
      verified: false,
      contextValue,
      parentPid,
    };
  }

  const command = ["/bin/ps", "-p", String(parentPid), "-o", "command="];
  if (!Number.isInteger(parentPid) || parentPid <= 0) {
    return {
      context: "unverified",
      verified: false,
      contextValue,
      parentPid,
      command,
      error: "Node test worker parent PID could not be established",
    };
  }

  const result = await runCommand(command[0], command.slice(1), cwd, execFileFn);
  if (result.error) {
    return {
      context: "unverified",
      verified: false,
      contextValue,
      parentPid,
      command,
      error: `Node test worker parent verification failed: ${result.error}`,
    };
  }
  if (!isNodeTestRunnerCommand(result.value, nodeExecutable)) {
    return {
      context: "unverified",
      verified: false,
      contextValue,
      parentPid,
      command,
      error: "Node test worker parent is not an independently verified Node test runner",
    };
  }
  return {
    context: "node-test-worker",
    verified: true,
    contextValue,
    parentPid,
    command,
  };
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Hash the complete generated application tree, including paths, without following symlinks. */
export async function hashApplicationBuild(buildRoot) {
  const records = [];
  async function visit(relativePath) {
    const absolutePath = path.join(buildRoot, relativePath);
    const info = await lstat(absolutePath);
    if (info.isSymbolicLink()) throw new Error("application build contains a symbolic link");
    if (info.isDirectory()) {
      const entries = await readdir(absolutePath);
      for (const entry of entries.sort()) await visit(path.join(relativePath, entry));
    } else if (info.isFile()) {
      records.push([relativePath.split(path.sep).join("/"), sha256(await defaultReadFile(absolutePath))]);
    } else {
      throw new Error("application build contains an unsupported entry");
    }
  }
  await visit("");
  if (!records.some(([name]) => name === "main.js") || !records.some(([name]) => name === "renderer/index.html")) {
    throw new Error("application build is incomplete");
  }
  return { sha256: sha256(JSON.stringify(records)), files: records };
}

export function validateApplicationBuildHash(build, expected) {
  if (!/^[a-f0-9]{64}$/i.test(expected ?? "")) return ["expected application build SHA-256 is missing or malformed"];
  if (!build || build.sha256 !== expected) return ["application build SHA-256 does not match the expected build"];
  return [];
}

export function nativeRunScope(contract, selectedScenario) {
  if (!contract?.valid || selectedScenario !== undefined || contract.testNamePatterns?.length
    || contract.testSkipPatterns?.length || contract.testOnly || contract.testShard
    || contract.testRerunFailures) return "focused-diagnostic";
  return "full-suite-candidate";
}

function firstMatch(value, pattern) {
  return value?.match(pattern)?.[1];
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function utf8Prefix(value, maxBytes) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maxBytes) return value;
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString("utf8");
}

export function createBoundedDiagnosticsCapture(
  label,
  { maxBytes = MAX_CAPTURED_STREAM_BYTES, onTruncate } = {},
) {
  const values = [];
  let bytes = 0;
  let truncated = false;

  const append = (value) => {
    if (truncated) return;
    const text = String(value);
    const remaining = maxBytes - bytes;
    const textBytes = Buffer.byteLength(text, "utf8");
    if (textBytes <= remaining) {
      values.push(text);
      bytes += textBytes;
      return;
    }

    const marker = `[${label} capture truncated at ${maxBytes} bytes]`;
    const markerBytes = Buffer.byteLength(marker, "utf8");
    const prefixBytes = Math.max(0, remaining - markerBytes);
    if (prefixBytes > 0) values.push(utf8Prefix(text, prefixBytes));
    if (remaining > prefixBytes) values.push(utf8Prefix(marker, remaining - prefixBytes));
    bytes = maxBytes;
    truncated = true;
    onTruncate?.(new Error(`${label} capture exceeded ${maxBytes} bytes; output truncated`));
  };

  return { values, append, get bytes() { return bytes; }, get truncated() { return truncated; } };
}

export function waitForPostCloseSettlement(setTimeoutFn = setTimeout) {
  return new Promise((resolve) => {
    setTimeoutFn(resolve, POST_CLOSE_SETTLEMENT_TIMEOUT_MS);
  });
}

export async function prepareIsolatedElectronProfile({
  tmpRoot,
  prefix = "audfree-electron-e2e-",
  mkdtempFn = defaultMkdtemp,
  mkdirFn = defaultMkdir,
  realpathFn = defaultRealpath,
  rmFn = defaultRm,
} = {}) {
  let profileRoot;
  try {
    profileRoot = await mkdtempFn(path.join(tmpRoot, prefix));
    const requestedUserDataDir = path.join(profileRoot, "user-data");
    const artifactsDir = path.join(profileRoot, "artifacts");
    await mkdirFn(requestedUserDataDir);
    const userDataDir = await realpathFn(requestedUserDataDir);
    return { profileRoot, requestedUserDataDir, artifactsDir, userDataDir };
  } catch (error) {
    if (!profileRoot) throw error;
    try {
      await rmFn(profileRoot, { recursive: true, force: true });
    } catch (cleanupError) {
      const safeSetupError = sanitizedPublicError(error);
      const safeCleanupError = sanitizedPublicError(cleanupError);
      const retainedError = new Error(
        `isolated Electron profile setup failed: ${safeSetupError.message}; profile root retained at ${profileRoot} because cleanup failed: ${safeCleanupError.message}`,
        { cause: safeSetupError },
      );
      retainedError.profileRoot = profileRoot;
      retainedError.cleanupError = safeCleanupError;
      throw retainedError;
    }
    const safeSetupError = sanitizedPublicError(error);
    throw new Error(`isolated Electron profile setup failed: ${safeSetupError.message}`, { cause: safeSetupError });
  }
}

const NODE_TEST_VALUE_OPTIONS = new Set([
  "--test-name-pattern",
  "--test-skip-pattern",
  "--test-isolation",
  "--experimental-test-isolation",
  "--test-shard",
  "--test-global-setup",
  "--test-rerun-failures",
  "--test-random-seed",
  "--watch-path",
]);

const NODE_TEST_MODELED_OPTIONS = new Set([
  "--test",
  "--test-name-pattern",
  "--test-skip-pattern",
  "--test-isolation",
  "--experimental-test-isolation",
  "--test-shard",
  "--test-global-setup",
  "--test-rerun-failures",
  "--test-random-seed",
  "--watch-path",
  "--test-only",
  "--test-randomize",
  "--watch",
  "--watch-preserve-output",
  "--experimental-test-module-mocks",
  "--test-force-exit",
]);
const NODE_TEST_BOOLEAN_OPTIONS = new Set([
  "--test",
  "--test-only",
  "--test-randomize",
  "--watch",
  "--watch-preserve-output",
  "--experimental-test-module-mocks",
  "--test-force-exit",
]);
const NODE_TEST_MULTI_VALUE_OPTIONS = new Set([
  "--test-name-pattern",
  "--test-skip-pattern",
  "--watch-path",
]);

// These are the exact Node 26 worker defaults observed in the retained
// provenance artifact. They are ignored only as generated defaults; any
// changed value is unmodeled and fails closed so an execution-affecting flag
// cannot be silently accepted.
const NODE_WORKER_GENERATED_DEFAULT_VALUES = new Map([
  ["--heap-prof-interval", "524288"],
  ["--watch-kill-signal", "SIGTERM"],
  ["--inspect-publish-uid", "stderr,http"],
  ["--test-timeout", "0"],
  ["--test-concurrency", "0"],
  ["--max-http-header-size", "16384"],
  ["--stack-trace-limit", "10"],
  ["--test-coverage-lines", "0"],
  ["--inspect-port", "127.0.0.1:9229"],
  ["--heapsnapshot-near-heap-limit", "0"],
  ["--test-coverage-functions", "0"],
  ["--test-coverage-branches", "0"],
  ["--cpu-prof-interval", "1000"],
  ["--report-signal", "SIGUSR2"],
  ["--use-largepages", "off"],
  ["--network-family-autoselection-attempt-timeout", "500"],
  ["--secure-heap-min", "2"],
  ["--v8-pool-size", "4"],
  ["--secure-heap", "0"],
  ["--tls-cipher-list", "TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_GCM_SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-SHA256:DHE-RSA-AES128-SHA256:ECDHE-RSA-AES256-SHA384:DHE-RSA-AES256-SHA384:ECDHE-RSA-AES256-SHA256:DHE-RSA-AES256-SHA256:HIGH:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA"],
  ["--trace-event-file-pattern", "node_trace.${rotation}.log"],
]);

const NODE_WORKER_GENERATED_DEFAULT_FLAGS = new Set([
  "--experimental-addon-modules",
  "--node-snapshot",
  "--use-env-proxy",
]);

export const NATIVE_ELECTRON_REJECTED_ENVIRONMENT_NAMES = ["NODE_OPTIONS"];

export function validateNativeElectronEnvironment(environment = process.env) {
  return NATIVE_ELECTRON_REJECTED_ENVIRONMENT_NAMES.filter((name) => {
    const value = environment?.[name];
    return typeof value === "string" && value.trim().length > 0;
  });
}

function parseInvocationTokens(tokens) {
  const options = [];
  const positionals = [];
  let sawPositional = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!isNonEmptyString(token) || !token.startsWith("-")) {
      positionals.push(token);
      sawPositional = true;
      continue;
    }

    const separator = token.indexOf("=");
    const name = separator === -1 ? token : token.slice(0, separator);
    let value = separator === -1 ? true : token.slice(separator + 1);
    if (separator === -1 && NODE_TEST_VALUE_OPTIONS.has(name) && index + 1 < tokens.length) {
      const candidate = tokens[index + 1];
      if (isNonEmptyString(candidate) && !candidate.startsWith("-")) {
        value = candidate;
        index += 1;
      } else {
        value = undefined;
      }
    }
    options.push({ name, value, afterPositional: sawPositional });
  }
  return { options, positionals };
}

function optionValues(options, name) {
  return options.filter((option) => option.name === name).map((option) => option.value);
}

function booleanOptionValue(options, name) {
  const matches = options.filter((option) => option.name === name);
  if (matches.length === 0) return false;
  if (matches.length > 1) return undefined;
  if (matches[0].value === true || matches[0].value === "true") return true;
  if (matches[0].value === "false") return false;
  return undefined;
}

function classifyInvocationOptions(options, { allowGeneratedDefaults = false } = {}) {
  const generatedDefaultOptions = [];
  const unmodeledOptions = [];
  const optionCounts = new Map();
  for (const option of options) optionCounts.set(option.name, (optionCounts.get(option.name) ?? 0) + 1);
  for (const option of options) {
    if (option.afterPositional) {
      unmodeledOptions.push(option.name);
      continue;
    }
    if (NODE_TEST_MODELED_OPTIONS.has(option.name)) {
      if (NODE_TEST_VALUE_OPTIONS.has(option.name) && !isNonEmptyString(option.value)) {
        unmodeledOptions.push(option.name);
      }
      continue;
    }
    if (optionCounts.get(option.name) > 1) {
      unmodeledOptions.push(option.name);
      continue;
    }
    if (allowGeneratedDefaults && NODE_WORKER_GENERATED_DEFAULT_FLAGS.has(option.name) && option.value === true) {
      generatedDefaultOptions.push(option.name);
      continue;
    }
    if (allowGeneratedDefaults && NODE_WORKER_GENERATED_DEFAULT_VALUES.get(option.name) === option.value) {
      generatedDefaultOptions.push(option.name);
      continue;
    }
    unmodeledOptions.push(option.name);
  }
  for (const option of options) {
    if (NODE_TEST_MODELED_OPTIONS.has(option.name)
      && NODE_TEST_BOOLEAN_OPTIONS.has(option.name)
      && booleanOptionValue(options, option.name) === undefined) {
      unmodeledOptions.push(option.name);
    }
    if (option.name === "--test" && option.value !== true) unmodeledOptions.push(option.name);
  }
  for (const [name, count] of optionCounts) {
    if (count > 1 && !NODE_TEST_MULTI_VALUE_OPTIONS.has(name)) unmodeledOptions.push(name);
  }
  return {
    generatedDefaultOptions: [...new Set(generatedDefaultOptions)],
    unmodeledOptions: [...new Set(unmodeledOptions)],
  };
}

/**
 * Describes the stable Node test-runner contract shared by the operator's
 * command and an isolated test worker. The raw command remains evidence, but
 * Node-generated worker defaults are intentionally not treated as operator
 * intent or compared byte-for-byte.
 */
export function nodeTestInvocationContract(command, { context } = {}) {
  if (!Array.isArray(command) || command.length < 2 || !isNonEmptyString(command[0])) {
    return { valid: false };
  }

  const { options, positionals } = parseInvocationTokens(command.slice(1));
  const isNodeTestWorker = context === "node-test-worker";
  const hasTestFlag = options.some((option) => option.name === "--test" && option.value === true);
  const testIsolation = optionValues(options, "--test-isolation");
  const experimentalTestIsolation = optionValues(options, "--experimental-test-isolation");
  const testNamePatterns = optionValues(options, "--test-name-pattern");
  const testSkipPatterns = optionValues(options, "--test-skip-pattern");
  const testShards = optionValues(options, "--test-shard");
  const testGlobalSetups = optionValues(options, "--test-global-setup");
  const testRerunFailures = optionValues(options, "--test-rerun-failures");
  const testRandomSeeds = optionValues(options, "--test-random-seed");
  const watchPaths = optionValues(options, "--watch-path");
  const { generatedDefaultOptions, unmodeledOptions } = classifyInvocationOptions(options, {
    allowGeneratedDefaults: isNodeTestWorker,
  });
  const testOnly = booleanOptionValue(options, "--test-only");
  const testRandomize = booleanOptionValue(options, "--test-randomize");
  const watch = booleanOptionValue(options, "--watch");
  const watchPreserveOutput = booleanOptionValue(options, "--watch-preserve-output");
  const moduleMocks = booleanOptionValue(options, "--experimental-test-module-mocks");
  const forceExit = booleanOptionValue(options, "--test-force-exit");
  if (testIsolation.length > 0 && experimentalTestIsolation.length > 0) {
    unmodeledOptions.push("--experimental-test-isolation");
  }
  return {
    valid: positionals.length > 0
      && positionals.every(isNonEmptyString)
      && ![testOnly, testRandomize, watch, watchPreserveOutput, moduleMocks, forceExit].includes(undefined)
      && unmodeledOptions.length === 0,
    executable: command[0],
    testRunnerMode: hasTestFlag ? "test-runner" : isNodeTestWorker ? "test-worker" : "script",
    testFiles: positionals,
    testNamePatterns,
    testSkipPatterns,
    testIsolation: testIsolation[0] ?? experimentalTestIsolation[0] ?? "process",
    testOnly,
    testShard: testShards[0] ?? null,
    testGlobalSetup: testGlobalSetups[0] ?? null,
    testRerunFailures: testRerunFailures[0] ?? null,
    testRandomize,
    testRandomSeed: testRandomSeeds[0] ?? null,
    watch: watch || watchPaths.length > 0,
    watchPaths,
    watchPreserveOutput,
    moduleMocks,
    forceExit,
    generatedDefaultOptions,
    unmodeledOptions,
  };
}

function compareInvocationContracts(actual, expected) {
  const mismatches = [];
  if (actual?.unmodeledOptions?.length > 0) {
    mismatches.push(`invocation contains unmodeled options: ${actual.unmodeledOptions.join(", ")}`);
  }
  if (!actual?.valid || !expected?.valid) {
    mismatches.push("invocation contract is missing or malformed");
    return mismatches;
  }

  for (const field of [
    "executable",
    "testFiles",
    "testRunnerMode",
    "testNamePatterns",
    "testSkipPatterns",
    "testIsolation",
    "testOnly",
    "testShard",
    "testGlobalSetup",
    "testRerunFailures",
    "testRandomize",
    "testRandomSeed",
    "watch",
    "watchPaths",
    "watchPreserveOutput",
    "moduleMocks",
    "forceExit",
  ]) {
    const workerEquivalent = field === "testRunnerMode"
      && expected[field] === "test-runner"
      && actual[field] === "test-worker";
    if (!workerEquivalent && JSON.stringify(actual[field]) !== JSON.stringify(expected[field])) {
      mismatches.push(`invocation ${field} expected ${JSON.stringify(expected[field])} but was ${JSON.stringify(actual[field])}`);
    }
  }
  return mismatches;
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

export function createNativeScenarioSelector(rawSelection) {
  const selectionProvided = rawSelection !== undefined;
  const selectedName = selectionProvided ? rawSelection.trim() : undefined;
  if (selectionProvided && !selectedName) {
    throw new Error("HARBOR_NATIVE_SCENARIO must be a non-empty scenario name when provided");
  }

  let selectedScenarioFound = selectedName === undefined;
  return {
    select(name) {
      if (selectedName === undefined || selectedName === name) {
        selectedScenarioFound = true;
        return { selected: true };
      }
      return { selected: false, skipReason: "not selected by HARBOR_NATIVE_SCENARIO" };
    },
    assertMatched() {
      if (!selectedScenarioFound) {
        throw new Error("HARBOR_NATIVE_SCENARIO did not match a registered native scenario");
      }
    },
  };
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

export function validateDirectGuiTestInvocation(provenance) {
  const invocation = provenance?.invocation;
  const contract = invocation?.contract;
  if (invocation?.context !== "main-process" || !contract?.valid
    || contract.testRunnerMode !== "test-runner" || contract.testIsolation !== "none") {
    return ["GUI acceptance requires a directly observed Node test runner with --test-isolation=none"];
  }
  return [];
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
  compare("branch/status", provenance?.repositoryStatus?.split("\n", 1)[0], expectations.branchStatus);

  if (expectations.requireCleanWorkingTree) {
    const statusLines = String(provenance?.repositoryStatus ?? "").split("\n").filter(Boolean);
    if (statusLines.length !== 1 || !statusLines[0].startsWith("## ")) {
      mismatches.push("working tree is not clean");
    }
  }

  if (expectations.invocationCommand !== undefined) {
    if (!Array.isArray(expectations.invocationCommand)) {
      mismatches.push("invocation command expectation is invalid");
    } else {
      const expectedInvocation = nodeTestInvocationContract(expectations.invocationCommand, { context: "main-process" });
      const actualInvocation = provenance?.invocation?.contract
        ?? nodeTestInvocationContract(provenance?.invocation?.command, {
          context: provenance?.invocation?.context,
        });
      const invocationMismatches = compareInvocationContracts(actualInvocation, expectedInvocation);
      if (invocationMismatches.length > 0) {
        mismatches.push(`invocation command expected contract ${JSON.stringify(expectedInvocation)} but was ${JSON.stringify(actualInvocation)}: ${invocationMismatches.join("; ")}`);
      }
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
  electronHelperExecutables = [],
  electronPackageJson,
  playwrightPackageJson,
  baseRef,
  command = currentInvocationCommand(),
  environment = process.env,
  execFileFn = execFile,
  readFileFn = defaultReadFile,
} = {}) {
  const resolvedBaseRef = baseRef
    ?? environment.HARBOR_NATIVE_BASE_REF
    ?? (environment.GITHUB_BASE_REF ? `origin/${environment.GITHUB_BASE_REF}` : "feature/harbor-clo-159");
  const rejectedEnvironmentNames = validateNativeElectronEnvironment(environment);
  if (rejectedEnvironmentNames.length > 0) {
    const rejectedInvocationContext = environment.NODE_TEST_CONTEXT?.startsWith("child")
      ? "unverified"
      : "main-process";
    return {
      status: false,
      worktree: repoRoot,
      baseRef: resolvedBaseRef,
      baseSha: undefined,
      headSha: undefined,
      changedFiles: undefined,
      repositoryStatus: "",
      invocation: {
        command,
        contract: nodeTestInvocationContract(command, { context: rejectedInvocationContext }),
        context: rejectedInvocationContext,
        contextValue: environment.NODE_TEST_CONTEXT,
        cwd: process.cwd(),
        nodeExecutable: process.execPath,
        environmentPolicy: { rejectedNames: rejectedEnvironmentNames },
        electronOverridesRemoved: [
          "ELECTRON_CACHE",
          "ELECTRON_MIRROR",
          "ELECTRON_OVERRIDE_DIST_PATH",
          "ELECTRON_RUN_AS_NODE",
          "NPM_CONFIG_ELECTRON_MIRROR",
          "npm_config_electron_mirror",
        ],
      },
      commands: [],
      toolchain: { node: process.version },
      artifact: {
        executable: electronExecutable,
        helperExecutables: electronHelperExecutables,
      },
      errors: rejectedEnvironmentNames.map((name) => `native Electron environment ${name} must be unset before launch`),
    };
  }
  const errors = [];
  const commands = [];
  const workerContext = await resolveNodeTestWorkerContext({
    environment,
    execFileFn,
    parentPid: process.ppid,
    nodeExecutable: process.execPath,
    cwd: repoRoot,
  });
  if (workerContext.command) {
    commands.push({
      argv: workerContext.command,
      cwd: repoRoot,
      outcome: workerContext.error ? "FAILURE" : "PASS",
      ...(workerContext.error ? { error: workerContext.error } : {}),
    });
  }
  if (workerContext.error) errors.push(workerContext.error);
  const invocationContext = workerContext.context;
  const invocationContract = nodeTestInvocationContract(command, { context: invocationContext });
  const commandResult = async (commandName, args, { details = false } = {}) => {
    const result = await runCommand(commandName, args, repoRoot, execFileFn);
    commands.push({
      argv: [commandName, ...args],
      cwd: repoRoot,
      outcome: result.error ? "FAILURE" : "PASS",
      ...(result.error ? { error: result.error } : {}),
    });
    if (result.error) errors.push(result.error);
    return details ? result : result.value;
  };
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
    ["invocation contract", () => invocationContract.valid],
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
      contract: invocationContract,
      context: invocationContext,
      contextValue: environment.NODE_TEST_CONTEXT,
      cwd: process.cwd(),
      nodeExecutable: process.execPath,
      environmentPolicy: {
        rejectedNames: rejectedEnvironmentNames,
      },
      electronOverridesRemoved: [
        "ELECTRON_CACHE",
        "ELECTRON_MIRROR",
        "ELECTRON_OVERRIDE_DIST_PATH",
        "ELECTRON_RUN_AS_NODE",
        "NPM_CONFIG_ELECTRON_MIRROR",
        "npm_config_electron_mirror",
      ],
    },
    commands,
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
      helperExecutables: electronHelperExecutables,
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

export function recordProcessError(diagnostics, error) {
  const details = errorDiagnostics(error);
  diagnostics.processErrors.push(details.stack ?? details.message);
  return details;
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
  settleAfterClose = async () => {},
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
      let closeTimer;
      try {
        await Promise.race([
          Promise.resolve().then(() => electronApp.close()),
          new Promise((_, reject) => {
            closeTimer = setTimeout(() => reject(new Error(`Electron close exceeded ${timeout}ms`)), timeout);
          }),
        ]);
      } finally {
        if (closeTimer) clearTimeout(closeTimer);
      }
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

    try {
      await settleAfterClose();
    } catch (error) {
      cleanupErrors.push(error);
      recordDiagnosticError(diagnostics, error);
    }
  }

  await persistCurrentDiagnostics();

  const cleanupSucceeded = !electronApp || (
    cleanupErrors.length === 0 && diagnostics.cleanup.verifiedExit
  );
  if (diagnostics.processFailure) diagnostics.disposition = "FAILURE";
  if (passed && !diagnostics.processFailure && (!cleanupSucceeded || persistenceError)) diagnostics.disposition = "CLEANUP_FAILURE";
  if (cleanupErrors.length > 0 || persistenceError) await persistCurrentDiagnostics();
  if (passed && !diagnostics.processFailure && cleanupSucceeded && !persistenceError) {
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

  const cause = errorDiagnostics(primaryError ?? secondaryErrors[0]);
  const publicCause = new Error(cause.message);
  publicCause.name = cause.name;
  if (cause.stack) publicCause.stack = cause.stack;
  const baseMessage = primaryError
    ? cause.message
    : `Electron E2E finalization failed: ${cause.message}`;
  const message = `${sanitizeDiagnosticsText(baseMessage)}\nElectron E2E diagnostics: ${diagnosticsPath ?? "unavailable"}`;
  const failure = new Error(message, { cause: publicCause });
  failure.secondaryErrors = secondaryErrors.map(errorDiagnostics);
  return failure;
}
