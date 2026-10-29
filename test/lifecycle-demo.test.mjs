import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advanceLifecycleDemo,
  createLifecycleDemoState,
  lifecycleDemoRecord,
} from "../dist/domain/lifecycle-demo.js";

test("lifecycle demo advances one deterministic step at a time", () => {
  let state = createLifecycleDemoState();
  const statuses = [state.status];

  for (let index = 0; index < 3; index += 1) {
    state = advanceLifecycleDemo(state);
    statuses.push(state.status);
  }

  assert.deepEqual(statuses, ["waiting", "analyzing", "converting", "converted"]);
  assert.equal(state.record, lifecycleDemoRecord);
});

test("lifecycle demo treats converted and failed as terminal states", () => {
  const converted = { ...createLifecycleDemoState(), status: "converted" };
  const failed = { ...createLifecycleDemoState(), status: "failed" };

  assert.strictEqual(advanceLifecycleDemo(converted), converted);
  assert.strictEqual(advanceLifecycleDemo(failed), failed);
});

test("lifecycle demo transitions do not mutate state or the immutable record", () => {
  const state = createLifecycleDemoState();
  const before = structuredClone(state);

  assert.ok(Object.isFrozen(lifecycleDemoRecord));
  const next = advanceLifecycleDemo(state);

  assert.deepEqual(state, before);
  assert.equal(next.record, state.record);
  assert.equal(next.status, "analyzing");
});
