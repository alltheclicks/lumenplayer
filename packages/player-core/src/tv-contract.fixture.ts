import { TV_CONTRACT_VERSION, type TVCatalogSnapshot } from "@lumen/types";

/** Public-safe fixture: no provider address, account name or credential. */
export const TV_CATALOG_FIXTURE: TVCatalogSnapshot = {
  version: TV_CONTRACT_VERSION,
  source: { id: "fixture-source", kind: "m3u", name: "Example playlist" },
  fetchedAtMs: 1_797_120_000_000,
  categories: [{ id: "news", name: "News" }],
  channels: [
    {
      id: "channel-a",
      streamId: 1,
      source: "m3u",
      number: 1,
      name: "Example News",
      logo: "",
      categoryId: "news",
      categoryName: "News",
      hasCatchUp: true,
      catchUpDays: 2,
      epgChannelId: "example.news",
      epg: [],
    },
  ],
  epg: [
    {
      id: "program-a",
      channelId: "channel-a",
      title: "Example program",
      description: "Credential-free contract fixture",
      category: "News",
      startTimeMs: 1_797_120_000_000,
      endTimeMs: 1_797_123_600_000,
      hasCatchUp: true,
    },
  ],
};
