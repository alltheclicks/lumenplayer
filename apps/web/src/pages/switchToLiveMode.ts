import { useCallback } from "react";
import { useNavigate, type NavigateFunction, type NavigateOptions } from "react-router-dom";
import type { SessionCommands } from "../hooks/useSessionCommands";
import { useSessionContext } from "../context/session-context";

type LiveModeCommands = Pick<SessionCommands, "stop">;

export const switchToLiveMode = (
  commands: LiveModeCommands,
  navigate: NavigateFunction,
  options?: NavigateOptions,
): void => {
  commands.stop();
  navigate("/player", options);
};

export const useSwitchToLiveMode = () => {
  const navigate = useNavigate();
  const { commands } = useSessionContext();

  return useCallback(
    (options?: NavigateOptions) => {
      switchToLiveMode(commands, navigate, options);
    },
    [commands, navigate],
  );
};
