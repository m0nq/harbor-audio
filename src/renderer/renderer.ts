import type { FixtureQueueProjection, FixtureView, QueueFilter, QueueQuery, WorkflowSnapshot } from "../domain/contracts.js";
import { filterLabels, findJob, projectQueueView, toQueueRowViewModel } from "../domain/workflow.js";

declare global {
  interface Window {
    workflowApi: {
      getFixture(): Promise<WorkflowSnapshot>;
    };
  }
}

let snapshot: WorkflowSnapshot | undefined;
let activeView: FixtureView = "browser";
let query: QueueQuery = { filter: "all", search: "" };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function renderShell(): void {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app || !snapshot) return;

  const projection = activeView === "browser" ? undefined : projectQueueView(snapshot, activeView, query);

  app.innerHTML = `
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">HA</div>
        <div><div class="brand-name">Harbor Audio</div><div class="brand-subtitle">local workflow studio</div></div>
      </div>
      <p class="nav-label">Workspace</p>
      <nav class="nav" aria-label="Workspace views">
        ${navButton("browser", "◌", "Browser")}
        ${navButton("converting", "↻", "Converting")}
        ${navButton("converted", "✓", "Converted")}
      </nav>
      <div class="fixture-note"><strong>Fixture mode</strong>All content is local sample data. Remote sources, credentials, and media operations are disabled.</div>
    </aside>
    <main class="workspace">
      <div class="topline">
        <div><div class="eyebrow">Workflow parity lab</div><h1>${activeView === "browser" ? "Browse a local source" : activeView === "converting" ? "Conversion queue" : "Completed items"}</h1><p class="intro">A bounded desktop shell for inspecting known and unknown workflow states.</p></div>
        <div class="baseline">capture ${escapeHtml("fixture-baseline-2026-10-12")}</div>
      </div>
      ${projection ? renderQueue(projection) : renderBrowser()}
    </main>
  `;

  wireEvents();
}

function navButton(view: typeof activeView, icon: string, label: string): string {
  return `<button class="nav-button ${activeView === view ? "active" : ""}" data-view="${view}"><span class="nav-icon">${icon}</span>${label}</button>`;
}

function renderBrowser(): string {
  const items = snapshot?.sourceItems ?? [];
  return `
    <section class="browser-card" aria-label="Local browser fixture">
      <div class="browser-toolbar"><div class="traffic"><span></span><span></span><span></span></div><div class="address">fixture://library/night-transit</div><span class="fixture-badge">offline</span></div>
      <div class="browser-body"><div class="source-menu"><div class="selected">Library</div><div>Playlists</div><div>Collections</div><div>Recently added</div></div><div><div class="source-heading">Night Transit</div><div class="source-meta">A local playlist fixture · ${items.length} sample items</div><div class="source-list">${items.map((item) => `<div class="source-row"><div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.creator)} · ${escapeHtml(item.collection)}</span></div><span>${escapeHtml(item.duration)}</span></div>`).join("")}</div></div></div>
    </section>
    <div class="section-heading"><div><h2>Queue preview</h2><p>Selection and insertion behavior remain explicitly fixture-scoped.</p></div><span class="fixture-badge">no actions</span></div>
    <div class="queue-card"><div class="unknown-note">The reference affordance for inserting selected source items was not captured safely. This scaffold preserves that behavior as unknown instead of inventing a button.</div></div>
  `;
}

function renderQueue(projection: FixtureQueueProjection): string {
  const { view, visibleItems: items, summary } = projection;
  const isConverted = view === "converted";

  return `
    <div class="section-heading"><div><h2>${isConverted ? "Converted" : "Converting"}</h2><p>${summary.total} fixture job${summary.total === 1 ? "" : "s"} · ${summary.failed} failed · ${summary.converted} converted</p></div><span class="fixture-badge">local only</span></div>
    <section class="queue-card" aria-label="${isConverted ? "Converted" : "Converting"} fixture list">
      <div class="queue-toolbar"><select class="filter-select" id="filter" aria-label="Filter items">${Object.entries(filterLabels).map(([value, label]) => `<option value="${value}" ${query.filter === value ? "selected" : ""}>${label}</option>`).join("")}</select><input class="search" id="search" type="search" placeholder="Search fixture library" value="${escapeHtml(query.search)}" /><span class="toolbar-spacer"></span><span class="fixture-badge">fixture</span></div>
      ${items.length === 0 ? `<div class="empty">No fixture rows match this view.</div>` : `<table class="queue-table"><thead><tr><th>Title</th><th>Creator</th><th>Collection</th><th>Duration</th><th>Status</th></tr></thead><tbody>${items.map((item) => { const row = toQueueRowViewModel(item, findJob(snapshot as WorkflowSnapshot, item.id)); return `<tr><td>${escapeHtml(row.title)}</td><td>${escapeHtml(row.creator)}</td><td>${escapeHtml(row.collection)}</td><td>${escapeHtml(row.duration)}</td><td><span class="status ${item.status}">${escapeHtml(row.statusLabel)}</span></td></tr>`; }).join("")}</tbody></table>`}
      <div class="unknown-note">Retry and cancellation affordances are unknown in the captured workflow. No action controls are exposed in fixture mode.</div>
    </section>
    <div class="footer-line"><span>Items: ${items.length}</span><span>Output policy: ${snapshot?.outputPolicy.directory.state === "observed" ? "fixture-output" : "unknown"}</span></div>
  `;
}

function wireEvents(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      activeView = button.dataset.view as typeof activeView;
      query = { ...query, filter: "all" };
      renderShell();
    });
  });

  document.querySelector<HTMLSelectElement>("#filter")?.addEventListener("change", (event) => {
    query.filter = (event.target as HTMLSelectElement).value as QueueFilter;
    renderShell();
  });
  document.querySelector<HTMLInputElement>("#search")?.addEventListener("input", (event) => {
    query.search = (event.target as HTMLInputElement).value;
    renderShell();
  });
}

void window.workflowApi.getFixture().then((loadedSnapshot) => {
  snapshot = loadedSnapshot;
  renderShell();
});
