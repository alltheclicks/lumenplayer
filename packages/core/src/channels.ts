import type { PlayerChannel } from "@lumen/types";

export const filterChannels = (
  channels: PlayerChannel[],
  query: string,
): PlayerChannel[] => {
  if (!query.trim()) return channels;
  const lower = query.toLowerCase();
  return channels.filter((ch) => ch.name.toLowerCase().includes(lower));
};

export const sortChannels = (
  channels: PlayerChannel[],
  by: "number" | "name" = "number",
): PlayerChannel[] => {
  return [...channels].sort((a, b) =>
    by === "name" ? a.name.localeCompare(b.name) : a.number - b.number,
  );
};
