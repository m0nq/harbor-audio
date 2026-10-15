import type { ConvertedFilterItem, ConvertedFilterSelection } from "./contracts.js";

/**
 * Projects only Converted items using the bounded reference-aligned
 * dimension/value model. Search, status queries, and renderer state remain
 * outside this pure fixture-local capability.
 */
export function projectConvertedFilter(
  items: readonly ConvertedFilterItem[],
  selection: ConvertedFilterSelection,
): ConvertedFilterItem[] {
  const convertedItems = items.filter((item) => item.status === "converted");

  if (selection.dimension === "all" || typeof selection.value === "string") {
    return convertedItems;
  }

  const specificKey = selection.value.key;

  return convertedItems.filter((item) => {
    const metadata = item.referenceMetadata;

    if (!metadata) {
      return false;
    }

    if (selection.dimension === "artist") {
      return metadata.artistCredits?.includes(specificKey) ?? false;
    }

    return metadata.album === specificKey;
  });
}
