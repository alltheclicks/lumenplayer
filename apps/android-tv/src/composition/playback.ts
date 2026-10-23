import { TVPlaybackController, UnavailableTVPlaybackAdapter } from "@lumen/player-core";
import type { TVPlaybackAdapter } from "@lumen/types";

/** A real adapter is opt-in at the native composition boundary; absent bridges stay unavailable. */
export function createPlaybackController(adapter: TVPlaybackAdapter = new UnavailableTVPlaybackAdapter()): TVPlaybackController {
  return new TVPlaybackController(adapter);
}
