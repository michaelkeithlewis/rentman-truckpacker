/**
 * Background auto-sync that polls on an interval.
 * Uses the provider set by ACTIVE_PROVIDER env var (defaults to "rentman").
 */

import * as log from "@/lib/logger";
import { acquireLock, releaseLock, isSyncing } from "@/lib/sync-lock";
import type { ProviderId } from "@/lib/providers/types";
import {
  flexDailyQuotaResumeAt,
  isFlexDailyQuota429Error,
  isFlexDailyQuotaPaused,
  pauseFlexUntilNextUtcDay,
} from "@/lib/flex-api-guard";

const INTERVAL_MS_RENTMAN = 60 * 60 * 1000; // 1 hour

/** Flex has a 10k/day hard cap — default 6h + in-memory equipment cache; tune via env. */
const INTERVAL_MS_FLEX_DEFAULT = 6 * 60 * 60 * 1000;

function getAutoSyncIntervalMs(): number {
  if (getServerProvider() === "flex") {
    const raw = process.env.FLEX_AUTO_SYNC_INTERVAL_MS;
    if (raw) {
      const n = parseInt(raw, 10);
      if (!Number.isNaN(n) && n >= 3_600_000) return n;
    }
    return INTERVAL_MS_FLEX_DEFAULT;
  }
  return INTERVAL_MS_RENTMAN;
}

function flexAutoSyncDisabled(): boolean {
  const v = process.env.FLEX_DISABLE_AUTO_SYNC?.toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

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

  if (providerId === "flex") {
    if (flexAutoSyncDisabled()) {
      log.info("auto-sync", "Flex auto-sync disabled (set FLEX_DISABLE_AUTO_SYNC=1)");
      releaseLock();
      return;
    }
    if (isFlexDailyQuotaPaused()) {
      log.info(
        "auto-sync",
        `Flex auto-sync skipped — daily quota pause active (resumes ${flexDailyQuotaResumeAt() ?? "unknown"})`
      );
      releaseLock();
      return;
    }
  }

  try {
    log.info("auto-sync", `Starting background sync (provider: ${providerId})`);

    const { getProvider } = await import("@/lib/providers");
    const { listPacks, listCaseCategories } = await import("@/lib/truckpacker");
    const { syncOneProject, syncOneProjectGeneric } = await import("@/lib/incremental-sync");

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
      // Generic provider sync (Flex, CurrentRMS, etc.)
      for (const project of projects) {
        try {
          const result = await syncOneProjectGeneric(
            provider, project, allPacks, catMap, colorIdx, srcToken, tpKey
          );
          if (result) synced++;
          else skipped++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("429")) {
            if (providerId === "flex" && isFlexDailyQuota429Error(msg)) {
              pauseFlexUntilNextUtcDay("Flex daily API limit reached");
            }
            log.warn("auto-sync", "Rate limited — stopping sync, will resume next cycle");
            break;
          }
          log.error("auto-sync", `Failed "${project.name}": ${msg}`);
        }
        await new Promise((r) => setTimeout(r, 3000)); // 3s between Flex projects
      }
    }

    log.info("auto-sync", `Background sync complete: ${synced} synced, ${skipped} skipped`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (providerId === "flex" && isFlexDailyQuota429Error(msg)) {
      pauseFlexUntilNextUtcDay("Flex daily API limit reached");
    }
    log.error("auto-sync", `Background sync failed: ${msg}`);
  } finally {
    releaseLock();
  }
}

export function startAutoSync() {
  if (g[gKey]) return;
  const intervalMs = getAutoSyncIntervalMs();
  log.info(
    "auto-sync",
    `Starting background sync (every ${Math.round(intervalMs / 1000)}s, provider: ${getServerProvider()})`
  );
  setTimeout(() => runSync(), 5000);
  g[gKey] = setInterval(() => runSync(), intervalMs);
}

export function stopAutoSync() {
  if (g[gKey]) {
    clearInterval(g[gKey]!);
    g[gKey] = null;
    log.info("auto-sync", "Stopped background sync");
  }
}
