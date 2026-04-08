/**
 * Background auto-sync that polls on an interval.
 * Uses the provider set by ACTIVE_PROVIDER env var (defaults to "rentman").
 */

import * as log from "@/lib/logger";
import { acquireLock, releaseLock, isSyncing } from "@/lib/sync-lock";
import type { ProviderId } from "@/lib/providers/types";

const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes (webhooks handle instant updates)

const gKey = Symbol.for("app.autoSync");
const g = globalThis as unknown as Record<symbol, NodeJS.Timeout | null>;

export function getServerProvider(): ProviderId {
  const p = process.env.ACTIVE_PROVIDER;
  if (p === "flex" || p === "currentrms") return p;
  return "rentman";
}

export function getServerSourceToken(): string {
  const provider = getServerProvider();
  switch (provider) {
    case "flex": return process.env.FLEX_API_TOKEN ?? "";
    case "currentrms": return process.env.CURRENTRMS_API_TOKEN ?? "";
    default: return process.env.RENTMAN_API_TOKEN ?? "";
  }
}

async function runSync() {
  if (isSyncing()) {
    log.debug("auto-sync", "Skipping — sync already in progress");
    return;
  }
  if (!acquireLock()) return;

  const srcToken = getServerSourceToken();
  const tpKey = process.env.TRUCKPACKER_API_KEY;
  if (!srcToken || !tpKey) {
    releaseLock();
    return;
  }

  const providerId = getServerProvider();

  try {
    log.info("auto-sync", `Starting background sync (provider: ${providerId})`);

    const { getProvider } = await import("@/lib/providers");
    const { listPacks, listCaseCategories } = await import("@/lib/truckpacker");
    const { syncOneProject } = await import("@/lib/incremental-sync");

    const provider = getProvider(providerId);
    const projects = await provider.listProjects(srcToken);

    log.info("auto-sync", `Loaded ${projects.length} projects from ${provider.name}`);

    // For non-Rentman providers, we need folders from the provider, not Rentman
    // The incremental sync uses folderMap for category resolution, but
    // the provider already resolves categories in listEquipment/getEquipment.
    // We still need folderMap for Rentman; for others, pass an empty map.
    let folderMap = new Map<number, string>();
    if (providerId === "rentman") {
      const { listFolders } = await import("@/lib/rentman");
      const folders = await listFolders(srcToken);
      for (const f of folders) folderMap.set(f.id, f.path ?? f.name);
    }

    const [allPacks, existingCats] = await Promise.all([
      listPacks(tpKey),
      listCaseCategories(tpKey),
    ]);

    const catMap = new Map<string, string>();
    for (const c of existingCats) catMap.set(c.name.trim().toLowerCase(), c._id);
    const colorIdx = { i: existingCats.length };

    let synced = 0;
    let skipped = 0;

    // Convert provider projects to the format syncOneProject expects
    // syncOneProject currently expects a Rentman Project type.
    // For now, only Rentman uses the auto-sync with full incremental sync.
    // For Flex/CurrentRMS, we use the provider abstraction through the API routes.
    if (providerId === "rentman") {
      const { listProjects: rmListProjects } = await import("@/lib/rentman");
      const rmProjects = await rmListProjects(100, srcToken);
      for (const project of rmProjects) {
        try {
          const result = await syncOneProject(
            project, allPacks, folderMap, catMap, colorIdx, srcToken, tpKey
          );
          if (result) synced++;
          else skipped++;
        } catch (e) {
          log.error("auto-sync", `Failed "${project.name}": ${e instanceof Error ? e.message : e}`);
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    } else {
      log.info("auto-sync", `Provider ${providerId} uses webhook/manual sync — auto-sync skipped`);
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
