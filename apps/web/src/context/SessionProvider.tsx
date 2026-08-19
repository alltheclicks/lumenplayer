import {
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { SessionStore } from "@lumen/session-core";
import { useSessionCommands } from "@/hooks/useSessionCommands";
import { useSession } from "@/hooks/useSession";
import { SessionContext } from "@/context/session-context";

interface SessionProviderProps {
  children: ReactNode;
}

export const SessionProvider = ({ children }: SessionProviderProps) => {
  const storeRef = useRef<SessionStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = new SessionStore();
  }

  const store = storeRef.current;
  const session = useSession(store);
  const commands = useSessionCommands(store);

  useEffect(() => {
    return () => {
      store.destroy();
    };
  }, [store]);

  const value = useMemo(
    () => ({
      store,
      session,
      commands,
    }),
    [store, session, commands]
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
};
