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

  try {
    await import(`${pathToFileURL(rendererPath).href}?renderer-interaction-${scenarioId}`);
    await settleRenderer();
  } catch (error) {
    restoreGlobals(previousGlobals);
    dom.window.close();
    throw error;
  }

  return {
    dom,
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

async function setSearch(harness, value) {
  const search = documentFor(harness).querySelector("#search");
  assert.ok(search, "expected fixture Search control");
  search.value = value;
  search.dispatchEvent(new harness.dom.window.Event("input", { bubbles: true }));
  await settleRenderer();
}

function assertRuntimeBoundaries(harness) {
  assert.deepEqual(harness.runtimeErrors, []);
  assert.deepEqual(harness.networkAttempts, []);
  assert.deepEqual(harness.ipcAttempts, []);
}

test("compiled renderer interaction suite", async (t) => {
  // Child scenarios are awaited serially because each temporarily installs
  // window, document, and fetch on the Node global object.
  await t.test("initializes Browser and navigates through all fixture views", async () => {
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
      assert.deepEqual(queueTitles(document), ["Lantern Room"]);
      assert.equal(queueSummary(document), "1 fixture job · 0 failed · 1 converted");
      assert.match(footerText(document), /Items: 1/);

      await clickView(harness, "browser");
      assert.equal(heading(document), "Browse a local source");
      assert.deepEqual(sourceTitles(document), ["Aurora Lines", "Blue Hour", "Lantern Room"]);
      assert.equal(document.querySelector('section[aria-label$="fixture list"]'), null);
      assertRuntimeBoundaries(harness);
    } finally {
      harness.dispose();
    }
  });

  await t.test("applies fixture status filters and Search composition within a view", async () => {
    const harness = await createRendererDom("filters");

    try {
      const document = documentFor(harness);
      await clickView(harness, "converting");
      assert.deepEqual(queueTitles(document), ["Aurora Lines", "Blue Hour"]);

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

      await setFilter(harness, "converted");
      assert.deepEqual(queueTitles(document), []);
      assert.match(emptyStateText(document), /No fixture rows match this view\./);
      assert.match(footerText(document), /Items: 0/);

      await setFilter(harness, "all");
      await setSearch(harness, "  MIRA  ");
      assert.deepEqual(queueTitles(document), ["Aurora Lines"]);

      await clickView(harness, "converted");
      await setSearch(harness, "");
      await setFilter(harness, "converted");
      assert.deepEqual(queueTitles(document), ["Lantern Room"]);
      await setFilter(harness, "failed");
      assert.deepEqual(queueTitles(document), []);
      assert.match(emptyStateText(document), /No fixture rows match this view\./);
      assertRuntimeBoundaries(harness);
    } finally {
      harness.dispose();
    }
  });

  await t.test("preserves Search and resets status when switching queue views", async () => {
    const harness = await createRendererDom("view-switch");

    try {
      const document = documentFor(harness);
      await clickView(harness, "converting");
      await setSearch(harness, "blue");
      await setFilter(harness, "failed");
      assert.deepEqual(queueTitles(document), ["Blue Hour"]);

      await clickView(harness, "converted");
      assert.equal(document.querySelector("#search")?.value, "blue");
      assert.equal(document.querySelector("#filter")?.value, "all");
      assert.deepEqual(queueTitles(document), []);
      assert.equal(queueSummary(document), "1 fixture job · 0 failed · 1 converted");
      assert.match(footerText(document), /Items: 0/);
      assert.match(emptyStateText(document), /No fixture rows match this view\./);

      await clickView(harness, "converting");
      assert.equal(document.querySelector("#search")?.value, "blue");
      assert.equal(document.querySelector("#filter")?.value, "all");
      assert.deepEqual(queueTitles(document), ["Blue Hour"]);
      assert.equal(queueSummary(document), "2 fixture jobs · 1 failed · 0 converted");
      assert.match(footerText(document), /Items: 1/);
      assertRuntimeBoundaries(harness);
    } finally {
      harness.dispose();
    }
  });

  await t.test("remains interactive across repeated rerenders and isolated cases", async () => {
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
        assert.deepEqual(queueTitles(document), ["Lantern Room"]);
        await clickView(harness, "converting");
        assert.deepEqual(queueTitles(document), ["Aurora Lines", "Blue Hour"]);
      }

      assert.equal(harness.fixtureCalls(), 1);
      assertRuntimeBoundaries(harness);
    } finally {
      harness.dispose();
    }
  });
});
