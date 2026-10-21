import { describe, expect, it } from "vitest";
import { backDestination, initialPlaybackState, reducePlaybackState } from "../focus/shell-state";
import { getMessages, isLocale } from "../i18n/messages";

describe("remote shell state", () => {
  it("returns from settings and playback to home; Back exits only from home", () => {
    expect(backDestination("settings")).toBe("home");
    expect(backDestination("playback")).toBe("home");
    expect(backDestination("home")).toBeNull();
  });

  it("returns settings to playback when opened from playback", () => {
    expect(backDestination("settings", "playback")).toBe("playback");
    expect(backDestination("settings", "home")).toBe("home");
    expect(backDestination("playback", "playback")).toBe("home");
  });

  it("shows loading, connected playback, and actionable failures", () => {
    const loading = reducePlaybackState(initialPlaybackState, { type: "start" });
    expect(loading.status).toBe("loading");

    const playing = reducePlaybackState(loading, {
      type: "stateChanged",
      state: "playing",
    });
    expect(playing.status).toBe("playing");

    const error = reducePlaybackState(loading, {
      type: "failed",
      error: { code: "MEDIA_ADAPTER_NOT_AVAILABLE", message: "No Media3", fatal: true },
    });
    expect(error.status).toBe("error");
    expect(error.error?.code).toBe("MEDIA_ADAPTER_NOT_AVAILABLE");
  });
});

describe("device language", () => {
  it("defaults unknown or missing values to English and uses native labels", () => {
    expect(isLocale("sr-Cyrl")).toBe(true);
    expect(isLocale("ar")).toBe(false);
    expect(getMessages(undefined).appName).toBe("Klaro Player");
    expect(getMessages("not-a-locale").openPlayback).toBe("Open playback test");
    expect(getMessages("sr-Cyrl").settings).toBe("Подешавања");
  });
});
