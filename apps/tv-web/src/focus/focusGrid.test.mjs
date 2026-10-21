import assert from "node:assert/strict";
import test from "node:test";
import { moveFocus, remoteAction } from "./focusGrid.mjs";

const items = [
  { id: "launch", row: 0, col: 1 },
  { id: "settings", row: 1, col: 1 },
  { id: "rail", row: 0, col: 0 },
];

test("D-pad directions select the nearest item in that direction", () => {
  assert.equal(moveFocus("launch", "down", items), "settings");
  assert.equal(moveFocus("launch", "left", items), "rail");
  assert.equal(moveFocus("launch", "right", items), "launch");
});

test("remote key names and legacy key codes map to OK and Back", () => {
  assert.equal(remoteAction("Accept", 0), "ok");
  assert.equal(remoteAction("", 10009), "back");
  assert.equal(remoteAction("BrowserBack", 0), "back");
});
