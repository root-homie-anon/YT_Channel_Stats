import { YouTubeAPI } from "./api/youtube";
import { NicheAnalyzer } from "./analysis/niche-analyzer";
import { ChromeExtractor } from "./chrome/extractor";
import { ReportGenerator } from "./report/report-generator";
import { SessionStore } from "./sessions";
import { ResearchSession } from "./types";

export class ResearchPipeline {
  private youtube: YouTubeAPI;
  private analyzer: NicheAnalyzer;
  private chrome: ChromeExtractor;
  private reports: ReportGenerator;
  private sessions: SessionStore;

  constructor(apiKey: string, sessionDir: string) {
    this.youtube = new YouTubeAPI(apiKey);
    this.analyzer = new NicheAnalyzer();
    this.chrome = new ChromeExtractor();
    this.reports = new ReportGenerator();
    this.sessions = new SessionStore(sessionDir);
  }

  async run(niche: string, keywords: string[]): Promise<ResearchSession> {
    const session = this.sessions.create(niche, keywords);
    session.status = "running";
    this.sessions.save(session);

    try {
      // Step 1: Search for channels across all keywords
      console.log(`[pipeline] Searching channels for: ${keywords.join(", ")}`);
      const channelSets = await Promise.all(
        keywords.map((kw) => this.youtube.searchChannels(kw, 10))
      );

      // Deduplicate channels by ID
      const seen = new Set<string>();
      for (const set of channelSets) {
        for (const ch of set) {
          if (!seen.has(ch.channelId)) {
            seen.add(ch.channelId);
            session.channels.push(ch);
          }
        }
      }
      console.log(`[pipeline] Found ${session.channels.length} unique channels`);

      // Step 2: Fetch recent videos for top channels (by subscriber count)
      const topChannels = [...session.channels]
        .sort((a, b) => b.subscriberCount - a.subscriberCount)
        .slice(0, 10);

      console.log(`[pipeline] Fetching videos for top ${topChannels.length} channels`);
      for (const ch of topChannels) {
        const videos = await this.youtube.getChannelVideos(ch.channelId, 10);
        const idx = session.channels.findIndex((c) => c.channelId === ch.channelId);
        if (idx >= 0) session.channels[idx].recentVideos = videos;
      }

      // Step 3: Run niche analysis
      console.log("[pipeline] Running niche analysis");
      session.analysis = this.analyzer.analyze(session.channels);

      // Step 4: Generate recommendation
      session.recommendation = this.analyzer.recommend(session.analysis, session.channels);

      // Step 5: Chrome extraction layer (TBD — logs warnings for now)
      // await this.chrome.extractSocialBlade(topChannels[0]?.channelId);

      session.status = "complete";
      session.completedAt = new Date().toISOString();
    } catch (err) {
      session.status = "failed";
      console.error("[pipeline] Research failed:", err);
    }

    this.sessions.save(session);
    return session;
  }

  generateReport(session: ResearchSession): string {
    return this.reports.generateMarkdown(session);
  }
}
