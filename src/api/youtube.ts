import { google, youtube_v3 } from "googleapis";
import { ChannelData, VideoData } from "../types";
import { withRetry } from "./retry";
import { RateLimiter } from "./rate-limiter";

// Quota costs per API method (YouTube Data API v3)
const QUOTA_COSTS: Record<string, number> = {
  search: 100,
  channels: 1,
  videos: 1,
  playlistItems: 1,
};

export interface QuotaUsage {
  used: number;
  limit: number;
  remaining: number;
  resetAt: string; // midnight Pacific time
  breakdown: Record<string, { calls: number; units: number }>;
}

export class YouTubeAPI {
  private yt: youtube_v3.Youtube;
  private limiter: RateLimiter;

  // Quota tracking (resets daily at midnight Pacific)
  private quotaUsed = 0;
  private quotaLimit = 10_000;
  private quotaBreakdown: Record<string, { calls: number; units: number }> = {};
  private quotaDay: string;

  constructor(apiKey: string) {
    this.yt = google.youtube({ version: "v3", auth: apiKey });
    this.limiter = new RateLimiter(5, 200);
    this.quotaDay = this.getPacificDate();
  }

  private getPacificDate(): string {
    return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  }

  private getNextResetTime(): string {
    // Next midnight Pacific
    const now = new Date();
    const pacific = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
    const tomorrow = new Date(pacific);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    // Convert back to UTC ISO string (approximate)
    const diffMs = tomorrow.getTime() - pacific.getTime();
    return new Date(now.getTime() + diffMs).toISOString();
  }

  private trackQuota(method: string): void {
    const today = this.getPacificDate();
    if (today !== this.quotaDay) {
      // New day — reset
      this.quotaUsed = 0;
      this.quotaBreakdown = {};
      this.quotaDay = today;
    }
    const cost = QUOTA_COSTS[method] ?? 1;
    this.quotaUsed += cost;
    if (!this.quotaBreakdown[method]) {
      this.quotaBreakdown[method] = { calls: 0, units: 0 };
    }
    this.quotaBreakdown[method].calls += 1;
    this.quotaBreakdown[method].units += cost;
  }

  getQuotaUsage(): QuotaUsage {
    const today = this.getPacificDate();
    if (today !== this.quotaDay) {
      this.quotaUsed = 0;
      this.quotaBreakdown = {};
      this.quotaDay = today;
    }
    return {
      used: this.quotaUsed,
      limit: this.quotaLimit,
      remaining: Math.max(0, this.quotaLimit - this.quotaUsed),
      resetAt: this.getNextResetTime(),
      breakdown: { ...this.quotaBreakdown },
    };
  }

  async searchChannels(query: string, maxResults = 20): Promise<ChannelData[]> {
    this.trackQuota("search");
    const searchRes = await this.apiCall(
      () =>
        this.yt.search.list({
          part: ["snippet"],
          q: query,
          type: ["channel"],
          maxResults,
          order: "relevance",
        }),
      `searchChannels("${query}")`
    );

    const channelIds = (searchRes.data.items ?? [])
      .map((item) => item.snippet?.channelId)
      .filter((id): id is string => !!id);

    if (channelIds.length === 0) return [];

    this.trackQuota("channels");
    const channelRes = await this.apiCall(
      () =>
        this.yt.channels.list({
          part: ["snippet", "statistics"],
          id: channelIds,
        }),
      `channels.list(${channelIds.length} ids)`
    );

    return (channelRes.data.items ?? []).map((ch) => ({
      channelId: ch.id ?? "",
      title: ch.snippet?.title ?? "",
      description: ch.snippet?.description ?? "",
      subscriberCount: parseInt(ch.statistics?.subscriberCount ?? "0", 10),
      viewCount: parseInt(ch.statistics?.viewCount ?? "0", 10),
      videoCount: parseInt(ch.statistics?.videoCount ?? "0", 10),
      publishedAt: ch.snippet?.publishedAt ?? "",
      thumbnailUrl: ch.snippet?.thumbnails?.medium?.url ?? "",
      recentVideos: [],
    }));
  }

  async getChannelVideos(channelId: string, maxResults = 10): Promise<VideoData[]> {
    // Use playlistItems.list (1 unit) instead of search.list (100 units)
    // Every channel's uploads playlist ID = channel ID with "UC" replaced by "UU"
    const uploadsPlaylistId = "UU" + channelId.slice(2);

    this.trackQuota("playlistItems");
    const playlistRes = await this.apiCall(
      () =>
        this.yt.playlistItems.list({
          part: ["snippet"],
          playlistId: uploadsPlaylistId,
          maxResults,
        }),
      `playlistItems.list("${uploadsPlaylistId}")`
    );

    const videoIds = (playlistRes.data.items ?? [])
      .map((item) => item.snippet?.resourceId?.videoId)
      .filter((id): id is string => !!id);

    if (videoIds.length === 0) return [];

    this.trackQuota("videos");
    const videoRes = await this.apiCall(
      () =>
        this.yt.videos.list({
          part: ["snippet", "statistics", "contentDetails"],
          id: videoIds,
        }),
      `videos.list(${videoIds.length} ids)`
    );

    return (videoRes.data.items ?? []).map((v) => ({
      videoId: v.id ?? "",
      title: v.snippet?.title ?? "",
      publishedAt: v.snippet?.publishedAt ?? "",
      viewCount: parseInt(v.statistics?.viewCount ?? "0", 10),
      likeCount: parseInt(v.statistics?.likeCount ?? "0", 10),
      commentCount: parseInt(v.statistics?.commentCount ?? "0", 10),
      duration: v.contentDetails?.duration ?? "",
      tags: v.snippet?.tags ?? [],
    }));
  }

  async getChannelWithVideos(channelId: string): Promise<ChannelData | null> {
    this.trackQuota("channels");
    const channelRes = await this.apiCall(
      () =>
        this.yt.channels.list({
          part: ["snippet", "statistics"],
          id: [channelId],
        }),
      `getChannelWithVideos("${channelId}")`
    );

    const ch = channelRes.data.items?.[0];
    if (!ch) return null;

    const recentVideos = await this.getChannelVideos(channelId);

    return {
      channelId: ch.id ?? "",
      title: ch.snippet?.title ?? "",
      description: ch.snippet?.description ?? "",
      subscriberCount: parseInt(ch.statistics?.subscriberCount ?? "0", 10),
      viewCount: parseInt(ch.statistics?.viewCount ?? "0", 10),
      videoCount: parseInt(ch.statistics?.videoCount ?? "0", 10),
      publishedAt: ch.snippet?.publishedAt ?? "",
      thumbnailUrl: ch.snippet?.thumbnails?.medium?.url ?? "",
      recentVideos,
    };
  }

  private apiCall<T>(fn: () => Promise<T>, label: string): Promise<T> {
    return this.limiter.wrap(() => withRetry(fn, label));
  }
}
