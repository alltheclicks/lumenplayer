import { describe, expect, it } from "vitest";
import {
  resolveXtreamApiServer,
  resolveXtreamRuntimeCredentials,
} from "./xtream";

describe("resolveXtreamApiServer", () => {
  it("returns direct server URL in production mode", () => {
    expect(
      resolveXtreamApiServer("https://gw.castcdn.net:443/", {
        isDev: false,
        origin: "http://localhost:8080",
      }),
    ).toBe("https://gw.castcdn.net:443");
  });

  it("returns same-origin proxy URL in dev mode", () => {
    expect(
      resolveXtreamApiServer("https://gw.castcdn.net:443", {
        isDev: true,
        origin: "http://localhost:8080/",
      }),
    ).toBe("http://localhost:8080/xui-api");
  });

  it("falls back to direct server URL in dev mode when origin is unavailable", () => {
    expect(
      resolveXtreamApiServer("https://gw.castcdn.net:443", {
        isDev: true,
        origin: null,
      }),
    ).toBe("https://gw.castcdn.net:443");
  });
});

describe("resolveXtreamRuntimeCredentials", () => {
  it("rewrites only server base in dev mode", () => {
    expect(
      resolveXtreamRuntimeCredentials(
        {
          server: "https://gw.castcdn.net:443/",
          username: "demo-user",
          password: "demo-pass",
        },
        {
          isDev: true,
          origin: "http://localhost:8080",
        },
      ),
    ).toEqual({
      server: "http://localhost:8080/xui-api",
      username: "demo-user",
      password: "demo-pass",
    });
  });

  it("keeps original server in production mode", () => {
    expect(
      resolveXtreamRuntimeCredentials(
        {
          server: "https://gw.castcdn.net:443/",
          username: "demo-user",
          password: "demo-pass",
        },
        {
          isDev: false,
          origin: "http://localhost:8080",
        },
      ),
    ).toEqual({
      server: "https://gw.castcdn.net:443",
      username: "demo-user",
      password: "demo-pass",
    });
  });
});
