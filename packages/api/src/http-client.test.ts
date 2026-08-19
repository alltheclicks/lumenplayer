import { afterEach, describe, expect, it, vi } from "vitest";
import { FetchHttpClient } from "./http-client";

describe("FetchHttpClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries transient JSON responses before returning data", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("rate limited", {
        status: 429,
        statusText: "Too Many Requests",
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const sleeps: number[] = [];
    const client = new FetchHttpClient({
      baseRetryDelayMs: 25,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    await expect(client.get<{ ok: boolean }>("https://example.test/player_api.php"))
      .resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([25]);
  });

  it("uses Retry-After for transient text responses", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("busy", {
        status: 503,
        statusText: "Service Unavailable",
        headers: { "Retry-After": "1" },
      }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const sleeps: number[] = [];
    const client = new FetchHttpClient({
      maxRetryDelayMs: 750,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    await expect(client.getText("https://example.test/xmltv.php")).resolves.toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([750]);
  });

  it("does not retry non-transient provider errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("forbidden", {
      status: 403,
      statusText: "Forbidden",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new FetchHttpClient({
      sleep: async () => {
        throw new Error("sleep should not run");
      },
    });

    await expect(client.get("https://example.test/live/blocked.m3u8"))
      .rejects.toThrow("HTTP 403: Forbidden");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries browser network failures before surfacing them", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const sleeps: number[] = [];
    const client = new FetchHttpClient({
      baseRetryDelayMs: 25,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    await expect(client.get<{ ok: boolean }>("https://example.test/player_api.php"))
      .resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([25]);
  });

  it("preserves the final network error after the bounded retry budget", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    const client = new FetchHttpClient({
      maxRetries: 1,
      sleep: async () => {},
    });

    await expect(client.get("https://example.test/player_api.php"))
      .rejects.toThrow("Failed to fetch");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts a hung request after the configured timeout (M1.2-c)", async () => {
    // Simulate a socket that never resolves until it is aborted via signal.
    const fetchMock = vi.fn((_url: string, init?: { signal?: AbortSignal }) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      })
    ));
    vi.stubGlobal("fetch", fetchMock);

    const client = new FetchHttpClient({
      maxRetries: 0,
      timeoutMs: 10,
    });

    await expect(client.get("https://example.test/player_api.php"))
      .rejects.toThrow(/timed out after 10ms/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("passes a signal on every attempt and clears the timer on success", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new FetchHttpClient({ timeoutMs: 5_000 });
    await expect(client.get<{ ok: boolean }>("https://example.test/player_api.php"))
      .resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("does not attach a signal when timeoutMs is 0 (M1.2-c opt-out)", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new FetchHttpClient({ timeoutMs: 0 });
    await expect(client.getText("https://example.test/xmltv.php")).resolves.toBe("ok");
    expect(fetchMock).toHaveBeenCalledWith("https://example.test/xmltv.php");
  });
});
