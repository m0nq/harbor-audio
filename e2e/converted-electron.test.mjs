import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { _electron as electron } from "playwright-core";
import {
  buildFailureError,
  collectRunProvenance,
  errorDiagnostics,
  expectedProvenanceFromEnvironment,
  finalizeDiagnostics,
  launchProcessDiagnostics,
  MAX_CAPTURED_STREAM_BYTES,
  createBoundedDiagnosticsCapture,
  createNativeScenarioSelector,
  prepareIsolatedElectronProfile,
  recordProcessError,
  utf8Prefix,
  validateExpectedProvenance,
  waitForPostCloseSettlement,
} from "./launch-diagnostics.mjs";

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
const canonicalConvertingRowsSelector =
  'section[aria-label="Converting fixture list"] tbody tr';
const sessionQueueRowsSelector =
  'section[aria-labelledby="session-queue-additions-heading"] tbody tr';
const completedSessionRowsSelector =
  'section[aria-labelledby="completed-session-heading"] tbody tr';
const { expected: expectedProvenance, missing: missingExpectedProvenance } = expectedProvenanceFromEnvironment({
  worktree: repoRoot,
  executable: electronExecutable,
  electronVersion: "44.7.0",
});
const collectedProvenance = await collectRunProvenance({
  repoRoot,
  electronExecutable,
  baseRef: expectedProvenance.baseRef,
  electronPackageJson: path.join(electronPackageRoot, "package.json"),
  playwrightPackageJson: path.join(
    repoRoot,
    "node_modules/.pnpm/playwright-core@1.64.1/node_modules/playwright-core/package.json",
  ),
});
const provenanceMismatches = validateExpectedProvenance(collectedProvenance, expectedProvenance);
const provenanceExpectationErrors = [
  ...missingExpectedProvenance.map((name) => `exact native provenance expectation is missing: ${name}`),
  ...provenanceMismatches.map((error) => `exact native provenance mismatch: ${error}`),
];
const runProvenance = {
  ...collectedProvenance,
  status: collectedProvenance.status && provenanceExpectationErrors.length === 0,
  errors: [...(collectedProvenance.errors ?? []), ...provenanceExpectationErrors],
};

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

async function withElectronLaunch(scenario, callback) {
  const { profileRoot, artifactsDir, userDataDir } = await prepareIsolatedElectronProfile({
    tmpRoot: os.tmpdir(),
  });

  const diagnostics = {
    scenario,
    provenance: runProvenance,
    profileRoot,
    userDataDir,
    artifactsDir,
    electronConsole: [],
    pageConsole: [],
    pageErrors: [],
    processErrors: [],
    processFailure: false,
    processExit: undefined,
    launchError: undefined,
    startupPhase: "prelaunch",
    disposition: "UNDETERMINED",
    cleanup: {
      ownership: "not-established",
      ownershipSource: "none",
      closeRequested: false,
      directChildPid: undefined,
      launchProcess: undefined,
      killAttempted: false,
      verifiedExit: false,
      closeObserved: false,
    },
  };
  let electronApp;
  let page;
  let child;
  let passed = false;
  let primaryError;
  let stderrBytes = 0;
  let stderrTruncated = false;
  const listenerDisposers = [];
  const listen = (target, event, handler, { retain = false } = {}) => {
    target.on(event, handler);
    if (!retain) listenerDisposers.push(() => target.removeListener?.(event, handler));
  };
  const markProcessFailure = (error) => {
    recordProcessError(diagnostics, error);
    diagnostics.processFailure = true;
    primaryError ??= error;
    passed = false;
    diagnostics.disposition = "FAILURE";
  };
  const electronConsoleCapture = createBoundedDiagnosticsCapture("Electron console", {
    onTruncate: markProcessFailure,
  });
  const pageConsoleCapture = createBoundedDiagnosticsCapture("Page console", {
    onTruncate: markProcessFailure,
  });
  const pageErrorCapture = createBoundedDiagnosticsCapture("Page error", {
    onTruncate: markProcessFailure,
  });
  diagnostics.electronConsole = electronConsoleCapture.values;
  diagnostics.pageConsole = pageConsoleCapture.values;
  diagnostics.pageErrors = pageErrorCapture.values;

  try {
    if (!runProvenance.status) {
      diagnostics.startupPhase = "provenance-gate";
      diagnostics.disposition = "HOLD";
      throw new Error("Native run provenance is incomplete; refusing Electron launch");
    }
    diagnostics.startupPhase = "electron-launch";
    electronApp = await electron.launch({
      executablePath: electronExecutable,
      args: [`--user-data-dir=${userDataDir}`, repoRoot],
      artifactsDir,
      cwd: repoRoot,
      env: isolatedEnvironment(),
      timeout: timeoutMs,
    });
    diagnostics.startupPhase = "electron-started";
    child = electronApp.process();
    diagnostics.cleanup.directChildPid = child.pid;
    diagnostics.cleanup.ownership = "playwright-child-handle";
    diagnostics.cleanup.ownershipSource = "electronApp.process()";
    listen(child, "error", (error) => {
      markProcessFailure(error);
    }, { retain: true });
    listen(child, "exit", (code, signal) => {
      diagnostics.processExit = { code, signal };
    });
    listen(child, "close", () => {
      diagnostics.cleanup.closeObserved = true;
    });
    if (child.stderr) {
      child.stderr.setEncoding("utf8");
      listen(child.stderr, "data", (chunk) => {
        if (stderrTruncated) return;
        const text = String(chunk);
        const bytes = Buffer.byteLength(text, "utf8");
        const remaining = MAX_CAPTURED_STREAM_BYTES - stderrBytes;
        if (bytes <= remaining) {
          diagnostics.processErrors.push(text);
          stderrBytes += bytes;
          return;
        }
        if (remaining > 0) {
          const retained = utf8Prefix(text, remaining);
          diagnostics.processErrors.push(retained);
          stderrBytes += Buffer.byteLength(retained, "utf8");
        }
        stderrTruncated = true;
        markProcessFailure(new Error(`Electron stderr capture exceeded ${MAX_CAPTURED_STREAM_BYTES} bytes; output truncated`));
      });
      listen(child.stderr, "error", (error) => {
        markProcessFailure(error);
      }, { retain: true });
    }

    listen(electronApp, "console", (message) => {
      electronConsoleCapture.append(`${message.type()}: ${message.text()}`);
    });

    page = await electronApp.firstWindow({ timeout: timeoutMs });
    diagnostics.startupPhase = "renderer-started";
    page.setDefaultTimeout(timeoutMs);
    listen(page, "console", (message) => {
      pageConsoleCapture.append(`${message.type()}: ${message.text()}`);
    });
    listen(page, "pageerror", (error) => {
      pageErrorCapture.append(error.stack ?? error.message);
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
    diagnostics.startupPhase = "application-workflow";
    diagnostics.disposition = "PASS";
  } catch (error) {
    primaryError ??= error;
    diagnostics.launchError = errorDiagnostics(error);
    diagnostics.cleanup.launchProcess = launchProcessDiagnostics(error);
    if (!electronApp) {
      if (diagnostics.disposition === "UNDETERMINED") diagnostics.disposition = "HOLD";
      if (diagnostics.startupPhase === "electron-launch") diagnostics.startupPhase = "pre-renderer-launch";
      if (diagnostics.startupPhase === "provenance-gate") {
        diagnostics.cleanup.ownership = "not-established";
        diagnostics.cleanup.ownershipSource = "provenance-gate";
      } else {
        diagnostics.cleanup.ownership = diagnostics.cleanup.launchProcess.ownership;
        diagnostics.cleanup.ownershipSource = "playwright-error-log";
      }
    } else if (!page) {
      diagnostics.disposition = "HOLD";
      diagnostics.startupPhase = "renderer-startup";
    } else {
      diagnostics.disposition = "FAILURE";
      diagnostics.startupPhase = "application-workflow";
    }
  } finally {
    let finalization;
    try {
      finalization = await finalizeDiagnostics({
        diagnostics,
        electronApp,
        child,
        passed,
        profileRoot,
        timeout: timeoutMs,
        settleAfterClose: () => waitForPostCloseSettlement(),
      });
    } finally {
      for (const dispose of listenerDisposers.splice(0).reverse()) dispose();
    }
    const finalError = buildFailureError({
      primaryError,
      diagnosticsPath: finalization.diagnosticsPath,
      cleanupErrors: finalization.cleanupErrors,
      persistenceError: finalization.persistenceError,
    });
    if (finalError) throw finalError;
  }
}

async function openConverted(page) {
  await page.getByRole("button", { name: "Converted", exact: true }).click();
  const resultRows = page.locator(convertedRowsSelector);
  await page.getByLabel("Filter by", { exact: true }).waitFor({ state: "visible" });
  await resultRows.first().waitFor({ state: "visible" });
  return resultRows;
}

async function openConvertedWithKeyboard(page) {
  const converted = page.getByRole("button", { name: "Converted", exact: true });
  await converted.focus();
  assert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute("data-view")),
    "converted",
  );
  await converted.press("Enter");
  const resultRows = page.locator(convertedRowsSelector);
  await page.getByLabel("Filter by", { exact: true }).waitFor({ state: "visible" });
  await resultRows.first().waitFor({ state: "visible" });
  return resultRows;
}

async function observeConvertedDimensionEvents(page) {
  await page.evaluate(() => {
    const dimension = document.querySelector("#converted-dimension");
    if (!dimension) throw new Error("expected Converted dimension selector");

    const events = [];
    const record = (event) => {
      const select = event.currentTarget;
      const selected = select.selectedOptions[0];
      events.push({
        type: event.type,
        key: event instanceof KeyboardEvent ? event.key : null,
        value: select.value,
        selectedOption: selected
          ? { value: selected.value, text: selected.textContent }
          : null,
      });
    };

    for (const type of ["keydown", "keyup", "input", "change"]) {
      dimension.addEventListener(type, record);
    }
    window.__harborA11y01BDimensionEvents = events;
  });
}

async function convertedDimensionDiagnostics(page) {
  return page.evaluate(() => {
    const dimension = document.querySelector("#converted-dimension");
    const selected = dimension?.selectedOptions[0];
    const active = document.activeElement;
    const conditional = document.querySelector("#converted-value");

    return {
      dimensionValue: dimension?.value ?? null,
      selectedOption: selected
        ? { value: selected.value, text: selected.textContent }
        : null,
      focusedElement: active
        ? {
          id: active.id,
          tag: active.tagName,
          ariaLabel: active.getAttribute("aria-label"),
        }
        : null,
      conditionalControl: {
        present: Boolean(conditional),
        id: conditional?.id ?? null,
        label: document.querySelector('label[for="converted-value"]')?.textContent?.trim() ?? null,
      },
      events: Array.isArray(window.__harborA11y01BDimensionEvents)
        ? window.__harborA11y01BDimensionEvents
        : [],
    };
  });
}

async function runConvertedDimensionDiagnostic(scenario, activate) {
  let diagnostics;
  await withElectronLaunch(scenario, async ({ page }) => {
    await openConvertedWithKeyboard(page);
    const dimension = page.getByLabel("Filter by", { exact: true });
    await observeConvertedDimensionEvents(page);
    await dimension.focus();
    await activate({ dimension, page });
    diagnostics = await convertedDimensionDiagnostics(page);
    console.log(`[HARBOR-A11Y-01B] ${scenario}: ${JSON.stringify(diagnostics)}`);
    assert.ok(diagnostics.selectedOption, JSON.stringify(diagnostics));
    assert.ok(Array.isArray(diagnostics.events), JSON.stringify(diagnostics));
  });
  return diagnostics;
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

async function sortBy(page, label, direction = "ascending") {
  const button = page.getByRole("button", { name: `Sort by ${label}`, exact: true });
  const header = page.locator(`th:has(button[aria-label="Sort by ${label}"])`);
  await header.waitFor({ state: "visible" });
  await button.click();
  await page.waitForFunction(
    ({ label: expectedLabel, direction: expectedDirection }) => [...document.querySelectorAll("th")].some((candidate) => (
      candidate.getAttribute("aria-sort") === expectedDirection
      && candidate.querySelector("button")?.getAttribute("aria-label") === `Sort by ${expectedLabel}`
    )),
    { label, direction },
    { timeout: timeoutMs },
  );
  return header;
}

async function sortByWithKeyboard(page, label, direction = "ascending") {
  const button = page.getByRole("button", { name: `Sort by ${label}`, exact: true });
  const header = page.locator(`th:has(button[aria-label="Sort by ${label}"])`);
  await header.waitFor({ state: "visible" });
  await button.focus();
  assert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute("aria-label")),
    `Sort by ${label}`,
  );
  await button.press("Enter");
  await page.waitForFunction(
    ({ label: expectedLabel, direction: expectedDirection }) => [...document.querySelectorAll("th")].some((candidate) => (
      candidate.getAttribute("aria-sort") === expectedDirection
      && candidate.querySelector("button")?.getAttribute("aria-label") === `Sort by ${expectedLabel}`
    )),
    { label, direction },
    { timeout: timeoutMs },
  );
  return header;
}

async function clearSort(page) {
  await page.getByRole("button", { name: "Clear sort", exact: true }).click();
}

const nativeScenarioSelector = createNativeScenarioSelector(process.env.HARBOR_NATIVE_SCENARIO);

async function runScenario(t, name, callback) {
  const selection = nativeScenarioSelector.select(name);
  if (selection.selected) return t.test(name, callback);
  return t.test(name, { skip: selection.skipReason }, callback);
}

test("Converted Slice 1 functional Electron acceptance", async (t) => {
  await runScenario(t, "Converted Electron vertical slice survives three isolated launches", async () => {
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

  await runScenario(t, "filters Converted rows by Album with a conditional selector", async () => {
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

  await runScenario(t, "sorts Converted rows by each visible column and clears back to source order", async () => {
    await withElectronLaunch("sorting-order-and-clear", async ({ page }) => {
      const resultRows = await openConverted(page);
      await assertConvertedResults(page, resultRows, [
        "Shared Lead",
        "Shared Other",
        "Alpha Other",
        "Unrelated Track",
        "Missing Metadata",
      ]);

      const titleHeader = await sortBy(page, "Title", "ascending");
      await assertConvertedResults(page, resultRows, [
        "Alpha Other",
        "Missing Metadata",
        "Shared Lead",
        "Shared Other",
        "Unrelated Track",
      ]);
      assert.equal(await titleHeader.getAttribute("aria-sort"), "ascending");

      await sortBy(page, "Title", "descending");
      await assertConvertedResults(page, resultRows, [
        "Unrelated Track",
        "Shared Other",
        "Shared Lead",
        "Missing Metadata",
        "Alpha Other",
      ]);
      assert.equal(await titleHeader.getAttribute("aria-sort"), "descending");

      const durationHeader = await sortBy(page, "Duration", "ascending");
      await assertConvertedResults(page, resultRows, [
        "Missing Metadata",
        "Alpha Other",
        "Shared Lead",
        "Shared Other",
        "Unrelated Track",
      ]);
      assert.equal(await durationHeader.getAttribute("aria-sort"), "ascending");

      const albumHeader = await sortBy(page, "Album", "ascending");
      await assertConvertedResults(page, resultRows, [
        "Missing Metadata",
        "Alpha Other",
        "Shared Lead",
        "Shared Other",
        "Unrelated Track",
      ]);
      assert.equal(await albumHeader.getAttribute("aria-sort"), "ascending");

      await clearSort(page);
      await assertConvertedResults(page, resultRows, [
        "Shared Lead",
        "Shared Other",
        "Alpha Other",
        "Unrelated Track",
        "Missing Metadata",
      ]);
      assert.equal(await page.getByRole("button", { name: "Clear sort", exact: true }).count(), 0);
    });
  });

  await runScenario(t, "orders Artist and Album options alphabetically with inclusive defaults", async () => {
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

  await runScenario(t, "matches Search queries and exposes contextual no-results recovery", async () => {
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

  await runScenario(t, "composes Search with active Artist and Album filters", async () => {
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

  await runScenario(t, "preserves Artist and Album selections across navigation", async () => {
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

  await runScenario(t, "composes sorting with filters and Search across navigation", async () => {
    await withElectronLaunch("sorting-composition-navigation", async ({ page }) => {
      const resultRows = await openConverted(page);
      await selectConvertedDimension(page, "Artist");
      await selectConvertedValue(page, "Lead Artist");
      await sortBy(page, "Title", "ascending");
      await assertConvertedResults(page, resultRows, ["Alpha Other", "Shared Lead"]);

      await setSearch(page, "Shared");
      await assertConvertedResults(page, resultRows, ["Shared Lead"]);
      await setSearch(page, "");
      await assertConvertedResults(page, resultRows, ["Alpha Other", "Shared Lead"]);

      await page.getByRole("button", { name: "Converting", exact: true }).click();
      await page.getByRole("button", { name: "Converted", exact: true }).click();
      await page.getByLabel("Artist", { exact: true }).waitFor({ state: "visible" });
      assert.equal(await page.getByLabel("Filter by", { exact: true }).inputValue(), "artist");
      await assertSelectedLabel(page.getByLabel("Artist", { exact: true }), "Lead Artist");
      await assertConvertedResults(page, resultRows, ["Alpha Other", "Shared Lead"]);
      assert.equal(await page.locator('th[aria-sort="ascending"] button[aria-label="Sort by Title"]').count(), 1);

      await clearSort(page);
      await assertConvertedResults(page, resultRows, ["Shared Lead", "Alpha Other"]);
      await assertSelectedLabel(page.getByLabel("Artist", { exact: true }), "Lead Artist");
    });
  });

  await runScenario(t, "resets Converted sorting on a fresh isolated launch", async () => {
    await withElectronLaunch("sorting-reset-first-launch", async ({ page }) => {
      const resultRows = await openConverted(page);
      await sortBy(page, "Title", "ascending");
      await assertConvertedResults(page, resultRows, [
        "Alpha Other",
        "Missing Metadata",
        "Shared Lead",
        "Shared Other",
        "Unrelated Track",
      ]);
    });

    await withElectronLaunch("sorting-reset-second-launch", async ({ page }) => {
      const resultRows = await openConverted(page);
      await assertConvertedResults(page, resultRows, [
        "Shared Lead",
        "Shared Other",
        "Alpha Other",
        "Unrelated Track",
        "Missing Metadata",
      ]);
      assert.equal(await page.getByRole("button", { name: "Clear sort", exact: true }).count(), 0);
    });
  });

  await runScenario(t, "keeps Converting status controls separate from Converted filters", async () => {
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

  await runScenario(t, "adds Browser sources to the isolated session queue by keyboard and resets on a fresh launch", async () => {
    await withElectronLaunch("browser-session-queue", async ({ page }) => {
      const aurora = page.getByRole("button", { name: "Add Aurora Lines to session queue", exact: true });
      const blueHour = page.getByRole("button", { name: "Add Blue Hour to session queue", exact: true });
      await aurora.focus();
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-source-id")), "source-aurora");
      await aurora.press("Enter");
      assert.equal(await page.locator("#session-queue-feedback").textContent(), "Added to session queue");
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-source-id")), "source-aurora");
      assert.equal(await page.locator(".session-queue-added").count(), 1);

      await blueHour.focus();
      await blueHour.press("Space");
      assert.equal(await page.locator("#session-queue-feedback").textContent(), "Added to session queue");
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-source-id")), "source-blue-hour");

      await page.getByRole("button", { name: "Converting", exact: true }).click();
      await page.getByRole("heading", { name: "Session queue additions", exact: true }).waitFor({ state: "visible" });
      assert.equal(await page.locator(canonicalConvertingRowsSelector).count(), 2);
      assert.equal(await page.locator(sessionQueueRowsSelector).count(), 2);
      assert.deepEqual(await page.locator(`${sessionQueueRowsSelector} td:first-child`).allTextContents(), ["Aurora Lines", "Blue Hour"]);
      assert.deepEqual(await page.locator(`${sessionQueueRowsSelector} .status`).allTextContents(), ["Waiting", "Waiting"]);
      assert.equal(
        await page.getByRole("heading", { name: "Converting", exact: true }).locator("..").locator("p").textContent(),
        "2 fixture jobs · 1 failed · 0 converted",
      );

      await page.getByLabel("Filter items", { exact: true }).selectOption("waiting");
      assert.equal(await page.locator(canonicalConvertingRowsSelector).count(), 0);
      assert.equal(await page.locator(sessionQueueRowsSelector).count(), 2);
      await page.getByPlaceholder("Search fixture library").fill("blue");
      assert.equal(await page.locator(canonicalConvertingRowsSelector).count(), 0);
      assert.equal(await page.locator(sessionQueueRowsSelector).count(), 2);

      await page.getByPlaceholder("Search fixture library").fill("");
      await page.getByRole("button", { name: "Converted", exact: true }).click();
      await page.getByLabel("Filter by", { exact: true }).waitFor({ state: "visible" });
      assert.equal(await page.locator(convertedRowsSelector).count(), 5);

      await page.getByRole("button", { name: "Browser", exact: true }).click();
      const duplicate = page.getByRole("button", { name: "Add Aurora Lines to session queue", exact: true });
      await duplicate.press("Enter");
      assert.equal(await page.locator("#session-queue-feedback").textContent(), "Already in session queue");
      await page.getByRole("button", { name: "Converting", exact: true }).click();
      assert.equal(await page.locator(sessionQueueRowsSelector).count(), 2);
    });

    await withElectronLaunch("browser-session-queue-fresh-launch", async ({ page }) => {
      await page.getByRole("button", { name: "Converting", exact: true }).click();
      await page.getByRole("heading", { name: "Session queue additions", exact: true }).waitFor({ state: "visible" });
      assert.equal(await page.locator(sessionQueueRowsSelector).count(), 0);
      assert.equal(await page.locator(canonicalConvertingRowsSelector).count(), 2);
    });
  });

  await runScenario(t, "connects session completion to Converted while preserving native focus and identity", async () => {
    await withElectronLaunch("session-queue-lifecycle", async ({ page }) => {
      const session = page.locator('section[aria-labelledby="session-queue-additions-heading"]');
      await page.getByRole("button", { name: "Add Aurora Lines to session queue", exact: true }).press("Enter");
      await page.getByRole("button", { name: "Add Blue Hour to session queue", exact: true }).press("Space");
      await page.getByRole("button", { name: "Converting", exact: true }).click();
      await session.waitFor({ state: "visible" });

      const auroraId = "session-queue:source-aurora:1";
      const blueId = "session-queue:source-blue-hour:2";
      const statusTexts = () => session.locator(".status").allTextContents();
      const activeAurora = (status) => session.getByRole("button", {
        name: `Advance Aurora Lines from ${status} (simulated)`,
        exact: true,
      });

      let aurora = activeAurora("Waiting");
      await aurora.focus();
      await aurora.press("Enter");
      assert.deepEqual(await statusTexts(), ["Analyzing", "Waiting"]);
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-session-queue-id")), auroraId);
      assert.match(await session.locator("#session-queue-announcement").textContent(), /Aurora Lines.*Analyzing.*simulated.*no media output/i);

      aurora = activeAurora("Analyzing");
      await aurora.press("Space");
      assert.deepEqual(await statusTexts(), ["Converting", "Waiting"]);
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-session-queue-id")), auroraId);

      aurora = activeAurora("Converting");
      await aurora.press("Enter");
      assert.deepEqual(await statusTexts(), ["Waiting"]);
      assert.equal(await page.evaluate(() => document.activeElement?.id), "session-queue-announcement");
      assert.match(await session.locator("#session-queue-announcement").textContent(), /Aurora Lines.*Converted.*simulated.*Converted.*no media output/i);

      const blue = session.getByRole("button", {
        name: "Advance Blue Hour from Waiting (simulated)",
        exact: true,
      });
      await blue.press("Enter");
      assert.deepEqual(await statusTexts(), ["Analyzing"]);
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-session-queue-id")), blueId);
      assert.equal(await page.locator(completedSessionRowsSelector).count(), 0);
      assert.match(await session.textContent(), /no media output/i);

      await page.getByRole("button", { name: "Converted", exact: true }).click();
      await page.getByLabel("Filter by", { exact: true }).waitFor({ state: "visible" });
      assert.equal(await page.locator(completedSessionRowsSelector).count(), 1);
      assert.equal(await page.locator(`${completedSessionRowsSelector} td:first-child`).textContent(), "Aurora Lines");
      assert.equal(await page.locator(completedSessionRowsSelector).getAttribute("data-session-queue-id"), auroraId);
      assert.match(await page.locator('section[aria-labelledby="completed-session-heading"]').textContent(), /simulated.*no output file/i);
      assert.equal(await page.locator(convertedRowsSelector).count(), 5);
      assert.equal(await page.locator("#result-count").textContent(), "5 results");
      await page.getByRole("button", { name: "Converting", exact: true }).click();
      await session.waitFor({ state: "visible" });
      assert.deepEqual(await statusTexts(), ["Analyzing"]);
    });

    await withElectronLaunch("session-queue-lifecycle-fresh", async ({ page }) => {
      await page.getByRole("button", { name: "Converting", exact: true }).click();
      await page.getByRole("heading", { name: "Session queue additions", exact: true }).waitFor({ state: "visible" });
      assert.equal(await page.locator(sessionQueueRowsSelector).count(), 0);
      assert.equal(await page.locator(canonicalConvertingRowsSelector).count(), 2);
    });
  });

  await runScenario(t, "advances the isolated Demo lifecycle by keyboard and resets on a fresh launch", async () => {
    await withElectronLaunch("lifecycle-demo-keyboard", async ({ page }) => {
      await page.getByRole("button", { name: "Converting", exact: true }).click();
      await page.getByRole("heading", { name: "Demo lifecycle", exact: true }).waitFor({ state: "visible" });

      const status = page.locator("#lifecycle-demo-status");
      const advance = page.getByRole("button", { name: "Advance demo step", exact: true });
      assert.equal(await status.textContent(), "Waiting");
      assert.equal(await advance.isDisabled(), false);
      assert.equal(await page.locator("#item-count").textContent(), "Items: 2");

      for (const expectedStatus of ["Analyzing", "Converting", "Converted"]) {
        await advance.focus();
        assert.equal(await page.evaluate(() => document.activeElement?.id), "advance-demo-step");
        await advance.press("Enter");
        await page.waitForFunction(
          (expected) => document.querySelector("#lifecycle-demo-status")?.textContent === expected,
          expectedStatus,
          { timeout: timeoutMs },
        );
        assert.equal(await status.textContent(), expectedStatus);
      }

      assert.equal(await advance.isDisabled(), true);
      assert.equal(await advance.evaluate((button) => button.disabled), false);
      assert.equal(await advance.getAttribute("aria-disabled"), "true");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "advance-demo-step");
      assert.match(await page.locator("#lifecycle-demo-completed").textContent(), /no actual media or output file/i);
      assert.equal(await page.locator("#item-count").textContent(), "Items: 2");

      await advance.press("Enter");
      assert.equal(await status.textContent(), "Converted");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "advance-demo-step");
      const terminalButtonBox = await advance.boundingBox();
      assert.ok(terminalButtonBox, "expected the terminal demo button to have a visible hit target");
      await page.mouse.click(
        terminalButtonBox.x + terminalButtonBox.width / 2,
        terminalButtonBox.y + terminalButtonBox.height / 2,
      );
      assert.equal(await status.textContent(), "Converted");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "advance-demo-step");
      await page.keyboard.press("Shift+Tab");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "search");
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "advance-demo-step");

      await page.getByRole("button", { name: "Converted", exact: true }).click();
      await page.getByLabel("Filter by", { exact: true }).waitFor({ state: "visible" });
      await page.getByRole("button", { name: "Converting", exact: true }).click();
      await page.getByRole("heading", { name: "Demo lifecycle", exact: true }).waitFor({ state: "visible" });
      assert.equal(await status.textContent(), "Converted");
      assert.equal(await advance.isDisabled(), true);
      assert.equal(await advance.evaluate((button) => button.disabled), false);
      assert.equal(await advance.getAttribute("aria-disabled"), "true");
    });

    await withElectronLaunch("lifecycle-demo-fresh-launch", async ({ page }) => {
      await page.getByRole("button", { name: "Converting", exact: true }).click();
      await page.getByRole("heading", { name: "Demo lifecycle", exact: true }).waitFor({ state: "visible" });
      assert.equal(await page.locator("#lifecycle-demo-status").textContent(), "Waiting");
      assert.equal(await page.getByRole("button", { name: "Advance demo step", exact: true }).isDisabled(), false);
      assert.equal(await page.getByRole("button", { name: "Advance demo step", exact: true }).getAttribute("aria-disabled"), "false");
    });
  });

  if (process.env.HARBOR_RUN_NATIVE_SELECT_DIAGNOSTICS === "1") {
  await runScenario(t, "diagnoses native Converted dimension activation paths without cross-platform keyboard assumptions", async () => {
    const arrowDiagnostics = await runConvertedDimensionDiagnostic(
      "dimension-arrow-down-enter",
      async ({ page }) => {
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Enter");
      },
    );
    const typeaheadDiagnostics = await runConvertedDimensionDiagnostic(
      "dimension-typeahead-ar",
      async ({ page }) => {
        await page.keyboard.type("ar");
        await page.keyboard.press("Enter");
      },
    );
    const controlDiagnostics = await runConvertedDimensionDiagnostic(
      "dimension-select-option-control",
      async ({ dimension }) => {
        await dimension.selectOption("artist");
      },
    );

    assert.equal(controlDiagnostics.dimensionValue, "artist", JSON.stringify(controlDiagnostics));
    assert.deepEqual(controlDiagnostics.conditionalControl, {
      present: true,
      id: "converted-value",
      label: "Artist",
    });
    assert.ok(arrowDiagnostics.focusedElement, JSON.stringify(arrowDiagnostics));
    assert.ok(typeaheadDiagnostics.focusedElement, JSON.stringify(typeaheadDiagnostics));
  });
  }

  await runScenario(t, "preserves keyboard traversal and Search recovery after controlled Artist setup", async () => {
    await withElectronLaunch("keyboard-navigation-and-search", async ({ page }) => {
      const resultRows = await openConvertedWithKeyboard(page);
      const dimension = page.getByLabel("Filter by", { exact: true });

      const artist = await selectConvertedDimension(page, "Artist");
      assert.equal(await dimension.inputValue(), "artist");
      await dimension.focus();
      assert.equal(await page.evaluate(() => document.activeElement?.id), "converted-dimension");

      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "converted-value");
      await page.keyboard.press("Shift+Tab");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "converted-dimension");
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "converted-value");
      await artist.selectOption({ label: "Alpha Collaborator" });
      await assertSelectedLabel(artist, "Alpha Collaborator");
      await assertConvertedResults(page, resultRows, ["Shared Lead", "Alpha Other"]);
      assert.equal(await page.evaluate(() => document.activeElement?.id), "converted-value");

      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "search");
      await page.keyboard.type("no such track");
      await assertConvertedResults(page, resultRows, []);

      const resultStatus = page.getByRole("status");
      assert.equal(await resultStatus.getAttribute("aria-atomic"), "true");
      assert.equal(await resultStatus.getAttribute("aria-controls"), "queue-results");
      assert.equal(await page.locator("#app").getAttribute("aria-live"), null);

      const clearSearch = page.getByRole("button", { name: "Clear Search", exact: true });
      await clearSearch.focus();
      assert.equal(await page.evaluate(() => document.activeElement?.id), "clear-search");
      await clearSearch.press("Enter");
      await assertConvertedResults(page, resultRows, ["Shared Lead", "Alpha Other"]);
      assert.equal(await page.getByLabel("Search", { exact: true }).inputValue(), "");
      await assertSelectedLabel(page.getByLabel("Artist", { exact: true }), "Alpha Collaborator");
    });
  });

  await runScenario(t, "supports keyboard sorting and clear-sort recovery without changing selection", async () => {
    await withElectronLaunch("keyboard-sorting-and-clear", async ({ page }) => {
      const resultRows = await openConvertedWithKeyboard(page);
      const dimension = page.getByLabel("Filter by", { exact: true });

      const artist = await selectConvertedDimension(page, "Artist");
      await artist.selectOption({ label: "Alpha Collaborator" });
      await assertSelectedLabel(artist, "Alpha Collaborator");
      await assertConvertedResults(page, resultRows, ["Shared Lead", "Alpha Other"]);

      const titleHeader = await sortByWithKeyboard(page, "Title", "ascending");
      await assertConvertedResults(page, resultRows, ["Alpha Other", "Shared Lead"]);
      assert.equal(await titleHeader.getAttribute("aria-sort"), "ascending");

      const clearSortButton = page.getByRole("button", { name: "Clear sort", exact: true });
      await clearSortButton.focus();
      assert.equal(await page.evaluate(() => document.activeElement?.id), "clear-sort");
      await clearSortButton.press("Enter");
      await assertConvertedResults(page, resultRows, ["Shared Lead", "Alpha Other"]);
      assert.equal(await page.getByRole("button", { name: "Clear sort", exact: true }).count(), 0);
      await assertSelectedLabel(page.getByLabel("Artist", { exact: true }), "Alpha Collaborator");
      assert.equal(await page.locator("#app").getAttribute("aria-live"), null);
    });
  });

  nativeScenarioSelector.assertMatched();
});
