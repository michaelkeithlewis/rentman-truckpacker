/**
 * Background auto-sync that polls on an interval.
 * Uses incremental sync — only adds/removes Rentman-stamped entities,
 * never touches items manually placed in Truck Packer.
 */

import * as log from "@/lib/logger";
import { acquireLock, releaseLock, isSyncing } from "@/lib/sync-lock";

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const gKey = Symbol.for("app.autoSync");
const g = globalThis as unknown as Record<symbol, NodeJS.Timeout | null>;

async function runSync() {
  if (isSyncing()) {
    log.debug("auto-sync", "Skipping — sync already in progress");
    return;
  }
  if (!acquireLock()) return;

  const rmToken = process.env.RENTMAN_API_TOKEN;
  const tpKey = process.env.TRUCKPACKER_API_KEY;
  if (!rmToken || !tpKey) {
    releaseLock();
    return;
  }

  try {
    log.info("auto-sync", "Starting background sync");

    const { listProjects, listFolders, parseRefId } = await import("@/lib/rentman");
    const { listPacks, listCaseCategories } = await import("@/lib/truckpacker");
    const { syncOneProject } = await import("@/lib/incremental-sync");

    const [projects, folders, existingCats] = await Promise.all([
      listProjects(50, rmToken),
      listFolders(rmToken),
      listCaseCategories(tpKey),
    ]);
    const allPacks = await listPacks(tpKey);

    const folderMap = new Map<number, string>();
    for (const f of folders) folderMap.set(f.id, f.path ?? f.name);

    const catMap = new Map<string, string>();
    for (const c of existingCats) catMap.set(c.name.trim().toLowerCase(), c._id);
    const colorIdx = { i: existingCats.length };

    let synced = 0;
    let skipped = 0;

    for (const project of projects) {
      try {
        const result = await syncOneProject(
          project, allPacks, folderMap, catMap, colorIdx, rmToken, tpKey
        );
        if (result) synced++;
        else skipped++;
      } catch (e) {
        log.error("auto-sync", `Failed "${project.name}": ${e instanceof Error ? e.message : e}`);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    log.info("auto-sync", `Background sync complete: ${synced} synced, ${skipped} skipped`);
  } catch (e) {
    log.error("auto-sync", `Background sync failed: ${e instanceof Error ? e.message : e}`);
  } finally {
    releaseLock();
  }
}

export function startAutoSync() {
  if (g[gKey]) return;
  log.info("auto-sync", `Starting background sync (every ${INTERVAL_MS / 1000}s)`);
  setTimeout(() => runSync(), 5000);
  g[gKey] = setInterval(() => runSync(), INTERVAL_MS);
}

export function stopAutoSync() {
  if (g[gKey]) {
    clearInterval(g[gKey]!);
    g[gKey] = null;
    log.info("auto-sync", "Stopped background sync");
  }
}
