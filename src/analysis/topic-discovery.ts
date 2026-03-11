import { ResearchSession, ChannelData, VideoData } from "../types";

export interface TopicSuggestion {
  topic: string;
  score: number;
  source: "tag_frequency" | "title_pattern" | "engagement_spike";
  evidence: string;
}

/**
 * Discovers high-potential topics from research session data.
 * Analyzes video titles, tags, and engagement patterns to find
 * content opportunities within a niche.
 *
 * This is the foundation for the YT_Channel_Auto integration endpoint.
 */
export class TopicDiscovery {
  discover(session: ResearchSession, limit = 20): TopicSuggestion[] {
    if (session.channels.length === 0) return [];

    const suggestions: TopicSuggestion[] = [];

    suggestions.push(...this.findHighFrequencyTags(session.channels));
    suggestions.push(...this.findTitlePatterns(session.channels));
    suggestions.push(...this.findEngagementSpikes(session.channels));

    // Deduplicate by topic name (case-insensitive), keep highest score
    const seen = new Map<string, TopicSuggestion>();
    for (const s of suggestions) {
      const key = s.topic.toLowerCase();
      const existing = seen.get(key);
      if (!existing || s.score > existing.score) {
        seen.set(key, s);
      }
    }

    return Array.from(seen.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private findHighFrequencyTags(channels: ChannelData[]): TopicSuggestion[] {
    const tagCounts = new Map<string, number>();
    const tagWeightedViews = new Map<string, number[]>();

    for (const ch of channels) {
      for (const v of ch.recentVideos) {
        const recency = recencyMultiplier(v.publishedAt);
        for (const tag of v.tags) {
          const t = tag.toLowerCase().trim();
          if (t.length < 3 || STOP_TAGS.has(t)) continue;
          tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
          const views = tagWeightedViews.get(t) ?? [];
          views.push(v.viewCount * recency);
          tagWeightedViews.set(t, views);
        }
      }
    }

    const results: TopicSuggestion[] = [];
    for (const [tag, count] of tagCounts) {
      if (count < 3) continue; // need at least 3 occurrences
      const views = tagWeightedViews.get(tag) ?? [];
      const avgViews = views.reduce((a, b) => a + b, 0) / views.length;
      // Score: frequency contributes up to 40, view performance (recency-weighted) up to 60
      const freqScore = Math.min(count / 50, 1) * 40;
      const viewScore = Math.min(Math.log10(avgViews + 1) / 7, 1) * 60; // log10(10M)=7 is max
      const score = Math.round(freqScore + viewScore);

      results.push({
        topic: tag,
        score: Math.round(score),
        source: "tag_frequency",
        evidence: `Appears in ${count} videos, avg ${formatNumber(avgViews)} views (recency-weighted)`,
      });
    }

    return results;
  }

  private findTitlePatterns(channels: ChannelData[]): TopicSuggestion[] {
    const allVideos = channels.flatMap((c) => c.recentVideos);
    if (allVideos.length === 0) return [];

    // Extract 2-3 word phrases from titles
    const phraseCounts = new Map<string, number>();
    const phraseViews = new Map<string, number[]>();

    for (const v of allVideos) {
      const recency = recencyMultiplier(v.publishedAt);
      const words = v.title
        .toLowerCase()
        .replace(/[^\w\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

      // Bigrams and trigrams
      for (let len = 2; len <= 3; len++) {
        for (let i = 0; i <= words.length - len; i++) {
          const phrase = words.slice(i, i + len).join(" ");
          phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1);
          const views = phraseViews.get(phrase) ?? [];
          views.push(v.viewCount * recency);
          phraseViews.set(phrase, views);
        }
      }
    }

    const results: TopicSuggestion[] = [];
    for (const [phrase, count] of phraseCounts) {
      if (count < 3) continue;
      const views = phraseViews.get(phrase) ?? [];
      const avgViews = views.reduce((a, b) => a + b, 0) / views.length;
      const freqScore = Math.min(count / 40, 1) * 35;
      const viewScore = Math.min(Math.log10(avgViews + 1) / 7, 1) * 55;
      const score = Math.round(freqScore + viewScore);

      results.push({
        topic: phrase,
        score: Math.round(score),
        source: "title_pattern",
        evidence: `Found in ${count} video titles, avg ${formatNumber(avgViews)} views (recency-weighted)`,
      });
    }

    return results;
  }

  private findEngagementSpikes(channels: ChannelData[]): TopicSuggestion[] {
    const allVideos = channels.flatMap((c) =>
      c.recentVideos.map((v) => ({ ...v, channelTitle: c.title }))
    );
    if (allVideos.length < 5) return [];

    // Find videos with views significantly above channel average
    const channelAvgViews = new Map<string, number>();
    for (const ch of channels) {
      if (ch.recentVideos.length === 0) continue;
      const avg = ch.recentVideos.reduce((s, v) => s + v.viewCount, 0) / ch.recentVideos.length;
      channelAvgViews.set(ch.title, avg);
    }

    const results: TopicSuggestion[] = [];
    for (const v of allVideos) {
      const chAvg = channelAvgViews.get(v.channelTitle) ?? 0;
      if (chAvg === 0) continue;

      const ratio = v.viewCount / chAvg;
      if (ratio >= 3) {
        // This video got 3x+ the channel average — the topic resonated
        const mainWords = v.title
          .replace(/[^\w\s]/g, "")
          .split(/\s+/)
          .filter((w) => w.length > 3 && !STOP_WORDS.has(w.toLowerCase()))
          .slice(0, 4)
          .join(" ")
          .toLowerCase();

        if (mainWords.length > 5) {
          results.push({
            topic: mainWords,
            score: Math.min(Math.round(20 + ratio * 10), 95),
            source: "engagement_spike",
            evidence: `"${v.title}" got ${ratio.toFixed(1)}x the channel average (${formatNumber(v.viewCount)} views) on ${v.channelTitle}, published ${v.publishedAt.slice(0, 10)}`,
          });
        }
      }
    }

    return results;
  }
}

/**
 * Returns a decay multiplier based on video age.
 * 1.0 for videos published in the last 30 days,
 * 0.7 for 30-90 days, 0.4 for older than 90 days.
 */
function recencyMultiplier(publishedAt: string): number {
  const ageMs = Date.now() - new Date(publishedAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays <= 30) return 1.0;
  if (ageDays <= 90) return 0.7;
  return 0.4;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return Math.round(n).toString();
}

const STOP_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "had",
  "her", "was", "one", "our", "out", "has", "have", "been", "some",
  "them", "than", "its", "over", "also", "that", "this", "with", "will",
  "each", "make", "like", "from", "just", "what", "how", "why", "when",
  "who", "get", "got", "your", "they", "does", "did", "his", "she",
  "about", "would", "there", "their", "which", "could", "other",
  "into", "more", "very", "best", "most", "video", "videos",
]);

const STOP_TAGS = new Set([
  "youtube", "video", "videos", "subscribe", "like", "comment",
  "share", "trending", "viral", "shorts", "short",
]);
