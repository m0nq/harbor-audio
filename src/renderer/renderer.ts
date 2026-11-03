import type {
  ConvertedFilterItem,
  ConvertedFilterSelection,
  FixtureQueueProjection,
  FixtureView,
  QueueFilter,
  QueueItem,
  QueueQuery,
  WorkflowSnapshot,
} from "../domain/contracts.js";
import type { ConvertedSortColumn, ConvertedSortState } from "../domain/converted-sort.js";
import {
  filterLabels,
  filterQueueItems,
  findJob,
  projectQueueView,
  toQueueRowViewModel,
} from "../domain/workflow.js";
import { projectConvertedFilter } from "../domain/converted-filter.js";
import { sortConvertedItems } from "../domain/converted-sort.js";
import { nextConversionStatus } from "../domain/conversion-status.js";
import {
  advanceLifecycleDemo,
  createLifecycleDemoState,
  type LifecycleDemoState,
} from "../domain/lifecycle-demo.js";
import {
  advanceSessionQueueItem,
  createSessionQueueState,
  insertSessionQueueItem,
  projectActiveSessionQueueItems,
  projectCompletedSessionItems,
  type SessionQueueState,
} from "../domain/session-queue.js";
import { convertedViewDemoItems } from "../fixtures/converted-filter-fixtures.js";

declare global {
  interface Window {
    workflowApi: {
      getFixture(): Promise<WorkflowSnapshot>;
    };
  }
}

interface ConvertedEmptyState {
  kind: "empty-collection" | "empty-selection" | "no-search-results";
  message: string;
  showClearSearch: boolean;
}

let snapshot: WorkflowSnapshot | undefined;
let activeView: FixtureView = "browser";
let query: QueueQuery = { filter: "all", search: "" };
let convertedSelection: ConvertedFilterSelection = { dimension: "all", value: "all" };
let convertedSort: ConvertedSortState | null = null;
let lifecycleDemoState: LifecycleDemoState = createLifecycleDemoState();
let sessionQueueState: SessionQueueState = createSessionQueueState();
let sessionQueueFeedback = "";
let sessionQueueAnnouncement = "";

const optionCollator = new Intl.Collator("en-US", { sensitivity: "base", numeric: false });

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

  const activeContent = activeView === "browser"
    ? renderBrowser()
    : activeView === "converted"
      ? renderConvertedQueue()
      : renderConvertingQueue(projectQueueView(snapshot, "converting", query));

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
      ${activeContent}
    </main>
  `;

  wireEvents();
}

function navButton(view: typeof activeView, icon: string, label: string): string {
  return `<button class="nav-button ${activeView === view ? "active" : ""}" data-view="${view}" aria-current="${activeView === view ? "page" : "false"}"><span class="nav-icon" aria-hidden="true">${icon}</span>${label}</button>`;
}

function renderBrowser(): string {
  const items = snapshot?.sourceItems ?? [];
  return `
    <section class="browser-card" aria-label="Local browser fixture">
      <div class="browser-toolbar"><div class="traffic" aria-hidden="true"><span></span><span></span><span></span></div><div class="address">fixture://library/night-transit</div><span class="fixture-badge">offline</span></div>
      <div class="browser-body"><div class="source-menu"><div class="selected">Library</div><div>Playlists</div><div>Collections</div><div>Recently added</div></div><div><div class="source-heading">Night Transit</div><div class="source-meta">A local playlist fixture · ${items.length} sample items</div><div class="source-list">${items.map((item) => renderSourceRow(item)).join("")}</div><p id="session-queue-feedback" class="session-queue-feedback" role="status" aria-live="polite" aria-atomic="true">${escapeHtml(sessionQueueFeedback)}</p></div></div>
    </section>
    <div class="section-heading"><div><h2>Queue preview</h2><p>Added records remain session-local fixture data.</p></div><span class="fixture-badge">session only</span></div>
    <div class="queue-card"><div class="unknown-note">Added records appear separately in Converting. They begin waiting, do not start automatically, and produce no media output.</div></div>
  `;
}

function renderSourceRow(item: WorkflowSnapshot["sourceItems"][number]): string {
  const isAdded = sessionQueueState.items.some((sessionItem) => sessionItem.sourceItemId === item.id);
  return `<div class="source-row"><div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.creator)} · ${escapeHtml(item.collection)}</span></div><div class="source-row-actions"><span>${escapeHtml(item.duration)}</span>${isAdded ? `<span class="session-queue-added">Added</span>` : ""}<button class="source-add-button" type="button" data-source-id="${escapeHtml(item.id)}" aria-label="Add ${escapeHtml(item.title)} to session queue">Add to session queue</button></div></div>`;
}

function renderConvertingQueue(projection: FixtureQueueProjection): string {
  const { visibleItems: items, summary } = projection;
  return `
    <div class="section-heading"><div><h2>Converting</h2><p>${summary.total} fixture job${summary.total === 1 ? "" : "s"} · ${summary.failed} failed · ${summary.converted} converted</p></div><span class="fixture-badge">local only</span></div>
    <section class="queue-card" aria-label="Converting fixture list">
      <div class="queue-toolbar">
        <label class="visually-hidden" for="filter">Filter items</label><select class="filter-select" id="filter" aria-label="Filter items">${Object.entries(filterLabels).map(([value, label]) => `<option value="${value}" ${query.filter === value ? "selected" : ""}>${label}</option>`).join("")}</select>
        <label class="visually-hidden" for="search">Search fixture library</label><input class="search" id="search" type="search" placeholder="Search fixture library" value="${escapeHtml(query.search)}" />
        <span class="toolbar-spacer"></span><span class="fixture-badge">fixture</span>
      </div>
      <div id="queue-results">${renderConvertingResults(items)}</div>
      <div class="unknown-note">Retry and cancellation affordances are unknown in the captured workflow. No action controls are exposed in fixture mode.</div>
    </section>
    ${renderSessionQueueAdditions()}
    ${renderLifecycleDemo()}
    <div class="footer-line"><span id="item-count">Items: ${items.length}</span><span>Output policy: ${snapshot?.outputPolicy.directory.state === "observed" ? "fixture-output" : "unknown"}</span></div>
  `;
}

function renderSessionQueueAdditions(): string {
  return `
    <section class="queue-card session-queue-additions" aria-labelledby="session-queue-additions-heading">
      <div class="section-heading"><div><h2 id="session-queue-additions-heading">Session queue additions</h2><p>Added during the current session · separate from canonical queue results</p></div><span class="fixture-badge">session only</span></div>
      <p class="session-queue-note">These fixture records begin at Waiting and advance only by explicit action. Completed items move to Converted for this session; no media output is created.</p>
      <p id="session-queue-announcement" class="session-queue-announcement" role="status" aria-live="polite" aria-atomic="true" tabindex="-1">${escapeHtml(sessionQueueAnnouncement)}</p>
      <div id="session-queue-results">${renderSessionQueueResults()}</div>
    </section>
  `;
}

function renderSessionQueueResults(): string {
  const items = projectActiveSessionQueueItems(sessionQueueState);
  if (items.length === 0) {
    const hasCompletedItems = projectCompletedSessionItems(sessionQueueState).length > 0;
    const message = hasCompletedItems
      ? "No active session jobs remain. Completed jobs are available in Converted."
      : "No session queue items have been added.";
    return `<div class="empty">${message}</div>`;
  }

  return `<table class="queue-table"><caption class="visually-hidden">Session queue additions</caption><thead><tr><th scope="col">Title</th><th scope="col">Creator</th><th scope="col">Collection</th><th scope="col">Duration</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead><tbody>${items.map((item) => renderSessionQueueRow(item)).join("")}</tbody></table>`;
}

function renderSessionQueueRow(item: SessionQueueState["items"][number]): string {
  const statusLabel = formatStatusLabel(item.status);
  const isTerminal = nextConversionStatus(item.status) === undefined;
  const actionLabel = isTerminal
    ? item.status === "converted"
      ? `${item.title} is already Converted (simulated complete)`
      : `${item.title} is already ${statusLabel} (simulated terminal state)`
    : `Advance ${item.title} from ${statusLabel} (simulated)`;
  const actionText = isTerminal ? item.status === "converted" ? "Completed" : "Terminal" : "Advance";

  return `<tr><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.creator)}</td><td>${escapeHtml(item.collection)}</td><td>${escapeHtml(item.duration)}</td><td><span class="status ${item.status}">${statusLabel}</span></td><td><button class="session-queue-advance" type="button" data-session-queue-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(actionLabel)}" aria-disabled="${isTerminal ? "true" : "false"}">${actionText}</button></td></tr>`;
}

function formatStatusLabel(status: QueueItem["status"]): string {
  return status[0].toUpperCase() + status.slice(1);
}

function renderLifecycleDemo(): string {
  const { record, status } = lifecycleDemoState;
  const isComplete = status === "converted";
  const statusLabel = status[0].toUpperCase() + status.slice(1);

  return `
    <section class="queue-card lifecycle-demo" aria-labelledby="lifecycle-demo-heading">
      <div class="section-heading"><div><h2 id="lifecycle-demo-heading">Demo lifecycle</h2><p>A deterministic fixture-only conversion demonstration.</p></div><span class="fixture-badge">no media</span></div>
      <div class="lifecycle-demo-row" data-lifecycle-state="${status}">
        <div><strong>${escapeHtml(record.title)}</strong><span>${escapeHtml(record.creator)} · ${escapeHtml(record.collection)} · ${escapeHtml(record.duration)}</span></div>
        <span id="lifecycle-demo-status" role="status" aria-live="polite" aria-atomic="true">${statusLabel}</span>
        <button id="advance-demo-step" type="button" aria-disabled="${isComplete ? "true" : "false"}">Advance demo step</button>
      </div>
      ${isComplete ? `<p id="lifecycle-demo-completed">Completed demonstration result remains visible; no actual media or output file is produced.</p>` : `<p id="lifecycle-demo-description">This demonstration changes fixture state only; no actual media or output file is produced.</p>`}
    </section>
  `;
}

function renderConvertingResults(items: QueueItem[]): string {
  if (items.length === 0) return `<div class="empty">No fixture rows match this view.</div>`;

  return `<table class="queue-table"><thead><tr><th scope="col">Title</th><th scope="col">Creator</th><th scope="col">Collection</th><th scope="col">Duration</th><th scope="col">Status</th></tr></thead><tbody>${items.map((item) => {
    const row = toQueueRowViewModel(item, findJob(snapshot as WorkflowSnapshot, item.id));
    return `<tr><td>${escapeHtml(row.title)}</td><td>${escapeHtml(row.creator)}</td><td>${escapeHtml(row.collection)}</td><td>${escapeHtml(row.duration)}</td><td><span class="status ${item.status}">${escapeHtml(row.statusLabel)}</span></td></tr>`;
  }).join("")}</tbody></table>`;
}

function renderConvertedQueue(): string {
  const membership = currentConvertedMembership();
  const items = currentConvertedItems(membership);
  const completedSessionItems = projectCompletedSessionItems(sessionQueueState);

  return `
    <section class="queue-card completed-session" aria-labelledby="completed-session-heading">
      <div class="section-heading"><div><h2 id="completed-session-heading">Completed this session</h2><p>${completedSessionItems.length} simulated session completion${completedSessionItems.length === 1 ? "" : "s"} · no output files created</p></div><span class="fixture-badge">session only</span></div>
      <p class="session-queue-note">These records come only from the current simulated session and remain separate from Converted demonstration history.</p>
      <div id="completed-session-results">${renderCompletedSessionResults(completedSessionItems)}</div>
    </section>
    <div class="section-heading"><div><h2>Converted</h2><p>${convertedViewDemoItems.length} synthetic demonstration tracks · no media conversion occurred</p></div><span class="fixture-badge">synthetic demo</span></div>
    <section class="queue-card" aria-label="Converted demonstration fixture list">
      <div class="queue-toolbar converted-toolbar">
        <div class="filter-control"><label for="converted-dimension">Filter by</label><select class="filter-select" id="converted-dimension">${renderDimensionOptions()}</select></div>
        <div id="secondary-filter-control" class="filter-control">${renderConvertedSecondaryControl()}</div>
        <div class="filter-control search-control"><label for="search">Search</label><input class="search" id="search" type="search" placeholder="Search Converted demonstration tracks" value="${escapeHtml(query.search)}" /></div>
        ${convertedSort ? `<button class="clear-sort" id="clear-sort" type="button">Clear sort</button>` : ""}
        <span class="toolbar-spacer"></span><span class="fixture-badge">fixture</span>
      </div>
      <p id="result-count" class="result-count" role="status" aria-atomic="true" aria-controls="queue-results">${formatResultCount(items.length)}</p>
      <div id="queue-results">${renderConvertedResults(items, membership.length)}</div>
    </section>
  `;
}

function renderCompletedSessionResults(items: readonly SessionQueueState["items"][number][]): string {
  if (items.length === 0) {
    return `<div class="empty completed-session-empty">No session jobs have completed in this session.</div>`;
  }

  return `<table class="queue-table completed-session-table"><caption class="visually-hidden">Completed this session</caption><thead><tr><th scope="col">Title</th><th scope="col">Creator</th><th scope="col">Collection</th><th scope="col">Duration</th><th scope="col">Status</th><th scope="col">Output</th></tr></thead><tbody>${items.map((item) => `<tr data-session-queue-id="${escapeHtml(item.id)}" data-source-item-id="${escapeHtml(item.sourceItemId)}"><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.creator)}</td><td>${escapeHtml(item.collection)}</td><td>${escapeHtml(item.duration)}</td><td><span class="status converted">Converted</span><small>Simulated completion</small></td><td>Simulated only; no output file was created.</td></tr>`).join("")}</tbody></table>`;
}

function renderDimensionOptions(): string {
  const dimensions = [
    ["all", "All"],
    ["artist", "Artist"],
    ["album", "Album"],
  ] as const;
  return dimensions.map(([value, label]) => `<option value="${value}" ${convertedSelection.dimension === value ? "selected" : ""}>${label}</option>`).join("");
}

function renderConvertedSecondaryControl(): string {
  if (convertedSelection.dimension === "all") return "";

  const isArtist = convertedSelection.dimension === "artist";
  const inclusiveValue = isArtist ? "all-artists" : "all-albums";
  const inclusiveLabel = isArtist ? "All Artists" : "All Albums";
  const specificValues = isArtist ? getArtistOptions() : getAlbumOptions();
  const selectedKey = typeof convertedSelection.value === "string" ? undefined : convertedSelection.value.key;
  const label = isArtist ? "Artist" : "Album";
  const options = specificValues.map((value, index) => {
    const selected = value === selectedKey ? "selected" : "";
    return `<option value="specific-${index}" data-filter-key="${escapeHtml(value)}" ${selected}>${escapeHtml(value)}</option>`;
  }).join("");

  return `<label for="converted-value">${label}</label><select class="filter-select" id="converted-value"><option value="${inclusiveValue}" ${convertedSelection.value === inclusiveValue ? "selected" : ""}>${inclusiveLabel}</option>${options}</select>`;
}

function getArtistOptions(): string[] {
  const values = convertedViewDemoItems.flatMap((item) => item.referenceMetadata?.artistCredits ?? []);
  return uniqueSortedValues(values);
}

function getAlbumOptions(): string[] {
  const values = convertedViewDemoItems.flatMap((item) => item.referenceMetadata?.album ? [item.referenceMetadata.album] : []);
  return uniqueSortedValues(values);
}

function uniqueSortedValues(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))]
    .sort((left, right) => optionCollator.compare(left, right) || compareCodeUnits(left, right));
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function currentConvertedMembership(): ConvertedFilterItem[] {
  return projectConvertedFilter(convertedViewDemoItems, convertedSelection);
}

function formatResultCount(count: number): string {
  return `${count} result${count === 1 ? "" : "s"}`;
}

export function getConvertedEmptyState(
  totalConvertedCount: number,
  membershipCount: number,
  visibleCount: number,
  searchText: string,
): ConvertedEmptyState | undefined {
  if (visibleCount > 0) return undefined;
  if (totalConvertedCount === 0) {
    return {
      kind: "empty-collection",
      message: "No Converted demonstration tracks are available.",
      showClearSearch: false,
    };
  }
  if (membershipCount === 0) {
    return {
      kind: "empty-selection",
      message: "No Converted tracks match this selection.",
      showClearSearch: false,
    };
  }

  const normalizedSearch = searchText.trim();
  if (normalizedSearch.length > 0) {
    return {
      kind: "no-search-results",
      message: `No tracks match ‘${normalizedSearch}’ within this selection.`,
      showClearSearch: true,
    };
  }

  return {
    kind: "empty-selection",
    message: "No Converted tracks match this selection.",
    showClearSearch: false,
  };
}

function renderConvertedResults(items: ConvertedFilterItem[], membershipCount: number): string {
  if (items.length === 0) {
    const emptyState = getConvertedEmptyState(
      convertedViewDemoItems.length,
      membershipCount,
      items.length,
      query.search,
    );
    if (!emptyState) return "";
    return `<div class="empty converted-empty" id="converted-empty" data-empty-kind="${emptyState.kind}"><p>${escapeHtml(emptyState.message)}</p>${emptyState.showClearSearch ? `<button class="clear-search" id="clear-search" type="button">Clear Search</button>` : ""}</div>`;
  }

  return `<table class="queue-table converted-table"><caption class="visually-hidden">Converted synthetic demonstration tracks</caption><thead><tr>${renderSortHeader("title", "Title")}${renderSortHeader("artist", "Artist")}${renderSortHeader("album", "Album")}${renderSortHeader("duration", "Duration")}</tr></thead><tbody>${items.map((item) => `<tr><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.creator)}</td><td>${escapeHtml(item.collection)}</td><td>${escapeHtml(item.duration)}</td></tr>`).join("")}</tbody></table>`;
}

function renderSortHeader(column: ConvertedSortColumn, label: string): string {
  const active = convertedSort?.column === column;
  const direction = active ? convertedSort?.direction : undefined;
  const indicator = direction === "ascending" ? " ↑" : direction === "descending" ? " ↓" : "";
  const ariaSort = direction === "ascending" ? "ascending" : direction === "descending" ? "descending" : "none";
  return `<th scope="col" aria-sort="${ariaSort}"><button class="sort-button" type="button" data-sort-column="${column}" aria-label="Sort by ${label}">${label}<span aria-hidden="true">${indicator}</span></button></th>`;
}

function wireEvents(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      activeView = button.dataset.view as typeof activeView;
      query = { ...query, filter: "all" };
      renderShell();
    });
  });

  document.querySelector<HTMLButtonElement>("#advance-demo-step")?.addEventListener("click", () => {
    if (lifecycleDemoState.status === "converted") return;

    lifecycleDemoState = advanceLifecycleDemo(lifecycleDemoState);
    renderShell();

    document.querySelector<HTMLButtonElement>("#advance-demo-step")?.focus();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-source-id]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!snapshot) return;
      const sourceItemId = button.dataset.sourceId;
      if (!sourceItemId) return;

      const result = insertSessionQueueItem({
        state: sessionQueueState,
        sourceItems: snapshot.sourceItems,
        canonicalQueueItems: snapshot.queueItems,
        sourceItemId,
      });
      sessionQueueState = result.state;
      sessionQueueFeedback = result.kind === "added"
        ? "Added to session queue"
        : result.kind === "already-present"
          ? "Already in session queue"
          : "Unable to add source to session queue";
      renderShell();
      document.querySelectorAll<HTMLButtonElement>("[data-source-id]")
        .forEach((nextButton) => {
          if (nextButton.dataset.sourceId === sourceItemId) nextButton.focus();
        });
    });
    button.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
      event.preventDefault();
      button.click();
    });
  });

  document.querySelector<HTMLSelectElement>("#filter")?.addEventListener("change", (event) => {
    query.filter = (event.target as HTMLSelectElement).value as QueueFilter;
    updateActiveQueueResults();
  });

  document.querySelector<HTMLSelectElement>("#converted-dimension")?.addEventListener("change", (event) => {
    const dimension = (event.target as HTMLSelectElement).value;
    convertedSelection = dimension === "artist"
      ? { dimension: "artist", value: "all-artists" }
      : dimension === "album"
        ? { dimension: "album", value: "all-albums" }
        : { dimension: "all", value: "all" };
    renderSecondaryControlInPlace();
    updateConvertedResults();
    wireClearSearch();
  });

  wireSecondaryControl();
  wireSortControls();
  wireSessionQueueControls();

  document.querySelector<HTMLInputElement>("#search")?.addEventListener("input", (event) => {
    query.search = (event.target as HTMLInputElement).value;
    updateActiveQueueResults();
  });

  wireClearSearch();
}

function wireSortHeaderControls(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-sort-column]").forEach((button) => {
    button.addEventListener("click", () => {
      const column = button.dataset.sortColumn as ConvertedSortColumn;
      const direction = convertedSort?.column === column && convertedSort.direction === "ascending"
        ? "descending"
        : "ascending";
      convertedSort = { column, direction };
      renderShell();
    });
  });
}

function wireSortControls(): void {
  wireSortHeaderControls();
  document.querySelector<HTMLButtonElement>("#clear-sort")?.addEventListener("click", () => {
    convertedSort = null;
    renderShell();
  });
}

function wireSecondaryControl(): void {
  document.querySelector<HTMLSelectElement>("#converted-value")?.addEventListener("change", (event) => {
    const select = event.target as HTMLSelectElement;
    const selectedOption = select.selectedOptions[0];
    if (select.value === "all-artists") {
      convertedSelection = { dimension: "artist", value: "all-artists" };
    } else if (select.value === "all-albums") {
      convertedSelection = { dimension: "album", value: "all-albums" };
    } else if (selectedOption?.dataset.filterKey && convertedSelection.dimension === "artist") {
      convertedSelection = {
        dimension: "artist",
        value: { kind: "specific", key: selectedOption.dataset.filterKey },
      };
    } else if (selectedOption?.dataset.filterKey && convertedSelection.dimension === "album") {
      convertedSelection = {
        dimension: "album",
        value: { kind: "specific", key: selectedOption.dataset.filterKey },
      };
    }
    updateConvertedResults();
    wireClearSearch();
  });
}

function wireSessionQueueControls(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-session-queue-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const sessionQueueItemId = button.dataset.sessionQueueId;
      if (!sessionQueueItemId) return;

      const result = advanceSessionQueueItem({ state: sessionQueueState, sessionQueueItemId });
      if (result.kind === "unknown-id" || result.kind === "terminal") return;

      sessionQueueState = result.state;
      sessionQueueAnnouncement = result.item.status === "converted"
        ? `${result.item.title} reached Converted in the simulated session; it is available in Converted. No media output was created.`
        : `${result.item.title} is now ${formatStatusLabel(result.item.status)} in the simulated session queue; no media output was created.`;
      updateSessionQueueResults();

      if (result.item.status === "converted") {
        document.querySelector<HTMLParagraphElement>("#session-queue-announcement")?.focus();
      } else {
        [...document.querySelectorAll<HTMLButtonElement>("[data-session-queue-id]")]
          .find((nextButton) => nextButton.dataset.sessionQueueId === sessionQueueItemId)
          ?.focus();
      }
    });
  });
}

function updateSessionQueueResults(): void {
  const results = document.querySelector<HTMLDivElement>("#session-queue-results");
  if (results) {
    results.innerHTML = renderSessionQueueResults();
    wireSessionQueueControls();
  }

  const announcement = document.querySelector<HTMLParagraphElement>("#session-queue-announcement");
  if (announcement) announcement.textContent = sessionQueueAnnouncement;
}

function renderSecondaryControlInPlace(): void {
  const secondaryControl = document.querySelector<HTMLDivElement>("#secondary-filter-control");
  if (!secondaryControl) return;
  secondaryControl.innerHTML = renderConvertedSecondaryControl();
  wireSecondaryControl();
}

function wireClearSearch(): void {
  document.querySelector<HTMLButtonElement>("#clear-search")?.addEventListener("click", () => {
    const search = document.querySelector<HTMLInputElement>("#search");
    query.search = "";
    if (search) search.value = "";
    updateActiveQueueResults();
    search?.focus();
    search?.setSelectionRange(0, 0);
  });
}

function updateActiveQueueResults(): void {
  if (activeView === "converted") {
    updateConvertedResults();
  } else if (activeView === "converting" && snapshot) {
    const projection = projectQueueView(snapshot, "converting", query);
    const results = document.querySelector<HTMLDivElement>("#queue-results");
    if (results) results.innerHTML = renderConvertingResults(projection.visibleItems);
    const itemCount = document.querySelector<HTMLSpanElement>("#item-count");
    if (itemCount) itemCount.textContent = `Items: ${projection.visibleItems.length}`;
  }
  wireClearSearch();
}

function updateConvertedResults(): void {
  const membership = currentConvertedMembership();
  const items = currentConvertedItems(membership);
  const results = document.querySelector<HTMLDivElement>("#queue-results");
  if (results) {
    results.innerHTML = renderConvertedResults(items, membership.length);
    wireSortHeaderControls();
  }
  const resultCount = document.querySelector<HTMLParagraphElement>("#result-count");
  if (resultCount) resultCount.textContent = formatResultCount(items.length);
}

function currentConvertedItems(membership: ConvertedFilterItem[]): ConvertedFilterItem[] {
  const searched = filterQueueItems(membership, { filter: "all", search: query.search });
  return sortConvertedItems(searched, convertedSort);
}

void window.workflowApi.getFixture().then((loadedSnapshot) => {
  snapshot = loadedSnapshot;
  renderShell();
});
