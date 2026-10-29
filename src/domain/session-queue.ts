import type { QueueItem, SourceItem } from "./contracts.js";

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

function sessionQueueId(sourceItemId: string, ordinal: number): string {
  return `session-queue:${sourceItemId}:${ordinal}`;
}
