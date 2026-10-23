import { TVPlaybackController, UnavailableTVPlaybackAdapter } from "@lumen/player-core";
import type { TVPlaybackAdapter } from "@lumen/types";

/** Replace only the adapter when the platform implementation is ready. */
export function createPlaybackController(adapter: TVPlaybackAdapter = new UnavailableTVPlaybackAdapter()): TVPlaybackController {
  return new TVPlaybackController(adapter);
}
