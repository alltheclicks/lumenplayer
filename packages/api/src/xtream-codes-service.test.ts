import { describe, expect, it } from "vitest";
import type { HttpClient } from "./http-client";
import type { XtreamCategory, XtreamEPGItem, XtreamVOD } from "@lumen/types";
import { XtreamCodesService } from "./xtream-codes-service";

const createVod = (streamId: number, categoryId: string): XtreamVOD => ({
  num: streamId,
  name: `Movie ${streamId}`,
  stream_type: "movie",
  stream_id: streamId,
  stream_icon: "",
  rating: "",
  rating_5based: 0,
  added: "",
  category_id: categoryId,
  container_extension: "mp4",
  custom_sid: "",
  direct_source: "",
});

describe("XtreamCodesService.getAllVODStreams", () => {
  it("merges per-category streams without duplicates", async () => {
    const categories: XtreamCategory[] = [
      { category_id: "10", category_name: "Action", parent_id: 0 },
      { category_id: "20", category_name: "Drama", parent_id: 0 },
    ];
    const actionStreams = [createVod(2, "10"), createVod(3, "10")];
    const dramaStreams = [createVod(3, "20"), createVod(4, "20")];

    const requestedUrls: string[] = [];
    const httpClient: HttpClient = {
      get: async <T>(url: string): Promise<T> => {
        requestedUrls.push(url);
        const parsed = new URL(url);
        const action = parsed.searchParams.get("action");
        const categoryId = parsed.searchParams.get("category_id");

        if (action === "get_vod_categories") {
          return categories as T;
        }
        if (action === "get_vod_streams" && categoryId === "10") {
          return actionStreams as T;
        }
        if (action === "get_vod_streams" && categoryId === "20") {
          return dramaStreams as T;
        }

        throw new Error(`Unexpected URL: ${url}`);
      },
      getText: async () => "",
    };

    const service = new XtreamCodesService(httpClient);
    service.setCredentials({
      server: "https://example.test",
      username: "demo",
      password: "demo",
    });

    const result = await service.getAllVODStreams();

    expect(result.map((stream) => stream.stream_id)).toEqual([2, 3, 4]);
    expect(requestedUrls).toHaveLength(3);
  });

  it("returns partial catalog when one category request fails", async () => {
    const categories: XtreamCategory[] = [
      { category_id: "10", category_name: "Action", parent_id: 0 },
      { category_id: "20", category_name: "Drama", parent_id: 0 },
      { category_id: "30", category_name: "Comedy", parent_id: 0 },
    ];
    const allStreams = [createVod(1, "0")];
    const actionStreams = [createVod(2, "10")];
    const comedyStreams = [createVod(3, "30")];

    const requestedUrls: string[] = [];
    const httpClient: HttpClient = {
      get: async <T>(url: string): Promise<T> => {
        requestedUrls.push(url);
        const parsed = new URL(url);
        const action = parsed.searchParams.get("action");
        const categoryId = parsed.searchParams.get("category_id");

        if (action === "get_vod_categories") {
          return categories as T;
        }
        if (action === "get_vod_streams" && categoryId === null) {
          return allStreams as T;
        }
        if (action === "get_vod_streams" && categoryId === "10") {
          return actionStreams as T;
        }
        if (action === "get_vod_streams" && categoryId === "20") {
          throw new Error("temporary provider error");
        }
        if (action === "get_vod_streams" && categoryId === "30") {
          return comedyStreams as T;
        }

        throw new Error(`Unexpected URL: ${url}`);
      },
      getText: async () => "",
    };

    const service = new XtreamCodesService(httpClient);
    service.setCredentials({
      server: "https://example.test",
      username: "demo",
      password: "demo",
    });

    const result = await service.getAllVODStreams();

    expect(result.map((stream) => stream.stream_id).sort()).toEqual([1, 2, 3]);
    expect(requestedUrls).toHaveLength(5);
  });

  it("keeps category results when fallback all-stream request fails", async () => {
    const categories: XtreamCategory[] = [
      { category_id: "10", category_name: "Action", parent_id: 0 },
      { category_id: "20", category_name: "Drama", parent_id: 0 },
    ];
    const actionStreams = [createVod(2, "10")];

    const requestedUrls: string[] = [];
    const httpClient: HttpClient = {
      get: async <T>(url: string): Promise<T> => {
        requestedUrls.push(url);
        const parsed = new URL(url);
        const action = parsed.searchParams.get("action");
        const categoryId = parsed.searchParams.get("category_id");

        if (action === "get_vod_categories") {
          return categories as T;
        }
        if (action === "get_vod_streams" && categoryId === "10") {
          return actionStreams as T;
        }
        if (action === "get_vod_streams" && categoryId === "20") {
          throw new Error("category timeout");
        }
        if (action === "get_vod_streams" && categoryId === null) {
          throw new Error("fallback timeout");
        }

        throw new Error(`Unexpected URL: ${url}`);
      },
      getText: async () => "",
    };

    const service = new XtreamCodesService(httpClient);
    service.setCredentials({
      server: "https://example.test",
      username: "demo",
      password: "demo",
    });

    const result = await service.getAllVODStreams();

    expect(result.map((stream) => stream.stream_id)).toEqual([2]);
    expect(requestedUrls).toHaveLength(4);
  });
});

describe("XtreamCodesService.getEPG", () => {
  const buildHttpClient = (requestedUrls: string[]): HttpClient => ({
    get: async <T>(url: string): Promise<T> => {
      requestedUrls.push(url);
      return {
        epg_listings: [
          {
            id: "epg-1",
            epg_id: "epg-1",
            title: "RG5ldm5paw==",
            lang: "sr",
            start: "2026-02-20 20:00:00",
            end: "2026-02-20 21:00:00",
            description: "VmVjZXJuamUgdmVzdGk=",
            channel_id: "10",
            start_timestamp: "1771617600",
            stop_timestamp: "1771621200",
            now_playing: 0,
            has_archive: 1,
          },
        ] satisfies XtreamEPGItem[],
      } as T;
    },
    getText: async () => "",
  });

  it("includes explicit limit when provided", async () => {
    const requestedUrls: string[] = [];
    const service = new XtreamCodesService(buildHttpClient(requestedUrls));
    service.setCredentials({
      server: "https://example.test",
      username: "demo",
      password: "demo",
    });

    await service.getEPG("10", { limit: 168 });

    expect(requestedUrls).toHaveLength(1);
    const request = new URL(requestedUrls[0]);
    expect(request.searchParams.get("action")).toBe("get_short_epg");
    expect(request.searchParams.get("stream_id")).toBe("10");
    expect(request.searchParams.get("limit")).toBe("168");
  });

  it("omits limit when value is not positive", async () => {
    const requestedUrls: string[] = [];
    const service = new XtreamCodesService(buildHttpClient(requestedUrls));
    service.setCredentials({
      server: "https://example.test",
      username: "demo",
      password: "demo",
    });

    await service.getEPG("99", { limit: 0 });

    expect(requestedUrls).toHaveLength(1);
    const request = new URL(requestedUrls[0]);
    expect(request.searchParams.get("action")).toBe("get_short_epg");
    expect(request.searchParams.get("stream_id")).toBe("99");
    expect(request.searchParams.has("limit")).toBe(false);
  });
});

describe("XtreamCodesService.getSimpleDataTable", () => {
  const buildService = (handler: (url: string) => unknown) => {
    const requestedUrls: string[] = [];
    const httpClient: HttpClient = {
      get: async <T>(url: string): Promise<T> => {
        requestedUrls.push(url);
        return handler(url) as T;
      },
      getText: async () => "",
    };

    const service = new XtreamCodesService(httpClient);
    service.setCredentials({
      server: "https://example.test",
      username: "demo",
      password: "demo",
    });

    return { service, requestedUrls };
  };

  const sampleItem: XtreamEPGItem = {
    id: "epg-1",
    epg_id: "epg-1",
    title: "RG5ldm5paw==",
    lang: "sr",
    start: "2026-02-20 20:00:00",
    end: "2026-02-20 21:00:00",
    description: "VmVjZXJuamUgdmVzdGk=",
    channel_id: "10",
    start_timestamp: "1771617600",
    stop_timestamp: "1771621200",
    now_playing: 0,
    has_archive: 1,
  };

  it("requests stream-scoped get_simple_data_table endpoint", async () => {
    const { service, requestedUrls } = buildService(() => ({
      epg_listings: [sampleItem],
    }));

    const result = await service.getSimpleDataTable("55");

    expect(result).toEqual([sampleItem]);
    expect(requestedUrls).toHaveLength(1);
    const request = new URL(requestedUrls[0]);
    expect(request.searchParams.get("action")).toBe("get_simple_data_table");
    expect(request.searchParams.get("stream_id")).toBe("55");
  });

  it("extracts EPG rows when provider nests stream payload under stream id key", async () => {
    const { service } = buildService(() => ({
      "77": {
        epg_listings: [sampleItem],
      },
    }));

    const result = await service.getSimpleDataTable(77);
    expect(result).toEqual([sampleItem]);
  });
});

describe("XtreamCodesService catch-up URL builders", () => {
  const createService = () => {
    const httpClient: HttpClient = {
      get: async <T>() => [] as T,
      getText: async () => "",
    };

    const service = new XtreamCodesService(httpClient);
    service.setCredentials({
      server: "https://example.test",
      username: "demo",
      password: "demo",
    });
    return service;
  };

  it("keeps the provider-accepted streaming/timeshift query URL as fallback", () => {
    const service = createService();
    const startTimestamp = 1771617600;
    const url = new URL(service.getCatchUpUrl(77, startTimestamp, 1800));
    const localDate = new Date(startTimestamp * 1000);
    const localStart = [
      localDate.getFullYear(),
      String(localDate.getMonth() + 1).padStart(2, "0"),
      String(localDate.getDate()).padStart(2, "0"),
    ].join("-") + `:${String(localDate.getHours()).padStart(2, "0")}-${String(localDate.getMinutes()).padStart(2, "0")}`;

    expect(url.pathname).toBe("/streaming/timeshift.php");
    expect(url.searchParams.get("username")).toBe("demo");
    expect(url.searchParams.get("password")).toBe("demo");
    expect(url.searchParams.get("stream")).toBe("77");
    expect(url.searchParams.get("duration")).toBe("30");
    expect(url.searchParams.get("extension")).toBe("m3u8");
    expect(url.searchParams.get("start")).toBe(localStart);
  });

  it("builds redirect-first timeshift_hls path URL for web catch-up", () => {
    const service = createService();
    const startTimestamp = 1771617600;
    const redirectUrl = service.getCatchUpRedirectUrl(77, startTimestamp, 1800);
    const localDate = new Date(startTimestamp * 1000);
    const localStart = [
      localDate.getFullYear(),
      String(localDate.getMonth() + 1).padStart(2, "0"),
      String(localDate.getDate()).padStart(2, "0"),
    ].join("-") + `:${String(localDate.getHours()).padStart(2, "0")}-${String(localDate.getMinutes()).padStart(2, "0")}`;

    expect(redirectUrl).toBe(
      `https://example.test/timeshift_hls/demo/demo/30/${localStart}/77.m3u8`,
    );
  });

  it("provides redirect variants with timeshift_hls first and legacy timeshift fallback", () => {
    const service = createService();
    const startTimestamp = 1771694880;
    const variants = service.getCatchUpRedirectUrlVariants(77, startTimestamp, 1800);
    const parsed = variants.map((variant) => new URL(variant));

    expect(variants.length).toBeGreaterThan(0);
    expect(new Set(variants).size).toBe(variants.length);
    expect(parsed[0]?.pathname).toContain("/timeshift_hls/");
    expect(parsed[0]?.pathname.endsWith(".m3u8")).toBe(true);
    expect(parsed.some((variant) => variant.pathname.includes("/timeshift/"))).toBe(true);
    expect(parsed.some((variant) => variant.pathname.endsWith(".ts"))).toBe(true);
  });

  it("provides catch-up query fallback variants for local-time and UTC providers", () => {
    const service = createService();
    const startTimestamp = 1771694880;
    const variants = service.getCatchUpUrlVariants(77, startTimestamp, 1800);

    expect(variants.length).toBeGreaterThan(0);
    expect(new Set(variants).size).toBe(variants.length);

    const parsedVariants = variants.map((variant) => new URL(variant));
    const localDate = new Date(startTimestamp * 1000);
    const localStart = [
      localDate.getFullYear(),
      String(localDate.getMonth() + 1).padStart(2, "0"),
      String(localDate.getDate()).padStart(2, "0"),
    ].join("-") + `:${String(localDate.getHours()).padStart(2, "0")}-${String(localDate.getMinutes()).padStart(2, "0")}`;
    const utcStart = [
      localDate.getUTCFullYear(),
      String(localDate.getUTCMonth() + 1).padStart(2, "0"),
      String(localDate.getUTCDate()).padStart(2, "0"),
    ].join("-") + `:${String(localDate.getUTCHours()).padStart(2, "0")}-${String(localDate.getUTCMinutes()).padStart(2, "0")}`;

    expect(parsedVariants[0]?.pathname).toBe("/streaming/timeshift.php");
    expect(parsedVariants[0]?.searchParams.get("start")).toBe(localStart);
    expect(parsedVariants[0]?.searchParams.get("duration")).toBe("30");
    expect(parsedVariants.some((variant) => (
      variant.searchParams.get("start") === localStart &&
      variant.searchParams.get("duration") === "1800"
    ))).toBe(true);
    expect(parsedVariants.some((variant) => (
      variant.searchParams.get("start") === utcStart &&
      variant.searchParams.get("duration") === "30"
    ))).toBe(true);
  });

  it("keeps legacy path-style catch-up URL available as fallback", () => {
    const service = createService();
    const localDate = new Date(1771617600 * 1000);
    const localStart = [
      localDate.getFullYear(),
      String(localDate.getMonth() + 1).padStart(2, "0"),
      String(localDate.getDate()).padStart(2, "0"),
    ].join("-") + `:${String(localDate.getHours()).padStart(2, "0")}-${String(localDate.getMinutes()).padStart(2, "0")}`;

    expect(service.getLegacyCatchUpUrl(77, 1771617600, 1800)).toBe(
      `https://example.test/timeshift/demo/demo/30/${localStart}/77.m3u8`,
    );
  });

  it("provides legacy path variants with formatted and epoch starts", () => {
    const service = createService();
    const variants = service.getLegacyCatchUpUrlVariants(77, 1771617600, 1800);
    const localDate = new Date(1771617600 * 1000);
    const localStart = [
      localDate.getFullYear(),
      String(localDate.getMonth() + 1).padStart(2, "0"),
      String(localDate.getDate()).padStart(2, "0"),
    ].join("-") + `:${String(localDate.getHours()).padStart(2, "0")}-${String(localDate.getMinutes()).padStart(2, "0")}`;

    expect(variants.some((variant) => (
      variant === `https://example.test/timeshift/demo/demo/30/${localStart}/77.m3u8`
    ))).toBe(true);
    expect(variants.some((variant) => (
      variant === "https://example.test/timeshift/demo/demo/1800/1771617600/77.m3u8"
    ))).toBe(true);
  });

  it("keeps the provider-accepted streaming/timeshift query URL first for mediaking", () => {
    const httpClient: HttpClient = {
      get: async <T>(): Promise<T> => {
        throw new Error("Unexpected GET");
      },
      getText: async () => "",
    };
    const service = new XtreamCodesService(httpClient);
    service.setCredentials({
      server: "http://smart.mediaking.fi:8080",
      username: "fica",
      password: "secret",
    });

    const queryVariants = service.getCatchUpUrlVariants(112, 1773071880, 240 * 60);

    expect(queryVariants.length).toBeGreaterThan(0);
    expect(queryVariants[0]).toContain("http://smart.mediaking.fi:8080/streaming/timeshift.php");
    expect(queryVariants[0]).toContain("extension=m3u8");
    expect(queryVariants.some((variant) => variant.includes("edge6.castcdn.net"))).toBe(false);
    expect(service.getLegacyCatchUpUrlVariants(112, 1773071880, 240 * 60).every((variant) => (
      variant.startsWith("http://smart.mediaking.fi:8080/timeshift/")
    ))).toBe(true);
  });

  it("uses local-time catch-up starts only for mediaking providers", () => {
    const httpClient: HttpClient = {
      get: async <T>(): Promise<T> => {
        throw new Error("Unexpected GET");
      },
      getText: async () => "",
    };
    const service = new XtreamCodesService(httpClient);
    service.setCredentials({
      server: "http://serv2.mediaking.fi:8080",
      username: "fica",
      password: "secret",
    });

    const startTimestamp = 1778268600;
    const localStart = "2026-05-08:21-30";
    const utcStart = "2026-05-08:19-30";
    const queryVariants = service.getCatchUpUrlVariants(381, startTimestamp, 90 * 60);
    const redirectVariants = service.getCatchUpRedirectUrlVariants(381, startTimestamp, 90 * 60);

    expect(queryVariants.length).toBeGreaterThan(0);
    expect(queryVariants.every((variant) => variant.includes(`start=${encodeURIComponent(localStart)}`))).toBe(true);
    expect(queryVariants.some((variant) => variant.includes(encodeURIComponent(utcStart)))).toBe(false);
    expect(redirectVariants.every((variant) => variant.includes(`/${localStart}/`))).toBe(true);
    expect(redirectVariants.some((variant) => variant.includes(`/${utcStart}/`))).toBe(false);
  });

  it("uses local-time catch-up starts when mediaking is reached through the xui proxy", () => {
    const httpClient: HttpClient = {
      get: async <T>(): Promise<T> => {
        throw new Error("Unexpected GET");
      },
      getText: async () => "",
    };
    const service = new XtreamCodesService(httpClient);
    service.setCredentials({
      server: "http://127.0.0.1:8788/xui-api/http%3A%2F%2Fserv2.mediaking.fi%3A8080",
      username: "fica",
      password: "secret",
    });

    const queryVariants = service.getCatchUpUrlVariants(381, 1778268600, 90 * 60);

    expect(queryVariants.length).toBeGreaterThan(0);
    expect(queryVariants.every((variant) => variant.includes("start=2026-05-08%3A21-30"))).toBe(true);
    expect(queryVariants.some((variant) => variant.includes("2026-05-08%3A19-30"))).toBe(false);
  });
});
