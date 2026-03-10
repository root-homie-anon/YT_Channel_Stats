import express from "express";
import cors from "cors";
import { loadConfig } from "../src/config";
import { SessionStore } from "../src/sessions";
import { ResearchPipeline } from "../src/pipeline";
import { ReportGenerator } from "../src/report/report-generator";

const config = loadConfig();
const app = express();
const sessions = new SessionStore(config.sessionDir);
const pipeline = new ResearchPipeline(config.youtubeApiKey, config.sessionDir);
const reports = new ReportGenerator();

app.use(cors());
app.use(express.json());

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

// Start a new research session
app.post("/api/sessions", async (req, res) => {
  const { niche, keywords } = req.body;
  if (!niche || !keywords || !Array.isArray(keywords)) {
    return res.status(400).json({ error: "Provide niche (string) and keywords (string[])" });
  }

  // Pipeline creates and manages the session internally
  res.status(201).json({ status: "started", niche, keywords });

  // Fire and forget — pipeline creates session and updates on disk
  pipeline.run(niche, keywords).catch((err) => {
    console.error("[server] Pipeline error:", err);
  });
});

// Delete a session
app.delete("/api/sessions/:id", (req, res) => {
  const deleted = sessions.delete(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Session not found" });
  res.json({ deleted: true });
});

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", apiKeySet: config.youtubeApiKey !== "" && config.youtubeApiKey !== "TBD" });
});

app.listen(config.port, () => {
  console.log(`[server] YT_Channel_Stats dashboard running on port ${config.port}`);
  console.log(`[server] API key configured: ${config.youtubeApiKey !== "" && config.youtubeApiKey !== "TBD"}`);
});
