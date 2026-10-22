import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { _electron as electron } from "playwright-core";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronPackageRoot = path.join(
  repoRoot,
  "node_modules/.pnpm/electron@44.7.0/node_modules/electron",
);
const electronExecutable = path.join(
  electronPackageRoot,
  "dist/Electron.app/Contents/MacOS/Electron",
);
const expectedTitles = ["Shared Lead", "Alpha Other"];
const timeoutMs = 15_000;

function isolatedEnvironment() {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => value !== undefined),
  );

  for (const key of [
    "ELECTRON_CACHE",
    "ELECTRON_MIRROR",
    "ELECTRON_OVERRIDE_DIST_PATH",
    "ELECTRON_RUN_AS_NODE",
    "NPM_CONFIG_ELECTRON_MIRROR",
    "npm_config_electron_mirror",
  ]) {
    delete environment[key];
  }

  return environment;
}

function diagnosticsText(diagnostics) {
  return JSON.stringify(diagnostics, null, 2);
}

function waitForProcessExit(child, timeout = timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Electron child process did not exit within ${timeout}ms`));
    }, timeout);

    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function runAcceptanceLaunch(attempt) {
  const profileRoot = await mkdtemp(path.join(os.tmpdir(), "audfree-electron-e2e-"));
  const requestedUserDataDir = path.join(profileRoot, "user-data");
  const artifactsDir = path.join(profileRoot, "artifacts");
  await mkdir(requestedUserDataDir);
  const userDataDir = await realpath(requestedUserDataDir);

  const diagnostics = {
    attempt,
    profileRoot,
    userDataDir,
    artifactsDir,
    electronConsole: [],
    pageConsole: [],
    pageErrors: [],
    processErrors: [],
    processExit: undefined,
  };
  let electronApp;
  let page;
  let child;
  let passed = false;

  try {
    electronApp = await electron.launch({
      executablePath: electronExecutable,
      args: [`--user-data-dir=${userDataDir}`, repoRoot],
      artifactsDir,
      cwd: repoRoot,
      env: isolatedEnvironment(),
      timeout: timeoutMs,
    });
    child = electronApp.process();
    child.on("error", (error) => {
      diagnostics.processErrors.push(error.stack ?? error.message);
    });
    child.on("exit", (code, signal) => {
      diagnostics.processExit = { code, signal };
    });
    if (child.stderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        diagnostics.processErrors.push(String(chunk));
      });
    }

    electronApp.on("console", (message) => {
      diagnostics.electronConsole.push(`${message.type()}: ${message.text()}`);
    });

    page = await electronApp.firstWindow({ timeout: timeoutMs });
    page.setDefaultTimeout(timeoutMs);
    page.on("console", (message) => {
      diagnostics.pageConsole.push(`${message.type()}: ${message.text()}`);
    });
    page.on("pageerror", (error) => {
      diagnostics.pageErrors.push(error.stack ?? error.message);
    });

    const runtimePaths = await electronApp.evaluate(({ app }) => ({
      userData: app.getPath("userData"),
      sessionData: app.getPath("sessionData"),
    }));
    assert.equal(
      runtimePaths.userData,
      userDataDir,
      "Electron userData must resolve to the prelaunch isolated directory",
    );
    assert.equal(
      runtimePaths.sessionData,
      userDataDir,
      "Electron sessionData must remain inside the prelaunch isolated userData directory",
    );

    await page.getByRole("button", { name: "Converted", exact: true }).click();

    const filterBy = page.getByLabel("Filter by", { exact: true });
    const resultRows = page.locator(
      'section[aria-label="Converted demonstration fixture list"] tbody tr',
    );
    await resultRows.first().waitFor({ state: "visible" });
    assert.equal(await filterBy.inputValue(), "all");
    assert.equal(await resultRows.count(), 5);

    await filterBy.selectOption("artist");

    const artistSelect = page.getByLabel("Artist", { exact: true });
    await artistSelect.waitFor({ state: "visible" });
    assert.equal(await artistSelect.inputValue(), "all-artists");
    assert.equal(await resultRows.count(), 5);

    await artistSelect.selectOption({ label: "Lead Artist" });
    assert.equal(
      await artistSelect.locator("option:checked").textContent(),
      "Lead Artist",
    );
    assert.equal(await resultRows.count(), expectedTitles.length);
    assert.deepEqual(
      await resultRows.locator("td:first-child").allTextContents(),
      expectedTitles,
    );
    assert.equal(await page.getByRole("status").textContent(), "2 results");

    passed = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}\nElectron E2E diagnostics:\n${diagnosticsText(diagnostics)}`, {
      cause: error,
    });
  } finally {
    if (electronApp) {
      try {
        await electronApp.close();
      } finally {
        if (child && child.exitCode === null && child.signalCode === null) {
          try {
            await waitForProcessExit(child);
          } catch (error) {
            if (!passed) {
              diagnostics.processErrors.push(error instanceof Error ? error.message : String(error));
            }
            if (child.exitCode === null && child.signalCode === null) child.kill();
            throw error;
          }
        }
        if (child && child.exitCode === null && child.signalCode === null) child.kill();
      }
    }

    if (passed) await rm(profileRoot, { recursive: true, force: true });
  }
}

test("Converted Electron vertical slice survives three isolated launches", async () => {
  for (const attempt of [1, 2, 3]) {
    await runAcceptanceLaunch(attempt);
  }
});
