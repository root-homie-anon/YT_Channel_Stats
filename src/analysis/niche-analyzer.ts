import { ChannelData, NicheAnalysis, Recommendation } from "../types";

export class NicheAnalyzer {
  analyze(channels: ChannelData[], nicheKeywords: string[] = []): NicheAnalysis {
    if (channels.length === 0) {
      return {
        saturation: "undersaturated",
        saturationScore: 0,
        avgSubscribers: 0,
        avgViews: 0,
        avgUploadFrequency: 0,
        uploadsPerWeek: 0,
        topFormats: [],
        trendDirection: "stable",
        relatedNiches: [],
        engagementRate: 0,
        avgLikesPerVideo: 0,
        avgCommentsPerVideo: 0,
      };
    }

    const avgSubscribers = avg(channels.map((c) => c.subscriberCount));
    const avgViews = avg(channels.map((c) => c.viewCount));
    const avgVideoCount = avg(channels.map((c) => c.videoCount));

    // Saturation scoring: channel count + avg subs + competition density
    const saturationScore = this.computeSaturation(channels);
    const saturation =
      saturationScore < 30
        ? "undersaturated"
        : saturationScore > 70
          ? "oversaturated"
          : "balanced";

    // Upload frequency: total video count as legacy metric
    const avgUploadFrequency = avgVideoCount;

    // Real upload cadence from recent video dates
    const uploadsPerWeek = this.computeUploadCadence(channels);

    // Format analysis from recent videos
    const topFormats = this.detectFormats(channels);

    // Trend direction from recent video performance
    const trendDirection = this.detectTrend(channels);

    // Related niches from tag co-occurrence
    const relatedNiches = this.discoverRelatedNiches(channels, nicheKeywords);

    // Engagement metrics
    const { engagementRate, avgLikesPerVideo, avgCommentsPerVideo } =
      this.computeEngagement(channels);

    return {
      saturation,
      saturationScore,
      avgSubscribers,
      avgViews,
      avgUploadFrequency,
      uploadsPerWeek,
      topFormats,
      trendDirection,
      relatedNiches,
      engagementRate,
      avgLikesPerVideo,
      avgCommentsPerVideo,
    };
  }

  recommend(analysis: NicheAnalysis, channels: ChannelData[]): Recommendation {
    if (channels.length === 0) {
      return {
        verdict: "needs_more_data",
        confidence: 0,
        summary: "No channels found for this niche. Cannot assess profitability.",
        strengths: [],
        risks: ["No data available"],
      };
    }

    // Edge case: very few channels — flag low confidence regardless of scores
    const lowData = channels.length < 3;

    const strengths: string[] = [];
    const risks: string[] = [];

    if (analysis.saturation === "undersaturated") {
      strengths.push("Low competition — room for new channels");
    }
    if (analysis.saturation === "oversaturated") {
      risks.push("High competition — difficult to break through");
    }
    if (analysis.trendDirection === "growing") {
      strengths.push("Niche is trending upward");
    }
    if (analysis.trendDirection === "declining") {
      risks.push("Niche appears to be declining");
    }
    if (analysis.avgViews > 1_000_000) {
      strengths.push("High average view counts indicate strong audience demand");
    }
    if (analysis.avgSubscribers > 100_000) {
      strengths.push("Established audience base in this niche");
    }
    if (analysis.avgSubscribers < 1_000) {
      risks.push("Very small existing audience — niche may lack demand");
    }

    // Engagement ratio: avg views / avg subscribers — high ratio = good engagement
    if (analysis.avgSubscribers > 0) {
      const engagementRatio = analysis.avgViews / analysis.avgSubscribers;
      if (engagementRatio > 200) {
        strengths.push("Strong view-to-subscriber ratio — high engagement niche");
      } else if (engagementRatio < 10) {
        risks.push("Low view-to-subscriber ratio — audience may not be engaged");
      }
    }

    // Format clarity as a signal
    if (analysis.topFormats.includes("shorts-dominant")) {
      strengths.push("Shorts-friendly niche — lower production cost to enter");
    }

    // Engagement signals
    if (analysis.engagementRate > 5) {
      strengths.push(`High engagement rate (${analysis.engagementRate}%) — active audience`);
    } else if (analysis.engagementRate > 0 && analysis.engagementRate < 1) {
      risks.push(`Low engagement rate (${analysis.engagementRate}%) — passive audience`);
    }

    // Upload cadence signal
    if (analysis.uploadsPerWeek > 5) {
      risks.push(`High upload cadence (${analysis.uploadsPerWeek}/wk) — demanding to compete`);
    } else if (analysis.uploadsPerWeek > 0 && analysis.uploadsPerWeek < 1) {
      strengths.push("Low upload cadence — easier to maintain competitive presence");
    }

    if (lowData) {
      risks.push("Very few channels found — results may not be representative");
    }

    // Weighted score
    let score = 50;
    score += analysis.saturation === "undersaturated" ? 15 : analysis.saturation === "oversaturated" ? -15 : 0;
    score += analysis.trendDirection === "growing" ? 15 : analysis.trendDirection === "declining" ? -15 : 0;
    score += analysis.avgViews > 500_000 ? 10 : analysis.avgViews < 10_000 ? -10 : 0;
    score = Math.max(0, Math.min(100, score));

    // Force needs_more_data if too few channels
    const verdict = lowData
      ? "needs_more_data"
      : score >= 55
        ? "profitable"
        : score <= 40
          ? "not_profitable"
          : "needs_more_data";

    const confidence = Math.round(Math.min(channels.length / 20, 1) * 100);

    return {
      verdict,
      confidence,
      summary: this.buildSummary(verdict, analysis),
      strengths,
      risks,
    };
  }

  private computeSaturation(channels: ChannelData[]): number {
    const count = channels.length;
    const avgSubs = avg(channels.map((c) => c.subscriberCount));

    // More channels + higher avg subs = more saturated
    let score = 0;
    score += Math.min(count / 20, 1) * 40; // up to 40 points from channel count
    score += Math.min(avgSubs / 500_000, 1) * 30; // up to 30 points from avg subs
    score += Math.min(avg(channels.map((c) => c.videoCount)) / 500, 1) * 30; // up to 30 from avg videos

    return Math.round(score);
  }

  private detectFormats(channels: ChannelData[]): string[] {
    const formats: string[] = [];
    const allVideos = channels.flatMap((c) => c.recentVideos);
    if (allVideos.length === 0) return ["unknown"];

    const shortCount = allVideos.filter((v) => isShort(v.duration)).length;
    const longCount = allVideos.length - shortCount;

    if (shortCount > longCount) {
      formats.push("shorts-dominant");
    } else if (longCount > shortCount * 2) {
      formats.push("long-form-dominant");
    } else {
      formats.push("mixed");
    }

    return formats;
  }

  private detectTrend(channels: ChannelData[]): "growing" | "stable" | "declining" {
    const allVideos = channels.flatMap((c) => c.recentVideos);
    if (allVideos.length < 5) return "stable";

    const now = Date.now();

    // Compute views-per-day for each video to normalize for video age.
    // Older videos naturally accumulate more raw views, so comparing raw
    // counts would almost always show a "declining" trend.
    const withRate = allVideos.map((v) => {
      const publishedMs = new Date(v.publishedAt).getTime();
      const ageDays = Math.max((now - publishedMs) / (24 * 60 * 60 * 1000), 1); // floor at 1 day
      return { publishedMs, viewsPerDay: v.viewCount / ageDays };
    });

    // Compare avg views-per-day of newer half vs older half
    const sorted = [...withRate].sort((a, b) => a.publishedMs - b.publishedMs);
    const mid = Math.floor(sorted.length / 2);
    const olderAvg = avg(sorted.slice(0, mid).map((v) => v.viewsPerDay));
    const newerAvg = avg(sorted.slice(mid).map((v) => v.viewsPerDay));

    const ratio = olderAvg > 0 ? newerAvg / olderAvg : 1;
    if (ratio > 1.2) return "growing";
    if (ratio < 0.8) return "declining";
    return "stable";
  }

  private computeUploadCadence(channels: ChannelData[]): number {
    const weeklyRates: number[] = [];

    for (const ch of channels) {
      if (ch.recentVideos.length < 2) continue;
      const dates = ch.recentVideos
        .map((v) => new Date(v.publishedAt).getTime())
        .filter((t) => !isNaN(t))
        .sort((a, b) => a - b);

      if (dates.length < 2) continue;
      const spanMs = dates[dates.length - 1] - dates[0];
      const spanWeeks = spanMs / (7 * 24 * 60 * 60 * 1000);
      if (spanWeeks > 0) {
        weeklyRates.push(dates.length / spanWeeks);
      }
    }

    return weeklyRates.length > 0 ? Math.round(avg(weeklyRates) * 10) / 10 : 0;
  }

  private computeEngagement(channels: ChannelData[]): {
    engagementRate: number;
    avgLikesPerVideo: number;
    avgCommentsPerVideo: number;
  } {
    const allVideos = channels.flatMap((c) => c.recentVideos);
    if (allVideos.length === 0) {
      return { engagementRate: 0, avgLikesPerVideo: 0, avgCommentsPerVideo: 0 };
    }

    const avgLikesPerVideo = Math.round(avg(allVideos.map((v) => v.likeCount)));
    const avgCommentsPerVideo = Math.round(avg(allVideos.map((v) => v.commentCount)));
    const avgViewsPerVideo = avg(allVideos.map((v) => v.viewCount));

    // Engagement rate: (likes + comments) / views * 100
    const engagementRate =
      avgViewsPerVideo > 0
        ? Math.round(((avgLikesPerVideo + avgCommentsPerVideo) / avgViewsPerVideo) * 10000) / 100
        : 0;

    return { engagementRate, avgLikesPerVideo, avgCommentsPerVideo };
  }

  discoverRelatedNiches(channels: ChannelData[], nicheKeywords: string[] = []): string[] {
    // Build set of primary niche terms to exclude
    const nicheTerms = new Set<string>();
    for (const kw of nicheKeywords) {
      for (const word of kw.toLowerCase().split(/\s+/)) {
        if (word.length > 2) nicheTerms.add(word);
      }
    }

    // Find tags that appear across multiple channels but aren't the main niche terms
    const tagChannelCount = new Map<string, Set<string>>();

    for (const ch of channels) {
      for (const v of ch.recentVideos) {
        for (const tag of v.tags) {
          const t = tag.toLowerCase().trim();
          if (t.length < 4 || GENERIC_TAGS.has(t)) continue;

          // Skip tags that are just the niche keywords
          const words = t.split(/\s+/);
          const isNicheTerm = words.every((w) => nicheTerms.has(w));
          if (isNicheTerm) continue;

          if (!tagChannelCount.has(t)) tagChannelCount.set(t, new Set());
          tagChannelCount.get(t)!.add(ch.channelId);
        }
      }
    }

    // Tags appearing in 2+ channels but fewer than half = related niche signal
    const channelCount = channels.length;
    const related: Array<{ tag: string; count: number }> = [];

    for (const [tag, channelSet] of tagChannelCount) {
      const count = channelSet.size;
      if (count >= 2 && count < channelCount * 0.6) {
        related.push({ tag, count });
      }
    }

    return related
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .map((r) => r.tag);
  }

  private buildSummary(verdict: string, analysis: NicheAnalysis): string {
    const satLabel = analysis.saturation;
    const trend = analysis.trendDirection;
    if (verdict === "profitable") {
      return `This niche looks ${satLabel} and is ${trend}. Good opportunity to enter.`;
    }
    if (verdict === "not_profitable") {
      return `This niche is ${satLabel} and ${trend}. High risk with limited upside.`;
    }
    return `Niche is ${satLabel} and ${trend}. More data needed for a confident recommendation.`;
  }
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

const GENERIC_TAGS = new Set([
  "youtube", "video", "videos", "subscribe", "like", "comment", "share",
  "trending", "viral", "shorts", "short", "tutorial", "tips", "how to",
  "2024", "2025", "2026", "best", "top", "new", "free", "easy",
]);

function isShort(duration: string): boolean {
  // ISO 8601 duration: PT1M30S, PT60S, etc.
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return false;
  const hours = parseInt(match[1] ?? "0", 10);
  const minutes = parseInt(match[2] ?? "0", 10);
  const seconds = parseInt(match[3] ?? "0", 10);
  return hours === 0 && minutes === 0 && seconds <= 60;
}
