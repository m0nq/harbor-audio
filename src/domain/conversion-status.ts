import type { ConversionStatus } from "./contracts.js";

const nextStatuses: Partial<Record<ConversionStatus, ConversionStatus>> = {
  waiting: "analyzing",
  analyzing: "converting",
  converting: "converted",
};

export function nextConversionStatus(status: ConversionStatus): ConversionStatus | undefined {
  return nextStatuses[status];
}
