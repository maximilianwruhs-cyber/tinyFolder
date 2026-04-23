/**
 * GZMO Chaos Engine — Pruning Engine (Purposeful Forgetting)
 *
 * Implements the decay/forgetting phase of the Cascading Honeypot Theorem.
 * Moves successfully digested raw data (tasks) out of the active Inbox and 
 * into a compressed Archive. This prevents unbounded folder growth and keeps 
 * the active dream ingestion loop lightning fast.
 */

import { promises as fsp } from "fs";
import * as path from "path";

const DIGESTED_FILE_NAME = ".gzmo_dreams_digested.json";

export class PruningEngine {
  private vaultPath: string;
  private digestedFilePath: string;
  private maxIdleTicks: number;
  private tickCounter: number = 0;

  constructor(vaultPath: string, executeEveryNTicks: number = 200) {
    this.vaultPath = vaultPath;
    this.digestedFilePath = path.join(vaultPath, "GZMO", DIGESTED_FILE_NAME);
    this.maxIdleTicks = executeEveryNTicks; // e.g. 200 ticks = ~1 minute
  }

  /**
   * Called by the heartbeat every tick.
   * Only actually prunes if elapsed ticks reached AND tension is low (Idle).
   */
  async tick(tension: number, energy: number): Promise<void> {
    this.tickCounter++;
    
    // Only prune during low-stress idle time (tension < 30)
    // and if enough time has passed.
    if (this.tickCounter >= this.maxIdleTicks) {
      if (tension < 30 && energy > 40) {
        this.tickCounter = 0;
        await this.archiveDigested();
      }
    }
  }

  private async archiveDigested(): Promise<void> {
    try {
      // 1. Read digested IDs
      let digestedData: { digested: string[] };
      try {
        const file = Bun.file(this.digestedFilePath);
        if (!(await file.exists())) return;
        digestedData = await file.json();
      } catch {
        return; // Invalid JSON, skip pruning
      }

      const digestedIds = new Set(digestedData.digested || []);
      if (digestedIds.size === 0) return;

      const inboxDir = path.join(this.vaultPath, "GZMO", "Inbox");
      const archiveDir = path.join(this.vaultPath, "GZMO", "Archive", "Inbox");
      
      try {
        await fsp.mkdir(archiveDir, { recursive: true });
      } catch {}

      // 2. Scan Inbox for files that exist in digested database
      const inboxFiles = await fsp.readdir(inboxDir);
      let archivedCount = 0;

      for (const file of inboxFiles) {
        if (!file.endsWith(".md")) continue;

        if (digestedIds.has(file)) {
          const sourcePath = path.join(inboxDir, file);
          const destPath = path.join(archiveDir, file);
          
          try {
            await fsp.rename(sourcePath, destPath);
            archivedCount++;
          } catch (err: any) {
            console.error(`[PRUNE] Failed to archive ${file}: ${err?.message}`);
          }
        }
      }

      if (archivedCount > 0) {
        console.log(`[PRUNE] Purposeful Forgetting: Archived ${archivedCount} digested tasks.`);
      }

    } catch (err: any) {
      console.error(`[PRUNE] Core error: ${err?.message}`);
    }
  }
}
