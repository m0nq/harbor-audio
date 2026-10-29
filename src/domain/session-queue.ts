import type { QueueItem, SourceItem } from "./contracts.js";
import { nextConversionStatus } from "./conversion-status.js";

export type SessionQueueItem = Readonly<QueueItem>;

export interface SessionQueueState {
  readonly items: readonly SessionQueueItem[];
  readonly nextInsertionOrdinal: number;
}

export type SessionQueueInsertionResult =
  | {
      readonly kind: "added";
      readonly item: SessionQueueItem;
      readonly state: SessionQueueState;
    }
  | {
      readonly kind: "already-present";
      readonly item: SessionQueueItem;
      readonly state: SessionQueueState;
    }
  | {
      readonly kind: "invalid-source";
      readonly sourceItemId: string;
      readonly state: SessionQueueState;
    };

export interface InsertSessionQueueItemInput {
  readonly state: SessionQueueState;
  readonly sourceItems: readonly SourceItem[];
  readonly canonicalQueueItems: readonly QueueItem[];
  readonly sourceItemId: string;
}

export interface AdvanceSessionQueueItemInput {
  readonly state: SessionQueueState;
  readonly sessionQueueItemId: string;
}

export type SessionQueueAdvanceResult =
  | {
      readonly kind: "advanced";
      readonly item: SessionQueueItem;
      readonly state: SessionQueueState;
    }
  | {
      readonly kind: "unknown-id";
      readonly sessionQueueItemId: string;
      readonly state: SessionQueueState;
    }
  | {
      readonly kind: "terminal";
      readonly item: SessionQueueItem;
      readonly state: SessionQueueState;
    };

function createState(items: readonly SessionQueueItem[], nextInsertionOrdinal: number): SessionQueueState {
  return Object.freeze({
    items: Object.freeze([...items]),
    nextInsertionOrdinal,
  });
}

export function createSessionQueueState(): SessionQueueState {
  return createState([], 1);
}

export function resetSessionQueue(): SessionQueueState {
  return createSessionQueueState();
}

export function insertSessionQueueItem(
  input: InsertSessionQueueItemInput,
): SessionQueueInsertionResult {
  const { state, sourceItems, canonicalQueueItems, sourceItemId } = input;
  const sourceItem = sourceItems.find((item) => item.id === sourceItemId);

  if (!sourceItem) {
    return { kind: "invalid-source", sourceItemId, state };
  }

  const existingItem = state.items.find((item) => item.sourceItemId === sourceItemId);
  if (existingItem) {
    return { kind: "already-present", item: existingItem, state };
  }

  const occupiedIds = new Set([
    ...canonicalQueueItems.map((item) => item.id),
    ...state.items.map((item) => item.id),
  ]);
  let ordinal = state.nextInsertionOrdinal;
  let id = sessionQueueId(sourceItemId, ordinal);
  while (occupiedIds.has(id)) {
    ordinal += 1;
    id = sessionQueueId(sourceItemId, ordinal);
  }

  const item = Object.freeze({
    id,
    sourceItemId: sourceItem.id,
    title: sourceItem.title,
    creator: sourceItem.creator,
    collection: sourceItem.collection,
    duration: sourceItem.duration,
    status: "waiting" as const,
  });

  return {
    kind: "added",
    item,
    state: createState([...state.items, item], ordinal + 1),
  };
}

export function advanceSessionQueueItem(
  input: AdvanceSessionQueueItemInput,
): SessionQueueAdvanceResult {
  const { state, sessionQueueItemId } = input;
  const itemIndex = state.items.findIndex((item) => item.id === sessionQueueItemId);

  if (itemIndex < 0) {
    return { kind: "unknown-id", sessionQueueItemId, state };
  }

  const item = state.items[itemIndex];
  const nextStatus = nextConversionStatus(item.status);
  if (!nextStatus) {
    return { kind: "terminal", item, state };
  }

  const nextItem = Object.freeze({ ...item, status: nextStatus });
  const nextItems = [...state.items];
  nextItems[itemIndex] = nextItem;

  return {
    kind: "advanced",
    item: nextItem,
    state: createState(nextItems, state.nextInsertionOrdinal),
  };
}

function sessionQueueId(sourceItemId: string, ordinal: number): string {
  return `session-queue:${sourceItemId}:${ordinal}`;
}
