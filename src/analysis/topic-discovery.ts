import { ResearchSession, ChannelData, VideoData } from "../types";

export interface TopicVideo {
  title: string;
  videoId: string;
  viewCount: number;
}

export interface TopicSuggestion {
  topic: string;
  score: number;
  source: "tag_frequency" | "title_pattern" | "engagement_spike";
  evidence: string;
  topVideos: TopicVideo[];
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

    // Build relevance keywords from niche name + session keywords
    const nicheTerms = [
      ...session.niche.toLowerCase().split(/\s+/),
      ...session.keywords.map((k) => k.toLowerCase()),
    ].filter((w) => w.length > 2);

    // Check if a single video is niche-relevant
    const isVideoRelevant = (v: VideoData): boolean => {
      const titleLower = v.title.toLowerCase();
      const tagsLower = v.tags.map((t) => t.toLowerCase());
      return nicheTerms.some(
        (term) =>
          fuzzyMatch(titleLower, term) ||
          tagsLower.some((tag) => fuzzyMatch(tag, term))
      );
    };

    // Filter each channel's videos to only niche-relevant ones.
    // If channel name matches AND majority of its videos are relevant,
    // keep all videos. Otherwise filter per-video.
    // Also filter out non-English videos.
    const filteredChannels: ChannelData[] = session.channels.map((ch) => {
      const chText = ch.title.toLowerCase() + " " + (ch.description ?? "").toLowerCase();
      const chNameMatches = nicheTerms.some((term) => fuzzyMatch(chText, term));
      const englishVideos = ch.recentVideos.filter((v) => isLikelyEnglish(v.title));
      const relevantCount = englishVideos.filter(isVideoRelevant).length;
      const majorityRelevant = relevantCount > englishVideos.length * 0.5;

      return {
        ...ch,
        recentVideos: englishVideos.filter((v) => {
          // Channel name matches AND most videos are on-topic — keep all
          if (chNameMatches && majorityRelevant) return true;
          return isVideoRelevant(v);
        }),
      };
    }).filter((ch) => ch.recentVideos.length > 0);

    const suggestions: TopicSuggestion[] = [];

    suggestions.push(...this.findHighFrequencyTags(filteredChannels));
    suggestions.push(...this.findTitlePatterns(filteredChannels));
    suggestions.push(...this.findEngagementSpikes(filteredChannels));

    // Deduplicate by topic name (case-insensitive), keep highest score
    const seen = new Map<string, TopicSuggestion>();
    for (const s of suggestions) {
      const key = s.topic.toLowerCase();
      const existing = seen.get(key);
      if (!existing || s.score > existing.score) {
        seen.set(key, s);
      }
    }

    // Post-filter: drop topics that aren't genuinely niche-related
    // Build a lookup of videoId -> tags for co-occurrence checks
    const videoTagMap = new Map<string, string[]>();
    for (const ch of filteredChannels) {
      for (const v of ch.recentVideos) {
        videoTagMap.set(v.videoId, v.tags.map((t) => t.toLowerCase()));
      }
    }

    const filtered = Array.from(seen.values()).filter((s) => {
      // Must be English text
      if (!isLikelyEnglish(s.topic)) return false;
      // Keep if topic itself contains a niche term
      const topicLower = s.topic.toLowerCase();
      if (nicheTerms.some((term) => fuzzyMatch(topicLower, term))) return true;
      // Keep if at least one top video's title (without hashtags) is niche-relevant
      if (s.topVideos.some((v) => {
        const cleanTitle = v.title.toLowerCase().replace(/#\S+/g, "").trim();
        return nicheTerms.some((term) => fuzzyMatch(cleanTitle, term));
      })) return true;
      // Keep engagement spikes (already filtered to relevant videos)
      if (s.source === "engagement_spike") return true;
      return false;
    });

    return filtered
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private findHighFrequencyTags(channels: ChannelData[]): TopicSuggestion[] {
    const tagCounts = new Map<string, number>();
    const tagWeightedViews = new Map<string, number[]>();
    const tagVideos = new Map<string, TopicVideo[]>();

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
          const vids = tagVideos.get(t) ?? [];
          vids.push({ title: v.title, videoId: v.videoId, viewCount: v.viewCount });
          tagVideos.set(t, vids);
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

      const topVideos = (tagVideos.get(tag) ?? [])
        .sort((a, b) => b.viewCount - a.viewCount)
        .slice(0, 10);

      results.push({
        topic: tag,
        score: Math.round(score),
        source: "tag_frequency",
        evidence: `Appears in ${count} videos, avg ${formatNumber(avgViews)} views (recency-weighted)`,
        topVideos,
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
    const phraseVideos = new Map<string, TopicVideo[]>();

    for (const v of allVideos) {
      const recency = recencyMultiplier(v.publishedAt);
      const words = v.title
        .toLowerCase()
        .replace(/#\S+/g, "")         // remove hashtags entirely
        .replace(/[^\w\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 2 && w.length < 30 && !STOP_WORDS.has(w));

      // Bigrams and trigrams
      const addedPhrases = new Set<string>();
      for (let len = 2; len <= 3; len++) {
        for (let i = 0; i <= words.length - len; i++) {
          const phrase = words.slice(i, i + len).join(" ");
          phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1);
          const views = phraseViews.get(phrase) ?? [];
          views.push(v.viewCount * recency);
          phraseViews.set(phrase, views);
          // Only add the video once per phrase (a title can match multiple n-grams)
          if (!addedPhrases.has(phrase)) {
            addedPhrases.add(phrase);
            const vids = phraseVideos.get(phrase) ?? [];
            vids.push({ title: v.title, videoId: v.videoId, viewCount: v.viewCount });
            phraseVideos.set(phrase, vids);
          }
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

      const topVideos = (phraseVideos.get(phrase) ?? [])
        .sort((a, b) => b.viewCount - a.viewCount)
        .slice(0, 10);

      results.push({
        topic: phrase,
        score: Math.round(score),
        source: "title_pattern",
        evidence: `Found in ${count} video titles, avg ${formatNumber(avgViews)} views (recency-weighted)`,
        topVideos,
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
            topVideos: [{ title: v.title, videoId: v.videoId, viewCount: v.viewCount }],
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

/**
 * Fuzzy substring match — returns true if text contains a string
 * similar to term (allows 1 character difference for terms >= 5 chars).
 * Handles common alternate spellings (e.g. annunaki/anunnaki).
 */
function fuzzyMatch(text: string, term: string): boolean {
  // Exact substring match first
  if (text.includes(term)) return true;
  // For short terms, exact only
  if (term.length < 5) return false;
  // Sliding window: allow edit distance of 1
  for (let i = 0; i <= text.length - term.length; i++) {
    const window = text.substring(i, i + term.length);
    if (editDistance1(window, term)) return true;
  }
  // Also try with ±1 length windows for insertions/deletions
  for (let i = 0; i <= text.length - term.length - 1; i++) {
    const window = text.substring(i, i + term.length + 1);
    if (editDistance1(window, term)) return true;
  }
  if (term.length > 1) {
    for (let i = 0; i <= text.length - term.length + 1; i++) {
      const window = text.substring(i, i + term.length - 1);
      if (editDistance1(window, term)) return true;
    }
  }
  return false;
}

function editDistance1(a: string, b: string): boolean {
  if (a === b) return true;
  const lenDiff = Math.abs(a.length - b.length);
  if (lenDiff > 1) return false;
  if (lenDiff === 0) {
    // substitution: exactly 1 char different
    let diffs = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) diffs++;
      if (diffs > 1) return false;
    }
    return diffs === 1;
  }
  // insertion/deletion
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  let si = 0, li = 0, diffs = 0;
  while (si < shorter.length && li < longer.length) {
    if (shorter[si] !== longer[li]) {
      diffs++;
      if (diffs > 1) return false;
      li++;
    } else {
      si++;
      li++;
    }
  }
  return true;
}

/**
 * Heuristic: a text is likely English if it uses basic Latin characters
 * and doesn't contain common non-English patterns.
 * Two-pass: (1) reject non-Latin scripts, (2) reject accented-heavy text.
 */
function isLikelyEnglish(text: string): boolean {
  // Pass 1: reject non-Latin scripts (Cyrillic, Arabic, CJK, Korean, etc.)
  const nonLatin = text.replace(/[a-zA-Z\u00C0-\u024F0-9\s\p{P}\p{S}]/gu, "");
  if (nonLatin.length > text.length * 0.15) return false;
  // Pass 2: reject text heavy on accented characters (Portuguese, Spanish, French, etc.)
  const alphaOnly = text.replace(/[^a-zA-Z\u00C0-\u024F]/g, "");
  if (alphaOnly.length === 0) return true;
  const accented = alphaOnly.replace(/[a-zA-Z]/g, "").length;
  if (accented / alphaOnly.length > 0.1) return false;
  // Pass 3: for short text (topic names), check words against common non-English markers
  const words = text.toLowerCase().split(/\s+/);
  const nonEnglishMarkers = new Set([
    "são", "não", "como", "para", "isso", "mais", "pode", "quem", "seus", "pela",
    "uma", "dos", "das", "nos", "nas", "por", "com", "que", "les", "des", "est",
    "une", "ont", "dans", "sur", "avec", "pas", "der", "die", "und", "ein", "ist",
    "mit", "von", "auf", "del", "los", "las", "por", "era", "fue", "muy",
    "deuses", "foram", "sobre", "depois", "antes", "também", "então", "ainda",
  ]);
  const markerCount = words.filter((w) => nonEnglishMarkers.has(w)).length;
  if (markerCount >= 2 || (words.length <= 4 && markerCount >= 1)) return false;
  return true;
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
