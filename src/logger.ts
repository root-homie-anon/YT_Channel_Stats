import fs from "fs";
import path from "path";

export type LogLevel = "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  [key: string]: unknown;
}

interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

const LOG_DIR = path.resolve(__dirname, "..", "data", "logs");
const LOG_FILE = path.join(LOG_DIR, "app.log");
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function rotateIfNeeded(): void {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    const stats = fs.statSync(LOG_FILE);
    if (stats.size >= MAX_LOG_SIZE) {
      const backup = LOG_FILE + ".1";
      if (fs.existsSync(backup)) {
        fs.unlinkSync(backup);
      }
      fs.renameSync(LOG_FILE, backup);
    }
  } catch {
    // Rotation failure should not crash the app
  }
}

function writeLog(entry: LogEntry): void {
  const line = JSON.stringify(entry);

  // Write to console
  switch (entry.level) {
    case "error":
      console.error(line);
      break;
    case "warn":
      console.warn(line);
      break;
    default:
      console.log(line);
  }

  // Append to file
  try {
    ensureLogDir();
    rotateIfNeeded();
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {
    // File write failure should not crash the app
  }
}

export function createLogger(component: string): Logger {
  function log(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component,
      message: msg,
      ...data,
    };
    writeLog(entry);
  }

  return {
    info: (msg, data?) => log("info", msg, data),
    warn: (msg, data?) => log("warn", msg, data),
    error: (msg, data?) => log("error", msg, data),
  };
}
