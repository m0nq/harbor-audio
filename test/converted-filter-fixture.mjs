function queueItem({ id, title, creator, collection, status = "converted", referenceMetadata }) {
  return {
    id,
    sourceItemId: `source-${id}`,
    title,
    creator,
    collection,
    duration: "03:00",
    status,
    ...(referenceMetadata === undefined ? {} : { referenceMetadata }),
  };
}

export const convertedFilterItems = [
  queueItem({
    id: "queue-shared-lead",
    title: "Shared Lead",
    creator: "Lead Artist",
    collection: "Shared Album",
    referenceMetadata: {
      artistCredits: ["Lead Artist", "Alpha Collaborator"],
      album: "Shared Album",
    },
  }),
  queueItem({
    id: "queue-shared-other",
    title: "Shared Other",
    creator: "Other Artist",
    collection: "Shared Album",
    referenceMetadata: {
      artistCredits: ["Other Artist"],
      album: "Shared Album",
    },
  }),
  queueItem({
    id: "queue-alpha-other",
    title: "Alpha Other",
    creator: "Lead Artist",
    collection: "Other Album",
    referenceMetadata: {
      artistCredits: ["Lead Artist", "Alpha Collaborator"],
      album: "Other Album",
    },
  }),
  queueItem({
    id: "queue-unrelated",
    title: "Unrelated Track",
    creator: "Unrelated Artist",
    collection: "Unrelated Album",
    referenceMetadata: {
      artistCredits: ["Unrelated Artist"],
      album: "Unrelated Album",
    },
  }),
  queueItem({
    id: "queue-missing-metadata",
    title: "Missing Metadata",
    creator: "Unknown Artist",
    collection: "Unknown Album",
  }),
  queueItem({
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
];
