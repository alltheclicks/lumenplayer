import { useMemo } from "react";
import type {
  SessionRenderer,
  SessionSource,
  SessionStore,
} from "@lumen/session-core";

export interface SessionCommands {
  setSource: (source: SessionSource, positionMs?: number) => void;
  play: () => void;
  pause: () => void;
  seek: (positionMs: number) => void;
  switchRenderer: (renderer: SessionRenderer) => void;
  stop: () => void;
}

export const useSessionCommands = (store: SessionStore): SessionCommands => {
  return useMemo(
    () => ({
      setSource: (source: SessionSource, positionMs?: number) => {
        store.dispatch({ type: "setSource", source, positionMs });
      },
      play: () => {
        store.dispatch({ type: "play" });
      },
      pause: () => {
        store.dispatch({ type: "pause" });
      },
      seek: (positionMs: number) => {
        store.dispatch({ type: "seek", positionMs });
      },
      switchRenderer: (renderer: SessionRenderer) => {
        store.dispatch({ type: "switchRenderer", renderer });
      },
      stop: () => {
        store.dispatch({ type: "stop" });
      },
    }),
    [store]
  );
};

export default useSessionCommands;
