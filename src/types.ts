export interface ResearchSession {
  id: string;
  niche: string;
  keywords: string[];
  status: "pending" | "running" | "complete" | "failed";
  createdAt: string;
  completedAt: string | null;
  channels: ChannelData[];
  analysis: NicheAnalysis | null;
  recommendation: Recommendation | null;
}

export interface ChannelData {
  channelId: string;
  title: string;
  description: string;
  subscriberCount: number;
  viewCount: number;
  videoCount: number;
  publishedAt: string;
  thumbnailUrl: string;
  recentVideos: VideoData[];
}

export interface VideoData {
  videoId: string;
  title: string;
  publishedAt: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  duration: string;
  tags: string[];
}

export interface NicheAnalysis {
  saturation: "undersaturated" | "balanced" | "oversaturated";
  saturationScore: number;
  avgSubscribers: number;
  avgViews: number;
  avgUploadFrequency: number;
  topFormats: string[];
  trendDirection: "growing" | "stable" | "declining";
  relatedNiches: string[];
}

export interface Recommendation {
  verdict: "profitable" | "not_profitable" | "needs_more_data";
  confidence: number;
  summary: string;
  strengths: string[];
  risks: string[];
}
