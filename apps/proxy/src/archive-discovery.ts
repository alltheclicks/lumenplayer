import type { CatchUpGatewayChannelCapabilityRecord } from "./catchup-gateway-contracts.js";

const buildKey = (serverId: string, channelId: string): string => `${serverId}:${channelId}`;

export class ArchiveDiscovery {
  private readonly capabilityByKey = new Map<string, CatchUpGatewayChannelCapabilityRecord>();

  upsert(
    serverId: string,
    capability: CatchUpGatewayChannelCapabilityRecord,
  ): CatchUpGatewayChannelCapabilityRecord {
    const key = buildKey(serverId, capability.channelId);
    this.capabilityByKey.set(key, capability);
    return capability;
  }

  get(serverId: string, channelId: string): CatchUpGatewayChannelCapabilityRecord | null {
    return this.capabilityByKey.get(buildKey(serverId, channelId)) ?? null;
  }
}
