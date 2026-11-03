import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advanceSessionQueueItem,
  createSessionQueueState,
  insertSessionQueueItem,
  projectActiveSessionQueueItems,
  projectCompletedSessionItems,
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

function advance(state, sessionQueueItemId) {
  return advanceSessionQueueItem({ state, sessionQueueItemId });
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

test("advances one session item through the shared lifecycle one step at a time", () => {
  const added = insert(createSessionQueueState(), "source-aurora");
  assert.equal(added.kind, "added");

  let state = added.state;
  const statuses = [state.items[0].status];
  for (const expectedStatus of ["analyzing", "converting", "converted"]) {
    const result = advance(state, state.items[0].id);
    assert.equal(result.kind, "advanced");
    state = result.state;
    statuses.push(result.item.status);
    assert.equal(result.item.status, expectedStatus);
  }

  assert.deepEqual(statuses, ["waiting", "analyzing", "converting", "converted"]);
  assert.equal(state.nextInsertionOrdinal, 2);
});

test("unknown IDs and terminal statuses return without mutation", () => {
  const added = insert(createSessionQueueState(), "source-aurora");
  assert.equal(added.kind, "added");

  const unknown = advance(added.state, "session-queue:missing:1");
  assert.equal(unknown.kind, "unknown-id");
  assert.strictEqual(unknown.state, added.state);

  let convertedState = added.state;
  for (let index = 0; index < 3; index += 1) {
    const result = advance(convertedState, convertedState.items[0].id);
    assert.equal(result.kind, "advanced");
    convertedState = result.state;
  }

  const converted = advance(convertedState, convertedState.items[0].id);
  assert.equal(converted.kind, "terminal");
  assert.strictEqual(converted.state, convertedState);
  assert.strictEqual(converted.item, convertedState.items[0]);

  const failedState = Object.freeze({
    items: Object.freeze([Object.freeze({ ...convertedState.items[0], status: "failed" })]),
    nextInsertionOrdinal: convertedState.nextInsertionOrdinal,
  });
  const failed = advance(failedState, failedState.items[0].id);
  assert.equal(failed.kind, "terminal");
  assert.strictEqual(failed.state, failedState);
  assert.strictEqual(failed.item, failedState.items[0]);
});

test("advancement changes only the target and preserves identity, metadata, order, and ordinal", () => {
  let state = createSessionQueueState();
  const first = insert(state, "source-aurora");
  assert.equal(first.kind, "added");
  state = first.state;
  const second = insert(state, "source-blue-hour");
  assert.equal(second.kind, "added");
  state = second.state;

  const beforeItems = [...state.items];
  const beforeTarget = beforeItems[1];
  const result = advance(state, beforeTarget.id);

  assert.equal(result.kind, "advanced");
  assert.notStrictEqual(result.state, state);
  assert.strictEqual(result.state.items[0], beforeItems[0]);
  assert.notStrictEqual(result.state.items[1], beforeTarget);
  assert.equal(result.item.id, beforeTarget.id);
  assert.equal(result.item.sourceItemId, beforeTarget.sourceItemId);
  assert.equal(result.item.title, beforeTarget.title);
  assert.equal(result.item.creator, beforeTarget.creator);
  assert.equal(result.item.collection, beforeTarget.collection);
  assert.equal(result.item.duration, beforeTarget.duration);
  assert.deepEqual(result.state.items.map((item) => item.id), beforeItems.map((item) => item.id));
  assert.equal(result.state.nextInsertionOrdinal, state.nextInsertionOrdinal);
  assert.deepEqual(state.items, beforeItems);
});

test("duplicate prevention remains stable after a session item reaches Converted", () => {
  const added = insert(createSessionQueueState(), "source-aurora");
  assert.equal(added.kind, "added");

  let state = added.state;
  for (let index = 0; index < 3; index += 1) {
    const result = advance(state, state.items[0].id);
    assert.equal(result.kind, "advanced");
    state = result.state;
  }

  const duplicate = insert(state, "source-aurora");
  assert.equal(duplicate.kind, "already-present");
  assert.strictEqual(duplicate.state, state);
  assert.strictEqual(duplicate.item, state.items[0]);
  assert.equal(state.items[0].status, "converted");
  assert.equal(state.nextInsertionOrdinal, 2);
});

test("projects active and completed session records from authoritative state in insertion order", () => {
  let state = createSessionQueueState();
  const first = insert(state, "source-aurora");
  assert.equal(first.kind, "added");
  state = first.state;
  const second = insert(state, "source-blue-hour");
  assert.equal(second.kind, "added");
  state = second.state;

  for (let index = 0; index < 3; index += 1) {
    const result = advance(state, second.item.id);
    assert.equal(result.kind, "advanced");
    state = result.state;
  }

  assert.deepEqual(projectActiveSessionQueueItems(state).map((item) => item.id), [first.item.id]);
  assert.deepEqual(projectCompletedSessionItems(state).map((item) => item.id), [second.item.id]);
  assert.equal(projectCompletedSessionItems(state)[0].sourceItemId, "source-blue-hour");

  for (let index = 0; index < 3; index += 1) {
    const result = advance(state, first.item.id);
    assert.equal(result.kind, "advanced");
    state = result.state;
  }

  assert.deepEqual(projectActiveSessionQueueItems(state), []);
  assert.deepEqual(projectCompletedSessionItems(state).map((item) => item.id), [first.item.id, second.item.id]);
  assert.deepEqual(state.items.map((item) => item.status), ["converted", "converted"]);
  assert.ok(Object.isFrozen(projectActiveSessionQueueItems(state)));
  assert.ok(Object.isFrozen(projectCompletedSessionItems(state)));
});
