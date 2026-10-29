import type { ConversionStatus } from "./contracts.js";
import { nextConversionStatus } from "./conversion-status.js";

export interface LifecycleDemoRecord {
  readonly id: string;
  readonly title: string;
  readonly creator: string;
  readonly collection: string;
  readonly duration: string;
}

export interface LifecycleDemoState {
  readonly record: LifecycleDemoRecord;
  readonly status: ConversionStatus;
}

export const lifecycleDemoRecord: LifecycleDemoRecord = Object.freeze({
  id: "lifecycle-demo-track",
  title: "Lifecycle Demo Track",
  creator: "Fixture Artist",
  collection: "Workflow Demo",
  duration: "3:42",
});

export function createLifecycleDemoState(): LifecycleDemoState {
  return {
    record: lifecycleDemoRecord,
    status: "waiting",
  };
}

export function advanceLifecycleDemo(state: LifecycleDemoState): LifecycleDemoState {
  const nextStatus = nextConversionStatus(state.status);
  if (!nextStatus) return state;

  return {
    ...state,
    status: nextStatus,
  };
}
