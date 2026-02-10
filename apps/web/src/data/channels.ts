// Re-export shim: types from @lumen/types, data from @lumen/demo-data, utils from @lumen/core
export type { Channel, Program } from "@lumen/types";
export { channels } from "@lumen/demo-data";
export { getCurrentProgram, getProgramProgress, formatTime, formatDate } from "@lumen/core";
