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
  private static readonly CATCH_UP_REDIRECT_PATHS = [
    {
      basePath: "/timeshift_hls",
      extensions: ["m3u8"],
    },
    {
      basePath: "/timeshift",
      extensions: ["m3u8", "ts"],
    },
  ] as const;
  private credentials: XtreamCredentials | null = null;
  private http: HttpClient;
  private readonly resolveCredentials: (credentials: XtreamCredentials) => XtreamCredentials;
  private readonly resolveApiCredentials: (credentials: XtreamCredentials) => XtreamCredentials;

  constructor(
    http: HttpClient,
    options: {
      resolveCredentials?: (credentials: XtreamCredentials) => XtreamCredentials;
      resolveApiCredentials?: (credentials: XtreamCredentials) => XtreamCredentials;
    } = {},
  ) {
    this.http = http;
    this.resolveCredentials = options.resolveCredentials ?? ((credentials) => credentials);
    this.resolveApiCredentials = options.resolveApiCredentials ?? ((credentials) => credentials);
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

    const apiCredentials = this.resolveApiCredentials(this.credentials);
    const url = new URL(`${apiCredentials.server}/player_api.php`);
    url.searchParams.set("username", apiCredentials.username);
    url.searchParams.set("password", apiCredentials.password);

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
    return this.getArrayResponse<XtreamCategory>("get_live_categories");
  }

  async getLiveStreams(categoryId?: string): Promise<XtreamLiveStream[]> {
    const params: Record<string, string> = categoryId ? { category_id: categoryId } : {};
    return this.getArrayResponse<XtreamLiveStream>("get_live_streams", params);
  }

  async getVODCategories(): Promise<XtreamCategory[]> {
    return this.getArrayResponse<XtreamCategory>("get_vod_categories");
  }

  async getVODStreams(categoryId?: string): Promise<XtreamVOD[]> {
    const params: Record<string, string> = categoryId ? { category_id: categoryId } : {};
    return this.getArrayResponse<XtreamVOD>("get_vod_streams", params);
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
    return this.getArrayResponse<XtreamCategory>("get_series_categories");
  }

  async getSeries(categoryId?: string): Promise<XtreamSeries[]> {
    const params: Record<string, string> = categoryId ? { category_id: categoryId } : {};
    return this.getArrayResponse<XtreamSeries>("get_series", params);
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
    const apiCredentials = this.resolveApiCredentials(this.credentials);
    const url = new URL(`${apiCredentials.server}/xmltv.php`);
    url.searchParams.set("username", apiCredentials.username);
    url.searchParams.set("password", apiCredentials.password);
    return this.http.getText(url.toString());
  }

  private async getArrayResponse<T>(
    action: string,
    params: Record<string, string> = {},
  ): Promise<T[]> {
    const payload = await this.http.get<unknown>(this.buildUrl(action, params));
    if (!Array.isArray(payload)) {
      throw new Error(`Unexpected Xtream API response for ${action}`);
    }
    return payload as T[];
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
    const candidates = this.getCatchUpUrlVariants(streamId, startTimestamp, duration);
    if (candidates.length === 0) {
      throw new Error("Unable to build catch-up URL");
    }
    return candidates[0];
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

    const startCandidates = XtreamCodesService.resolveTimeshiftStartCandidates(
      startTimestamp,
      this.usesLocalOnlyTimeshiftStart(),
    );
    const durationCandidates = XtreamCodesService.resolveTimeshiftDurationCandidates(duration);
    const urls: string[] = [];

    for (const startTime of startCandidates) {
      for (const durationCandidate of durationCandidates) {
        const url = new URL(`${credentials.server}/streaming/timeshift.php`);
        url.searchParams.set("username", credentials.username);
        url.searchParams.set("password", credentials.password);
        url.searchParams.set("stream", String(streamId));
        url.searchParams.set("start", startTime);
        url.searchParams.set("duration", String(durationCandidate));
        url.searchParams.set("extension", "m3u8");
        urls.push(url.toString());
      }
    }

    return XtreamCodesService.filterUniqueUrls(urls);
  }

  getCatchUpRedirectUrl(
    streamId: number,
    startTimestamp: number,
    duration: number,
  ): string {
    const candidates = this.getCatchUpRedirectUrlVariants(streamId, startTimestamp, duration);
    if (candidates.length === 0) {
      throw new Error("Unable to build redirect catch-up URL");
    }
    return candidates[0];
  }

  getCatchUpRedirectUrlVariants(
    streamId: number,
    startTimestamp: number,
    duration: number,
  ): string[] {
    const urls = XtreamCodesService.CATCH_UP_REDIRECT_PATHS.flatMap((candidate) => (
      this.buildTimeshiftPathCatchUpVariants(streamId, startTimestamp, duration, {
        serverOrigin: this.credentials?.server ?? "",
        basePath: candidate.basePath,
        extensions: [...candidate.extensions],
        includeEpochStart: false,
      })
    ));

    return XtreamCodesService.filterUniqueUrls(urls);
  }

  getLegacyCatchUpUrl(
    streamId: number,
    startTimestamp: number,
    duration: number,
  ): string {
    const candidates = this.getLegacyCatchUpUrlVariants(streamId, startTimestamp, duration);
    if (candidates.length === 0) {
      throw new Error("Unable to build legacy catch-up URL");
    }
    return candidates[0];
  }

  getLegacyCatchUpUrlVariants(
    streamId: number,
    startTimestamp: number,
    duration: number,
  ): string[] {
    return this.buildTimeshiftPathCatchUpVariants(streamId, startTimestamp, duration, {
      serverOrigin: this.credentials?.server ?? "",
      basePath: "/timeshift",
      extensions: ["m3u8"],
      includeEpochStart: true,
    });
  }

  private buildTimeshiftPathCatchUpVariants(
    streamId: number,
    startTimestamp: number,
    duration: number,
    options: {
      serverOrigin: string;
      basePath: string;
      extensions: string[];
      includeEpochStart: boolean;
    },
  ): string[] {
    if (!this.credentials) {
      throw new Error("Credentials not set");
    }

    const durationCandidates = XtreamCodesService.resolveTimeshiftDurationCandidates(duration);
    const formattedStartCandidates = XtreamCodesService.resolveTimeshiftStartCandidates(
      startTimestamp,
      this.usesLocalOnlyTimeshiftStart(),
    );
    const startCandidates = options.includeEpochStart
      ? [...formattedStartCandidates, String(Math.floor(startTimestamp))]
      : formattedStartCandidates;
    const extensionCandidates = options.extensions
      .map((extension) => extension.trim())
      .filter((extension, index, extensions) => (
        extension.length > 0 && extensions.indexOf(extension) === index
      ));

    const urls: string[] = [];
    for (const extension of extensionCandidates) {
      for (const startCandidate of startCandidates) {
        for (const durationCandidate of durationCandidates) {
          urls.push(
            `${options.serverOrigin}${options.basePath}/${this.credentials.username}/${this.credentials.password}/${durationCandidate}/${startCandidate}/${streamId}.${extension}`,
          );
        }
      }
    }

    return XtreamCodesService.filterUniqueUrls(urls);
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

  private usesLocalOnlyTimeshiftStart(): boolean {
    if (!this.credentials) {
      return false;
    }

    const host = XtreamCodesService.resolveServerHost(this.credentials.server);
    if (!host) {
      return false;
    }

    return (
      host === "mediaking.fi" ||
      host.endsWith(".mediaking.fi") ||
      host === "castcdn.net" ||
      host.endsWith(".castcdn.net") ||
      host === "79.137.99.121"
    );
  }

  private static resolveServerHost(server: string): string | null {
    try {
      const parsed = new URL(server);
      const proxiedTargetMatch = parsed.pathname.match(/^\/xui-api\/([^/?#]+)/);
      if (!proxiedTargetMatch?.[1]) {
        return parsed.hostname.toLowerCase();
      }

      const decodedTarget = decodeURIComponent(proxiedTargetMatch[1]).trim();
      if (!decodedTarget) {
        return parsed.hostname.toLowerCase();
      }

      const upstreamUrl = new URL(decodedTarget.includes("://") ? decodedTarget : `http://${decodedTarget}`);
      return upstreamUrl.hostname.toLowerCase();
    } catch {
      return null;
    }
  }

  private static resolveTimeshiftStartCandidates(
    startTimestamp: number,
    localOnly = false,
  ): string[] {
    const localStart = XtreamCodesService.formatTimeshiftStart(startTimestamp);
    if (localOnly) {
      return [localStart];
    }

    const utcStart = XtreamCodesService.formatTimeshiftStartUtc(startTimestamp);
    if (localStart === utcStart) {
      return [localStart];
    }

    return [localStart, utcStart];
  }

  private static resolveTimeshiftDurationCandidates(duration: number): number[] {
    const normalizedSeconds = Math.max(1, Math.floor(duration));
    const normalizedMinutes = Math.max(1, Math.round(normalizedSeconds / 60));

    if (normalizedMinutes === normalizedSeconds) {
      return [normalizedMinutes];
    }

    return [normalizedMinutes, normalizedSeconds];
  }

  private static filterUniqueUrls(urls: string[]): string[] {
    return urls.filter((url, index, allUrls) => allUrls.indexOf(url) === index);
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
