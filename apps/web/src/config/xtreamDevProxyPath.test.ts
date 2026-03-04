import { describe, expect, it } from "vitest";
import { resolveXtreamDevProxyRequest } from "./xtreamDevProxyPath";

describe("resolveXtreamDevProxyRequest", () => {
  it("resolves encoded proxy target and keeps suffix path/query", () => {
    expect(resolveXtreamDevProxyRequest(
      "/xui-api/http%3A%2F%2Fserv2.mediaking.fi%3A8080/player_api.php?username=fica&password=test",
    )).toEqual({
      target: "http://serv2.mediaking.fi:8080",
      rewrittenPath: "/player_api.php?username=fica&password=test",
    });
  });

  it("resolves decoded absolute target path used by middleware-normalized requests", () => {
    expect(resolveXtreamDevProxyRequest(
      "/xui-api/https://edge6.castcdn.net/streaming/timeshift.php?token=abc&seg=0_1.ts",
    )).toEqual({
      target: "https://edge6.castcdn.net",
      rewrittenPath: "/streaming/timeshift.php?token=abc&seg=0_1.ts",
    });
  });

  it("keeps target-only requests rewired to root path", () => {
    expect(resolveXtreamDevProxyRequest("/xui-api/https%3A%2F%2Fedge6.castcdn.net")).toEqual({
      target: "https://edge6.castcdn.net",
      rewrittenPath: "/",
    });
  });

  it("returns null target for malformed proxy prefix payload", () => {
    expect(resolveXtreamDevProxyRequest("/xui-api/not-a-valid-target/path")).toEqual({
      target: null,
      rewrittenPath: "",
    });
  });

  it("passes through non proxy paths unchanged", () => {
    expect(resolveXtreamDevProxyRequest("/api/health?full=true")).toEqual({
      target: null,
      rewrittenPath: "/api/health?full=true",
    });
  });
});
