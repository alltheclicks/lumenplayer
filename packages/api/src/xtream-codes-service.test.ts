import { describe, expect, it } from "vitest";
import type { HttpClient } from "./http-client";
import type { XtreamCategory, XtreamVOD } from "@lumen/types";
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
    const dramaStreams = [createVod(4, "20")];

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
});
