import { useCallback, useSyncExternalStore } from "react";
import type { SessionState, SessionStore } from "@lumen/session-core";

export const useSession = (store: SessionStore): SessionState => {
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(() => listener()),
    [store]
  );
  const getSnapshot = useCallback(() => store.getState(), [store]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};
