import { createContext, useContext } from "react";
import type { SessionState, SessionStore } from "@lumen/session-core";
import type { SessionCommands } from "@/hooks/useSessionCommands";

export interface SessionContextValue {
  store: SessionStore;
  session: SessionState;
  commands: SessionCommands;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

export const useSessionContext = (): SessionContextValue => {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSessionContext must be used within SessionProvider");
  }
  return context;
};
