import { ResearchSession, ChannelData } from "../types";

function escapeCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function computeRecentVideoAvg(
  channel: ChannelData,
  field: "viewCount" | "likeCount" | "commentCount"
): number {
  if (!channel.recentVideos || channel.recentVideos.length === 0) return 0;
  const sum = channel.recentVideos.reduce((acc, v) => acc + (v[field] ?? 0), 0);
  return Math.round(sum / channel.recentVideos.length);
}

const BASE_HEADERS = [
  "channelId",
  "title",
  "subscribers",
  "views",
  "videoCount",
  "publishedAt",
  "recentVideoAvgViews",
  "recentVideoAvgLikes",
  "recentVideoAvgComments",
];

function channelToRow(channel: ChannelData): string {
  const fields = [
    channel.channelId,
    channel.title,
    channel.subscriberCount,
    channel.viewCount,
    channel.videoCount,
    channel.publishedAt,
    computeRecentVideoAvg(channel, "viewCount"),
    computeRecentVideoAvg(channel, "likeCount"),
    computeRecentVideoAvg(channel, "commentCount"),
  ];
  return fields.map(escapeCsvField).join(",");
}

export function sessionToCsv(session: ResearchSession): string {
  const header = BASE_HEADERS.join(",");
  const rows = (session.channels ?? []).map(channelToRow);
  return [header, ...rows].join("\n");
}

export function channelListToCsv(sessions: ResearchSession[]): string {
  const header = ["niche", "sessionId", ...BASE_HEADERS].join(",");
  const rows: string[] = [];
  for (const session of sessions) {
    for (const channel of session.channels ?? []) {
      const row = [
        escapeCsvField(session.niche),
        escapeCsvField(session.id),
        channelToRow(channel),
      ].join(",");
      rows.push(row);
    }
  }
  return [header, ...rows].join("\n");
}
