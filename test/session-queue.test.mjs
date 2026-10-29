import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSessionQueueState,
  insertSessionQueueItem,
  resetSessionQueue,
} from "../dist/domain/session-queue.js";
import { lifecycleDemoRecord } from "../dist/domain/lifecycle-demo.js";
import { fixtureSnapshot } from "../dist/fixtures/workflow-fixtures.js";

function insert(state, sourceItemId, snapshot = fixtureSnapshot) {
  return insertSessionQueueItem({
    state,
    sourceItems: snapshot.sourceItems,
    canonicalQueueItems: snapshot.queueItems,
    sourceItemId,
  });
}

test("adds one existing source as an immutable waiting queue record", () => {
  const state = createSessionQueueState();
  const result = insert(state, "source-aurora");

  assert.equal(result.kind, "added");
  assert.deepEqual(result.item, {
    id: "session-queue:source-aurora:1",
    sourceItemId: "source-aurora",
    title: "Aurora Lines",
    creator: "Mira Vale",
    collection: "Night Transit",
    duration: "03:42",
    status: "waiting",
  });
  assert.equal(result.state.items.length, 1);
  assert.ok(Object.isFrozen(result.state));
  assert.ok(Object.isFrozen(result.state.items));
  assert.ok(Object.isFrozen(result.item));
});

test("preserves the source association and generates a stable session identity", () => {
  const first = insert(createSessionQueueState(), "source-lantern");
  const second = insert(createSessionQueueState(), "source-lantern");

  assert.equal(first.kind, "added");
  assert.equal(first.item.sourceItemId, "source-lantern");
  assert.equal(first.item.id, "session-queue:source-lantern:1");
  assert.equal(first.item.id, second.item.id);
  assert.notEqual(first.item.id, "queue-lantern");
});

test("allows a session addition for a source already present in the canonical queue", () => {
  const result = insert(createSessionQueueState(), "source-aurora");

  assert.equal(result.kind, "added");
  assert.equal(result.state.items[0].sourceItemId, "source-aurora");
  assert.equal(result.state.items[0].status, "waiting");
});

test("prevents a duplicate session addition without changing membership or order", () => {
  const first = insert(createSessionQueueState(), "source-aurora");
  const duplicate = insert(first.state, "source-aurora");

  assert.equal(duplicate.kind, "already-present");
  assert.strictEqual(duplicate.state, first.state);
  assert.strictEqual(duplicate.item, first.item);
  assert.deepEqual(duplicate.state.items.map((item) => item.sourceItemId), ["source-aurora"]);
});

test("rejects an invalid source without changing membership or order", () => {
  const state = createSessionQueueState();
  const result = insert(state, "source-missing");

  assert.equal(result.kind, "invalid-source");
  assert.strictEqual(result.state, state);
  assert.deepEqual(result.state.items, []);
});

test("appends distinct source additions in activation order", () => {
  let state = createSessionQueueState();
  const first = insert(state, "source-blue-hour");
  assert.equal(first.kind, "added");
  state = first.state;
  const second = insert(state, "source-lantern");

  assert.equal(second.kind, "added");
  assert.deepEqual(second.state.items.map((item) => item.sourceItemId), [
    "source-blue-hour",
    "source-lantern",
  ]);
  assert.deepEqual(second.state.items.map((item) => item.id), [
    "session-queue:source-blue-hour:1",
    "session-queue:source-lantern:2",
  ]);
});

test("does not mutate source items, canonical queue items, or the prior state", () => {
  const sourceItemsBefore = structuredClone(fixtureSnapshot.sourceItems);
  const canonicalQueueBefore = structuredClone(fixtureSnapshot.queueItems);
  const state = createSessionQueueState();
  const stateBefore = structuredClone(state);
  const result = insert(state, "source-aurora");

  assert.equal(result.kind, "added");
  assert.deepEqual(fixtureSnapshot.sourceItems, sourceItemsBefore);
  assert.deepEqual(fixtureSnapshot.queueItems, canonicalQueueBefore);
  assert.deepEqual(state, stateBefore);
  assert.deepEqual(result.state.items, [result.item]);
});

test("resets session membership without touching canonical or lifecycle fixtures", () => {
  const added = insert(createSessionQueueState(), "source-aurora");
  assert.equal(added.kind, "added");

  const reset = resetSessionQueue();
  assert.deepEqual(reset.items, []);
  assert.ok(Object.isFrozen(reset));
  assert.notEqual(added.item.id, lifecycleDemoRecord.id);
  assert.deepEqual(fixtureSnapshot.queueItems.map((item) => item.id), [
    "queue-aurora",
    "queue-blue-hour",
    "queue-lantern",
  ]);
});
