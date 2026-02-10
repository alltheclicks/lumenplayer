import type {
  XtreamCategory,
  XtreamLiveStream,
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
  const hasCatchUp = stream.tv_archive === 1;

  return {
    id: String(stream.stream_id),
    streamId: stream.stream_id,
    number: index + 1,
    name: stream.name,
    logo: stream.stream_icon || "\u{1F4FA}",
    categoryId: stream.category_id,
    categoryName: category?.category_name || "Uncategorized",
    hasCatchUp,
    catchUpDays: stream.tv_archive_duration || 0,
    epgChannelId: stream.epg_channel_id,
    epg: epgGenerator
      ? epgGenerator(String(stream.stream_id), hasCatchUp)
      : [],
  };
};
