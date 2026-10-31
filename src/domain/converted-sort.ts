import type { ConvertedFilterItem } from "./contracts.js";

export type ConvertedSortColumn = "title" | "artist" | "album" | "duration";
export type ConvertedSortDirection = "ascending" | "descending";

export interface ConvertedSortState {
  column: ConvertedSortColumn;
  direction: ConvertedSortDirection;
}

const textCollator = new Intl.Collator("en-US", { sensitivity: "base", numeric: false });
const maxSafeDurationSeconds = BigInt(Number.MAX_SAFE_INTEGER);

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareConvertedText(left: string, right: string): number {
  return textCollator.compare(left, right) || compareCodeUnits(left, right);
}

/** Parse the fixture's supported MM:SS and H:MM:SS duration formats. */
export function parseDurationSeconds(value: string): number | undefined {
  const minuteSecond = /^(\d+):([0-5]\d)$/.exec(value);
  if (minuteSecond) {
    const totalSeconds = BigInt(minuteSecond[1]) * 60n + BigInt(minuteSecond[2]);
    return totalSeconds <= maxSafeDurationSeconds ? Number(totalSeconds) : undefined;
  }

  const hourMinuteSecond = /^(\d+):([0-5]\d):([0-5]\d)$/.exec(value);
  if (hourMinuteSecond) {
    const totalSeconds = BigInt(hourMinuteSecond[1]) * 3600n
      + BigInt(hourMinuteSecond[2]) * 60n
      + BigInt(hourMinuteSecond[3]);
    return totalSeconds <= maxSafeDurationSeconds ? Number(totalSeconds) : undefined;
  }

  return undefined;
}

function primaryText(item: ConvertedFilterItem, column: Exclude<ConvertedSortColumn, "duration">): string {
  if (column === "title") return item.title;
  if (column === "artist") return item.creator;
  return item.collection;
}

function secondaryText(item: ConvertedFilterItem, column: ConvertedSortColumn): string {
  return column === "title" ? item.creator : item.title;
}

function comparePrimary(left: ConvertedFilterItem, right: ConvertedFilterItem, column: ConvertedSortColumn): number {
  if (column === "duration") {
    const leftSeconds = parseDurationSeconds(left.duration);
    const rightSeconds = parseDurationSeconds(right.duration);
    if (leftSeconds === undefined && rightSeconds === undefined) return 0;
    if (leftSeconds === undefined) return 1;
    if (rightSeconds === undefined) return -1;
    return leftSeconds - rightSeconds;
  }

  return compareConvertedText(primaryText(left, column), primaryText(right, column));
}

export function sortConvertedItems(
  items: readonly ConvertedFilterItem[],
  state: ConvertedSortState | null,
): ConvertedFilterItem[] {
  const decorated = items.map((item, index) => ({ item, index }));
  if (!state) return decorated.map(({ item }) => item);

  return decorated
    .sort((left, right) => {
      const primary = comparePrimary(left.item, right.item, state.column);
      if (primary !== 0) {
        if (state.column === "duration"
          && (parseDurationSeconds(left.item.duration) === undefined
            || parseDurationSeconds(right.item.duration) === undefined)) {
          return primary;
        }
        return state.direction === "ascending" ? primary : -primary;
      }

      const secondary = compareConvertedText(
        secondaryText(left.item, state.column),
        secondaryText(right.item, state.column),
      );
      return secondary || left.index - right.index;
    })
    .map(({ item }) => item);
}
