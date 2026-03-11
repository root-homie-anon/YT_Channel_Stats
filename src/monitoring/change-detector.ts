import { ResearchSession } from "../types";
import { compareSessions } from "../analysis/session-compare";

export interface ChangeAlert {
  type: string;
  message: string;
  severity: "info" | "warning" | "critical";
}

export function detectSignificantChanges(
  previous: ResearchSession,
  current: ResearchSession
): ChangeAlert[] {
  const alerts: ChangeAlert[] = [];
  const comparison = compareSessions(previous, current);

  // Saturation change (e.g. balanced -> oversaturated) = warning
  if (comparison.saturationChange.from !== comparison.saturationChange.to &&
      comparison.saturationChange.from !== "unknown" &&
      comparison.saturationChange.to !== "unknown") {
    alerts.push({
      type: "saturation_change",
      message: `Saturation changed from ${comparison.saturationChange.from} to ${comparison.saturationChange.to} (score ${comparison.saturationChange.scoreChange > 0 ? "+" : ""}${comparison.saturationChange.scoreChange})`,
      severity: "warning",
    });
  }

  // Trend direction change (e.g. growing -> declining) = critical
  if (comparison.trendChange.from !== comparison.trendChange.to &&
      comparison.trendChange.from !== "unknown" &&
      comparison.trendChange.to !== "unknown") {
    alerts.push({
      type: "trend_change",
      message: `Trend direction changed from ${comparison.trendChange.from} to ${comparison.trendChange.to}`,
      severity: "critical",
    });
  }

  // Verdict change (e.g. profitable -> not_profitable) = critical
  if (comparison.verdictChange.from !== comparison.verdictChange.to &&
      comparison.verdictChange.from !== "unknown" &&
      comparison.verdictChange.to !== "unknown") {
    alerts.push({
      type: "verdict_change",
      message: `Verdict changed from ${comparison.verdictChange.from} to ${comparison.verdictChange.to}`,
      severity: "critical",
    });
  }

  // Avg subscribers change > 50% = warning
  if (comparison.avgSubsChange.from > 0 &&
      Math.abs(comparison.avgSubsChange.pctChange) > 50) {
    const direction = comparison.avgSubsChange.pctChange > 0 ? "increased" : "decreased";
    alerts.push({
      type: "avg_subscribers_change",
      message: `Avg subscribers ${direction} by ${Math.abs(Math.round(comparison.avgSubsChange.pctChange))}% (${comparison.avgSubsChange.from.toLocaleString()} -> ${comparison.avgSubsChange.to.toLocaleString()})`,
      severity: "warning",
    });
  }

  // Avg views change > 50% = warning
  if (comparison.avgViewsChange.from > 0 &&
      Math.abs(comparison.avgViewsChange.pctChange) > 50) {
    const direction = comparison.avgViewsChange.pctChange > 0 ? "increased" : "decreased";
    alerts.push({
      type: "avg_views_change",
      message: `Avg views ${direction} by ${Math.abs(Math.round(comparison.avgViewsChange.pctChange))}% (${comparison.avgViewsChange.from.toLocaleString()} -> ${comparison.avgViewsChange.to.toLocaleString()})`,
      severity: "warning",
    });
  }

  // New channels entering top 10 = info
  if (comparison.newChannels.length > 0) {
    const top10 = comparison.newChannels.slice(0, 10);
    alerts.push({
      type: "new_channels",
      message: `${comparison.newChannels.length} new channel(s) appeared: ${top10.join(", ")}`,
      severity: "info",
    });
  }

  return alerts;
}
