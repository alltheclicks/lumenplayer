import { describe, expect, it, vi } from "vitest";
import { switchToLiveMode } from "./switchToLiveMode";

describe("switchToLiveMode", () => {
  it("stops current source context before navigating to live player route", () => {
    const calls: string[] = [];
    const commands = {
      stop: () => {
        calls.push("stop");
      },
    };
    const navigate = vi.fn(() => {
      calls.push("navigate");
    });

    switchToLiveMode(commands, navigate);

    expect(calls).toEqual(["stop", "navigate"]);
    expect(navigate).toHaveBeenCalledWith("/player", undefined);
  });
});
