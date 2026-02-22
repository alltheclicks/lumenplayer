import type {
  XtreamCredentials,
  XtreamApiResponse,
  XtreamCategory,
  XtreamLiveStream,
  XtreamVOD,
  XtreamVODInfo,
  XtreamSeries,
  XtreamSeriesInfo,
  XtreamEPGItem,
} from "@lumen/types";
import type { HttpClient } from "./http-client";

export class XtreamCodesService {
  private static readonly VOD_CATEGORY_FETCH_CONCURRENCY = 8;
  private credentials: XtreamCredentials | null = null;
  private http: HttpClient;
  private readonly resolveCredentials: (credentials: XtreamCredentials) => XtreamCredentials;

  constructor(
    http: HttpClient,
    options: {
      resolveCredentials?: (credentials: XtreamCredentials) => XtreamCredentials;
    } = {},
  ) {
    this.http = http;
    this.resolveCredentials = options.resolveCredentials ?? ((credentials) => credentials);
  }

  setCredentials(credentials: XtreamCredentials | null): void {
    this.credentials = credentials ? this.resolveCredentials(credentials) : null;
  }

  getCredentials(): XtreamCredentials | null {
    return this.credentials;
  }

  hasCredentials(): boolean {
    return this.credentials !== null;
  }

  private buildUrl(
    action?: string,
    params: Record<string, string> = {},
  ): string {
    if (!this.credentials) {
      throw new Error("Credentials not set");
    }

    const url = new URL(`${this.credentials.server}/player_api.php`);
    url.searchParams.set("username", this.credentials.username);
    url.searchParams.set("password", this.credentials.password);

    if (action) {
      url.searchParams.set("action", action);
    }

    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });

    return url.toString();
  }

  async authenticate(): Promise<XtreamApiResponse> {
    return this.http.get<XtreamApiResponse>(this.buildUrl());
  }

  async getLiveCategories(): Promise<XtreamCategory[]> {
    return this.http.get<XtreamCategory[]>(
      this.buildUrl("get_live_categories"),
    );
  }

  async getLiveStreams(categoryId?: string): Promise<XtreamLiveStream[]> {
    const params = categoryId ? { category_id: categoryId } : {};
    return this.http.get<XtreamLiveStream[]>(
      this.buildUrl("get_live_streams", params),
    );
  }

  async getVODCategories(): Promise<XtreamCategory[]> {
    return this.http.get<XtreamCategory[]>(
      this.buildUrl("get_vod_categories"),
    );
  }

  async getVODStreams(categoryId?: string): Promise<XtreamVOD[]> {
    const params = categoryId ? { category_id: categoryId } : {};
    return this.http.get<XtreamVOD[]>(
      this.buildUrl("get_vod_streams", params),
    );
  }

  async getAllVODStreams(): Promise<XtreamVOD[]> {
    const categories = await this.getVODCategories();
    if (categories.length === 0) {
      return this.getVODStreams();
    }

    let hasFailedCategoryRequest = false;
    const categoryStreamGroups: XtreamVOD[][] = [];
    for (
      let categoryIndex = 0;
      categoryIndex < categories.length;
      categoryIndex += XtreamCodesService.VOD_CATEGORY_FETCH_CONCURRENCY
    ) {
      const categoryBatch = categories.slice(
        categoryIndex,
        categoryIndex + XtreamCodesService.VOD_CATEGORY_FETCH_CONCURRENCY,
      );
      const categoryBatchResults = await Promise.allSettled(
        categoryBatch.map((category) => this.getVODStreams(category.category_id)),
      );

      for (const result of categoryBatchResults) {
        if (result.status === "fulfilled") {
          categoryStreamGroups.push(result.value);
        } else {
          hasFailedCategoryRequest = true;
        }
      }
    }

    const deduplicatedById = new Map<string, XtreamVOD>();
    for (const stream of categoryStreamGroups.flat()) {
      const streamId = String(stream.stream_id);
      if (!deduplicatedById.has(streamId)) {
        deduplicatedById.set(streamId, stream);
      }
    }

    if (deduplicatedById.size === 0 || hasFailedCategoryRequest) {
      try {
        const fallbackAllStreams = await this.getVODStreams();
        for (const stream of fallbackAllStreams) {
          const streamId = String(stream.stream_id);
          if (!deduplicatedById.has(streamId)) {
            deduplicatedById.set(streamId, stream);
          }
        }
      } catch {
        // Fallback endpoint can fail while category streams are still usable.
      }
    }

    return Array.from(deduplicatedById.values());
  }

  async getVODInfo(vodId: string | number): Promise<XtreamVODInfo> {
    return this.http.get<XtreamVODInfo>(
      this.buildUrl("get_vod_info", { vod_id: String(vodId) }),
    );
  }

  async getSeriesCategories(): Promise<XtreamCategory[]> {
    return this.http.get<XtreamCategory[]>(
      this.buildUrl("get_series_categories"),
    );
  }

  async getSeries(categoryId?: string): Promise<XtreamSeries[]> {
    const params = categoryId ? { category_id: categoryId } : {};
    return this.http.get<XtreamSeries[]>(
      this.buildUrl("get_series", params),
    );
  }

  async getSeriesInfo(seriesId: string | number): Promise<XtreamSeriesInfo> {
    return this.http.get<XtreamSeriesInfo>(
      this.buildUrl("get_series_info", { series_id: String(seriesId) }),
    );
  }

  async getEPG(
    streamId: string,
    options?: {
      limit?: number;
    },
  ): Promise<XtreamEPGItem[]> {
    const params: Record<string, string> = { stream_id: streamId };
    const limit = options?.limit;
    if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
      params.limit = String(Math.floor(limit));
    }

    const data = await this.http.get<{ epg_listings?: XtreamEPGItem[] }>(
      this.buildUrl("get_short_epg", params),
    );
    return data.epg_listings || [];
  }

  async getSimpleDataTable(streamId: string | number): Promise<XtreamEPGItem[]> {
    const normalizedStreamId = String(streamId);
    const payload = await this.http.get<unknown>(
      this.buildUrl("get_simple_data_table", { stream_id: normalizedStreamId }),
    );
    return XtreamCodesService.extractEpgListings(payload, normalizedStreamId);
  }

  async getFullEPG(): Promise<Record<string, XtreamEPGItem[]>> {
    return this.http.get<Record<string, XtreamEPGItem[]>>(
      this.buildUrl("get_simple_data_table", { stream_id: "all" }),
    );
  }

  async getXMLTVEPG(): Promise<string> {
    if (!this.credentials) {
      throw new Error("Credentials not set");
    }
    const url = new URL(`${this.credentials.server}/xmltv.php`);
    url.searchParams.set("username", this.credentials.username);
    url.searchParams.set("password", this.credentials.password);
    return this.http.getText(url.toString());
  }

  getLiveStreamUrl(streamId: number, extension = "m3u8"): string {
    if (!this.credentials) {
      throw new Error("Credentials not set");
    }
    return `${this.credentials.server}/live/${this.credentials.username}/${this.credentials.password}/${streamId}.${extension}`;
  }

  getVODStreamUrl(streamId: number, extension = "mp4"): string {
    if (!this.credentials) {
      throw new Error("Credentials not set");
    }
    return `${this.credentials.server}/movie/${this.credentials.username}/${this.credentials.password}/${streamId}.${extension}`;
  }

  getSeriesEpisodeStreamUrl(
    episodeId: number,
    extension = "mp4",
  ): string {
    if (!this.credentials) {
      throw new Error("Credentials not set");
    }
    return `${this.credentials.server}/series/${this.credentials.username}/${this.credentials.password}/${episodeId}.${extension}`;
  }

  getCatchUpUrl(
    streamId: number,
    startTimestamp: number,
    duration: number,
  ): string {
    if (!this.credentials) {
      throw new Error("Credentials not set");
    }

    const startTime = XtreamCodesService.formatTimeshiftStartUtc(startTimestamp);
    const url = new URL(`${this.credentials.server}/streaming/timeshift.php`);
    url.searchParams.set("username", this.credentials.username);
    url.searchParams.set("password", this.credentials.password);
    url.searchParams.set("stream", String(streamId));
    url.searchParams.set("start", startTime);
    url.searchParams.set("duration", String(duration));
    url.searchParams.set("extension", "m3u8");
    return url.toString();
  }

  getCatchUpUrlVariants(
    streamId: number,
    startTimestamp: number,
    duration: number,
  ): string[] {
    if (!this.credentials) {
      throw new Error("Credentials not set");
    }
    const credentials = this.credentials;

    const startCandidates = XtreamCodesService.resolveTimeshiftStartCandidates(startTimestamp);
    return startCandidates.map((startTime) => {
      const url = new URL(`${credentials.server}/streaming/timeshift.php`);
      url.searchParams.set("username", credentials.username);
      url.searchParams.set("password", credentials.password);
      url.searchParams.set("stream", String(streamId));
      url.searchParams.set("start", startTime);
      url.searchParams.set("duration", String(duration));
      url.searchParams.set("extension", "m3u8");
      return url.toString();
    });
  }

  getLegacyCatchUpUrl(
    streamId: number,
    startTimestamp: number,
    duration: number,
  ): string {
    if (!this.credentials) {
      throw new Error("Credentials not set");
    }
    return `${this.credentials.server}/timeshift/${this.credentials.username}/${this.credentials.password}/${duration}/${startTimestamp}/${streamId}.m3u8`;
  }

  getArchiveUrl(
    streamId: number,
    startTime: string,
    endTime: string,
  ): string {
    if (!this.credentials) {
      throw new Error("Credentials not set");
    }
    return `${this.credentials.server}/streaming/timeshift.php?username=${this.credentials.username}&password=${this.credentials.password}&stream=${streamId}&start=${startTime}&end=${endTime}`;
  }

  private static formatTimeshiftStart(startTimestamp: number): string {
    const startDate = new Date(startTimestamp * 1000);
    const year = startDate.getFullYear();
    const month = String(startDate.getMonth() + 1).padStart(2, "0");
    const day = String(startDate.getDate()).padStart(2, "0");
    const hours = String(startDate.getHours()).padStart(2, "0");
    const minutes = String(startDate.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}:${hours}-${minutes}`;
  }

  private static formatTimeshiftStartUtc(startTimestamp: number): string {
    const startDate = new Date(startTimestamp * 1000);
    const year = startDate.getUTCFullYear();
    const month = String(startDate.getUTCMonth() + 1).padStart(2, "0");
    const day = String(startDate.getUTCDate()).padStart(2, "0");
    const hours = String(startDate.getUTCHours()).padStart(2, "0");
    const minutes = String(startDate.getUTCMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}:${hours}-${minutes}`;
  }

  private static resolveTimeshiftStartCandidates(startTimestamp: number): string[] {
    const localStart = XtreamCodesService.formatTimeshiftStart(startTimestamp);
    const utcStart = XtreamCodesService.formatTimeshiftStartUtc(startTimestamp);
    if (localStart === utcStart) {
      return [localStart];
    }

    return [localStart, utcStart];
  }

  private static extractEpgListings(
    payload: unknown,
    streamId: string,
  ): XtreamEPGItem[] {
    const directEntries = XtreamCodesService.pickEpgItems(payload);
    if (directEntries) {
      return directEntries;
    }

    if (!payload || typeof payload !== "object") {
      return [];
    }

    const objectPayload = payload as Record<string, unknown>;
    const byStreamId = XtreamCodesService.pickEpgItems(objectPayload[streamId]);
    if (byStreamId) {
      return byStreamId;
    }

    for (const value of Object.values(objectPayload)) {
      const entries = XtreamCodesService.pickEpgItems(value);
      if (entries && entries.length > 0) {
        return entries;
      }
    }

    return [];
  }

  private static pickEpgItems(value: unknown): XtreamEPGItem[] | null {
    if (Array.isArray(value)) {
      return value as XtreamEPGItem[];
    }

    if (!value || typeof value !== "object") {
      return null;
    }

    const maybePayload = value as { epg_listings?: unknown };
    if (Array.isArray(maybePayload.epg_listings)) {
      return maybePayload.epg_listings as XtreamEPGItem[];
    }

    return null;
  }
}
