import { describe, expect, it } from "vitest";
import {
  resolveXtreamCanonicalServer,
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
    ).toBe("http://localhost:8080/xui-api/https%3A%2F%2Fgw.castcdn.net%3A443");
  });

  it("falls back to direct server URL in dev mode when origin is unavailable", () => {
    expect(
      resolveXtreamApiServer("https://gw.castcdn.net:443", {
        isDev: true,
        origin: null,
      }),
    ).toBe("https://gw.castcdn.net:443");
  });

  it("prefers configured proxy origin in production-like environments", () => {
    expect(
      resolveXtreamApiServer("https://gw.castcdn.net:443", {
        isDev: false,
        origin: "http://localhost:8080",
        proxyOrigin: "http://localhost:8788/",
      }),
    ).toBe("http://localhost:8788/xui-api/https%3A%2F%2Fgw.castcdn.net%3A443");
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
      server: "http://localhost:8080/xui-api/https%3A%2F%2Fgw.castcdn.net%3A443",
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

  it("routes credentials through configured proxy origin when available", () => {
    expect(
      resolveXtreamRuntimeCredentials(
        {
          server: "https://gw.castcdn.net:443/",
          username: "demo-user",
          password: "demo-pass",
        },
        {
          isDev: false,
          proxyOrigin: "http://localhost:8788/",
        },
      ),
    ).toEqual({
      server: "http://localhost:8788/xui-api/https%3A%2F%2Fgw.castcdn.net%3A443",
      username: "demo-user",
      password: "demo-pass",
    });
  });
});

describe("resolveXtreamCanonicalServer", () => {
  it("keeps current server when server info is missing", () => {
    expect(
      resolveXtreamCanonicalServer("http://smart.example:8080", null),
    ).toBe("http://smart.example:8080");
  });

  it("resolves canonical host from auth server_info payload", () => {
    expect(resolveXtreamCanonicalServer("http://smart.example:8080", {
      url: "serv2.example",
      port: "8080",
      https_port: "443",
      server_protocol: "http",
    })).toBe("http://serv2.example:8080");
  });

  it("drops default https port when canonicalizing", () => {
    expect(resolveXtreamCanonicalServer("http://smart.example:8080", {
      url: "edge.example",
      port: "8080",
      https_port: "443",
      server_protocol: "https",
    })).toBe("https://edge.example");
  });
});
