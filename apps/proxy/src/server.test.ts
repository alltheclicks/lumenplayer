import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProxyServer, parseAllowedHosts } from "./server.js";

const encodeTarget = (value: string): string => encodeURIComponent(value);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseAllowedHosts", () => {
  it("parses and normalizes comma-separated host list", () => {
    expect(parseAllowedHosts(" Example.com , *.castcdn.net ,,localhost ")).toEqual([
      "example.com",
      "*.castcdn.net",
      "localhost",
    ]);
  });
});

describe("createProxyServer", () => {
  it("returns missing_target when encoded target is invalid", async () => {
    const fetchMock = vi.fn();
    const app = createProxyServer({
      allowedHosts: ["*"],
      fetchImpl: fetchMock as typeof fetch,
      logger: false,
    });

    const response = await app.inject({
      method: "GET",
      url: "/xui-api/not-a-valid-url/player_api.php",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "missing_target",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("blocks outbound host outside allowlist", async () => {
    const fetchMock = vi.fn();
    const app = createProxyServer({
      allowedHosts: ["allowed.example"],
      fetchImpl: fetchMock as typeof fetch,
      logger: false,
    });

    const response = await app.inject({
      method: "GET",
      url: `/xui-api/${encodeTarget("https://blocked.example")}/player_api.php?action=get_live_streams`,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: "blocked_host",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("rewrites upstream redirects back into /xui-api contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: {
          location: "https://edge.example/streaming/timeshift.php?token=abc123",
        },
      }),
    );

    const app = createProxyServer({
      allowedHosts: ["login.example", "edge.example"],
      fetchImpl: fetchMock as typeof fetch,
      logger: false,
    });

    const response = await app.inject({
      method: "GET",
      url: `/xui-api/${encodeTarget("https://login.example:8080")}/timeshift/demo/user/3600/2026-03-04:20-10/112.ts`,
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(
      `/xui-api/${encodeTarget("https://edge.example")}/streaming/timeshift.php?token=abc123`,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("retries once on transport failure for GET and then returns upstream payload", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response("#EXTM3U", {
        status: 200,
        headers: {
          "content-type": "application/x-mpegurl",
        },
      }));

    const app = createProxyServer({
      allowedHosts: ["login.example"],
      retryCount: 1,
      fetchImpl: fetchMock as typeof fetch,
      logger: false,
    });

    const response = await app.inject({
      method: "GET",
      url: `/xui-api/${encodeTarget("https://login.example")}/streaming/timeshift.php?stream=112`,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/x-mpegurl");
    await app.close();
  });

  it("does not retry on upstream HTTP 5xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("upstream fail", {
      status: 502,
      headers: {
        "content-type": "text/plain",
      },
    }));

    const app = createProxyServer({
      allowedHosts: ["login.example"],
      retryCount: 1,
      fetchImpl: fetchMock as typeof fetch,
      logger: false,
    });

    const response = await app.inject({
      method: "GET",
      url: `/xui-api/${encodeTarget("https://login.example")}/live/demo/user/112.ts`,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.statusCode).toBe(502);
    expect(response.headers["content-type"]).toContain("text/plain");
    await app.close();
  });

  it("returns upstream_timeout when request exceeds timeout budget", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError"));

    const app = createProxyServer({
      allowedHosts: ["login.example"],
      retryCount: 0,
      timeoutMs: 5,
      fetchImpl: fetchMock as typeof fetch,
      logger: false,
    });

    const response = await app.inject({
      method: "GET",
      url: `/xui-api/${encodeTarget("https://login.example")}/player_api.php?action=get_live_categories`,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.statusCode).toBe(504);
    expect(response.json()).toMatchObject({
      error: "upstream_timeout",
    });
    await app.close();
  });

  it("streams media payload from real upstream without buffering", async () => {
    const upstream = createServer((_, response) => {
      response.writeHead(200, {
        "content-type": "video/mp2t",
      });
      response.end("segment-data");
    });

    const upstreamPort = await new Promise<number>((resolve) => {
      upstream.listen(0, "127.0.0.1", () => {
        const address = upstream.address();
        if (address && typeof address === "object") {
          resolve(address.port);
        }
      });
    });

    const app = createProxyServer({
      allowedHosts: ["127.0.0.1"],
      logger: false,
    });

    await app.listen({
      host: "127.0.0.1",
      port: 0,
    });
    const proxyAddress = app.server.address();
    const proxyPort = typeof proxyAddress === "object" && proxyAddress ? proxyAddress.port : 0;

    const response = await fetch(
      `http://127.0.0.1:${proxyPort}/xui-api/${encodeTarget(`http://127.0.0.1:${upstreamPort}`)}/live/demo/user/112.ts`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type") ?? "").toContain("video/mp2t");
    expect(await response.text()).toBe("segment-data");

    await app.close();
    await new Promise<void>((resolve, reject) => {
      upstream.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });
});
