import { describe, expect, it } from "vitest";
import {
  decodeXtreamProxyTargetFromPathname,
  resolveXtreamCanonicalServer,
  resolveXtreamApiServer,
  resolveXtreamProxyMediaRequestUrl,
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

describe("resolveXtreamProxyMediaRequestUrl", () => {
  it("keeps already proxied request URL unchanged", () => {
    expect(
      resolveXtreamProxyMediaRequestUrl(
        "http://localhost:8080/xui-api/http%3A%2F%2Fsmart.example%3A8080/streaming/timeshift.php?token=abc",
        {
          runtimeOrigin: "http://localhost:8080",
          fallbackTarget: "http://smart.example:8080",
        },
      ),
    ).toBe(
      "http://localhost:8080/xui-api/http%3A%2F%2Fsmart.example%3A8080/streaming/timeshift.php?token=abc",
    );
  });

  it("rewrites cross-origin request URL through same-origin proxy path", () => {
    expect(
      resolveXtreamProxyMediaRequestUrl(
        "https://edge6.castcdn.net/streaming/timeshift.php?token=abc",
        {
          runtimeOrigin: "http://localhost:8080",
          fallbackTarget: null,
        },
      ),
    ).toBe(
      "http://localhost:8080/xui-api/https%3A%2F%2Fedge6.castcdn.net/streaming/timeshift.php?token=abc",
    );
  });

  it("rewrites same-origin absolute media path using fallback target", () => {
    expect(
      resolveXtreamProxyMediaRequestUrl("/streaming/timeshift.php?token=abc", {
        runtimeOrigin: "http://localhost:8080",
        fallbackTarget: "http://smart.example:8080",
      }),
    ).toBe(
      "http://localhost:8080/xui-api/http%3A%2F%2Fsmart.example%3A8080/streaming/timeshift.php?token=abc",
    );
  });
});

describe("decodeXtreamProxyTargetFromPathname", () => {
  it("extracts decoded target from proxy pathname", () => {
    expect(
      decodeXtreamProxyTargetFromPathname("/xui-api/https%3A%2F%2Fedge6.castcdn.net%3A443/streaming/timeshift.php"),
    ).toBe("https://edge6.castcdn.net");
  });

  it("returns null for non-proxy paths", () => {
    expect(decodeXtreamProxyTargetFromPathname("/streaming/timeshift.php")).toBeNull();
  });
});
