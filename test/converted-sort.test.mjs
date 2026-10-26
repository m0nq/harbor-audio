import assert from "node:assert/strict";
import { test } from "node:test";
import {
  convertedFilterItems,
  convertedViewDemoItems,
} from "./converted-filter-fixture.mjs";
import {
  parseDurationSeconds,
  sortConvertedItems,
} from "../dist/domain/converted-sort.js";

const ids = (items) => items.map((item) => item.id);
const state = (column, direction) => ({ column, direction });

const synthetic = (id, title, creator, collection, duration) => ({
  id,
  sourceItemId: `source-${id}`,
  title,
  creator,
  collection,
  duration,
  status: "converted",
});

test("unsorted Converted items preserve source order without mutating the input", () => {
  const result = sortConvertedItems(convertedViewDemoItems, null);

  assert.deepEqual(ids(result), [
    "queue-shared-lead",
    "queue-shared-other",
    "queue-alpha-other",
    "queue-unrelated",
    "queue-missing-metadata",
  ]);
  assert.notStrictEqual(result, convertedViewDemoItems);
});

test("each sortable column supports ascending and descending order", () => {
  const expected = {
    title: {
      ascending: ["queue-alpha-other", "queue-missing-metadata", "queue-shared-lead", "queue-shared-other", "queue-unrelated"],
      descending: ["queue-unrelated", "queue-shared-other", "queue-shared-lead", "queue-missing-metadata", "queue-alpha-other"],
    },
    artist: {
      ascending: ["queue-missing-metadata", "queue-alpha-other", "queue-shared-lead", "queue-shared-other", "queue-unrelated"],
      descending: ["queue-unrelated", "queue-shared-other", "queue-alpha-other", "queue-shared-lead", "queue-missing-metadata"],
    },
    album: {
      ascending: ["queue-missing-metadata", "queue-alpha-other", "queue-shared-lead", "queue-shared-other", "queue-unrelated"],
      descending: ["queue-unrelated", "queue-shared-lead", "queue-shared-other", "queue-alpha-other", "queue-missing-metadata"],
    },
    duration: {
      ascending: ["queue-missing-metadata", "queue-alpha-other", "queue-shared-lead", "queue-shared-other", "queue-unrelated"],
      descending: ["queue-unrelated", "queue-shared-other", "queue-shared-lead", "queue-alpha-other", "queue-missing-metadata"],
    },
  };

  for (const [column, directions] of Object.entries(expected)) {
    assert.deepEqual(ids(sortConvertedItems(convertedViewDemoItems, state(column, "ascending"))), directions.ascending, `${column} ascending`);
    assert.deepEqual(ids(sortConvertedItems(convertedViewDemoItems, state(column, "descending"))), directions.descending, `${column} descending`);
  }
});

test("secondary values remain ascending and exact ties retain source order", () => {
  const artistTie = [
    synthetic("artist-zulu", "Zulu", "Same Artist", "Album", "01:00"),
    synthetic("artist-alpha", "Alpha", "Same Artist", "Album", "01:00"),
  ];
  assert.deepEqual(ids(sortConvertedItems(artistTie, state("artist", "descending"))), ["artist-alpha", "artist-zulu"]);

  const titleTie = [
    synthetic("title-zulu", "Same Title", "Zulu Artist", "Album", "01:00"),
    synthetic("title-alpha", "Same Title", "Alpha Artist", "Album", "01:00"),
  ];
  assert.deepEqual(ids(sortConvertedItems(titleTie, state("title", "descending"))), ["title-alpha", "title-zulu"]);

  const exactTie = [
    synthetic("exact-first", "Same", "Artist", "Album", "01:00"),
    synthetic("exact-second", "Same", "Artist", "Album", "01:00"),
  ];
  assert.deepEqual(ids(sortConvertedItems(exactTie, state("duration", "descending"))), ["exact-first", "exact-second"]);
});

test("duration parsing is strict and invalid or missing values sort last", () => {
  assert.equal(parseDurationSeconds("03:00"), 180);
  assert.equal(parseDurationSeconds("1:02:03"), 3723);
  assert.equal(parseDurationSeconds("03:60"), undefined);
  assert.equal(parseDurationSeconds("180"), undefined);
  assert.equal(parseDurationSeconds(""), undefined);

  const items = [
    synthetic("invalid", "Invalid", "Artist", "Album", "03:60"),
    synthetic("valid", "Valid", "Artist", "Album", "00:30"),
    synthetic("missing", "Missing", "Artist", "Album", ""),
  ];
  assert.deepEqual(ids(sortConvertedItems(items, state("duration", "ascending"))), ["valid", "invalid", "missing"]);
  assert.deepEqual(ids(sortConvertedItems(items, state("duration", "descending"))), ["valid", "invalid", "missing"]);
});

test("sorting does not mutate canonical Converted records or nested metadata", () => {
  const before = structuredClone(convertedFilterItems);
  sortConvertedItems(convertedFilterItems, state("album", "ascending"));
  sortConvertedItems(convertedFilterItems, state("duration", "descending"));
  assert.deepEqual(convertedFilterItems, before);
});
