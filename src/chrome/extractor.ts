import puppeteer, { Browser, Page } from "puppeteer";
import { createLogger } from "../logger";

const log = createLogger("chrome");

export interface ChromeExtractionResult {
  source: string;
  channelId: string;
  data: Record<string, unknown>;
  extractedAt: string;
}

export interface SocialBladeData {
  grade: string | null;
  subscriberRank: string | null;
  estimatedMonthlyEarnings: string | null;
  estimatedYearlyEarnings: string | null;
  last30DaySubs: string | null;
  last30DayViews: string | null;
}

export interface ChannelPageData {
  hasMemberships: boolean;
  hasMerchShelf: boolean;
  communityPostCount: number;
  tabsAvailable: string[];
  channelDescription: string;
  linkCount: number;
}

export class ChromeExtractor {
  private browser: Browser | null = null;

  async init(): Promise<void> {
    if (this.browser) return;
    this.browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    log.info("Browser launched");
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      log.info("Browser closed");
    }
  }

  async extractSocialBlade(channelId: string): Promise<ChromeExtractionResult> {
    const page = await this.getPage();
    try {
      const url = `https://socialblade.com/youtube/channel/${channelId}`;
      log.info(`Navigating to Social Blade: ${channelId}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });

      // Wait for page content to load
      await page.waitForSelector("body", { timeout: 10000 });

      // Wait for dynamic content to render
      await page.waitForSelector(".shadow-md", { timeout: 10000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 3000));

      const data = await page.evaluate(() => {
        const bodyText = document.body.innerText;

        // Grade: "C+\nGrade" or "A\nGrade"
        const gradeMatch = bodyText.match(/\n([A-F][+-]?)\nGrade\n/);

        // Ranks: "102,831st\nSB Rank"
        const sbRankMatch = bodyText.match(/([\d,]+(?:st|nd|rd|th))\s*\n\s*SB Rank/);
        const subsRankMatch = bodyText.match(/([\d,]+(?:st|nd|rd|th))\s*\n\s*Subscribers Rank/);

        // Stats cards: value is prepended to label in the same text block
        // e.g. "0Subscribers for the last 30 days" or "+1,234Subscribers..."
        const extractCardValue = (label: string): string | null => {
          const cards = document.querySelectorAll(".shadow-md");
          for (const card of cards) {
            const text = card.textContent ?? "";
            if (text.includes(label)) {
              // Value is everything before the label
              const idx = text.indexOf(label);
              const val = text.substring(0, idx).trim();
              return val || null;
            }
          }
          return null;
        };

        // Daily earnings from the table (most recent row)
        const earningsMatch = bodyText.match(/\$[\d,.]+ - \$[\d,.]+[KM]?/);

        return {
          grade: gradeMatch?.[1] ?? null,
          subscriberRank: subsRankMatch?.[1] ?? null,
          sbRank: sbRankMatch?.[1] ?? null,
          last30DaySubs: extractCardValue("Subscribers for the last 30 days"),
          last30DayViews: extractCardValue("Views for the last 30 days"),
          estimatedMonthlyEarnings: extractCardValue("Monthly Estimated Earnings"),
          estimatedYearlyEarnings: extractCardValue("Yearly Estimated Earnings"),
          recentDailyEarnings: earningsMatch?.[0] ?? null,
        };
      });

      return {
        source: "socialblade",
        channelId,
        data: data as unknown as Record<string, unknown>,
        extractedAt: new Date().toISOString(),
      };
    } catch (err) {
      log.warn(`Social Blade extraction failed for ${channelId}: ${err instanceof Error ? err.message : err}`);
      return this.errorResult("socialblade", channelId, err);
    } finally {
      await page.close();
    }
  }

  async extractChannelPage(channelId: string): Promise<ChromeExtractionResult> {
    const page = await this.getPage();
    try {
      const url = `https://www.youtube.com/channel/${channelId}`;
      log.info(`Navigating to YouTube channel: ${channelId}`);
      await page.goto(url, { waitUntil: "networkidle2", timeout: 25000 });

      // Let dynamic content render
      await new Promise((r) => setTimeout(r, 2000));

      // Collect data visible on the main channel page (tabs, memberships, preview description)
      const preData = await page.evaluate(() => {
        // Check for membership button
        const hasMemberships = !!document.querySelector(
          'yt-button-shape a[href*="membership"], button[aria-label*="Join"]'
        );

        // Check for merch shelf
        const hasMerchShelf = !!document.querySelector(
          'ytd-merch-shelf-renderer, [is-merch-shelf]'
        );

        // Channel tabs
        const tabs = Array.from(document.querySelectorAll("yt-tab-shape, tp-yt-paper-tab"))
          .map((t) => t.textContent?.trim() ?? "")
          .filter(Boolean);

        // Preview description (visible in the channel header without clicking "more")
        const previewDesc = document.querySelector(
          "yt-description-preview-view-model span.yt-core-attributed-string"
        );
        const previewText = previewDesc?.textContent?.trim() ?? "";

        // Header attribution link count (visible on the channel header)
        const headerLinks = document.querySelectorAll("yt-attribution-view-model a");

        return {
          hasMemberships,
          hasMerchShelf,
          tabsAvailable: tabs,
          previewDescription: previewText,
          headerLinkCount: headerLinks.length,
        };
      });

      // Click the description preview to open the about dialog for full description + links
      let aboutOpened = false;
      try {
        await page.click("yt-description-preview-view-model");
        await page.waitForSelector("ytd-about-channel-renderer", { timeout: 5000 });
        aboutOpened = true;
      } catch {
        log.warn("About dialog did not open; using preview data");
      }

      let channelDescription = preData.previewDescription;
      let linkCount = preData.headerLinkCount;

      if (aboutOpened) {
        const aboutData = await page.evaluate(() => {
          const about = document.querySelector("ytd-about-channel-renderer");
          if (!about) return null;

          // Full description from #description-container
          const descContainer = about.querySelector("#description-container");
          const fullDesc = descContainer?.textContent?.trim() ?? "";

          // Channel external links (social media, website) inside the about dialog
          const linkModels = about.querySelectorAll("yt-channel-external-link-view-model a");

          return {
            description: fullDesc,
            linkCount: linkModels.length,
          };
        });

        if (aboutData) {
          channelDescription = aboutData.description || channelDescription;
          linkCount = aboutData.linkCount;
        }
      }

      // Fallback: if description is still empty, try the meta tag
      if (!channelDescription) {
        channelDescription = await page.evaluate(() => {
          const meta = document.querySelector('meta[name="description"]');
          return meta?.getAttribute("content")?.trim() ?? "";
        });
      }

      const data: ChannelPageData = {
        hasMemberships: preData.hasMemberships,
        hasMerchShelf: preData.hasMerchShelf,
        communityPostCount: 0, // would need to navigate to community tab
        tabsAvailable: preData.tabsAvailable,
        channelDescription,
        linkCount,
      };

      return {
        source: "youtube-channel",
        channelId,
        data: data as unknown as Record<string, unknown>,
        extractedAt: new Date().toISOString(),
      };
    } catch (err) {
      log.warn(`Channel page extraction failed for ${channelId}: ${err instanceof Error ? err.message : err}`);
      return this.errorResult("youtube-channel", channelId, err);
    } finally {
      await page.close();
    }
  }

  async extractVidIQ(keyword: string): Promise<ChromeExtractionResult> {
    // VidIQ requires a browser extension — can't be scraped directly
    // This would need the VidIQ extension installed in the Puppeteer browser profile
    log.warn("VidIQ extraction requires browser extension — returning stub");
    return {
      source: "vidiq",
      channelId: keyword,
      data: { status: "requires_extension", note: "VidIQ needs browser extension installed in Chrome profile" },
      extractedAt: new Date().toISOString(),
    };
  }

  async extractTubeBuddy(keyword: string): Promise<ChromeExtractionResult> {
    // TubeBuddy also requires a browser extension
    log.warn("TubeBuddy extraction requires browser extension — returning stub");
    return {
      source: "tubebuddy",
      channelId: keyword,
      data: { status: "requires_extension", note: "TubeBuddy needs browser extension installed in Chrome profile" },
      extractedAt: new Date().toISOString(),
    };
  }

  private async getPage(): Promise<Page> {
    await this.init();
    const page = await this.browser!.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1280, height: 800 });
    return page;
  }

  private errorResult(source: string, channelId: string, err: unknown): ChromeExtractionResult {
    return {
      source,
      channelId,
      data: {
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      },
      extractedAt: new Date().toISOString(),
    };
  }
}
