import assert from "node:assert/strict";
import test from "node:test";
import { createShellController, createInitialState, reduceShellState } from "./shellState.mjs";
import { FixturePlayerAdapter } from "./fixturePlayerAdapter.mjs";

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
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const controller = createShellController({ storage, adapter: new FixturePlayerAdapter() });
  controller.setLanguage("sr");
  assert.equal(values.get("@lumen/tv-web/language"), "sr");
  assert.equal(createShellController({ storage, adapter: new FixturePlayerAdapter() }).getState().language, "sr");
});

test("OK action exposes loading then a deterministic adapter error", async () => {
  const states = [];
  const controller = createShellController({ adapter: new FixturePlayerAdapter() });
  controller.subscribe((state) => states.push(state));
  await controller.startTest();
  assert.deepEqual(states.map((state) => state.playback), ["loading", "error"]);
  assert.match(controller.getState().error, /no media playback/i);
  assert.equal(controller.getState().screen, "playback");
});

test("fixture adapter emits an error and never claims playing", async () => {
  const adapter = new FixturePlayerAdapter();
  const states = [];
  const errors = [];
  adapter.onStateChange((state) => states.push(state));
  adapter.onError((error) => errors.push(error));
  await assert.rejects(adapter.load({ url: "fixture://no-playback", type: "hls" }), /no media playback/i);
  assert.deepEqual(states, ["error"]);
  assert.equal(errors[0].code, "TV_PLAYBACK_ADAPTER_MISSING");
  assert.equal(adapter.getState(), "error");
});

test("Back from the playback test returns to launch", async () => {
  const controller = createShellController({ adapter: new FixturePlayerAdapter() });
  await controller.startTest();
  controller.back();
  assert.equal(controller.getState().screen, "home");
  assert.equal(controller.getState().playback, "idle");
});
