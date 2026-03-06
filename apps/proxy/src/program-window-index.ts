import type { CatchUpGatewayProgramWindowRecord } from "./catchup-gateway-contracts.js";

const buildKey = (serverId: string, channelId: string, programId: string): string => (
  `${serverId}:${channelId}:${programId}`
);

export class ProgramWindowIndex {
  private readonly programWindowByKey = new Map<string, CatchUpGatewayProgramWindowRecord>();

  upsert(
    serverId: string,
    record: CatchUpGatewayProgramWindowRecord,
  ): CatchUpGatewayProgramWindowRecord {
    this.programWindowByKey.set(buildKey(serverId, record.channelId, record.programId), record);
    return record;
  }

  get(
    serverId: string,
    channelId: string,
    programId: string,
  ): CatchUpGatewayProgramWindowRecord | null {
    return this.programWindowByKey.get(buildKey(serverId, channelId, programId)) ?? null;
  }
}
