import { NextResponse } from "next/server";
import * as log from "@/lib/logger";
import { listPacks, listCaseCategories } from "@/lib/truckpacker";
import { listProjects, listFolders } from "@/lib/rentman";
import { syncOneProject } from "@/lib/incremental-sync";
import { rentmanToken, truckpackerKey } from "@/lib/tokens";
import { acquireLock, releaseLock, isSyncing } from "@/lib/sync-lock";

export async function POST(req: Request) {
  const rmToken = rentmanToken(req);
  const tpKey = truckpackerKey(req);

  if (!rmToken || !tpKey) {
    return NextResponse.json({ error: "Missing API tokens" }, { status: 400 });
  }

  if (isSyncing()) {
    return NextResponse.json({ error: "Sync already in progress" }, { status: 409 });
  }
  if (!acquireLock()) {
    return NextResponse.json({ error: "Sync already in progress" }, { status: 409 });
  }

  try {
    log.info("sync-all", "Starting full incremental sync");

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
    const results: Array<{ name: string; added: number; removed: number; unchanged: number }> = [];

    for (const project of projects) {
      try {
        const result = await syncOneProject(
          project, allPacks, folderMap, catMap, colorIdx, rmToken, tpKey
        );
        if (result) {
          synced++;
          results.push({
            name: (project.displayname ?? project.name).trim(),
            added: result.added,
            removed: result.removed,
            unchanged: result.unchanged,
          });
        } else {
          skipped++;
        }
      } catch (e) {
        log.error("sync-all", `Failed "${project.name}": ${e instanceof Error ? e.message : e}`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    log.info("sync-all", `Complete: ${synced} synced, ${skipped} skipped`);
    releaseLock();

    return NextResponse.json({
      success: true,
      synced,
      skipped,
      total: projects.length,
      results,
    });
  } catch (e: unknown) {
    releaseLock();
    const msg = e instanceof Error ? e.message : "Unknown error";
    log.error("sync-all", `Failed: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
