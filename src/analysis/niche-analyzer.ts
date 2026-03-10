import { ChannelData, NicheAnalysis, Recommendation } from "../types";

export class NicheAnalyzer {
  analyze(channels: ChannelData[]): NicheAnalysis {
    if (channels.length === 0) {
      return {
        saturation: "undersaturated",
        saturationScore: 0,
        avgSubscribers: 0,
        avgViews: 0,
        avgUploadFrequency: 0,
        topFormats: [],
        trendDirection: "stable",
        relatedNiches: [],
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

    // Upload frequency: avg videos per channel as proxy
    const avgUploadFrequency = avgVideoCount;

    // Format analysis from recent videos
    const topFormats = this.detectFormats(channels);

    // Trend direction from recent video performance
    const trendDirection = this.detectTrend(channels);

    return {
      saturation,
      saturationScore,
      avgSubscribers,
      avgViews,
      avgUploadFrequency,
      topFormats,
      trendDirection,
      relatedNiches: [], // populated by Chrome extraction layer later
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

    // Simple weighted score
    let score = 50;
    score += analysis.saturation === "undersaturated" ? 15 : analysis.saturation === "oversaturated" ? -15 : 0;
    score += analysis.trendDirection === "growing" ? 15 : analysis.trendDirection === "declining" ? -15 : 0;
    score += analysis.avgViews > 500_000 ? 10 : analysis.avgViews < 10_000 ? -10 : 0;
    score = Math.max(0, Math.min(100, score));

    const verdict = score >= 55 ? "profitable" : score <= 40 ? "not_profitable" : "needs_more_data";
    const confidence = Math.min(channels.length / 20, 1) * 100; // more channels = higher confidence

    return {
      verdict,
      confidence: Math.round(confidence),
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

    // Compare avg views of newer half vs older half
    const sorted = [...allVideos].sort(
      (a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime()
    );
    const mid = Math.floor(sorted.length / 2);
    const olderAvg = avg(sorted.slice(0, mid).map((v) => v.viewCount));
    const newerAvg = avg(sorted.slice(mid).map((v) => v.viewCount));

    const ratio = olderAvg > 0 ? newerAvg / olderAvg : 1;
    if (ratio > 1.2) return "growing";
    if (ratio < 0.8) return "declining";
    return "stable";
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

function isShort(duration: string): boolean {
  // ISO 8601 duration: PT1M30S, PT60S, etc.
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return false;
  const hours = parseInt(match[1] ?? "0", 10);
  const minutes = parseInt(match[2] ?? "0", 10);
  const seconds = parseInt(match[3] ?? "0", 10);
  return hours === 0 && minutes === 0 && seconds <= 60;
}
