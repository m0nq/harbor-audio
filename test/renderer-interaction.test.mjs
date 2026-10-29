import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { fixtureSnapshot } from "../dist/fixtures/workflow-fixtures.js";

const rendererPath = path.resolve("dist/renderer/renderer/renderer.js");

async function createRendererDom(scenarioId) {
  const htmlPath = path.resolve("dist/renderer/index.html");
  const html = await readFile(htmlPath, "utf8");
  const dom = new JSDOM(html, { url: pathToFileURL(htmlPath).href });
  const runtimeErrors = [];
  const networkAttempts = [];
  const ipcAttempts = [];
  let fixtureCalls = 0;

  const blockNetwork = (kind) => (...args) => {
    networkAttempts.push({ kind, args });
    throw new Error(`Unexpected ${kind} attempt in renderer interaction test`);
  };
  const blockedFetch = blockNetwork("fetch");
  const blockedXhr = class {
    constructor() {
      networkAttempts.push({ kind: "XMLHttpRequest", args: [] });
      throw new Error("Unexpected XMLHttpRequest attempt in renderer interaction test");
    }
  };
  const blockedWebSocket = class {
    constructor(...args) {
      networkAttempts.push({ kind: "WebSocket", args });
      throw new Error("Unexpected WebSocket attempt in renderer interaction test");
    }
  };
  const blockedIpc = new Proxy({}, {
    get(_target, property) {
      ipcAttempts.push(String(property));
      throw new Error(`Unexpected Electron IPC access: ${String(property)}`);
    },
  });

  dom.window.workflowApi = {
    getFixture: async () => {
      fixtureCalls += 1;
      return structuredClone(fixtureSnapshot);
    },
  };
  dom.window.ipcRenderer = blockedIpc;
  dom.window.fetch = blockedFetch;
  dom.window.XMLHttpRequest = blockedXhr;
  dom.window.WebSocket = blockedWebSocket;

  dom.window.addEventListener("error", (event) => {
    runtimeErrors.push(event.error ?? new Error(event.message));
  });
  dom.window.addEventListener("unhandledrejection", (event) => {
    runtimeErrors.push(event.reason);
  });

  const previousGlobals = new Map(
    ["window", "document", "fetch"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const key of ["window", "document", "fetch"]) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: key === "fetch" ? blockedFetch : dom.window[key],
      writable: true,
    });
  }

  let rendererModule;
  try {
    rendererModule = await import(`${pathToFileURL(rendererPath).href}?renderer-interaction-${scenarioId}`);
    await settleRenderer();
  } catch (error) {
    restoreGlobals(previousGlobals);
    dom.window.close();
    throw error;
  }

  return {
    dom,
    rendererModule,
    fixtureCalls: () => fixtureCalls,
    runtimeErrors,
    networkAttempts,
    ipcAttempts,
    dispose: () => {
      restoreGlobals(previousGlobals);
      dom.window.close();
    },
  };
}

function restoreGlobals(previousGlobals) {
  for (const [key, descriptor] of previousGlobals) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      delete globalThis[key];
    }
  }
}

async function settleRenderer() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

function documentFor(harness) {
  return harness.dom.window.document;
}

function heading(document) {
  return document.querySelector("h1")?.textContent;
}

function sourceTitles(document) {
  return [...document.querySelectorAll('[aria-label="Local browser fixture"] .source-row strong')]
    .map((element) => element.textContent);
}

function queueTitles(document) {
  return [...document.querySelectorAll('section[aria-label$="fixture list"] tbody tr td:first-child')]
    .map((element) => element.textContent);
}

function sessionQueueTitles(document) {
  return [...document.querySelectorAll('section[aria-labelledby="session-queue-additions-heading"] tbody tr td:first-child')]
    .map((element) => element.textContent);
}

function sessionQueueStatuses(document) {
  return [...document.querySelectorAll('section[aria-labelledby="session-queue-additions-heading"] tbody .status')]
    .map((element) => element.textContent);
}

function sessionQueueActions(document) {
  return [...document.querySelectorAll('section[aria-labelledby="session-queue-additions-heading"] [data-session-queue-id]')];
}

function queueSummary(document) {
  const queueHeading = [...document.querySelectorAll("h2")]
    .find((element) => element.textContent === "Converting" || element.textContent === "Converted");
  return queueHeading?.parentElement?.querySelector("p")?.textContent;
}

function footerText(document) {
  return document.querySelector(".footer-line")?.textContent;
}

function emptyStateText(document) {
  return document.querySelector('section[aria-label$="fixture list"]')?.textContent;
}

function optionLabels(select) {
  return [...select.options].map((option) => option.textContent);
}

async function clickView(harness, view) {
  const button = documentFor(harness).querySelector(`[data-view="${view}"]`);
  assert.ok(button, `expected ${view} navigation control`);
  button.dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true }));
  await settleRenderer();
}

async function setFilter(harness, value) {
  const select = documentFor(harness).querySelector("#filter");
  assert.ok(select, "expected fixture status filter");
  select.value = value;
  select.dispatchEvent(new harness.dom.window.Event("change", { bubbles: true }));
  await settleRenderer();
}

async function setDimension(harness, value) {
  const select = documentFor(harness).querySelector("#converted-dimension");
  assert.ok(select, "expected Converted dimension selector");
  select.value = value;
  select.dispatchEvent(new harness.dom.window.Event("change", { bubbles: true }));
  await settleRenderer();
}

async function setSecondaryByLabel(harness, label) {
  const select = documentFor(harness).querySelector("#converted-value");
  assert.ok(select, "expected Converted metadata-value selector");
  const option = [...select.options].find((candidate) => candidate.textContent === label);
  assert.ok(option, `expected a Converted value option named ${label}`);
  select.value = option.value;
  select.dispatchEvent(new harness.dom.window.Event("change", { bubbles: true }));
  await settleRenderer();
}

async function setSearch(harness, value) {
  const search = documentFor(harness).querySelector("#search");
  assert.ok(search, "expected fixture Search control");
  search.value = value;
  search.dispatchEvent(new harness.dom.window.Event("input", { bubbles: true }));
  await settleRenderer();
}

async function sortBy(harness, column) {
  const button = documentFor(harness).querySelector(`[data-sort-column="${column}"]`);
  assert.ok(button, `expected Converted ${column} sort control`);
  button.dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true }));
  await settleRenderer();
}

async function clearSort(harness) {
  const button = documentFor(harness).querySelector("#clear-sort");
  assert.ok(button, "expected a Clear sort control");
  button.dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true }));
  await settleRenderer();
}

async function clearSearch(harness) {
  const document = documentFor(harness);
  const button = document.querySelector("#clear-search");
  assert.ok(button, "expected a Clear Search recovery action");
  const searchInput = document.querySelector("#search");
  assert.ok(searchInput, "expected the Search input to survive Clear Search");
  button.focus();
  assert.strictEqual(document.activeElement, button);
  button.dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true }));
  await settleRenderer();
  assert.strictEqual(document.querySelector("#search"), searchInput);
  assert.equal(searchInput.value, "");
  assert.strictEqual(document.activeElement, searchInput);
  assert.equal(searchInput.selectionStart, 0);
  assert.equal(searchInput.selectionEnd, 0);
}

function resultCount(document) {
  return document.querySelector("#result-count")?.textContent;
}

function assertRuntimeBoundaries(harness) {
  assert.deepEqual(harness.runtimeErrors, []);
  assert.deepEqual(harness.networkAttempts, []);
  assert.deepEqual(harness.ipcAttempts, []);
}

test("compiled renderer interaction suite", async (t) => {
  // Child scenarios are awaited serially because each temporarily installs
  // window, document, and fetch on the Node global object.
  await t.test("initializes Browser and shows the separate Converted demonstration data", async () => {
    const harness = await createRendererDom("navigation");

    try {
      const document = documentFor(harness);
      assert.equal(harness.fixtureCalls(), 1);
      assert.equal(heading(document), "Browse a local source");
      assert.deepEqual(sourceTitles(document), ["Aurora Lines", "Blue Hour", "Lantern Room"]);
      assert.equal(document.querySelector("#filter"), null);
      assert.equal(document.querySelector("#search"), null);

      await clickView(harness, "converting");
      assert.equal(heading(document), "Conversion queue");
      assert.deepEqual(queueTitles(document), ["Aurora Lines", "Blue Hour"]);
      assert.equal(queueSummary(document), "2 fixture jobs · 1 failed · 0 converted");
      assert.match(footerText(document), /Items: 2/);
      assert.equal(document.querySelector('[aria-label="Local browser fixture"]'), null);

      await clickView(harness, "converted");
      assert.equal(heading(document), "Completed items");
      assert.deepEqual(queueTitles(document), ["Shared Lead", "Shared Other", "Alpha Other", "Unrelated Track", "Missing Metadata"]);
      assert.equal(document.querySelector("#converted-dimension")?.value, "all");
      assert.equal(document.querySelector("#converted-value"), null);
      assert.equal(document.querySelector("#filter"), null);
      assert.equal(resultCount(document), "5 results");
      assert.match(queueSummary(document), /synthetic demonstration tracks/);
      assert.match(queueSummary(document), /no media conversion occurred/);
      assert.deepEqual(
        [...document.querySelectorAll(".converted-table th button")].map((button) => button.dataset.sortColumn),
        ["title", "artist", "album", "duration"],
      );
      assert.equal(document.querySelector("#clear-sort"), null);

      await clickView(harness, "browser");
      assert.equal(heading(document), "Browse a local source");
      assert.deepEqual(sourceTitles(document), ["Aurora Lines", "Blue Hour", "Lantern Room"]);
      assert.equal(document.querySelector('section[aria-label$="fixture list"]'), null);
      assertRuntimeBoundaries(harness);
    } finally {
      harness.dispose();
    }
  });

  await t.test("inserts Browser sources into a separate session queue with keyboard and pointer feedback", async () => {
    const harness = await createRendererDom("browser-session-queue");

    try {
      const document = documentFor(harness);
      const buttons = [...document.querySelectorAll(".source-add-button")];
      assert.deepEqual(buttons.map((button) => button.getAttribute("aria-label")), [
        "Add Aurora Lines to session queue",
        "Add Blue Hour to session queue",
        "Add Lantern Room to session queue",
      ]);
      assert.deepEqual(buttons.map((button) => button.type), ["button", "button", "button"]);

      const auroraButton = buttons[0];
      auroraButton.focus();
      assert.strictEqual(document.activeElement, auroraButton);
      auroraButton.dispatchEvent(new harness.dom.window.KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }));
      await settleRenderer();
      assert.deepEqual(sessionQueueTitles(document), []);
      assert.equal(document.querySelector("#session-queue-feedback")?.textContent, "Added to session queue");
      assert.equal(document.querySelector("#session-queue-feedback")?.getAttribute("role"), "status");
      assert.equal(document.querySelector("#app")?.hasAttribute("aria-live"), false);
      assert.strictEqual(document.activeElement?.getAttribute("data-source-id"), "source-aurora");
      assert.equal(document.querySelector('[data-source-id="source-aurora"]')?.disabled, false);

      const auroraRow = [...document.querySelectorAll(".source-row")]
        .find((row) => row.querySelector("strong")?.textContent === "Aurora Lines");
      assert.equal(auroraRow?.querySelector(".session-queue-added")?.textContent, "Added");

      const blueButton = document.querySelector('[data-source-id="source-blue-hour"]');
      blueButton.focus();
      blueButton.dispatchEvent(new harness.dom.window.KeyboardEvent("keydown", {
        key: " ",
        bubbles: true,
      }));
      await settleRenderer();
      assert.equal(document.querySelector("#session-queue-feedback")?.textContent, "Added to session queue");
      assert.strictEqual(document.activeElement?.getAttribute("data-source-id"), "source-blue-hour");

      const lanternButton = document.querySelector('[data-source-id="source-lantern"]');
      lanternButton.click();
      await settleRenderer();
      assert.equal(document.querySelector("#session-queue-feedback")?.textContent, "Added to session queue");
      assert.strictEqual(document.activeElement?.getAttribute("data-source-id"), "source-lantern");

      await clickView(harness, "converting");
      assert.deepEqual(queueTitles(document), ["Aurora Lines", "Blue Hour"]);
      assert.deepEqual(sessionQueueTitles(document), ["Aurora Lines", "Blue Hour", "Lantern Room"]);
      assert.deepEqual(
        [...document.querySelectorAll('section[aria-labelledby="session-queue-additions-heading"] tbody .status')]
          .map((status) => status.textContent),
        ["Waiting", "Waiting", "Waiting"],
      );
      assert.equal(queueSummary(document), "2 fixture jobs · 1 failed · 0 converted");

      await setFilter(harness, "waiting");
      assert.deepEqual(queueTitles(document), []);
      assert.deepEqual(sessionQueueTitles(document), ["Aurora Lines", "Blue Hour", "Lantern Room"]);
      await setSearch(harness, "blue");
      assert.deepEqual(queueTitles(document), []);
      assert.deepEqual(sessionQueueTitles(document), ["Aurora Lines", "Blue Hour", "Lantern Room"]);

      await setSearch(harness, "");
      await clickView(harness, "converted");
      assert.deepEqual(queueTitles(document), ["Shared Lead", "Shared Other", "Alpha Other", "Unrelated Track", "Missing Metadata"]);
      await clickView(harness, "browser");
      const duplicateButton = document.querySelector('[data-source-id="source-aurora"]');
      duplicateButton.click();
      await settleRenderer();
      assert.equal(document.querySelector("#session-queue-feedback")?.textContent, "Already in session queue");
      await clickView(harness, "converting");
      assert.deepEqual(sessionQueueTitles(document), ["Aurora Lines", "Blue Hour", "Lantern Room"]);
      assert.equal(queueSummary(document), "2 fixture jobs · 1 failed · 0 converted");
      assertRuntimeBoundaries(harness);
    } finally {
      harness.dispose();
    }

    const freshHarness = await createRendererDom("browser-session-queue-fresh");
    try {
      const document = documentFor(freshHarness);
      await clickView(freshHarness, "converting");
      assert.deepEqual(sessionQueueTitles(document), []);
      assert.deepEqual(queueTitles(document), ["Aurora Lines", "Blue Hour"]);
      assertRuntimeBoundaries(freshHarness);
    } finally {
      freshHarness.dispose();
    }
  });

  await t.test("advances targeted session items with stable announcements, labels, focus, and terminal no-op behavior", async () => {
    const harness = await createRendererDom("session-queue-lifecycle");

    try {
      const document = documentFor(harness);
      document.querySelector('[data-source-id="source-aurora"]').click();
      document.querySelector('[data-source-id="source-blue-hour"]').click();
      await clickView(harness, "converting");

      const results = document.querySelector("#session-queue-results");
      const announcement = document.querySelector("#session-queue-announcement");
      assert.ok(results);
      assert.ok(announcement);
      assert.equal(announcement.getAttribute("role"), "status");
      assert.equal(announcement.getAttribute("aria-live"), "polite");
      assert.deepEqual(sessionQueueStatuses(document), ["Waiting", "Waiting"]);
      assert.deepEqual(sessionQueueActions(document).map((button) => button.getAttribute("aria-label")), [
        "Advance Aurora Lines from Waiting (simulated)",
        "Advance Blue Hour from Waiting (simulated)",
      ]);

      const auroraAction = sessionQueueActions(document)[0];
      auroraAction.focus();
      auroraAction.click();
      await settleRenderer();

      assert.deepEqual(sessionQueueStatuses(document), ["Analyzing", "Waiting"]);
      assert.deepEqual(sessionQueueActions(document).map((button) => button.getAttribute("aria-label")), [
        "Advance Aurora Lines from Analyzing (simulated)",
        "Advance Blue Hour from Waiting (simulated)",
      ]);
      assert.strictEqual(document.querySelector("#session-queue-results"), results);
      assert.strictEqual(document.querySelector("#session-queue-announcement"), announcement);
      assert.match(announcement.textContent, /Aurora Lines.*Analyzing.*simulated.*no media output/i);
      assert.equal(document.activeElement?.getAttribute("data-session-queue-id"), "session-queue:source-aurora:1");
      assert.deepEqual(queueTitles(document), ["Aurora Lines", "Blue Hour"]);
      assert.equal(queueSummary(document), "2 fixture jobs · 1 failed · 0 converted");

      for (const expectedStatus of ["Converting", "Converted"]) {
        const action = sessionQueueActions(document)[0];
        action.focus();
        action.click();
        await settleRenderer();
        assert.equal(sessionQueueStatuses(document)[0], expectedStatus);
        assert.equal(document.activeElement?.getAttribute("data-session-queue-id"), "session-queue:source-aurora:1");
      }

      const terminal = sessionQueueActions(document)[0];
      assert.equal(terminal.textContent, "Completed");
      assert.equal(terminal.getAttribute("aria-disabled"), "true");
      assert.equal(terminal.disabled, false);
      const terminalAnnouncement = announcement.textContent;
      terminal.focus();
      terminal.click();
      await settleRenderer();
      assert.deepEqual(sessionQueueStatuses(document), ["Converted", "Waiting"]);
      assert.strictEqual(document.activeElement, terminal);
      assert.equal(announcement.textContent, terminalAnnouncement);

      await clickView(harness, "browser");
      document.querySelector('[data-source-id="source-aurora"]').click();
      await settleRenderer();
      assert.equal(document.querySelector("#session-queue-feedback")?.textContent, "Already in session queue");
      await clickView(harness, "converting");
      assert.deepEqual(sessionQueueStatuses(document), ["Converted", "Waiting"]);
      assertRuntimeBoundaries(harness);
    } finally {
      harness.dispose();
    }

    const freshHarness = await createRendererDom("session-queue-lifecycle-fresh");
    try {
      const document = documentFor(freshHarness);
      await clickView(freshHarness, "converting");
      assert.deepEqual(sessionQueueTitles(document), []);
      assertRuntimeBoundaries(freshHarness);
    } finally {
      freshHarness.dispose();
    }
  });

  await t.test("sorts Converted rows, preserves filters across navigation, and clears without resetting them", async () => {
    const harness = await createRendererDom("converted-sorting");

    try {
      const document = documentFor(harness);
      await clickView(harness, "converted");
      assert.deepEqual(queueTitles(document), ["Shared Lead", "Shared Other", "Alpha Other", "Unrelated Track", "Missing Metadata"]);

      await sortBy(harness, "title");
      assert.deepEqual(queueTitles(document), ["Alpha Other", "Missing Metadata", "Shared Lead", "Shared Other", "Unrelated Track"]);
      assert.equal(document.querySelector('th[aria-sort="ascending"] [data-sort-column="title"]')?.textContent, "Title ↑");
      assert.equal(document.querySelector("#clear-sort")?.textContent, "Clear sort");

      await sortBy(harness, "title");
      assert.deepEqual(queueTitles(document), ["Unrelated Track", "Shared Other", "Shared Lead", "Missing Metadata", "Alpha Other"]);
      assert.equal(document.querySelector('th[aria-sort="descending"] [data-sort-column="title"]')?.textContent, "Title ↓");

      await sortBy(harness, "duration");
      assert.deepEqual(queueTitles(document), ["Missing Metadata", "Alpha Other", "Shared Lead", "Shared Other", "Unrelated Track"]);
      await sortBy(harness, "duration");
      assert.deepEqual(queueTitles(document), ["Unrelated Track", "Shared Other", "Shared Lead", "Alpha Other", "Missing Metadata"]);

      await setDimension(harness, "artist");
      await setSecondaryByLabel(harness, "Lead Artist");
      await setSearch(harness, "");
      await sortBy(harness, "title");
      assert.deepEqual(queueTitles(document), ["Alpha Other", "Shared Lead"]);
      await clickView(harness, "converting");
      await clickView(harness, "converted");
      assert.equal(document.querySelector("#converted-dimension")?.value, "artist");
      assert.equal(document.querySelector("#converted-value")?.selectedOptions[0]?.textContent, "Lead Artist");
      assert.deepEqual(queueTitles(document), ["Alpha Other", "Shared Lead"]);

      await clearSort(harness);
      assert.deepEqual(queueTitles(document), ["Shared Lead", "Alpha Other"]);
      assert.equal(document.querySelector("#clear-sort"), null);
      assert.equal(document.querySelector("#converted-value")?.selectedOptions[0]?.textContent, "Lead Artist");
      assert.equal(document.querySelector("#search")?.value, "");
      assertRuntimeBoundaries(harness);
    } finally {
      harness.dispose();
    }
  });

  await t.test("starts a fresh renderer session in source order without Converted sort controls active", async () => {
    const harness = await createRendererDom("converted-sort-reset");

    try {
      const document = documentFor(harness);
      await clickView(harness, "converted");
      assert.deepEqual(queueTitles(document), ["Shared Lead", "Shared Other", "Alpha Other", "Unrelated Track", "Missing Metadata"]);
      assert.equal(document.querySelector("#clear-sort"), null);
      assert.deepEqual(
        [...document.querySelectorAll(".converted-table th")].map((header) => header.getAttribute("aria-sort")),
        ["none", "none", "none", "none"],
      );
      assertRuntimeBoundaries(harness);
    } finally {
      harness.dispose();
    }
  });

  await t.test("preserves all Converting status choices and their fixture-local behavior", async () => {
    const harness = await createRendererDom("converting-status");

    try {
      const document = documentFor(harness);
      await clickView(harness, "converting");
      assert.deepEqual(queueTitles(document), ["Aurora Lines", "Blue Hour"]);
      assert.equal(document.querySelectorAll("[data-sort-column]").length, 0);
      assert.deepEqual(optionLabels(document.querySelector("#filter")), [
        "All", "Waiting", "Analyzing", "Converting", "Failed", "Converted",
      ]);

      for (const [filter, expectedTitles] of [
        ["waiting", []],
        ["analyzing", []],
        ["converting", ["Aurora Lines"]],
        ["failed", ["Blue Hour"]],
        ["converted", []],
        ["all", ["Aurora Lines", "Blue Hour"]],
      ]) {
        await setFilter(harness, filter);
        assert.deepEqual(queueTitles(document), expectedTitles, `unexpected ${filter} results`);
      }

      await setSearch(harness, "  bLuE  ");
      assert.deepEqual(queueTitles(document), ["Blue Hour"]);
      assert.equal(document.querySelector("#search")?.value, "  bLuE  ");
      assert.equal(document.querySelector("#filter")?.value, "all");

      await setFilter(harness, "failed");
      assert.deepEqual(queueTitles(document), ["Blue Hour"]);
      assert.equal(queueSummary(document), "2 fixture jobs · 1 failed · 0 converted");
      assert.match(footerText(document), /Items: 1/);
      assertRuntimeBoundaries(harness);
    } finally {
      harness.dispose();
    }
  });

  await t.test("runs the isolated Demo lifecycle without changing canonical queue behavior", async () => {
    const harness = await createRendererDom("lifecycle-demo");

    try {
      const document = documentFor(harness);
      await clickView(harness, "converting");

      const demo = document.querySelector('[aria-labelledby="lifecycle-demo-heading"]');
      assert.ok(demo);
      assert.equal(demo.querySelector("h2")?.textContent, "Demo lifecycle");
      assert.equal(demo.querySelector("#lifecycle-demo-status")?.textContent, "Waiting");
      assert.equal(demo.querySelector("#advance-demo-step")?.textContent, "Advance demo step");
      assert.equal(demo.querySelector("#advance-demo-step")?.disabled, false);
      assert.equal(demo.querySelector("#advance-demo-step")?.getAttribute("aria-disabled"), "false");
      assert.match(demo.textContent, /no actual media or output file is produced/i);
      assert.deepEqual(queueTitles(document), ["Aurora Lines", "Blue Hour"]);
      assert.equal(queueSummary(document), "2 fixture jobs · 1 failed · 0 converted");

      await setFilter(harness, "failed");
      await setSearch(harness, "blue");
      assert.deepEqual(queueTitles(document), ["Blue Hour"]);
      assert.equal(demo.querySelector("#lifecycle-demo-status")?.textContent, "Waiting");
      assert.equal(queueSummary(document), "2 fixture jobs · 1 failed · 0 converted");

      await setSearch(harness, "");
      await setFilter(harness, "all");
      for (const expectedStatus of ["Analyzing", "Converting", "Converted"]) {
        const advance = document.querySelector("#advance-demo-step");
        assert.ok(advance);
        advance.focus();
        assert.strictEqual(document.activeElement, advance);
        advance.dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true }));
        await settleRenderer();
        assert.equal(document.querySelector("#lifecycle-demo-status")?.textContent, expectedStatus);
      }

      const completed = document.querySelector("#lifecycle-demo-status");
      const completedButton = document.querySelector("#advance-demo-step");
      assert.equal(completed?.getAttribute("tabindex"), null);
      assert.equal(completedButton?.disabled, false);
      assert.equal(completedButton?.getAttribute("aria-disabled"), "true");
      assert.strictEqual(document.activeElement, completedButton);
      assert.match(document.querySelector('[data-lifecycle-state="converted"]')?.textContent, /Lifecycle Demo Track/);
      assert.match(document.querySelector('[aria-labelledby="lifecycle-demo-heading"]')?.textContent, /completed demonstration/i);

      completedButton.dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true }));
      await settleRenderer();
      assert.equal(document.querySelector("#lifecycle-demo-status")?.textContent, "Converted");
      assert.strictEqual(document.activeElement, document.querySelector("#advance-demo-step"));

      await clickView(harness, "converted");
      assert.deepEqual(queueTitles(document), ["Shared Lead", "Shared Other", "Alpha Other", "Unrelated Track", "Missing Metadata"]);
      await clickView(harness, "converting");
      assert.equal(document.querySelector("#lifecycle-demo-status")?.textContent, "Converted");
      assert.equal(document.querySelector("#advance-demo-step")?.getAttribute("aria-disabled"), "true");
      assert.equal(document.querySelector("#advance-demo-step")?.disabled, false);
      assert.deepEqual(queueTitles(document), ["Aurora Lines", "Blue Hour"]);
      assert.equal(queueSummary(document), "2 fixture jobs · 1 failed · 0 converted");
      assertRuntimeBoundaries(harness);
    } finally {
      harness.dispose();
    }

    const freshHarness = await createRendererDom("lifecycle-demo-fresh");
    try {
      const document = documentFor(freshHarness);
      await clickView(freshHarness, "converting");
      assert.equal(document.querySelector("#lifecycle-demo-status")?.textContent, "Waiting");
      assert.equal(document.querySelector("#advance-demo-step")?.disabled, false);
      assert.equal(document.querySelector("#advance-demo-step")?.getAttribute("aria-disabled"), "false");
      assertRuntimeBoundaries(freshHarness);
    } finally {
      freshHarness.dispose();
    }
  });

  await t.test("preserves Search and Converted selections independently across navigation", async () => {
    const harness = await createRendererDom("view-switch");

    try {
      const document = documentFor(harness);
      await clickView(harness, "converted");
      await setDimension(harness, "artist");
      await setSecondaryByLabel(harness, "Lead Artist");
      assert.deepEqual(queueTitles(document), ["Shared Lead", "Alpha Other"]);

      await clickView(harness, "converting");
      await setSearch(harness, "blue");
      await setFilter(harness, "failed");
      assert.deepEqual(queueTitles(document), ["Blue Hour"]);

      await clickView(harness, "converted");
      assert.equal(document.querySelector("#search")?.value, "blue");
      assert.equal(document.querySelector("#converted-dimension")?.value, "artist");
      assert.equal(document.querySelector("#converted-value")?.selectedOptions[0]?.textContent, "Lead Artist");
      assert.deepEqual(queueTitles(document), []);

      await clickView(harness, "converting");
      assert.equal(document.querySelector("#search")?.value, "blue");
      assert.equal(document.querySelector("#filter")?.value, "all");
      assert.deepEqual(queueTitles(document), ["Blue Hour"]);

      await clickView(harness, "converted");
      await setSearch(harness, "");
      assert.deepEqual(queueTitles(document), ["Shared Lead", "Alpha Other"]);

      await setDimension(harness, "album");
      await setSecondaryByLabel(harness, "Shared Album");
      await clickView(harness, "converting");
      await clickView(harness, "converted");
      assert.equal(document.querySelector("#converted-dimension")?.value, "album");
      assert.equal(document.querySelector("#converted-value")?.selectedOptions[0]?.textContent, "Shared Album");
      assert.deepEqual(queueTitles(document), ["Shared Lead", "Shared Other"]);
      assertRuntimeBoundaries(harness);
    } finally {
      harness.dispose();
    }
  });

  await t.test("shows inclusive-first, unique, alphabetically ordered options from the full dataset", async () => {
    const harness = await createRendererDom("selector-options");

    try {
      const document = documentFor(harness);
      await clickView(harness, "converted");
      const dimension = document.querySelector("#converted-dimension");
      assert.deepEqual(optionLabels(dimension), ["All", "Artist", "Album"]);
      assert.equal(document.querySelector("#converted-value"), null);

      await setDimension(harness, "artist");
      const artistSelect = document.querySelector("#converted-value");
      assert.deepEqual(optionLabels(artistSelect), [
        "All Artists", "Alpha Collaborator", "Lead Artist", "Other Artist", "Unrelated Artist",
      ]);
      assert.equal(new Set(optionLabels(artistSelect)).size, artistSelect.options.length);

      await setSearch(harness, "Unrelated Track");
      assert.deepEqual(optionLabels(document.querySelector("#converted-value")), [
        "All Artists", "Alpha Collaborator", "Lead Artist", "Other Artist", "Unrelated Artist",
      ]);

      await setDimension(harness, "album");
      assert.deepEqual(optionLabels(document.querySelector("#converted-value")), [
        "All Albums", "Other Album", "Shared Album", "Unrelated Album",
      ]);
      assert.equal(new Set(optionLabels(document.querySelector("#converted-value"))).size,
        document.querySelector("#converted-value").options.length);

      await setDimension(harness, "all");
      assert.equal(document.querySelector("#converted-value"), null);
      assert.equal(document.querySelector("#converted-dimension").value, "all");
    } finally {
      harness.dispose();
    }
  });

  await t.test("filters Artist and Album membership in source order", async () => {
    const harness = await createRendererDom("membership");

    try {
      const document = documentFor(harness);
      await clickView(harness, "converted");
      await setDimension(harness, "artist");
      await setSecondaryByLabel(harness, "Alpha Collaborator");
      assert.deepEqual(queueTitles(document), ["Shared Lead", "Alpha Other"]);
      assert.equal(resultCount(document), "2 results");

      await setDimension(harness, "album");
      await setSecondaryByLabel(harness, "Shared Album");
      assert.deepEqual(queueTitles(document), ["Shared Lead", "Shared Other"]);
      assert.deepEqual(
        [...document.querySelectorAll(".queue-table tbody tr td:nth-child(2)")].map((cell) => cell.textContent),
        ["Lead Artist & Alpha Collaborator", "Other Artist"],
      );
      assert.equal(resultCount(document), "2 results");
    } finally {
      harness.dispose();
    }
  });

  await t.test("Search intersects with specific Artist and Album values and Clear Search restores each membership", async () => {
    const harness = await createRendererDom("search-composition");

    try {
      const document = documentFor(harness);
      await clickView(harness, "converted");
      await setDimension(harness, "artist");
      await setSecondaryByLabel(harness, "Lead Artist");
      assert.deepEqual(queueTitles(document), ["Shared Lead", "Alpha Other"]);

      await setSearch(harness, "Alpha Other");
      assert.deepEqual(queueTitles(document), ["Alpha Other"]);
      assert.equal(document.querySelector("#converted-value")?.selectedOptions[0]?.textContent, "Lead Artist");
      await setSearch(harness, "Unrelated Track");
      assert.deepEqual(queueTitles(document), []);
      assert.equal(document.querySelector("#converted-value")?.selectedOptions[0]?.textContent, "Lead Artist");
      assert.match(document.querySelector("#converted-empty")?.textContent, /No tracks match.*within this selection/);
      assert.equal(document.querySelector("#clear-search")?.textContent, "Clear Search");
      await clearSearch(harness);
      assert.equal(document.querySelector("#search")?.value, "");
      assert.deepEqual(queueTitles(document), ["Shared Lead", "Alpha Other"]);
      assert.equal(document.querySelector("#converted-value")?.selectedOptions[0]?.textContent, "Lead Artist");

      await setDimension(harness, "album");
      await setSecondaryByLabel(harness, "Shared Album");
      await setSearch(harness, "Shared Lead");
      assert.deepEqual(queueTitles(document), ["Shared Lead"]);
      assert.equal(document.querySelector("#converted-value")?.selectedOptions[0]?.textContent, "Shared Album");
      await setSearch(harness, "Alpha Other");
      assert.deepEqual(queueTitles(document), []);
      assert.equal(document.querySelector("#converted-value")?.selectedOptions[0]?.textContent, "Shared Album");
      await clearSearch(harness);
      assert.deepEqual(queueTitles(document), ["Shared Lead", "Shared Other"]);
      assert.equal(document.querySelector("#converted-value")?.selectedOptions[0]?.textContent, "Shared Album");
    } finally {
      harness.dispose();
    }
  });

  await t.test("keeps the Search input node, focus, caret, and query through repeated updates", async () => {
    const harness = await createRendererDom("search-focus");

    try {
      const document = documentFor(harness);
      await clickView(harness, "converted");
      const search = document.querySelector("#search");
      search.focus();

      for (const [value, start, end] of [["Shared", 2, 5], ["Shared Lead", 3, 7], ["", 0, 0]]) {
        search.value = value;
        search.setSelectionRange(start, end);
        search.dispatchEvent(new harness.dom.window.Event("input", { bubbles: true }));
        await settleRenderer();
        assert.strictEqual(document.querySelector("#search"), search);
        assert.strictEqual(document.activeElement, search);
        assert.equal(search.selectionStart, start);
        assert.equal(search.selectionEnd, end);
        assert.equal(search.value, value);
      }

      assert.equal(document.querySelectorAll("#result-count").length, 1);
      assert.equal(document.querySelectorAll("#queue-results").length, 1);
      assertRuntimeBoundaries(harness);
    } finally {
      harness.dispose();
    }
  });

  await t.test("uses accessible native controls, contextual empty states, and a narrow results status", async () => {
    const harness = await createRendererDom("accessibility-empty-states");

    try {
      const document = documentFor(harness);
      await clickView(harness, "converted");
      const primary = document.querySelector("#converted-dimension");
      assert.equal(primary.tagName, "SELECT");
      assert.equal(primary.labels.length, 1);
      assert.equal(primary.labels[0].textContent.trim(), "Filter by");

      primary.focus();
      await setDimension(harness, "artist");
      assert.strictEqual(document.activeElement, primary);
      const secondary = document.querySelector("#converted-value");
      assert.equal(secondary.tagName, "SELECT");
      assert.equal(secondary.labels.length, 1);
      assert.equal(secondary.labels[0].textContent.trim(), "Artist");
      assert.equal(document.querySelector("#search").tagName, "INPUT");
      assert.equal(document.querySelector("#search").type, "search");
      assert.equal(document.querySelector("#search").labels.length, 1);
      assert.equal(document.querySelector("#clear-search"), null);

      secondary.focus();
      await setSecondaryByLabel(harness, "Lead Artist");
      assert.strictEqual(document.activeElement, secondary);
      await setSearch(harness, "no matching title");
      assert.equal(document.querySelector("#result-count").getAttribute("role"), "status");
      assert.equal(document.querySelector("#result-count").getAttribute("aria-atomic"), "true");
      assert.equal(resultCount(document), "0 results");
      assert.equal(document.querySelector("#app").hasAttribute("aria-live"), false);
      const clear = document.querySelector("#clear-search");
      assert.equal(clear.tagName, "BUTTON");
      assert.equal(clear.textContent, "Clear Search");
      clear.focus();
      assert.strictEqual(document.activeElement, clear);

      const emptyState = harness.rendererModule.getConvertedEmptyState;
      assert.deepEqual(emptyState(0, 0, 0, ""), {
        kind: "empty-collection",
        message: "No Converted demonstration tracks are available.",
        showClearSearch: false,
      });
      assert.deepEqual(emptyState(5, 0, 0, ""), {
        kind: "empty-selection",
        message: "No Converted tracks match this selection.",
        showClearSearch: false,
      });
      assert.deepEqual(emptyState(5, 2, 0, "missing"), {
        kind: "no-search-results",
        message: "No tracks match ‘missing’ within this selection.",
        showClearSearch: true,
      });

      const css = await readFile("src/renderer/styles.css", "utf8");
      assert.match(css, /:focus-visible/);
      assertRuntimeBoundaries(harness);
    } finally {
      harness.dispose();
    }
  });

  await t.test("remains interactive across repeated filter changes without extra IPC or duplicate controls", async () => {
    const harness = await createRendererDom("rerenders");

    try {
      const document = documentFor(harness);
      await clickView(harness, "converting");
      for (let round = 0; round < 3; round += 1) {
        await setFilter(harness, "failed");
        assert.deepEqual(queueTitles(document), ["Blue Hour"]);
        await setFilter(harness, "all");
        assert.deepEqual(queueTitles(document), ["Aurora Lines", "Blue Hour"]);
        await setSearch(harness, "mira");
        assert.deepEqual(queueTitles(document), ["Aurora Lines"]);
        await setSearch(harness, "");
        assert.deepEqual(queueTitles(document), ["Aurora Lines", "Blue Hour"]);
        await clickView(harness, "converted");
        await setDimension(harness, "all");
        assert.deepEqual(queueTitles(document), ["Shared Lead", "Shared Other", "Alpha Other", "Unrelated Track", "Missing Metadata"]);
        await setDimension(harness, "artist");
        let resultMutations = 0;
        const observer = new harness.dom.window.MutationObserver((records) => {
          resultMutations += records.length;
        });
        observer.observe(document.querySelector("#queue-results"), { childList: true });
        try {
          await setSecondaryByLabel(harness, "Alpha Collaborator");
          assert.equal(resultMutations, 1, "one selection change should produce one result update");
        } finally {
          observer.disconnect();
        }
        assert.deepEqual(queueTitles(document), ["Shared Lead", "Alpha Other"]);
        await clickView(harness, "converting");
      }

      assert.equal(harness.fixtureCalls(), 1);
      assertRuntimeBoundaries(harness);
    } finally {
      harness.dispose();
    }
  });
});
