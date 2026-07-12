import { describe, expect, it } from "vitest";
import { redactSensitiveText, sanitizeLogRecord } from "./privacy-redaction.js";

describe("privacy-safe proxy logging", () => {
  it("redacts Xtream credentials and provider tokens while preserving diagnostics", () => {
    const sanitized = sanitizeLogRecord({
      event: "catchup.redirect",
      streamId: 112,
      sourceUrl: "https://provider.example/live/viewer@example.com/live-pass/112.m3u8",
      requestUrl: "https://provider.example/streaming/timeshift.php?username=viewer@example.com&password=catchup-pass&stream=112",
      finalUrl: "https://edge.example/streaming/timeshift.php?token=edge-secret&seg=0_1.ts",
      nested: {
        username: "viewer@example.com",
        credentials: { password: "nested-pass" },
      },
    });

    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toContain("viewer@example.com");
    expect(serialized).not.toContain("live-pass");
    expect(serialized).not.toContain("catchup-pass");
    expect(serialized).not.toContain("edge-secret");
    expect(serialized).not.toContain("nested-pass");
    expect(serialized).toContain("provider.example");
    expect(serialized).toContain("stream=112");
    expect(sanitized.streamId).toBe(112);
  });

  it("redacts credentials embedded in error messages and proxy request paths", () => {
    const text = redactSensitiveText(
      "failed https://user:pass@provider.example/movie/viewer/movie-pass/9.mp4?access_token=secret Bearer abc.def",
    );

    expect(text).not.toContain("user:pass");
    expect(text).not.toContain("viewer");
    expect(text).not.toContain("movie-pass");
    expect(text).not.toContain("access_token=secret");
    expect(text).not.toContain("abc.def");
    expect(text).toContain("movie/[REDACTED]/[REDACTED]/9.mp4");
  });
});
