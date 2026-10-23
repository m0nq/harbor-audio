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
const convertedRowsSelector =
  'section[aria-label="Converted demonstration fixture list"] tbody tr';

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

async function withElectronLaunch(scenario, callback) {
  const profileRoot = await mkdtemp(path.join(os.tmpdir(), "audfree-electron-e2e-"));
  const requestedUserDataDir = path.join(profileRoot, "user-data");
  const artifactsDir = path.join(profileRoot, "artifacts");
  await mkdir(requestedUserDataDir);
  const userDataDir = await realpath(requestedUserDataDir);

  const diagnostics = {
    scenario,
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

    await callback({ electronApp, page });

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

async function openConverted(page) {
  await page.getByRole("button", { name: "Converted", exact: true }).click();
  const resultRows = page.locator(convertedRowsSelector);
  await page.getByLabel("Filter by", { exact: true }).waitFor({ state: "visible" });
  await resultRows.first().waitFor({ state: "visible" });
  return resultRows;
}

async function resultTitles(resultRows) {
  return (await resultRows.locator("td:first-child").allTextContents()).map((title) => title.trim());
}

async function assertConvertedResults(page, resultRows, expected) {
  if (expected.length > 0) await resultRows.first().waitFor({ state: "visible" });
  assert.equal(await resultRows.count(), expected.length);
  assert.deepEqual(await resultTitles(resultRows), expected);
  assert.equal(await page.getByRole("status").textContent(), `${expected.length} result${expected.length === 1 ? "" : "s"}`);
}

async function selectConvertedDimension(page, label) {
  const dimension = page.getByLabel("Filter by", { exact: true });
  await dimension.selectOption({ label });
  const secondary = page.getByLabel(label, { exact: true });
  await secondary.waitFor({ state: "visible" });
  return secondary;
}

async function selectConvertedValue(page, label) {
  const secondary = page.getByLabel(/^(Artist|Album)$/, { exact: true });
  await secondary.selectOption({ label });
  assert.equal(await secondary.locator("option:checked").textContent(), label);
  return secondary;
}

async function assertSelectedLabel(select, label) {
  assert.equal(await select.locator("option:checked").textContent(), label);
}

async function setSearch(page, value) {
  const search = page.getByLabel("Search", { exact: true });
  await search.fill(value);
  return search;
}

test("Converted Slice 1 functional Electron acceptance", async (t) => {
  await t.test("Converted Electron vertical slice survives three isolated launches", async () => {
    for (const attempt of [1, 2, 3]) {
      await withElectronLaunch(`artist-baseline-${attempt}`, async ({ page }) => {
        const resultRows = await openConverted(page);
        const filterBy = page.getByLabel("Filter by", { exact: true });
        assert.equal(await filterBy.inputValue(), "all");
        assert.equal(await resultRows.count(), 5);

        const artistSelect = await selectConvertedDimension(page, "Artist");
        assert.equal(await artistSelect.inputValue(), "all-artists");
        assert.equal(await resultRows.count(), 5);

        await selectConvertedValue(page, "Lead Artist");
        await assertConvertedResults(page, resultRows, expectedTitles);
      });
    }
  });

  await t.test("filters Converted rows by Album with a conditional selector", async () => {
    await withElectronLaunch("album-filtering", async ({ page }) => {
      const resultRows = await openConverted(page);
      const albumSelect = await selectConvertedDimension(page, "Album");
      assert.equal(await albumSelect.inputValue(), "all-albums");
      assert.equal(await resultRows.count(), 5);

      await selectConvertedValue(page, "Shared Album");
      await assertConvertedResults(page, resultRows, ["Shared Lead", "Shared Other"]);
      const titles = await resultTitles(resultRows);
      assert.equal(titles.includes("Alpha Other"), false);
      assert.equal(titles.includes("Unrelated Track"), false);
    });
  });

  await t.test("orders Artist and Album options alphabetically with inclusive defaults", async () => {
    await withElectronLaunch("selector-ordering", async ({ page }) => {
      await openConverted(page);
      const dimension = page.getByLabel("Filter by", { exact: true });
      assert.deepEqual(await dimension.locator("option").allTextContents(), ["All", "Artist", "Album"]);

      const artistSelect = await selectConvertedDimension(page, "Artist");
      assert.deepEqual(await artistSelect.locator("option").allTextContents(), [
        "All Artists",
        "Alpha Collaborator",
        "Lead Artist",
        "Other Artist",
        "Unrelated Artist",
      ]);

      const albumSelect = await selectConvertedDimension(page, "Album");
      assert.deepEqual(await albumSelect.locator("option").allTextContents(), [
        "All Albums",
        "Other Album",
        "Shared Album",
        "Unrelated Album",
      ]);
    });
  });

  await t.test("matches Search queries and exposes contextual no-results recovery", async () => {
    await withElectronLaunch("search-empty-state", async ({ page }) => {
      const resultRows = await openConverted(page);
      const search = await setSearch(page, "shared");
      await assertConvertedResults(page, resultRows, ["Shared Lead", "Shared Other"]);
      assert.equal(await search.inputValue(), "shared");

      await setSearch(page, "no such track");
      await assertConvertedResults(page, resultRows, []);
      assert.equal(
        await page.locator("#converted-empty").textContent(),
        "No tracks match ‘no such track’ within this selection.Clear Search",
      );
      await page.getByRole("button", { name: "Clear Search", exact: true }).click();
      assert.equal(await search.inputValue(), "");
      await assertConvertedResults(page, resultRows, [
        "Shared Lead",
        "Shared Other",
        "Alpha Other",
        "Unrelated Track",
        "Missing Metadata",
      ]);
      assert.equal(await page.getByRole("button", { name: "Clear Search", exact: true }).count(), 0);
    });
  });

  await t.test("composes Search with active Artist and Album filters", async () => {
    await withElectronLaunch("search-composition", async ({ page }) => {
      const resultRows = await openConverted(page);
      await selectConvertedDimension(page, "Artist");
      await selectConvertedValue(page, "Lead Artist");
      await assertConvertedResults(page, resultRows, expectedTitles);

      await setSearch(page, "Alpha Other");
      await assertConvertedResults(page, resultRows, ["Alpha Other"]);
      await setSearch(page, "Unrelated Track");
      await assertConvertedResults(page, resultRows, []);
      await page.getByRole("button", { name: "Clear Search", exact: true }).click();
      await assertConvertedResults(page, resultRows, expectedTitles);

      await selectConvertedDimension(page, "Album");
      await selectConvertedValue(page, "Shared Album");
      await setSearch(page, "Shared Lead");
      await assertConvertedResults(page, resultRows, ["Shared Lead"]);
      await setSearch(page, "Alpha Other");
      await assertConvertedResults(page, resultRows, []);
      await page.getByRole("button", { name: "Clear Search", exact: true }).click();
      await assertConvertedResults(page, resultRows, ["Shared Lead", "Shared Other"]);
    });
  });

  await t.test("preserves Artist and Album selections across navigation", async () => {
    await withElectronLaunch("navigation-preservation", async ({ page }) => {
      const resultRows = await openConverted(page);
      await selectConvertedDimension(page, "Artist");
      const artistSelect = await selectConvertedValue(page, "Lead Artist");
      await assertConvertedResults(page, resultRows, expectedTitles);

      await page.getByRole("button", { name: "Converting", exact: true }).click();
      await page.getByLabel("Filter items", { exact: true }).waitFor({ state: "visible" });
      await page.getByRole("button", { name: "Converted", exact: true }).click();
      await page.getByLabel("Artist", { exact: true }).waitFor({ state: "visible" });
      assert.equal(await page.getByLabel("Filter by", { exact: true }).inputValue(), "artist");
      await assertSelectedLabel(artistSelect, "Lead Artist");
      await assertConvertedResults(page, resultRows, expectedTitles);

      await selectConvertedDimension(page, "Album");
      const albumSelect = await selectConvertedValue(page, "Shared Album");
      await assertConvertedResults(page, resultRows, ["Shared Lead", "Shared Other"]);
      await page.getByRole("button", { name: "Converting", exact: true }).click();
      await page.getByRole("button", { name: "Converted", exact: true }).click();
      await page.getByLabel("Album", { exact: true }).waitFor({ state: "visible" });
      assert.equal(await page.getByLabel("Filter by", { exact: true }).inputValue(), "album");
      await assertSelectedLabel(albumSelect, "Shared Album");
      await assertConvertedResults(page, resultRows, ["Shared Lead", "Shared Other"]);
    });
  });

  await t.test("keeps Converting status controls separate from Converted filters", async () => {
    await withElectronLaunch("view-control-separation", async ({ page }) => {
      await openConverted(page);
      await page.getByLabel("Filter by", { exact: true }).waitFor({ state: "visible" });
      assert.equal(await page.getByLabel("Filter items", { exact: true }).count(), 0);
      assert.equal(await page.getByLabel("Artist", { exact: true }).count(), 0);
      assert.equal(await page.getByLabel("Album", { exact: true }).count(), 0);

      await page.getByRole("button", { name: "Converting", exact: true }).click();
      const statusFilter = page.getByLabel("Filter items", { exact: true });
      await statusFilter.waitFor({ state: "visible" });
      assert.equal(await page.getByLabel("Filter by", { exact: true }).count(), 0);
      assert.equal(await page.getByLabel("Artist", { exact: true }).count(), 0);
      assert.equal(await page.getByLabel("Album", { exact: true }).count(), 0);
      assert.deepEqual(await statusFilter.locator("option").allTextContents(), [
        "All",
        "Waiting",
        "Analyzing",
        "Converting",
        "Failed",
        "Converted",
      ]);
    });
  });
});
