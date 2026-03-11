import fs from "fs";
import path from "path";
import crypto from "crypto";
import { ResearchSession } from "./types";

export class SessionStore {
  private dir: string;

  constructor(sessionDir: string) {
    this.dir = sessionDir;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  create(niche: string, keywords: string[]): ResearchSession {
    const session: ResearchSession = {
      id: crypto.randomUUID(),
      niche,
      keywords,
      status: "pending",
      createdAt: new Date().toISOString(),
      completedAt: null,
      channels: [],
      analysis: null,
      recommendation: null,
      chromeData: null,
      tags: [],
      error: null,
    };
    this.save(session);
    return session;
  }

  save(session: ResearchSession): void {
    const filePath = path.join(this.dir, `${session.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
  }

  get(id: string): ResearchSession | null {
    const filePath = path.join(this.dir, `${id}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  }

  list(): ResearchSession[] {
    if (!fs.existsSync(this.dir)) return [];
    const files = fs.readdirSync(this.dir).filter((f) => f.endsWith(".json"));
    return files
      .map((f) => JSON.parse(fs.readFileSync(path.join(this.dir, f), "utf-8")))
      .sort((a: ResearchSession, b: ResearchSession) =>
        b.createdAt.localeCompare(a.createdAt)
      );
  }

  delete(id: string): boolean {
    const filePath = path.join(this.dir, `${id}.json`);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  }
}
