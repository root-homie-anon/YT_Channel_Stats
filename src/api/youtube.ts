import { google, youtube_v3 } from "googleapis";
import { ChannelData, VideoData } from "../types";

export class YouTubeAPI {
  private yt: youtube_v3.Youtube;

  constructor(apiKey: string) {
    this.yt = google.youtube({ version: "v3", auth: apiKey });
  }

  async searchChannels(query: string, maxResults = 20): Promise<ChannelData[]> {
    const searchRes = await this.yt.search.list({
      part: ["snippet"],
      q: query,
      type: ["channel"],
      maxResults,
      order: "relevance",
    });

    const channelIds = (searchRes.data.items ?? [])
      .map((item) => item.snippet?.channelId)
      .filter((id): id is string => !!id);

    if (channelIds.length === 0) return [];

    const channelRes = await this.yt.channels.list({
      part: ["snippet", "statistics"],
      id: channelIds,
    });

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
    const searchRes = await this.yt.search.list({
      part: ["snippet"],
      channelId,
      type: ["video"],
      maxResults,
      order: "date",
    });

    const videoIds = (searchRes.data.items ?? [])
      .map((item) => item.id?.videoId)
      .filter((id): id is string => !!id);

    if (videoIds.length === 0) return [];

    const videoRes = await this.yt.videos.list({
      part: ["snippet", "statistics", "contentDetails"],
      id: videoIds,
    });

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
    const channelRes = await this.yt.channels.list({
      part: ["snippet", "statistics"],
      id: [channelId],
    });

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
}
