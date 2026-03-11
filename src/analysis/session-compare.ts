import { ResearchSession } from "../types";

export interface SessionComparison {
  nicheA: string;
  nicheB: string;
  sessionIdA: string;
  sessionIdB: string;
  saturationChange: { from: string; to: string; scoreChange: number };
  trendChange: { from: string; to: string };
  avgSubsChange: { from: number; to: number; pctChange: number };
  avgViewsChange: { from: number; to: number; pctChange: number };
  verdictChange: { from: string; to: string };
  confidenceChange: { from: number; to: number };
  newChannels: string[];
  droppedChannels: string[];
  summary: string;
}

export function compareSessions(a: ResearchSession, b: ResearchSession): SessionComparison {
  const aChannelIds = new Set(a.channels.map((c) => c.channelId));
  const bChannelIds = new Set(b.channels.map((c) => c.channelId));

  const newChannels = b.channels
    .filter((c) => !aChannelIds.has(c.channelId))
    .map((c) => c.title);
  const droppedChannels = a.channels
    .filter((c) => !bChannelIds.has(c.channelId))
    .map((c) => c.title);

  const saturationChange = {
    from: a.analysis?.saturation ?? "unknown",
    to: b.analysis?.saturation ?? "unknown",
    scoreChange: (b.analysis?.saturationScore ?? 0) - (a.analysis?.saturationScore ?? 0),
  };

  const trendChange = {
    from: a.analysis?.trendDirection ?? "unknown",
    to: b.analysis?.trendDirection ?? "unknown",
  };

  const avgSubsA = a.analysis?.avgSubscribers ?? 0;
  const avgSubsB = b.analysis?.avgSubscribers ?? 0;
  const avgSubsChange = {
    from: avgSubsA,
    to: avgSubsB,
    pctChange: avgSubsA > 0 ? ((avgSubsB - avgSubsA) / avgSubsA) * 100 : 0,
  };

  const avgViewsA = a.analysis?.avgViews ?? 0;
  const avgViewsB = b.analysis?.avgViews ?? 0;
  const avgViewsChange = {
    from: avgViewsA,
    to: avgViewsB,
    pctChange: avgViewsA > 0 ? ((avgViewsB - avgViewsA) / avgViewsA) * 100 : 0,
  };

  const verdictChange = {
    from: a.recommendation?.verdict ?? "unknown",
    to: b.recommendation?.verdict ?? "unknown",
  };

  const confidenceChange = {
    from: a.recommendation?.confidence ?? 0,
    to: b.recommendation?.confidence ?? 0,
  };

  const summary = buildComparisonSummary({
    saturationChange,
    trendChange,
    avgViewsChange,
    verdictChange,
    newChannels,
  });

  return {
    nicheA: a.niche,
    nicheB: b.niche,
    sessionIdA: a.id,
    sessionIdB: b.id,
    saturationChange,
    trendChange,
    avgSubsChange,
    avgViewsChange,
    verdictChange,
    confidenceChange,
    newChannels,
    droppedChannels,
    summary,
  };
}

function buildComparisonSummary(data: {
  saturationChange: { from: string; to: string; scoreChange: number };
  trendChange: { from: string; to: string };
  avgViewsChange: { pctChange: number };
  verdictChange: { from: string; to: string };
  newChannels: string[];
}): string {
  const parts: string[] = [];

  if (data.saturationChange.from !== data.saturationChange.to) {
    parts.push(
      `Saturation shifted from ${data.saturationChange.from} to ${data.saturationChange.to} (${data.saturationChange.scoreChange > 0 ? "+" : ""}${data.saturationChange.scoreChange} pts).`
    );
  } else {
    parts.push(`Saturation unchanged at ${data.saturationChange.to}.`);
  }

  if (data.trendChange.from !== data.trendChange.to) {
    parts.push(`Trend changed from ${data.trendChange.from} to ${data.trendChange.to}.`);
  }

  const viewPct = Math.round(data.avgViewsChange.pctChange);
  if (Math.abs(viewPct) > 5) {
    parts.push(`Average views ${viewPct > 0 ? "up" : "down"} ${Math.abs(viewPct)}%.`);
  }

  if (data.verdictChange.from !== data.verdictChange.to) {
    parts.push(
      `Verdict changed from ${data.verdictChange.from} to ${data.verdictChange.to}.`
    );
  }

  if (data.newChannels.length > 0) {
    parts.push(`${data.newChannels.length} new channel(s) appeared.`);
  }

  return parts.join(" ");
}
