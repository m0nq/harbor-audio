import assert from "node:assert/strict";
import { test } from "node:test";
import { fixtureSnapshot } from "../dist/fixtures/workflow-fixtures.js";
import { filterQueueItems } from "../dist/domain/workflow.js";
import { projectConvertedFilter } from "../dist/domain/converted-filter.js";
import { convertedFilterItems } from "./converted-filter-fixture.mjs";

const ids = (items) => items.map((item) => item.id);
const selection = {
  all: { dimension: "all", value: "all" },
  allArtists: { dimension: "artist", value: "all-artists" },
  allAlbums: { dimension: "album", value: "all-albums" },
  artist: (key) => ({ dimension: "artist", value: { kind: "specific", key } }),
  album: (key) => ({ dimension: "album", value: { kind: "specific", key } }),
};

test("All returns every Converted entry in source order", () => {
  const result = projectConvertedFilter(convertedFilterItems, selection.all);

  assert.deepEqual(ids(result), [
    "queue-shared-lead",
    "queue-shared-other",
    "queue-alpha-other",
    "queue-unrelated",
    "queue-missing-metadata",
  ]);
  assert.notStrictEqual(result, convertedFilterItems);
});

test("Artist → All Artists preserves Converted membership and order", () => {
  const result = projectConvertedFilter(convertedFilterItems, selection.allArtists);

  assert.deepEqual(
    ids(result),
    ids(projectConvertedFilter(convertedFilterItems, selection.all)),
  );
  assert.notStrictEqual(result, convertedFilterItems);
});

test("Album → All Albums preserves Converted membership and order", () => {
  const result = projectConvertedFilter(convertedFilterItems, selection.allAlbums);

  assert.deepEqual(
    ids(result),
    ids(projectConvertedFilter(convertedFilterItems, selection.all)),
  );
  assert.notStrictEqual(result, convertedFilterItems);
});

test("a specific Artist restricts membership across multiple albums", () => {
  assert.deepEqual(
    ids(projectConvertedFilter(convertedFilterItems, selection.artist("Lead Artist"))),
    ["queue-shared-lead", "queue-alpha-other"],
  );
});

test("collaborator membership uses explicit credits instead of display-string parsing", () => {
  assert.deepEqual(
    ids(projectConvertedFilter(convertedFilterItems, selection.artist("Alpha Collaborator"))),
    ["queue-shared-lead", "queue-alpha-other"],
  );
});

test("a specific Album restricts membership to the selected album", () => {
  assert.deepEqual(
    ids(projectConvertedFilter(convertedFilterItems, selection.album("Shared Album"))),
    ["queue-shared-lead", "queue-shared-other"],
  );
});

test("an Album can include entries with different displayed Artist values", () => {
  const sharedAlbum = projectConvertedFilter(convertedFilterItems, selection.album("Shared Album"));
  assert.deepEqual(sharedAlbum.map((item) => item.creator), ["Lead Artist", "Other Artist"]);
});

test("unrelated Converted entries are excluded from specific Artist and Album projections", () => {
  assert.deepEqual(ids(projectConvertedFilter(convertedFilterItems, selection.artist("Missing Artist"))), []);
  assert.deepEqual(ids(projectConvertedFilter(convertedFilterItems, selection.album("Missing Album"))), []);
});

test("non-Converted entries are outside the Converted projection", () => {
  assert.equal(ids(projectConvertedFilter(convertedFilterItems, selection.all)).includes("queue-not-converted"), false);
});

test("filtered entries retain source ordering", () => {
  assert.deepEqual(
    ids(projectConvertedFilter(convertedFilterItems, selection.artist("Alpha Collaborator"))),
    ["queue-shared-lead", "queue-alpha-other"],
  );
  assert.deepEqual(
    ids(projectConvertedFilter(convertedFilterItems, selection.album("Shared Album"))),
    ["queue-shared-lead", "queue-shared-other"],
  );
});

test("the input records and nested metadata remain unchanged", () => {
  const before = structuredClone(convertedFilterItems);

  projectConvertedFilter(convertedFilterItems, selection.artist("Alpha Collaborator"));
  projectConvertedFilter(convertedFilterItems, selection.album("Shared Album"));

  assert.deepEqual(convertedFilterItems, before);
});

test("missing metadata remains eligible for inclusive projections but cannot match a specific value", () => {
  assert.deepEqual(
    ids(projectConvertedFilter(convertedFilterItems, selection.all)),
    [
      "queue-shared-lead",
      "queue-shared-other",
      "queue-alpha-other",
      "queue-unrelated",
      "queue-missing-metadata",
    ],
  );
  assert.deepEqual(ids(projectConvertedFilter(convertedFilterItems, selection.artist("Unknown Artist"))), []);
  assert.deepEqual(ids(projectConvertedFilter(convertedFilterItems, selection.album("Unknown Album"))), []);
});

test("nonmatching values produce an empty domain projection without defining UI empty-state behavior", () => {
  assert.deepEqual(ids(projectConvertedFilter(convertedFilterItems, selection.artist("No Such Artist"))), []);
  assert.deepEqual(ids(projectConvertedFilter(convertedFilterItems, selection.album("No Such Album"))), []);
});

test("existing status and Search behavior remains on the unchanged fixture pipeline", () => {
  assert.deepEqual(
    ids(filterQueueItems(fixtureSnapshot.queueItems, { filter: "failed", search: "" })),
    ["queue-blue-hour"],
  );
  assert.deepEqual(
    ids(filterQueueItems(fixtureSnapshot.queueItems, { filter: "all", search: "  MIRA  " })),
    ["queue-aurora", "queue-lantern"],
  );
});
