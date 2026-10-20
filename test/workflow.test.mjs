import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import * as workflow from "../dist/domain/workflow.js";
import { fixtureAuthBoundary, fixtureParityState, fixtureSnapshot } from "../dist/fixtures/workflow-fixtures.js";

test("fixture queue exposes active, failed, and converted states", () => {
  assert.deepEqual(workflow.summarizeQueue(fixtureSnapshot.queueItems), {
    total: 3,
    waiting: 0,
    analyzing: 0,
    converting: 1,
    failed: 1,
    converted: 1,
  });
});

test("All and Search filtering use only local fixture data", () => {
  assert.equal(workflow.filterQueueItems(fixtureSnapshot.queueItems, { filter: "all", search: "" }).length, 3);
  assert.deepEqual(
    workflow.filterQueueItems(fixtureSnapshot.queueItems, { filter: "all", search: "blue" }).map((item) => item.id),
    ["queue-blue-hour"],
  );
  assert.deepEqual(
    workflow.filterQueueItems(fixtureSnapshot.queueItems, { filter: "failed", search: "" }).map((item) => item.id),
    ["queue-blue-hour"],
  );
});

test("fixture filter options are deterministic and each status filters locally", () => {
  assert.deepEqual(Object.keys(workflow.filterLabels), [
    "all",
    "waiting",
    "analyzing",
    "converting",
    "failed",
    "converted",
  ]);
  assert.deepEqual(Object.values(workflow.filterLabels), [
    "All",
    "Waiting",
    "Analyzing",
    "Converting",
    "Failed",
    "Converted",
  ]);

  const expectedIds = {
    all: ["queue-aurora", "queue-blue-hour", "queue-lantern"],
    waiting: [],
    analyzing: [],
    converting: ["queue-aurora"],
    failed: ["queue-blue-hour"],
    converted: ["queue-lantern"],
  };

  for (const [filter, ids] of Object.entries(expectedIds)) {
    assert.deepEqual(
      workflow.filterQueueItems(fixtureSnapshot.queueItems, { filter, search: "" }).map((item) => item.id),
      ids,
      `unexpected fixture rows for ${filter}`,
    );
  }
});

test("Search composes with fixture status filters and normalizes the query", () => {
  assert.deepEqual(
    workflow.filterQueueItems(fixtureSnapshot.queueItems, { filter: "failed", search: "  BLUE  " }).map((item) => item.id),
    ["queue-blue-hour"],
  );
  assert.deepEqual(
    workflow.filterQueueItems(fixtureSnapshot.queueItems, { filter: "converted", search: "blue" }).map((item) => item.id),
    [],
  );
  assert.deepEqual(
    workflow.filterQueueItems(fixtureSnapshot.queueItems, { filter: "all", search: "MIRA" }).map((item) => item.id),
    ["queue-aurora", "queue-lantern"],
  );
});

test("fixture queue projections scope converting and converted views in source order", () => {
  const converting = workflow.projectQueueView(fixtureSnapshot, "converting", { filter: "all", search: "" });
  const converted = workflow.projectQueueView(fixtureSnapshot, "converted", { filter: "all", search: "" });

  assert.equal(converting.view, "converting");
  assert.deepEqual(converting.viewItems.map((item) => item.id), ["queue-aurora", "queue-blue-hour"]);
  assert.deepEqual(converting.visibleItems.map((item) => item.id), ["queue-aurora", "queue-blue-hour"]);
  assert.equal(converted.view, "converted");
  assert.deepEqual(converted.viewItems.map((item) => item.id), ["queue-lantern"]);
  assert.deepEqual(converted.visibleItems.map((item) => item.id), ["queue-lantern"]);
});

test("fixture queue projections compose status and Search filters inside the active view", () => {
  assert.deepEqual(
    workflow.projectQueueView(fixtureSnapshot, "converting", { filter: "failed", search: "" }).visibleItems.map((item) => item.id),
    ["queue-blue-hour"],
  );
  assert.deepEqual(
    workflow.projectQueueView(fixtureSnapshot, "converting", { filter: "converted", search: "" }).visibleItems,
    [],
  );
  assert.deepEqual(
    workflow.projectQueueView(fixtureSnapshot, "converted", { filter: "failed", search: "" }).visibleItems,
    [],
  );
  assert.deepEqual(
    workflow.projectQueueView(fixtureSnapshot, "converting", { filter: "all", search: "  BLUE  " }).visibleItems.map((item) => item.id),
    ["queue-blue-hour"],
  );
  assert.deepEqual(
    workflow.projectQueueView(fixtureSnapshot, "converted", { filter: "all", search: "MIRA" }).visibleItems.map((item) => item.id),
    ["queue-lantern"],
  );
});

test("fixture queue projections summarize complete views, handle empty results, and do not mutate input", () => {
  const before = structuredClone(fixtureSnapshot);
  const converting = workflow.projectQueueView(fixtureSnapshot, "converting", { filter: "failed", search: "" });
  const converted = workflow.projectQueueView(fixtureSnapshot, "converted", { filter: "all", search: "missing" });

  assert.deepEqual(converting.summary, {
    total: 2,
    waiting: 0,
    analyzing: 0,
    converting: 1,
    failed: 1,
    converted: 0,
  });
  assert.deepEqual(converted.summary, {
    total: 1,
    waiting: 0,
    analyzing: 0,
    converting: 0,
    failed: 0,
    converted: 1,
  });
  assert.deepEqual(converted.visibleItems, []);
  assert.deepEqual(fixtureSnapshot, before);
});

test("reference filter evidence preserves the unresolved option set", async () => {
  const manifest = JSON.parse(await readFile("evidence/evidence-manifest.json", "utf8"));
  const filterEvidence = manifest.evidence.find((entry) => entry.id === "EV-FILTER-002");

  assert.ok(filterEvidence);
  assert.equal(filterEvidence.source, "reference-ui");
  assert.match(filterEvidence.fact, /closed-state accessibility and screenshot observation/);
  assert.match(filterEvidence.fact, /non-activating Tab focus attempt did not expose additional filter labels/);
  assert.match(filterEvidence.unresolvedBehavior.join(" "), /complete live filter option set remains unknown/);
});

test("failed and converted rows retain distinct rendering state", () => {
  const failed = fixtureSnapshot.queueItems.find((item) => item.status === "failed");
  const converted = fixtureSnapshot.queueItems.find((item) => item.status === "converted");
  assert.equal(workflow.toQueueRowViewModel(failed, workflow.findJob(fixtureSnapshot, failed.id)).statusLabel, "Failed");
  assert.equal(workflow.toQueueRowViewModel(converted, workflow.findJob(fixtureSnapshot, converted.id)).statusLabel, "Complete");
});

test("retry and cancellation remain unknown rather than invented", () => {
  const failedJob = fixtureSnapshot.jobs.find((job) => job.status === "failed");
  assert.equal(failedJob.retry.state, "unknown");
  assert.equal(failedJob.cancellation.state, "unknown");
  assert.equal(workflow.actionLabel(failedJob.retry), "Behavior unknown");
});

test("confirmed fixture states and unknown affordances remain separate", () => {
  assert.deepEqual(fixtureParityState.views, {
    state: "observed",
    value: ["browser", "converting", "converted"],
    evidence: fixtureParityState.views.evidence,
  });
  assert.deepEqual(fixtureParityState.filterControls.value, ["status-filter", "search"]);
  assert.deepEqual(fixtureParityState.filterOptions.value, [
    "all",
    "waiting",
    "analyzing",
    "converting",
    "failed",
    "converted",
  ]);
  assert.equal(fixtureParityState.filterControls.evidence[0].source, "fixture");
  assert.equal(fixtureParityState.filterOptions.evidence[0].source, "fixture");
  assert.deepEqual(fixtureParityState.conversionStates.value, ["converting", "failed", "converted"]);
  assert.equal(fixtureParityState.queueInsertion.state, "unknown");
  assert.equal(fixtureParityState.retry.state, "unknown");
  assert.equal(fixtureParityState.cancellation.state, "unknown");
});

test("implementation boundaries are declared rather than reference-observed", () => {
  assert.equal(fixtureAuthBoundary.mode.state, "declared");
  assert.equal(fixtureAuthBoundary.credentials.state, "declared");
  assert.equal(fixtureAuthBoundary.remoteProviders.state, "declared");
  assert.equal(fixtureAuthBoundary.mode.evidence[0].source, "implementation-policy");
});

test("output policy records sanitized metadata and optional lyrics", () => {
  assert.deepEqual(fixtureSnapshot.outputPolicy.directory.value, "fixture-output");
  assert.deepEqual(fixtureSnapshot.outputPolicy.filenameTemplate.value, "{creator} - {title}");
  assert.deepEqual(fixtureSnapshot.outputPolicy.lyrics.value, "optional");
});

test("fixture-only source contains no network primitives or remote URLs", async () => {
  const files = [
    "src/main.ts",
    "src/preload.ts",
    "src/domain/contracts.ts",
    "src/domain/workflow.ts",
    "src/fixtures/workflow-fixtures.ts",
    "src/fixtures/converted-filter-fixtures.ts",
    "src/renderer/renderer.ts",
  ];
  const source = await Promise.all(files.map((file) => readFile(file, "utf8")));
  const combined = source.join("\n");
  assert.doesNotMatch(combined, /\b(fetch|XMLHttpRequest|WebSocket)\s*\(/);
  assert.doesNotMatch(combined, /https?:\/\//);
  assert.match(combined, /fixture-only/);
});

test("renderer output is browser-loadable rather than CommonJS", async () => {
  const html = await readFile("dist/renderer/index.html", "utf8");
  const renderer = await readFile("dist/renderer/renderer/renderer.js", "utf8");

  assert.match(html, /<script type="module" src="\.\/renderer\/renderer\.js"><\/script>/);
  assert.doesNotMatch(renderer, /\brequire\s*\(/);
  assert.match(renderer, /from ["']\.\.\/domain\/workflow\.js["']/);
});

test("parity matrix references only manifest evidence IDs", async () => {
  const matrix = await readFile("PARITY_MATRIX.md", "utf8");
  const manifest = JSON.parse(await readFile("evidence/evidence-manifest.json", "utf8"));
  const matrixEvidenceIds = [...new Set([...matrix.matchAll(/EV-[A-Z0-9-]+/g)].map((match) => match[0]))];
  const matrixRows = matrix
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.startsWith("| ---") && !line.startsWith("| Capability "));
  const manifestEvidenceIds = new Set(manifest.evidence.map((entry) => entry.id));
  const statuses = new Set(["observed", "partial", "inferred", "unknown"]);
  const confidences = new Set(["high", "medium", "low"]);

  assert.equal(matrixRows.length, 14);
  for (const row of matrixRows) {
    const cells = row.split("|").slice(1, -1).map((cell) => cell.trim());
    assert.equal(cells.length, 7, `matrix row must contain seven populated columns: ${row}`);
    const [capability, evidenceCell, status, confidence, implementation, tests, nextStep] = cells;
    assert.ok(capability, "matrix capability must be populated");
    assert.ok(statuses.has(status), `${capability} must use a recognized status`);
    assert.ok(confidences.has(confidence), `${capability} must use a recognized confidence`);
    assert.ok(implementation, `${capability} implementation status must be populated`);
    assert.ok(tests, `${capability} test status must be populated`);
    assert.ok(nextStep, `${capability} next safe verification step must be populated`);

    const evidenceIds = [...evidenceCell.matchAll(/EV-[A-Z0-9-]+/g)].map((match) => match[0]);
    assert.ok(evidenceIds.length > 0, `${capability} must reference evidence`);
    for (const evidenceId of evidenceIds) {
      assert.ok(manifestEvidenceIds.has(evidenceId), `${evidenceId} must be provenance-backed in the manifest`);
    }
  }
});

test("renderer keeps local-only CSP and the three bounded views", async () => {
  const html = await readFile("src/renderer/index.html", "utf8");
  const renderer = await readFile("src/renderer/renderer.ts", "utf8");

  assert.match(html, /connect-src 'none'/);
  assert.match(renderer, /navButton\("browser"/);
  assert.match(renderer, /navButton\("converting"/);
  assert.match(renderer, /navButton\("converted"/);
  assert.match(renderer, /projectQueueView\(snapshot,\s*"converting",\s*query\)/);
  assert.match(renderer, /projectConvertedFilter\(convertedViewDemoItems,\s*convertedSelection\)/);
  assert.match(renderer, /filterQueueItems\(membership,\s*\{ filter: "all", search: query\.search \}\)/);
  assert.doesNotMatch(renderer, /projectQueueView\(snapshot,\s*activeView/);
  assert.doesNotMatch(renderer, /filterQueueItems\(snapshot\.queueItems/);
  assert.match(renderer, /query = \{ \.\.\.query, filter: "all" \}/);
  assert.ok(renderer.includes('${summary.total} fixture job${summary.total === 1 ? "" : "s"}'));
});

test("fixture accessibility contract is semantic without claiming runtime traversal", async () => {
  const html = await readFile("src/renderer/index.html", "utf8");
  const renderer = await readFile("src/renderer/renderer.ts", "utf8");

  assert.match(html, /<div id="app" class="app-shell"><\/div>/);
  assert.doesNotMatch(html, /id="app"[^>]*aria-live/);
  assert.match(renderer, /<nav class="nav" aria-label="Workspace views">/);
  assert.match(renderer, /<select class="filter-select" id="filter" aria-label="Filter items">/);
  assert.match(renderer, /id="converted-dimension"/);
  assert.match(renderer, /id="converted-value"/);
  assert.match(renderer, /<input class="search" id="search" type="search"/);
  assert.match(renderer, /role="status"/);
  assert.match(renderer, /<table class="queue-table"><thead><tr><th scope="col">Title<\/th>/);
  assert.match(renderer, /<table class="queue-table converted-table"><caption class="visually-hidden">Converted synthetic demonstration tracks<\/caption>/);
  assert.match(renderer, /<span class="status \$\{item\.status\}">/);
  assert.match(renderer, /No action controls are exposed in fixture mode/);
});

test("runtime diagnostic evidence preserves the pre-renderer environment block", async () => {
  const manifest = JSON.parse(await readFile("evidence/evidence-manifest.json", "utf8"));
  const runtimeEvidence = manifest.evidence.find((entry) => entry.id === "EV-RUNTIME-002");

  assert.ok(runtimeEvidence);
  assert.equal(runtimeEvidence.source, "runtime-smoke");
  assert.match(runtimeEvidence.fact, /macOS 26\.7\.1 arm64/);
  assert.match(runtimeEvidence.fact, /Electron 44\.7\.0 arm64/);
  assert.match(runtimeEvidence.fact, /SIGABRT/);
  assert.match(runtimeEvidence.fact, /AppKit\/LaunchServices/);
  assert.match(runtimeEvidence.fact, /before fixture renderer startup/);
  assert.match(runtimeEvidence.unresolvedBehavior.join(" "), /documented macOS floor is satisfied/);
  assert.match(runtimeEvidence.unresolvedBehavior.join(" "), /official Electron issue #52815/);
  assert.match(runtimeEvidence.unresolvedBehavior.join(" "), /does not establish this machine's launchservicesd state/);
});

test("evidence entries and capture plan preserve provenance and unknown gaps", async () => {
  const manifest = JSON.parse(await readFile("evidence/evidence-manifest.json", "utf8"));
  const plan = await readFile("EVIDENCE_CAPTURE_PLAN.md", "utf8");

  for (const entry of manifest.evidence) {
    assert.ok(entry.id);
    assert.ok(entry.source);
    assert.ok(["high", "medium", "low"].includes(entry.confidence));
    assert.ok(Array.isArray(entry.unresolvedBehavior));
    assert.ok(entry.provenance?.kind);
    assert.ok(entry.provenance?.artifact);
  }

  const expectedSections = [
    "Complete live filter option set",
    "Retry and cancellation affordances",
    "Output settings, filename/path rules, and lyrics representation",
    "Keyboard focus order and accessibility semantics",
  ];
  const requiredLabels = [
    "Preconditions",
    "Safe observation",
    "Prohibited action",
    "Expected evidence artifact",
    "Stop condition",
    "Current status",
  ];
  const planSections = [...plan.matchAll(/^## (.+)$/gm)];

  assert.deepEqual(planSections.map((match) => match[1]), expectedSections);
  for (let index = 0; index < planSections.length; index += 1) {
    const sectionStart = planSections[index].index + planSections[index][0].length;
    const sectionEnd = planSections[index + 1]?.index ?? plan.length;
    const section = plan.slice(sectionStart, sectionEnd);
    for (const label of requiredLabels) {
      assert.match(section, new RegExp(`^- ${label}:`, "m"), `${planSections[index][1]} must include ${label}`);
    }
  }
});
