import { expect, it } from "vitest";
import { parseSourceOrigins } from "../../scripts/tizen-source-origins.mjs";
it("defaults Samsung network access to none and accepts only exact origin-only configuration", () => {
  expect(parseSourceOrigins()).toEqual([]);
  expect(parseSourceOrigins('["https://example.invalid","https://example.invalid"]')).toEqual(["https://example.invalid"]);
  for (const value of ['["*"]', '["https://example.invalid/path"]', '["https://user:secret@example.invalid"]', '["file:///test"]', '[1]', '{}']) {
    expect(() => parseSourceOrigins(value)).toThrow();
  }
});
