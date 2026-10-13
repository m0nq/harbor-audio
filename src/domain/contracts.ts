export type Confidence = "high" | "medium" | "low";
export type EvidenceSource = "reference-ui" | "reference-static" | "fixture" | "implementation-policy" | "runtime-smoke";

export interface EvidenceRef {
  id: string;
  captureBaseline: string;
  confidence: Confidence;
  unresolvedBehavior: string[];
  source: EvidenceSource;
}

export interface Observed<T> {
  state: "observed";
  value: T;
  evidence: EvidenceRef[];
}

export interface Declared<T> {
  state: "declared";
  value: T;
  evidence: EvidenceRef[];
}

export interface Unknown {
  state: "unknown";
  reason: string;
  evidence: EvidenceRef[];
}

export type Observation<T> = Observed<T> | Unknown;

export type SourceKind = "playlist" | "library";

export interface SourceItem {
  id: string;
  title: string;
  creator: string;
  collection: string;
  duration: string;
  kind: SourceKind;
  selection: "selected" | "available";
}

export interface QueueItem {
  id: string;
  sourceItemId: string;
  title: string;
  creator: string;
  collection: string;
  duration: string;
  status: ConversionStatus;
}

export type ConversionStatus = "waiting" | "analyzing" | "converting" | "failed" | "converted";

export interface ConversionJob {
  id: string;
  queueItemId: string;
  status: ConversionStatus;
  retry: Observation<"available" | "not-available">;
  cancellation: Observation<"available" | "not-available">;
}

export interface OutputPolicy {
  directory: Observation<"fixture-output">;
  filenameTemplate: Observation<"{creator} - {title}">;
  lyrics: Observation<"optional" | "not-provided">;
}

export interface AuthBoundary {
  mode: Declared<"fixture-only">;
  credentials: Declared<"never-requested">;
  remoteProviders: Declared<"disabled">;
}

export interface WorkflowSnapshot {
  sourceItems: SourceItem[];
  queueItems: QueueItem[];
  jobs: ConversionJob[];
  outputPolicy: OutputPolicy;
  authBoundary: AuthBoundary;
}

export type FixtureView = "browser" | "converting" | "converted";
export type FilterControl = "status-filter" | "search";

export interface FixtureParityState {
  views: Observation<FixtureView[]>;
  /** Fixture-local control capabilities; this is not the reference option vocabulary. */
  filterControls: Observation<FilterControl[]>;
  /** Fixture-local selectable queue options; this is not reference parity evidence. */
  filterOptions: Observation<QueueFilter[]>;
  conversionStates: Observation<ConversionStatus[]>;
  queueInsertion: Unknown;
  retry: Unknown;
  cancellation: Unknown;
}

export type QueueFilter = "all" | ConversionStatus;

export interface QueueQuery {
  filter: QueueFilter;
  search: string;
}
