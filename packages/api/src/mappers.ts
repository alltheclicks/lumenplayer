import type {
  XtreamCategory,
  XtreamLiveStream,
  Channel,
  PlayerChannel,
  PlayerCategory,
  Program,
} from "@lumen/types";

export const mapXtreamCategory = (
  category: XtreamCategory,
): PlayerCategory => ({
  id: category.category_id,
  name: category.category_name,
});

export const mapXtreamChannel = (
  stream: XtreamLiveStream,
  index: number,
  categories: XtreamCategory[],
  epgGenerator?: (channelId: string, hasCatchUp: boolean) => Program[],
): PlayerChannel => {
  const category = categories.find(
    (c) => c.category_id === stream.category_id,
  );
  const hasCatchUp = Number(stream.tv_archive) === 1;
  const catchUpDays = Number(stream.tv_archive_duration);

  return {
    id: String(stream.stream_id),
    streamId: stream.stream_id,
    source: "xtream",
    number: index + 1,
    name: stream.name,
    logo: stream.stream_icon || "\u{1F4FA}",
    categoryId: stream.category_id,
    categoryName: category?.category_name || "Uncategorized",
    hasCatchUp,
    catchUpDays: Number.isFinite(catchUpDays) && catchUpDays > 0 ? catchUpDays : 0,
    epgChannelId: stream.epg_channel_id,
    epg: epgGenerator
      ? epgGenerator(String(stream.stream_id), hasCatchUp)
      : [],
  };
};

const slugifyCategory = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "uncategorized";

export const mapM3UChannel = (
  channel: Channel,
  index: number,
): PlayerChannel => {
  const categoryName = channel.category || "Uncategorized";
  return {
    id: `m3u:${channel.id || index + 1}`,
    streamId: -(index + 1),
    source: "m3u",
    streamUrl: channel.streamUrl,
    number: channel.number || index + 1,
    name: channel.name,
    logo: channel.logo || "TV",
    categoryId: `m3u-category:${slugifyCategory(categoryName)}`,
    categoryName,
    hasCatchUp: channel.hasCatchUp,
    catchUpDays: channel.hasCatchUp ? 7 : 0,
    epgChannelId: null,
    epg: channel.epg,
  };
};
