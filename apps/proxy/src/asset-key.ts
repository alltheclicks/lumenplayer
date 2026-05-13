export const buildCatchUpAssetKey = ({
  serverId,
  channelId,
  programStart,
  programEnd,
  sourceSignature,
}: {
  serverId: string;
  channelId: string;
  programStart: number;
  programEnd: number;
  sourceSignature: string;
}): string => (
  `${serverId}:${channelId}:${programStart}:${programEnd}:${sourceSignature}`
);
