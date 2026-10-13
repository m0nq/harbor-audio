import type {
  ConversionJob,
  ConversionStatus,
  QueueFilter,
  QueueItem,
  QueueQuery,
  WorkflowSnapshot,
} from "./contracts.js";

export function filterQueueItems(items: QueueItem[], query: QueueQuery): QueueItem[] {
  const search = query.search.trim().toLocaleLowerCase();

  return items.filter((item) => {
    const matchesFilter = query.filter === "all" || item.status === query.filter;
    const haystack = `${item.title} ${item.creator} ${item.collection}`.toLocaleLowerCase();
    return matchesFilter && (!search || haystack.includes(search));
  });
}

export function summarizeQueue(items: QueueItem[]): Record<ConversionStatus | "total", number> {
  const summary: Record<ConversionStatus | "total", number> = {
    total: items.length,
    waiting: 0,
    analyzing: 0,
    converting: 0,
    failed: 0,
    converted: 0,
  };

  for (const item of items) {
    summary[item.status] += 1;
  }

  return summary;
}

export function findJob(snapshot: WorkflowSnapshot, queueItemId: string): ConversionJob | undefined {
  return snapshot.jobs.find((job) => job.queueItemId === queueItemId);
}

export function actionLabel(
  observation: ConversionJob["retry"] | ConversionJob["cancellation"],
): string {
  return observation.state === "unknown" ? "Behavior unknown" : observation.value === "available" ? "Available" : "Not available";
}

export interface QueueRowViewModel {
  title: string;
  creator: string;
  collection: string;
  duration: string;
  statusLabel: string;
  retryLabel: string;
  cancellationLabel: string;
}

export function toQueueRowViewModel(item: QueueItem, job: ConversionJob | undefined): QueueRowViewModel {
  return {
    title: item.title,
    creator: item.creator,
    collection: item.collection,
    duration: item.duration,
    statusLabel: item.status === "converted" ? "Complete" : item.status[0].toUpperCase() + item.status.slice(1),
    retryLabel: job ? actionLabel(job.retry) : "Behavior unknown",
    cancellationLabel: job ? actionLabel(job.cancellation) : "Behavior unknown",
  };
}

export function countVisibleItems(snapshot: WorkflowSnapshot, query: QueueQuery): number {
  return filterQueueItems(snapshot.queueItems, query).length;
}

export const filterLabels: Record<QueueFilter, string> = {
  all: "All",
  waiting: "Waiting",
  analyzing: "Analyzing",
  converting: "Converting",
  failed: "Failed",
  converted: "Converted",
};
