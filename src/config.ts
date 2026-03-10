import dotenv from "dotenv";
import path from "path";
import fs from "fs";

dotenv.config();

export interface AppConfig {
  youtubeApiKey: string;
  port: number;
  sessionDir: string;
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

  return { youtubeApiKey, port, sessionDir };
}
