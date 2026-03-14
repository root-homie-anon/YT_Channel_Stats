import { YouTubeAPI, QuotaUsage } from "./api/youtube";
import { NicheAnalyzer } from "./analysis/niche-analyzer";
import { ChromeExtractor } from "./chrome/extractor";
import { ReportGenerator } from "./report/report-generator";
import { TelegramNotifier } from "./notifications/telegram";
import { loadConfig } from "./config";
import { SessionStore } from "./sessions";
import { ChromeDataCollection, ResearchSession } from "./types";
import { createLogger } from "./logger";

const log = createLogger("pipeline");

export class ResearchPipeline {
  private youtube: YouTubeAPI;
  private analyzer: NicheAnalyzer;
  private chrome: ChromeExtractor;
  private reports: ReportGenerator;
  private sessions: SessionStore;
  private telegram: TelegramNotifier | null;

  constructor(apiKey: string, sessionDir: string) {
    this.youtube = new YouTubeAPI(apiKey);
    this.analyzer = new NicheAnalyzer();
    this.chrome = new ChromeExtractor();
    this.reports = new ReportGenerator();
    this.sessions = new SessionStore(sessionDir);

    const cfg = loadConfig();
    this.telegram = cfg.telegramBotToken
      ? new TelegramNotifier(cfg.telegramBotToken, cfg.telegramChatId, cfg.telegramGroupId)
      : null;
  }

  getQuotaUsage(): QuotaUsage {
    return this.youtube.getQuotaUsage();
  }

  async run(niche: string, keywords: string[]): Promise<ResearchSession> {
    const session = this.sessions.create(niche, keywords);
    session.status = "running";
    this.sessions.save(session);

    try {
      // Step 1: Search for channels across all keywords
      log.info(`Searching channels for: ${keywords.join(", ")}`);
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
      log.info(`Found ${session.channels.length} unique channels`);
      this.sessions.save(session); // save progress after channel search

      // Step 2: Fetch recent videos for top channels (by subscriber count)
      const topChannels = [...session.channels]
        .sort((a, b) => b.subscriberCount - a.subscriberCount)
        .slice(0, 10);

      log.info(`Fetching videos for top ${topChannels.length} channels`);
      for (const ch of topChannels) {
        try {
          const videos = await this.youtube.getChannelVideos(ch.channelId, 10);
          const idx = session.channels.findIndex((c) => c.channelId === ch.channelId);
          if (idx >= 0) session.channels[idx].recentVideos = videos;
        } catch (err) {
          log.warn(`Failed to fetch videos for ${ch.title}: ${err instanceof Error ? err.message : err}`);
          // Continue with other channels instead of failing the whole pipeline
        }
      }
      this.sessions.save(session); // save progress after video fetch

      // Step 3: Run niche analysis
      log.info("Running niche analysis");
      session.analysis = this.analyzer.analyze(session.channels, [niche, ...keywords]);

      // Step 4: Generate recommendation
      session.recommendation = this.analyzer.recommend(session.analysis, session.channels);

      // Step 5: Chrome extraction layer
      log.info("Running Chrome extraction");
      session.chromeData = await this.runChromeExtraction(topChannels.map((c) => c.channelId));
      this.sessions.save(session);

      session.status = "complete";
      session.completedAt = new Date().toISOString();
    } catch (err) {
      session.status = "failed";
      session.error = err instanceof Error ? err.message : String(err);
      log.error(`Research failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    this.sessions.save(session);

    // Send Telegram notification
    if (this.telegram) {
      if (session.status === "complete") {
        await this.telegram.notifySessionComplete(session);
      } else if (session.status === "failed") {
        await this.telegram.notifySessionFailed(session);
      }
    }

    return session;
  }

  generateReport(session: ResearchSession): string {
    return this.reports.generateMarkdown(session);
  }

  private async runChromeExtraction(channelIds: string[]): Promise<ChromeDataCollection> {
    const collection: ChromeDataCollection = {
      socialBlade: [],
      channelPages: [],
      extractedAt: new Date().toISOString(),
    };

    try {
      await this.chrome.init();

      // Extract Social Blade data for top 3 channels (to limit scraping)
      for (const id of channelIds.slice(0, 3)) {
        try {
          const result = await this.chrome.extractSocialBlade(id);
          collection.socialBlade.push({ channelId: id, ...result.data });
        } catch (err) {
          log.warn(`Chrome Social Blade failed for ${id}: ${err instanceof Error ? err.message : err}`);
        }
      }

      // Extract YouTube channel page data for top 5
      for (const id of channelIds.slice(0, 5)) {
        try {
          const result = await this.chrome.extractChannelPage(id);
          collection.channelPages.push({ channelId: id, ...result.data });
        } catch (err) {
          log.warn(`Chrome channel page failed for ${id}: ${err instanceof Error ? err.message : err}`);
        }
      }
    } catch (err) {
      log.warn(`Chrome extraction layer error: ${err instanceof Error ? err.message : err}`);
    } finally {
      await this.chrome.close();
    }

    return collection;
  }
}
