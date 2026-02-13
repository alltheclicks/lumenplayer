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
  private credentials: XtreamCredentials | null = null;
  private http: HttpClient;

  constructor(http: HttpClient) {
    this.http = http;
  }

  setCredentials(credentials: XtreamCredentials | null): void {
    this.credentials = credentials;
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

  async getEPG(streamId: string): Promise<XtreamEPGItem[]> {
    const data = await this.http.get<{ epg_listings?: XtreamEPGItem[] }>(
      this.buildUrl("get_short_epg", { stream_id: streamId }),
    );
    return data.epg_listings || [];
  }

  async getFullEPG(): Promise<Record<string, XtreamEPGItem[]>> {
    return this.http.get<Record<string, XtreamEPGItem[]>>(
      this.buildUrl("get_simple_data_table", { stream_id: "all" }),
    );
  }

  getLiveStreamUrl(streamId: number, extension = "m3u8"): string {
    if (!this.credentials) {
      throw new Error("Credentials not set");
    }
    return `${this.credentials.server}/live/${this.credentials.username}/${this.credentials.password}/${streamId}.${extension}`;
  }

  getVODStreamUrl(streamId: number, extension: string): string {
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
    startTime: number,
    duration: number,
  ): string {
    if (!this.credentials) {
      throw new Error("Credentials not set");
    }
    return `${this.credentials.server}/timeshift/${this.credentials.username}/${this.credentials.password}/${duration}/${startTime}/${streamId}.m3u8`;
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
}
