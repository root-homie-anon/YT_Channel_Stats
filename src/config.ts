import dotenv from "dotenv";
import path from "path";
import fs from "fs";

dotenv.config();

export interface AppConfig {
  youtubeApiKey: string;
  port: number;
  sessionDir: string;
  dashboardUser: string;
  dashboardPass: string;
  telegramBotToken: string;
  telegramChatId: string;
  telegramGroupId: string;
}

export function loadConfig(): AppConfig {
  const youtubeApiKey = process.env.YOUTUBE_API_KEY ?? "";
  const port = parseInt(process.env.PORT ?? "3400", 10);
  const sessionDir = path.resolve(process.env.SESSION_DIR ?? "./data/sessions");

  if (!youtubeApiKey || youtubeApiKey === "TBD") {
    console.warn("[config] YOUTUBE_API_KEY is not set — API calls will fail until configured.");
  }

  // Ensure session directory exists
  fs.mkdirSync(sessionDir, { recursive: true });

  const dashboardUser = process.env.DASHBOARD_USER ?? "admin";
  const dashboardPass = process.env.DASHBOARD_PASS ?? "";

  if (!dashboardPass || dashboardPass === "changeme") {
    console.warn("[config] DASHBOARD_PASS is default — change it before exposing the server.");
  }

  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
  const telegramChatId = process.env.TELEGRAM_CHAT_ID ?? "";
  const telegramGroupId = process.env.TELEGRAM_GROUP_ID ?? "";

  if (!telegramBotToken) {
    console.warn("[config] TELEGRAM_BOT_TOKEN is not set — Telegram notifications disabled.");
  }

  return { youtubeApiKey, port, sessionDir, dashboardUser, dashboardPass, telegramBotToken, telegramChatId, telegramGroupId };
}
