import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { loadConfig } from "../src/config";
import { SessionStore } from "../src/sessions";
import { ResearchPipeline } from "../src/pipeline";
import { ReportGenerator } from "../src/report/report-generator";
import { PDFReportGenerator } from "../src/report/pdf-generator";
import { compareSessions } from "../src/analysis/session-compare";
import { TopicDiscovery } from "../src/analysis/topic-discovery";
import { crossValidate } from "../src/analysis/cross-validator";
import { TrendMonitor } from "../src/monitoring/trend-monitor";
import { detectSignificantChanges } from "../src/monitoring/change-detector";
import { TelegramNotifier } from "../src/notifications/telegram";
import { sessionToCsv, channelListToCsv } from "../src/export/csv-exporter";
import { createLogger } from "../src/logger";

const log = createLogger("server");

const config = loadConfig();
const app = express();
const sessions = new SessionStore(config.sessionDir);
const pipeline = new ResearchPipeline(config.youtubeApiKey, config.sessionDir);
const reports = new ReportGenerator();
const pdfReports = new PDFReportGenerator();
const topicEngine = new TopicDiscovery();
const trendMonitor = new TrendMonitor(path.dirname(config.sessionDir));
// monitors.json lives at data/monitors.json (parent of data/sessions/)
const telegram = config.telegramBotToken
  ? new TelegramNotifier(config.telegramBotToken, config.telegramChatId, config.telegramGroupId)
  : null;

app.use(cors());
app.use(express.json());

// Request logging
app.use((req, _res, next) => {
  log.info(`${req.method} ${req.path}`);
  next();
});

// Serve dashboard frontend
app.use(express.static(path.join(__dirname, "public")));

// Health check (public — registered before auth middleware)
app.get("/api/health", (_req, res) => {
  const allSessions = sessions.list();
  const completedSessions = allSessions.filter((s) => s.status === "complete");
  const runningSessions = allSessions.filter((s) => s.status === "running");

  let lastCompletedAt: string | null = null;
  if (completedSessions.length > 0) {
    const withCompletedAt = completedSessions
      .filter((s) => s.completedAt !== null)
      .sort((a, b) => (b.completedAt as string).localeCompare(a.completedAt as string));
    lastCompletedAt = withCompletedAt.length > 0 ? withCompletedAt[0].completedAt : null;
  }

  let diskUsage: { sessionDir: string; sizeBytes: number } = {
    sessionDir: config.sessionDir,
    sizeBytes: 0,
  };
  try {
    const files = fs.readdirSync(config.sessionDir);
    let totalSize = 0;
    for (const file of files) {
      try {
        const stat = fs.statSync(path.join(config.sessionDir, file));
        if (stat.isFile()) {
          totalSize += stat.size;
        }
      } catch {
        // Skip files that can't be stat'd
      }
    }
    diskUsage.sizeBytes = totalSize;
  } catch {
    // Session directory may not exist or be unreadable
  }

  res.json({
    status: "ok",
    apiKeySet: config.youtubeApiKey !== "" && config.youtubeApiKey !== "TBD",
    telegramConfigured: config.telegramBotToken !== "",
    sessionCount: allSessions.length,
    completedSessions: completedSessions.length,
    runningPipelines: runningSessions.length,
    lastCompletedAt,
    monitorCount: trendMonitor.listMonitors().length,
    uptime: process.uptime(),
    diskUsage,
  });
});

// Quota usage (public — like health)
app.get("/api/quota", (_req, res) => {
  res.json(pipeline.getQuotaUsage());
});

// Basic auth middleware
function basicAuth(req: Request, res: Response, next: NextFunction): void {
  // Health endpoint is public
  if (req.baseUrl + req.path === "/api/health" || req.originalUrl.startsWith("/api/health")) return next();

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Basic ")) {
    res.set("WWW-Authenticate", 'Basic realm="YT_Channel_Stats"');
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const decoded = Buffer.from(authHeader.slice(6), "base64").toString();
  const [user, pass] = decoded.split(":");

  if (user === config.dashboardUser && pass === config.dashboardPass) {
    return next();
  }

  res.status(403).json({ error: "Invalid credentials" });
}

app.use("/api", basicAuth);

// List all research sessions
app.get("/api/sessions", (_req, res) => {
  const all = sessions.list();
  res.json(
    all.map((s) => ({
      id: s.id,
      niche: s.niche,
      status: s.status,
      createdAt: s.createdAt,
      recommendation: s.recommendation?.verdict ?? null,
      tags: s.tags ?? [],
    }))
  );
});

// Get a single session
app.get("/api/sessions/:id", (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json(session);
});

// Get report for a session
app.get("/api/sessions/:id/report", (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  const markdown = reports.generateMarkdown(session);
  res.type("text/markdown").send(markdown);
});

// Get PDF report for a session
app.get("/api/sessions/:id/report/pdf", async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  const pdf = await pdfReports.generate(session);
  res.type("application/pdf").send(pdf);
});

// Export all sessions' channels as CSV (must be before :id routes)
app.get("/api/sessions/export/csv", (req, res) => {
  let all = sessions.list();
  const niche = req.query.niche;
  if (niche && typeof niche === "string") {
    all = all.filter((s) => s.niche.toLowerCase() === niche.toLowerCase());
  }
  const csv = channelListToCsv(all);
  res.set("Content-Type", "text/csv");
  res.set("Content-Disposition", 'attachment; filename="channels.csv"');
  res.send(csv);
});

// Export a single session's channels as CSV
app.get("/api/sessions/:id/export/csv", (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  const csv = sessionToCsv(session);
  res.set("Content-Type", "text/csv");
  res.set("Content-Disposition", `attachment; filename="session-${session.id}.csv"`);
  res.send(csv);
});

// Re-run an existing session with the same niche/keywords
app.post("/api/sessions/:id/rerun", async (req, res) => {
  const existing = sessions.get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Session not found" });

  res.status(201).json({ status: "started", niche: existing.niche, keywords: existing.keywords });

  pipeline.run(existing.niche, existing.keywords).catch((err) => {
    log.error(`Pipeline re-run error: ${err instanceof Error ? err.message : String(err)}`);
  });
});

// Start a new research session
app.post("/api/sessions", async (req, res) => {
  const { niche, keywords } = req.body;
  if (!niche || typeof niche !== "string" || !keywords || !Array.isArray(keywords)) {
    return res.status(400).json({ error: "Provide niche (string) and keywords (string[])" });
  }

  // Sanitize inputs
  const cleanNiche = niche.trim().slice(0, 200);
  const cleanKeywords = keywords
    .filter((k: unknown): k is string => typeof k === "string")
    .map((k: string) => k.trim().slice(0, 200))
    .filter((k: string) => k.length > 0)
    .slice(0, 10);

  if (cleanKeywords.length === 0) {
    return res.status(400).json({ error: "Provide at least one non-empty keyword" });
  }

  res.status(201).json({ status: "started", niche: cleanNiche, keywords: cleanKeywords });

  // Fire and forget — pipeline creates session and updates on disk
  pipeline.run(cleanNiche, cleanKeywords).catch((err) => {
    log.error(`Pipeline error: ${err instanceof Error ? err.message : String(err)}`);
  });
});

// Start bulk niche research (up to 10 niches, sequential execution)
app.post("/api/sessions/bulk", (req, res) => {
  const { niches } = req.body;
  if (!Array.isArray(niches) || niches.length === 0) {
    return res.status(400).json({ error: "Provide niches (array of { niche: string, keywords: string[] })" });
  }

  if (niches.length > 10) {
    return res.status(400).json({ error: "Maximum 10 niches per bulk request" });
  }

  // Validate and sanitize each entry
  const cleaned: Array<{ niche: string; keywords: string[] }> = [];
  for (let i = 0; i < niches.length; i++) {
    const entry = niches[i];
    if (!entry || typeof entry.niche !== "string" || !Array.isArray(entry.keywords)) {
      return res.status(400).json({ error: `Invalid entry at index ${i}: provide niche (string) and keywords (string[])` });
    }

    const cleanNiche = entry.niche.trim().slice(0, 200);
    if (cleanNiche.length === 0) {
      return res.status(400).json({ error: `Empty niche at index ${i}` });
    }

    const cleanKeywords = entry.keywords
      .filter((k: unknown): k is string => typeof k === "string")
      .map((k: string) => k.trim().slice(0, 200))
      .filter((k: string) => k.length > 0)
      .slice(0, 10);

    if (cleanKeywords.length === 0) {
      return res.status(400).json({ error: `No valid keywords at index ${i}` });
    }

    cleaned.push({ niche: cleanNiche, keywords: cleanKeywords });
  }

  res.status(201).json({
    status: "started",
    count: cleaned.length,
    niches: cleaned.map((c) => c.niche),
  });

  // Fire and forget — run pipelines sequentially to avoid API rate limits
  (async () => {
    for (let i = 0; i < cleaned.length; i++) {
      const { niche, keywords } = cleaned[i];
      log.info(`[bulk] Starting niche ${i + 1}/${cleaned.length}: ${niche}`);
      try {
        await pipeline.run(niche, keywords);
        log.info(`[bulk] Completed niche ${i + 1}/${cleaned.length}: ${niche}`);
      } catch (err) {
        log.error(`[bulk] Failed niche ${i + 1}/${cleaned.length} (${niche}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    log.info(`[bulk] All ${cleaned.length} niches processed`);
  })();
});

// Delete a session
app.delete("/api/sessions/:id", (req, res) => {
  const deleted = sessions.delete(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Session not found" });
  res.json({ deleted: true });
});

// Compare two sessions
app.get("/api/sessions/compare", (req, res) => {
  const { a, b } = req.query;
  if (!a || !b || typeof a !== "string" || typeof b !== "string") {
    return res.status(400).json({ error: "Provide ?a=sessionId&b=sessionId" });
  }
  const sessionA = sessions.get(a);
  const sessionB = sessions.get(b);
  if (!sessionA) return res.status(404).json({ error: `Session ${a} not found` });
  if (!sessionB) return res.status(404).json({ error: `Session ${b} not found` });

  res.json(compareSessions(sessionA, sessionB));
});

// Topic discovery for a session
app.get("/api/sessions/:id/topics", (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  const limit = parseInt(req.query.limit as string) || 20;
  res.json(topicEngine.discover(session, limit));
});

// Tag a session
app.put("/api/sessions/:id/tags", (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });

  const { tags } = req.body;
  if (!Array.isArray(tags)) {
    return res.status(400).json({ error: "Provide tags (string[])" });
  }

  session.tags = tags
    .filter((t: unknown): t is string => typeof t === "string")
    .map((t: string) => t.trim().toLowerCase().slice(0, 50))
    .filter((t: string) => t.length > 0)
    .slice(0, 20);
  sessions.save(session);
  res.json({ tags: session.tags });
});

// Cross-validate API vs Chrome data for a session
app.get("/api/sessions/:id/validate", (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json(crossValidate(session));
});

// Compare a session to the previous session of the same niche and return change alerts
app.get("/api/sessions/:id/changes", (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });

  // Find the previous session for the same niche (sorted by createdAt desc)
  const all = sessions.list();
  const sameNiche = all.filter(
    (s) =>
      s.status === "complete" &&
      s.niche.toLowerCase() === session.niche.toLowerCase() &&
      s.id !== session.id &&
      s.createdAt < session.createdAt
  );

  if (sameNiche.length === 0) {
    return res.json({ alerts: [], message: "No previous session found for this niche" });
  }

  const previous = sameNiche[0]; // most recent prior session
  const alerts = detectSignificantChanges(previous, session);
  res.json({ previousSessionId: previous.id, alerts });
});

// === YT_Channel_Auto Integration Endpoints ===

// Topic discovery endpoint — given a niche, return high-potential topics
// from the most recent completed session for that niche
app.get("/api/integration/topics", (req, res) => {
  const { niche, limit: limitStr } = req.query;
  if (!niche || typeof niche !== "string") {
    return res.status(400).json({ error: "Provide ?niche=..." });
  }

  const all = sessions.list();
  const matching = all.find(
    (s) => s.status === "complete" && s.niche.toLowerCase() === niche.toLowerCase()
  );

  if (!matching) {
    return res.status(404).json({ error: `No completed session found for niche: ${niche}` });
  }

  const limit = parseInt(limitStr as string) || 20;
  const topics = topicEngine.discover(matching, limit);

  res.json({
    niche: matching.niche,
    sessionId: matching.id,
    sessionDate: matching.createdAt,
    recommendation: matching.recommendation?.verdict ?? null,
    topics,
  });
});

// Niche status endpoint — quick check if a niche is profitable
app.get("/api/integration/niche-status", (req, res) => {
  const { niche } = req.query;
  if (!niche || typeof niche !== "string") {
    return res.status(400).json({ error: "Provide ?niche=..." });
  }

  const all = sessions.list();
  const matching = all.filter(
    (s) => s.status === "complete" && s.niche.toLowerCase() === niche.toLowerCase()
  );

  if (matching.length === 0) {
    return res.status(404).json({ error: `No completed sessions for niche: ${niche}` });
  }

  const latest = matching[0]; // already sorted by createdAt desc
  res.json({
    niche: latest.niche,
    sessionId: latest.id,
    sessionDate: latest.createdAt,
    verdict: latest.recommendation?.verdict ?? null,
    confidence: latest.recommendation?.confidence ?? 0,
    saturation: latest.analysis?.saturation ?? null,
    trend: latest.analysis?.trendDirection ?? null,
    summary: latest.recommendation?.summary ?? null,
    sessionsCount: matching.length,
  });
});

// === Trend Monitoring Endpoints ===

// List all monitors
app.get("/api/monitors", (_req, res) => {
  res.json(trendMonitor.listMonitors());
});

// Add a monitor
app.post("/api/monitors", (req, res) => {
  const { niche, keywords, intervalDays } = req.body;
  if (!niche || typeof niche !== "string") {
    return res.status(400).json({ error: "Provide niche (string)" });
  }
  if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
    return res.status(400).json({ error: "Provide keywords (string[])" });
  }
  if (!intervalDays || typeof intervalDays !== "number" || intervalDays < 1) {
    return res.status(400).json({ error: "Provide intervalDays (number >= 1)" });
  }

  try {
    const monitor = trendMonitor.addMonitor(niche.trim(), keywords, intervalDays);
    res.status(201).json(monitor);
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Remove a monitor
app.delete("/api/monitors/:niche", (req, res) => {
  const removed = trendMonitor.removeMonitor(decodeURIComponent(req.params.niche));
  if (!removed) return res.status(404).json({ error: "Monitor not found" });
  res.json({ deleted: true });
});

// Trigger re-runs for all stale monitors
app.post("/api/monitors/run-stale", (_req, res) => {
  const stale = trendMonitor.getStaleMonitors();
  if (stale.length === 0) {
    return res.json({ triggered: 0, niches: [] });
  }

  const niches = stale.map((m) => m.niche);
  res.json({ triggered: stale.length, niches });

  // Notify via Telegram
  if (telegram) {
    telegram.notifyStaleMonitorsTriggered(niches).catch(() => {});
  }

  // Fire and forget — run pipeline for each stale monitor
  for (const monitor of stale) {
    pipeline
      .run(monitor.niche, monitor.keywords)
      .then(() => {
        trendMonitor.markRun(monitor.niche);
        log.info(`[trend-monitor] Completed re-run for: ${monitor.niche}`);

        // Detect changes vs the previous session for this niche
        const allSessions = sessions.list();
        const sameNiche = allSessions.filter(
          (s) =>
            s.status === "complete" &&
            s.niche.toLowerCase() === monitor.niche.toLowerCase()
        );

        if (sameNiche.length >= 2) {
          const current = sameNiche[0];
          const previous = sameNiche[1];
          const alerts = detectSignificantChanges(previous, current);
          const actionable = alerts.filter(
            (a) => a.severity === "warning" || a.severity === "critical"
          );

          if (actionable.length > 0 && telegram) {
            telegram.notifyChangeAlerts(monitor.niche, actionable).catch((err) => {
              log.warn(`[trend-monitor] Failed to send change alerts for ${monitor.niche}: ${err instanceof Error ? err.message : String(err)}`);
            });
          }
        }
      })
      .catch((err) => {
        log.error(`[trend-monitor] Re-run failed for ${monitor.niche}: ${err instanceof Error ? err.message : String(err)}`);
      });
  }
});

app.listen(config.port, () => {
  log.info(`YT_Channel_Stats dashboard running on port ${config.port}`);
  log.info(`API key configured: ${config.youtubeApiKey !== "" && config.youtubeApiKey !== "TBD"}`);
});
