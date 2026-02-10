import type { Channel, Program } from "@lumen/types";

export const getCurrentProgram = (channel: Channel): Program | undefined => {
  const now = new Date();
  return channel.epg.find((p) => p.startTime <= now && p.endTime > now);
};

export const getProgramProgress = (program: Program): number => {
  const now = new Date();
  const total = program.endTime.getTime() - program.startTime.getTime();
  const elapsed = now.getTime() - program.startTime.getTime();
  return Math.min(100, Math.max(0, (elapsed / total) * 100));
};
