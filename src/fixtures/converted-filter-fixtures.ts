import type { ConvertedFilterItem, ConvertedFilterMetadata } from "../domain/contracts.js";

interface ConvertedFixtureInput {
  id: string;
  title: string;
  creator: string;
  collection: string;
  status?: ConvertedFilterItem["status"];
  referenceMetadata?: ConvertedFilterMetadata;
}

function convertedItem(input: ConvertedFixtureInput): ConvertedFilterItem {
  const referenceMetadata = input.referenceMetadata
    ? Object.freeze({
      ...input.referenceMetadata,
      ...(input.referenceMetadata.artistCredits
        ? { artistCredits: Object.freeze([...input.referenceMetadata.artistCredits]) }
        : {}),
    })
    : undefined;

  return Object.freeze({
    id: input.id,
    sourceItemId: `source-${input.id}`,
    title: input.title,
    creator: input.creator,
    collection: input.collection,
    duration: "03:00",
    status: input.status ?? "converted",
    ...(referenceMetadata ? { referenceMetadata } : {}),
  });
}

/** Synthetic records shared by the Converted renderer and domain tests. */
export const convertedFilterItems: readonly ConvertedFilterItem[] = Object.freeze([
  convertedItem({
    id: "queue-shared-lead",
    title: "Shared Lead",
    creator: "Lead Artist & Alpha Collaborator",
    collection: "Shared Album",
    referenceMetadata: {
      artistCredits: ["Lead Artist", "Alpha Collaborator", "Alpha Collaborator"],
      album: "Shared Album",
    },
  }),
  convertedItem({
    id: "queue-shared-other",
    title: "Shared Other",
    creator: "Other Artist",
    collection: "Shared Album",
    referenceMetadata: {
      artistCredits: ["Other Artist"],
      album: "Shared Album",
    },
  }),
  convertedItem({
    id: "queue-alpha-other",
    title: "Alpha Other",
    creator: "Lead Artist & Alpha Collaborator",
    collection: "Other Album",
    referenceMetadata: {
      artistCredits: ["Lead Artist", "Alpha Collaborator"],
      album: "Other Album",
    },
  }),
  convertedItem({
    id: "queue-unrelated",
    title: "Unrelated Track",
    creator: "Unrelated Artist",
    collection: "Unrelated Album",
    referenceMetadata: {
      artistCredits: ["Unrelated Artist"],
      album: "Unrelated Album",
    },
  }),
  convertedItem({
    id: "queue-missing-metadata",
    title: "Missing Metadata",
    creator: "—",
    collection: "—",
  }),
  convertedItem({
    id: "queue-not-converted",
    title: "Pending Track",
    creator: "Lead Artist",
    collection: "Shared Album",
    status: "waiting",
    referenceMetadata: {
      artistCredits: ["Lead Artist"],
      album: "Shared Album",
    },
  }),
]);

/** The Converted UI, options, counts, and empty states share this one source. */
export const convertedViewDemoItems: readonly ConvertedFilterItem[] = Object.freeze(
  convertedFilterItems.filter((item) => item.status === "converted"),
);
