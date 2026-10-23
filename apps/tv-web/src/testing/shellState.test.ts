import assert from "node:assert/strict";
import { test } from "vitest";
import { createShellController, createInitialState, reduceShellState } from "./shellState.mjs";
import { createPlaybackController } from "../composition/playback";

test("English is the default and Back returns from settings", () => {
  let state = createInitialState();
  assert.equal(state.language, "en");
  state = reduceShellState(state, { type: "OPEN_SETTINGS" });
  assert.equal(state.screen, "settings");
  state = reduceShellState(state, { type: "BACK" });
  assert.equal(state.screen, "home");
});

test("language selection is saved to per-device storage", () => {
  const values = new Map();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  const controller = createShellController({ storage, createPlaybackController });
  controller.setLanguage("sr");
  assert.equal(values.get("@lumen/tv-web/language"), "sr");
  assert.equal(createShellController({ storage, createPlaybackController }).getState().language, "sr");
});

test("OK action exposes loading then a deterministic adapter error", async () => {
  const states: import("./shellState.mjs").ShellState[] = [];
  const controller = createShellController({ createPlaybackController });
  controller.subscribe((state) => states.push(state));
  await controller.startTest("https://example.invalid/live.m3u8");
  assert.deepEqual(states.map((state) => state.playback), ["loading", "error"]);
  assert.match(controller.getState().error, /unsupported/);
  assert.equal(controller.getState().screen, "playback");
});

test("Back from the playback test returns to launch", async () => {
  const controller = createShellController({ createPlaybackController });
  await controller.startTest("https://example.invalid/live.m3u8");
  controller.back();
  assert.equal(controller.getState().screen, "home");
  assert.equal(controller.getState().playback, "idle");
});
