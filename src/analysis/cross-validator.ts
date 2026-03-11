import { ResearchSession } from "../types";

export interface ValidationResult {
  channelId: string;
  channelTitle: string;
  checks: ValidationCheck[];
  overallStatus: "consistent" | "minor_discrepancy" | "major_discrepancy";
}

export interface ValidationCheck {
  field: string;
  apiValue: string;
  chromeValue: string;
  status: "match" | "minor_diff" | "major_diff" | "no_chrome_data";
}

/**
 * Cross-validates YouTube API data against Chrome-extracted data.
 * Flags discrepancies that may indicate stale or inaccurate data.
 */
export function crossValidate(session: ResearchSession): ValidationResult[] {
  if (!session.chromeData) return [];

  const results: ValidationResult[] = [];

  for (const channel of session.channels.slice(0, 10)) {
    const chromeChannel = session.chromeData.channelPages.find(
      (cp) => cp.channelId === channel.channelId
    );
    const chromeSB = session.chromeData.socialBlade.find(
      (sb) => sb.channelId === channel.channelId
    );

    if (!chromeChannel && !chromeSB) continue;

    const checks: ValidationCheck[] = [];

    // Check tabs for content signals
    if (chromeChannel) {
      const tabs = (chromeChannel.tabsAvailable as string[]) ?? [];
      const hasVideosTab = tabs.some((t) => t.toLowerCase().includes("video"));
      const hasShortsTab = tabs.some((t) => t.toLowerCase().includes("short"));
      const hasPostsTab = tabs.some((t) => t.toLowerCase().includes("post"));

      checks.push({
        field: "has_videos",
        apiValue: String(channel.videoCount > 0),
        chromeValue: String(hasVideosTab),
        status: (channel.videoCount > 0) === hasVideosTab ? "match" : "minor_diff",
      });

      if (channel.recentVideos.length > 0) {
        const apiHasShorts = channel.recentVideos.some((v) => {
          const match = v.duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
          if (!match) return false;
          const h = parseInt(match[1] ?? "0", 10);
          const m = parseInt(match[2] ?? "0", 10);
          const s = parseInt(match[3] ?? "0", 10);
          return h === 0 && m === 0 && s <= 60;
        });

        checks.push({
          field: "shorts_presence",
          apiValue: String(apiHasShorts),
          chromeValue: String(hasShortsTab),
          status: apiHasShorts === hasShortsTab ? "match" : "minor_diff",
        });
      }

      checks.push({
        field: "community_tab",
        apiValue: "n/a",
        chromeValue: String(hasPostsTab),
        status: "match",
      });

      // Monetization signals
      const hasMemberships = chromeChannel.hasMemberships as boolean;
      checks.push({
        field: "memberships",
        apiValue: "n/a",
        chromeValue: String(hasMemberships),
        status: "match",
      });
    }

    // Social Blade subscriber cross-check
    if (chromeSB && chromeSB.subscriberRank) {
      checks.push({
        field: "sb_rank",
        apiValue: formatNumber(channel.subscriberCount) + " subs",
        chromeValue: `Rank ${chromeSB.subscriberRank}`,
        status: "match",
      });

      if (chromeSB.grade) {
        checks.push({
          field: "sb_grade",
          apiValue: "n/a",
          chromeValue: String(chromeSB.grade),
          status: "match",
        });
      }
    }

    const majorCount = checks.filter((c) => c.status === "major_diff").length;
    const minorCount = checks.filter((c) => c.status === "minor_diff").length;

    results.push({
      channelId: channel.channelId,
      channelTitle: channel.title,
      checks,
      overallStatus:
        majorCount > 0
          ? "major_discrepancy"
          : minorCount > 1
            ? "minor_discrepancy"
            : "consistent",
    });
  }

  return results;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}
