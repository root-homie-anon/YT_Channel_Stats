import PDFDocument from "pdfkit";
import { ResearchSession } from "../types";
import { TopicDiscovery } from "../analysis/topic-discovery";

export class PDFReportGenerator {
  private topics = new TopicDiscovery();

  generate(session: ResearchSession): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: "A4" });
      const chunks: Buffer[] = [];

      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      this.buildDocument(doc, session);
      doc.end();
    });
  }

  private buildDocument(doc: PDFKit.PDFDocument, session: ResearchSession): void {
    const { niche, analysis, recommendation, channels } = session;

    // Title
    doc.fontSize(24).font("Helvetica-Bold").text("Niche Validation Report", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(16).font("Helvetica").text(niche, { align: "center" });
    doc.moveDown(0.3);
    doc.fontSize(9).fillColor("#666666")
      .text(`Session: ${session.id}  |  ${new Date(session.createdAt).toLocaleDateString()}  |  Status: ${session.status}`, { align: "center" });
    doc.fillColor("#000000");
    doc.moveDown(1.5);

    // Overview
    this.sectionHeader(doc, "Overview");
    this.bullet(doc, "Niche", niche);
    this.bullet(doc, "Keywords", session.keywords.join(", "));
    this.bullet(doc, "Channels analyzed", String(channels.length));
    doc.moveDown(1);

    // Analysis
    if (analysis) {
      this.sectionHeader(doc, "Niche Analysis");
      this.bullet(doc, "Saturation", `${analysis.saturation} (score: ${analysis.saturationScore}/100)`);
      this.bullet(doc, "Trend", analysis.trendDirection);
      this.bullet(doc, "Avg subscribers", formatNumber(analysis.avgSubscribers));
      this.bullet(doc, "Avg views", formatNumber(analysis.avgViews));
      this.bullet(doc, "Avg total videos", `${Math.round(analysis.avgUploadFrequency)}`);
      this.bullet(doc, "Upload cadence", `${analysis.uploadsPerWeek} videos/week`);
      this.bullet(doc, "Top formats", analysis.topFormats.join(", "));
      this.bullet(doc, "Engagement rate", `${analysis.engagementRate}%`);
      this.bullet(doc, "Avg likes/video", formatNumber(analysis.avgLikesPerVideo));
      this.bullet(doc, "Avg comments/video", formatNumber(analysis.avgCommentsPerVideo));
      if (analysis.relatedNiches.length > 0) {
        this.bullet(doc, "Related niches", analysis.relatedNiches.join(", "));
      }
      doc.moveDown(1);
    }

    // Recommendation
    if (recommendation) {
      this.sectionHeader(doc, "Recommendation");

      const verdictColor = recommendation.verdict === "profitable"
        ? "#2e7d32"
        : recommendation.verdict === "not_profitable"
          ? "#c62828"
          : "#f57f17";

      doc.fontSize(14).font("Helvetica-Bold").fillColor(verdictColor)
        .text(`${recommendation.verdict.toUpperCase()} — Confidence: ${recommendation.confidence}%`);
      doc.fillColor("#000000");
      doc.moveDown(0.5);

      doc.fontSize(10).font("Helvetica").text(recommendation.summary);
      doc.moveDown(0.8);

      if (recommendation.strengths.length > 0) {
        doc.fontSize(11).font("Helvetica-Bold").text("Strengths:");
        doc.font("Helvetica").fontSize(10);
        for (const s of recommendation.strengths) {
          doc.text(`  + ${s}`, { indent: 10 });
        }
        doc.moveDown(0.5);
      }

      if (recommendation.risks.length > 0) {
        doc.fontSize(11).font("Helvetica-Bold").text("Risks:");
        doc.font("Helvetica").fontSize(10);
        for (const r of recommendation.risks) {
          doc.text(`  - ${r}`, { indent: 10 });
        }
        doc.moveDown(0.5);
      }
      doc.moveDown(0.5);
    }

    // Top Channels table
    if (channels.length > 0) {
      this.sectionHeader(doc, "Top Channels");

      const top = [...channels]
        .sort((a, b) => b.subscriberCount - a.subscriberCount)
        .slice(0, 10);

      // Table header
      const colX = [50, 250, 340, 430];
      doc.fontSize(9).font("Helvetica-Bold");
      doc.text("Channel", colX[0], doc.y, { continued: false });
      const headerY = doc.y - 11;
      doc.text("Subscribers", colX[1], headerY);
      doc.text("Views", colX[2], headerY);
      doc.text("Videos", colX[3], headerY);
      doc.moveDown(0.3);

      // Divider
      doc.moveTo(50, doc.y).lineTo(520, doc.y).stroke("#cccccc");
      doc.moveDown(0.3);

      // Rows
      doc.font("Helvetica").fontSize(9);
      for (const ch of top) {
        if (doc.y > 720) {
          doc.addPage();
        }
        const name = ch.title.length > 30 ? ch.title.slice(0, 28) + "..." : ch.title;
        doc.text(name, colX[0], doc.y, { continued: false });
        const rowY = doc.y - 11;
        doc.text(formatNumber(ch.subscriberCount), colX[1], rowY);
        doc.text(formatNumber(ch.viewCount), colX[2], rowY);
        doc.text(String(ch.videoCount), colX[3], rowY);
        doc.moveDown(0.2);
      }
    }

    // Topic Opportunities
    const topicSuggestions = this.topics.discover(session, 10);
    if (topicSuggestions.length > 0) {
      if (doc.y > 600) doc.addPage();
      doc.moveDown(1);
      this.sectionHeader(doc, "Topic Opportunities");

      const tColX = [50, 230, 280, 350];
      doc.fontSize(9).font("Helvetica-Bold");
      doc.text("Topic", tColX[0], doc.y, { continued: false });
      const tHeaderY = doc.y - 11;
      doc.text("Score", tColX[1], tHeaderY);
      doc.text("Source", tColX[2], tHeaderY);
      doc.text("Evidence", tColX[3], tHeaderY);
      doc.moveDown(0.3);
      doc.moveTo(50, doc.y).lineTo(520, doc.y).stroke("#cccccc");
      doc.moveDown(0.3);

      doc.font("Helvetica").fontSize(8);
      for (const t of topicSuggestions) {
        if (doc.y > 720) doc.addPage();
        const topic = t.topic.length > 25 ? t.topic.slice(0, 23) + "..." : t.topic;
        doc.text(topic, tColX[0], doc.y, { continued: false });
        const tRowY = doc.y - 9;
        doc.text(String(t.score), tColX[1], tRowY);
        doc.text(t.source, tColX[2], tRowY);
        const ev = t.evidence.length > 40 ? t.evidence.slice(0, 38) + "..." : t.evidence;
        doc.text(ev, tColX[3], tRowY);
        doc.moveDown(0.2);
      }
    }

    // Error
    if (session.error) {
      doc.moveDown(1);
      this.sectionHeader(doc, "Error");
      doc.fontSize(10).fillColor("#c62828").text(session.error);
      doc.fillColor("#000000");
    }

    // Footer
    doc.moveDown(2);
    doc.fontSize(8).fillColor("#999999")
      .text("Generated by YT_Channel_Stats", { align: "center" });
  }

  private sectionHeader(doc: PDFKit.PDFDocument, title: string): void {
    doc.fontSize(14).font("Helvetica-Bold").text(title);
    doc.moveDown(0.3);
    doc.moveTo(50, doc.y).lineTo(520, doc.y).stroke("#333333");
    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(10);
  }

  private bullet(doc: PDFKit.PDFDocument, label: string, value: string): void {
    doc.font("Helvetica-Bold").text(`${label}: `, { continued: true });
    doc.font("Helvetica").text(value);
  }
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}
