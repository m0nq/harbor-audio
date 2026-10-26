import type { ConvertedFilterItem } from "./contracts.js";

export type ConvertedSortColumn = "title" | "artist" | "album" | "duration";
export type ConvertedSortDirection = "ascending" | "descending";

export interface ConvertedSortState {
  column: ConvertedSortColumn;
  direction: ConvertedSortDirection;
}

const textCollator = new Intl.Collator("en-US", { sensitivity: "base", numeric: false });

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareConvertedText(left: string, right: string): number {
  return textCollator.compare(left, right) || compareCodeUnits(left, right);
}

/** Parse the fixture's supported MM:SS and H:MM:SS duration formats. */
export function parseDurationSeconds(value: string): number | undefined {
  const minuteSecond = /^(\d+):([0-5]\d)$/.exec(value);
  if (minuteSecond) return Number(minuteSecond[1]) * 60 + Number(minuteSecond[2]);

  const hourMinuteSecond = /^(\d+):([0-5]\d):([0-5]\d)$/.exec(value);
  if (hourMinuteSecond) {
    return Number(hourMinuteSecond[1]) * 3600
      + Number(hourMinuteSecond[2]) * 60
      + Number(hourMinuteSecond[3]);
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
