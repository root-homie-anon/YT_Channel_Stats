import { ResearchSession } from "../types";
import { ChangeAlert } from "../monitoring/change-detector";
import { createLogger } from "../logger";

const log = createLogger("telegram");

export class TelegramNotifier {
  private botToken: string;
  private chatIds: string[];
  private baseUrl: string;

  constructor(botToken: string, chatId: string, groupId?: string) {
    this.botToken = botToken;
    this.chatIds = [chatId];
    if (groupId) {
      this.chatIds.push(groupId);
    }
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  async sendMessage(text: string, parseMode?: "HTML" | "Markdown"): Promise<void> {
    for (const chatId of this.chatIds) {
      try {
        const body: Record<string, string> = {
          chat_id: chatId,
          text,
        };
        if (parseMode) {
          body.parse_mode = parseMode;
        }

        const resp = await fetch(`${this.baseUrl}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!resp.ok) {
          const detail = await resp.text();
          log.warn(`sendMessage failed for ${chatId} (${resp.status}): ${detail}`);
        }
      } catch (err) {
        log.warn(`sendMessage error for ${chatId}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  async notifySessionComplete(session: ResearchSession): Promise<void> {
    const verdict = session.recommendation?.verdict ?? "unknown";
    const confidence = session.recommendation?.confidence ?? 0;
    const saturation = session.analysis?.saturation ?? "unknown";
    const channelCount = session.channels.length;
    const dashboardLink = `http://localhost:3400`;

    const lines = [
      `<b>Research Complete</b>`,
      ``,
      `<b>Niche:</b> ${escapeHtml(session.niche)}`,
      `<b>Verdict:</b> ${verdict}`,
      `<b>Confidence:</b> ${(confidence * 100).toFixed(0)}%`,
      `<b>Saturation:</b> ${saturation}`,
      `<b>Channels found:</b> ${channelCount}`,
      ``,
      `<a href="${dashboardLink}">Open Dashboard</a>`,
    ];

    await this.sendMessage(lines.join("\n"), "HTML");
  }

  async notifySessionFailed(session: ResearchSession): Promise<void> {
    const lines = [
      `<b>Research Failed</b>`,
      ``,
      `<b>Niche:</b> ${escapeHtml(session.niche)}`,
      `<b>Error:</b> ${escapeHtml(session.error ?? "Unknown error")}`,
    ];

    await this.sendMessage(lines.join("\n"), "HTML");
  }

  async notifyChangeAlerts(niche: string, alerts: ChangeAlert[]): Promise<void> {
    if (alerts.length === 0) return;

    const severityIcon = (s: ChangeAlert["severity"]): string => {
      switch (s) {
        case "critical": return "[CRITICAL]";
        case "warning": return "[WARNING]";
        case "info": return "[INFO]";
      }
    };

    const alertLines = alerts.map(
      (a) => `  ${severityIcon(a.severity)} ${escapeHtml(a.message)}`
    );

    const lines = [
      `<b>Change Alerts for "${escapeHtml(niche)}"</b>`,
      ``,
      `${alerts.length} change(s) detected:`,
      ...alertLines,
    ];

    await this.sendMessage(lines.join("\n"), "HTML");
  }

  async notifyStaleMonitorsTriggered(niches: string[]): Promise<void> {
    const nicheList = niches.map((n) => `  - ${escapeHtml(n)}`).join("\n");
    const lines = [
      `<b>Stale Monitors Triggered</b>`,
      ``,
      `Re-running research for ${niches.length} niche(s):`,
      nicheList,
    ];

    await this.sendMessage(lines.join("\n"), "HTML");
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
