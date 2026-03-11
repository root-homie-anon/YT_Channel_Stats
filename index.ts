import { loadConfig } from "./src/config";
import { ResearchPipeline } from "./src/pipeline";
import { SessionStore } from "./src/sessions";

async function main() {
  const config = loadConfig();
  const sessions = new SessionStore(config.sessionDir);
  const pipeline = new ResearchPipeline(config.youtubeApiKey, config.sessionDir);

  const pastSessions = sessions.list();

  if (pastSessions.length > 0) {
    console.log("\n=== Past Research Sessions ===");
    for (const s of pastSessions) {
      const verdict = s.recommendation?.verdict ?? "pending";
      const error = s.error ? ` | error: ${s.error}` : "";
      console.log(`  [${s.status}] ${s.niche} — ${verdict} (${s.createdAt})${error}`);
    }
    console.log("");
  } else {
    console.log("\nNo past research sessions found.\n");
  }

  // CLI usage: pass niche and keywords as args
  // e.g., ts-node index.ts "personal finance" "personal finance youtube" "money tips youtube"
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log("Usage: ts-node index.ts <niche> [keyword1] [keyword2] ...");
    console.log('Example: ts-node index.ts "personal finance" "money tips" "budgeting youtube"');
    console.log("\nOr start the dashboard server: ts-node dashboard/server.ts");
    return;
  }

  const niche = args[0];
  const keywords = args.length > 1 ? args.slice(1) : [niche];

  console.log(`Starting research session for niche: "${niche}"`);
  console.log(`Keywords: ${keywords.join(", ")}\n`);

  const session = await pipeline.run(niche, keywords);
  const report = pipeline.generateReport(session);

  console.log("\n" + report);
}

main().catch(console.error);
