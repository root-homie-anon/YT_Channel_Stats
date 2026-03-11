import fs from "fs";
import path from "path";

export interface NicheMonitor {
  niche: string;
  keywords: string[];
  intervalDays: number;
  lastRunAt: string | null;
  createdAt: string;
  active: boolean;
}

export class TrendMonitor {
  private filePath: string;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.filePath = path.join(dataDir, "monitors.json");
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify([], null, 2));
    }
  }

  private load(): NicheMonitor[] {
    const raw = fs.readFileSync(this.filePath, "utf-8");
    return JSON.parse(raw) as NicheMonitor[];
  }

  private save(monitors: NicheMonitor[]): void {
    fs.writeFileSync(this.filePath, JSON.stringify(monitors, null, 2));
  }

  addMonitor(niche: string, keywords: string[], intervalDays: number): NicheMonitor {
    const monitors = this.load();
    const existing = monitors.find(
      (m) => m.niche.toLowerCase() === niche.toLowerCase()
    );
    if (existing) {
      throw new Error(`Monitor already exists for niche: ${niche}`);
    }

    const monitor: NicheMonitor = {
      niche,
      keywords,
      intervalDays,
      lastRunAt: null,
      createdAt: new Date().toISOString(),
      active: true,
    };

    monitors.push(monitor);
    this.save(monitors);
    return monitor;
  }

  removeMonitor(niche: string): boolean {
    const monitors = this.load();
    const idx = monitors.findIndex(
      (m) => m.niche.toLowerCase() === niche.toLowerCase()
    );
    if (idx === -1) return false;

    monitors.splice(idx, 1);
    this.save(monitors);
    return true;
  }

  listMonitors(): NicheMonitor[] {
    return this.load();
  }

  getStaleMonitors(): NicheMonitor[] {
    const monitors = this.load();
    const now = Date.now();

    return monitors.filter((m) => {
      if (!m.active) return false;
      if (!m.lastRunAt) return true; // never run — stale by definition

      const lastRun = new Date(m.lastRunAt).getTime();
      const ageMs = now - lastRun;
      const intervalMs = m.intervalDays * 24 * 60 * 60 * 1000;
      return ageMs >= intervalMs;
    });
  }

  markRun(niche: string): boolean {
    const monitors = this.load();
    const monitor = monitors.find(
      (m) => m.niche.toLowerCase() === niche.toLowerCase()
    );
    if (!monitor) return false;

    monitor.lastRunAt = new Date().toISOString();
    this.save(monitors);
    return true;
  }
}
