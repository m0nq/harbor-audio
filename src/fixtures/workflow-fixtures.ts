import type {
  AuthBoundary,
  ConversionJob,
  Declared,
  EvidenceRef,
  FixtureParityState,
  OutputPolicy,
  QueueFilter,
  QueueItem,
  SourceItem,
  WorkflowSnapshot,
} from "../domain/contracts.js";

const baseline = "fixture-baseline-2026-10-12";

export const evidence: Record<string, EvidenceRef> = {
  "EV-UI-001": {
    id: "EV-UI-001",
    captureBaseline: baseline,
    confidence: "high",
    unresolvedBehavior: ["Exact source selection-to-queue gesture is not established."],
    source: "reference-ui",
  },
  "EV-WORKFLOW-001": {
    id: "EV-WORKFLOW-001",
    captureBaseline: baseline,
    confidence: "medium",
    unresolvedBehavior: ["Retry and cancellation affordances were not visible on the captured failed rows."],
    source: "reference-ui",
  },
  "EV-OUTPUT-001": {
    id: "EV-OUTPUT-001",
    captureBaseline: baseline,
    confidence: "medium",
    unresolvedBehavior: ["Output path, filename expansion, and lyrics representation require a controlled local test."],
    source: "reference-static",
  },
  "EV-FIXTURE-001": {
    id: "EV-FIXTURE-001",
    captureBaseline: baseline,
    confidence: "high",
    unresolvedBehavior: [],
    source: "fixture",
  },
  "EV-POLICY-001": {
    id: "EV-POLICY-001",
    captureBaseline: baseline,
    confidence: "high",
    unresolvedBehavior: ["Direct terminal Electron invocation remains environment-limited by SIGABRT; macOS app-layer runtime smoke is separately verified."],
    source: "implementation-policy",
  },
  "EV-RUNTIME-001": {
    id: "EV-RUNTIME-001",
    captureBaseline: baseline,
    confidence: "high",
    unresolvedBehavior: ["Direct terminal Electron invocation exited SIGABRT in this environment."],
    source: "runtime-smoke",
  },
};

const observed = <T>(value: T, evidenceRefs: EvidenceRef[]): { state: "observed"; value: T; evidence: EvidenceRef[] } => ({
  state: "observed",
  value,
  evidence: evidenceRefs,
});

const unknown = (reason: string, evidenceRefs: EvidenceRef[]) => ({
  state: "unknown" as const,
  reason,
  evidence: evidenceRefs,
});

const declared = <T>(value: T, evidenceRefs: EvidenceRef[]): Declared<T> => ({
  state: "declared",
  value,
  evidence: evidenceRefs,
});

export const fixtureSourceItems: SourceItem[] = [
  {
    id: "source-aurora",
    title: "Aurora Lines",
    creator: "Mira Vale",
    collection: "Night Transit",
    duration: "03:42",
    kind: "playlist",
    selection: "selected",
  },
  {
    id: "source-blue-hour",
    title: "Blue Hour",
    creator: "North Window",
    collection: "Night Transit",
    duration: "04:08",
    kind: "playlist",
    selection: "selected",
  },
  {
    id: "source-lantern",
    title: "Lantern Room",
    creator: "Mira Vale",
    collection: "Small Rooms",
    duration: "02:58",
    kind: "library",
    selection: "available",
  },
];

export const fixtureQueueItems: QueueItem[] = [
  {
    id: "queue-aurora",
    sourceItemId: "source-aurora",
    title: "Aurora Lines",
    creator: "Mira Vale",
    collection: "Night Transit",
    duration: "03:42",
    status: "converting",
  },
  {
    id: "queue-blue-hour",
    sourceItemId: "source-blue-hour",
    title: "Blue Hour",
    creator: "North Window",
    collection: "Night Transit",
    duration: "04:08",
    status: "failed",
  },
  {
    id: "queue-lantern",
    sourceItemId: "source-lantern",
    title: "Lantern Room",
    creator: "Mira Vale",
    collection: "Small Rooms",
    duration: "02:58",
    status: "converted",
  },
];

export const fixtureJobs: ConversionJob[] = [
  {
    id: "job-aurora",
    queueItemId: "queue-aurora",
    status: "converting",
    retry: unknown("Retry affordance was not captured for active work.", [evidence["EV-WORKFLOW-001"]]),
    cancellation: unknown("Cancellation affordance was not captured for active work.", [evidence["EV-WORKFLOW-001"]]),
  },
  {
    id: "job-blue-hour",
    queueItemId: "queue-blue-hour",
    status: "failed",
    retry: unknown("The captured failed row did not expose a retry control.", [evidence["EV-WORKFLOW-001"]]),
    cancellation: unknown("A failed row has no confirmed cancellation affordance.", [evidence["EV-WORKFLOW-001"]]),
  },
  {
    id: "job-lantern",
    queueItemId: "queue-lantern",
    status: "converted",
    retry: unknown("History retry behavior was not captured.", [evidence["EV-WORKFLOW-001"]]),
    cancellation: unknown("History cancellation behavior was not captured.", [evidence["EV-WORKFLOW-001"]]),
  },
];

export const fixtureOutputPolicy: OutputPolicy = {
  directory: observed("fixture-output", [evidence["EV-FIXTURE-001"]]),
  filenameTemplate: observed("{creator} - {title}", [evidence["EV-FIXTURE-001"]]),
  lyrics: observed("optional", [evidence["EV-FIXTURE-001"]]),
};

export const fixtureAuthBoundary: AuthBoundary = {
  mode: declared("fixture-only", [evidence["EV-POLICY-001"]]),
  credentials: declared("never-requested", [evidence["EV-POLICY-001"]]),
  remoteProviders: declared("disabled", [evidence["EV-POLICY-001"]]),
};

export const fixtureParityState: FixtureParityState = {
  views: observed(["browser", "converting", "converted"], [evidence["EV-FIXTURE-001"]]),
  filterControls: observed(["status-filter", "search"], [evidence["EV-FIXTURE-001"]]),
  filterOptions: observed<QueueFilter[]>(["all", "waiting", "analyzing", "converting", "failed", "converted"], [evidence["EV-FIXTURE-001"]]),
  conversionStates: observed(["converting", "failed", "converted"], [evidence["EV-FIXTURE-001"]]),
  queueInsertion: unknown("The reference source-selection gesture was not safely confirmed.", [evidence["EV-UI-001"]]),
  retry: unknown("Retry behavior is not established by the captured evidence.", [evidence["EV-WORKFLOW-001"]]),
  cancellation: unknown("Cancellation behavior is not established by the captured evidence.", [evidence["EV-WORKFLOW-001"]]),
};

export const fixtureSnapshot: WorkflowSnapshot = {
  sourceItems: fixtureSourceItems,
  queueItems: fixtureQueueItems,
  jobs: fixtureJobs,
  outputPolicy: fixtureOutputPolicy,
  authBoundary: fixtureAuthBoundary,
};
