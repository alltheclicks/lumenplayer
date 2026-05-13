import { describe, expect, it } from "vitest";
import {
  evaluateCatchUpRuntimePayload,
  normalizeContentType,
} from "./catchupRuntimeGate";

describe("normalizeContentType", () => {
  it("normalizes and strips charset suffix", () => {
    expect(normalizeContentType("Application/X-MPEGURL; charset=utf-8")).toBe("application/x-mpegurl");
  });

  it("returns null for empty values", () => {
    expect(normalizeContentType("")).toBeNull();
    expect(normalizeContentType(null)).toBeNull();
  });
});

describe("evaluateCatchUpRuntimePayload", () => {
  it("accepts manifest payload content-type", () => {
    expect(
      evaluateCatchUpRuntimePayload({
        requestedUrl: "http://localhost:8080/xui-api/http%3A%2F%2Flogin.example/streaming/timeshift.php?stream=112",
        manifestUrl: "http://localhost:8080/xui-api/http%3A%2F%2Flogin.example/streaming/timeshift.php?stream=112",
        finalUrl: "http://localhost:8080/xui-api/https%3A%2F%2Fedge.example/streaming/timeshift.php?token=abc",
        httpStatus: 200,
        contentType: "application/x-mpegurl",
      }),
    ).toEqual({
      isPlayableForRuntime: true,
      rejectionReason: null,
      responseContentType: "application/x-mpegurl",
    });
  });

  it("rejects non-playable TS payload content-type", () => {
    expect(
      evaluateCatchUpRuntimePayload({
        requestedUrl: "http://localhost:8080/xui-api/http%3A%2F%2Flogin.example/timeshift/demo/user/3600/2026-03-03:20-00/112.ts",
        manifestUrl: "http://localhost:8080/xui-api/http%3A%2F%2Flogin.example/timeshift/demo/user/3600/2026-03-03:20-00/112.ts",
        finalUrl: "http://localhost:8080/xui-api/https%3A%2F%2Fedge.example/streaming/timeshift.php?token=abc",
        httpStatus: 200,
        contentType: "video/mp2t",
      }),
    ).toEqual({
      isPlayableForRuntime: false,
      rejectionReason: "non_playable_ts_payload",
      responseContentType: "video/mp2t",
    });
  });

  it("rejects manifest response when status indicates HTTP error", () => {
    expect(
      evaluateCatchUpRuntimePayload({
        requestedUrl: "https://edge.example/streaming/timeshift.php?token=abc",
        manifestUrl: "https://edge.example/streaming/timeshift.php?token=abc",
        finalUrl: "https://edge.example/streaming/timeshift.php?token=abc",
        httpStatus: 502,
        contentType: "application/x-mpegurl",
      }),
    ).toEqual({
      isPlayableForRuntime: false,
      rejectionReason: "http_error",
      responseContentType: "application/x-mpegurl",
    });
  });

  it("accepts manifest-like URL when content-type is missing", () => {
    expect(
      evaluateCatchUpRuntimePayload({
        requestedUrl: "https://edge.example/streaming/timeshift.php?token=abc&extension=m3u8",
        manifestUrl: "https://edge.example/streaming/timeshift.php?token=abc&extension=m3u8",
        finalUrl: "https://edge.example/streaming/timeshift.php?token=abc&extension=m3u8",
        httpStatus: 200,
        contentType: null,
      }),
    ).toEqual({
      isPlayableForRuntime: true,
      rejectionReason: null,
      responseContentType: null,
    });
  });
});
