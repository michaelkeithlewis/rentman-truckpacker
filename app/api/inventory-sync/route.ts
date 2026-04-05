import { getProvider, makeStamp, parseStamp } from "@/lib/providers";
import type { SyncStatus, SyncedItem, ProviderId } from "@/lib/providers";
import {
  listCases,
  listCaseCategories,
  createCase,
  updateCase,
  createCaseCategory,
} from "@/lib/truckpacker";
import type { TPCase } from "@/lib/truckpacker";
import { activeProvider, sourceToken, truckpackerKey } from "@/lib/tokens";
import { NextResponse } from "next/server";
import * as log from "@/lib/logger";

const CM_TO_M = 0.01;
const FALLBACK_DIM = 0.3;
const EPSILON = 0.001;

const CATEGORY_COLORS = [
  "#4A90D9", "#E06C75", "#98C379", "#E5C07B", "#C678DD",
  "#56B6C2", "#D19A66", "#61AFEF", "#BE5046", "#7EC699",
];

function dimsMatch(
  source: { length?: number; width?: number; height?: number; weight?: number },
  tp: { dx: number; dy: number; dz: number; weight?: number }
): boolean {
  const sl = (source.length ?? 0) * CM_TO_M;
  const sw = (source.width ?? 0) * CM_TO_M;
  const sh = (source.height ?? 0) * CM_TO_M;
  const hasSrc = sl > 0 && sw > 0 && sh > 0;
  const srcL = hasSrc ? sl : FALLBACK_DIM;
  const srcW = hasSrc ? sw : FALLBACK_DIM;
  const srcH = hasSrc ? sh : FALLBACK_DIM;

  return (
    Math.abs(srcL - tp.dx) < EPSILON &&
    Math.abs(srcW - tp.dy) < EPSILON &&
    Math.abs(srcH - tp.dz) < EPSILON &&
    Math.abs((source.weight ?? 0) - (tp.weight ?? 0)) < EPSILON
  );
}

function computeStatus(
  source: { length?: number; width?: number; height?: number; weight?: number },
  tpCase: TPCase
): SyncStatus {
  if (dimsMatch(source, tpCase)) return "synced";
  // We can't do 3-way merge without a stored snapshot, so for now:
  // if they differ, it's a conflict (user must decide which side wins)
  return "conflict";
}

// ── GET: compute sync status for all equipment ──

export async function GET(req: Request) {
  try {
    const providerId = activeProvider(req);
    const srcToken = sourceToken(req);
    const tpKey = truckpackerKey(req);
    const provider = getProvider(providerId);

    log.info("inventory-sync", "GET: computing sync status", { provider: providerId });

    const [equipment, cases] = await Promise.all([
      log.timed("inventory-sync", `Fetch equipment from ${provider.name}`, () => provider.listEquipment(srcToken)),
      log.timed("inventory-sync", "Fetch TP cases", () => listCases(tpKey)),
    ]);

    // Build map of stamp → TP case
    const stampMap = new Map<string, TPCase>();
    for (const c of cases) {
      const stamp = parseStamp(c.description);
      if (stamp && stamp.providerId === providerId) {
        stampMap.set(stamp.sourceId, c);
      }
    }

    const items: SyncedItem[] = equipment.map((e) => {
      const tpCase = stampMap.get(e.sourceId);
      let syncStatus: SyncStatus = "unlinked";
      let tpValues: SyncedItem["tpValues"];

      if (tpCase) {
        syncStatus = computeStatus(
          { length: e.length, width: e.width, height: e.height, weight: e.weight },
          tpCase
        );
        tpValues = {
          length: Math.round(tpCase.dx / CM_TO_M * 100) / 100,
          width: Math.round(tpCase.dy / CM_TO_M * 100) / 100,
          height: Math.round(tpCase.dz / CM_TO_M * 100) / 100,
          weight: tpCase.weight,
        };
      }

      return {
        sourceId: e.sourceId,
        name: e.name,
        code: e.code,
        category: e.category,
        isPhysical: e.isPhysical,
        syncStatus,
        sourceValues: {
          length: e.length,
          width: e.width,
          height: e.height,
          weight: e.weight,
        },
        tpValues,
        tpCaseId: tpCase?._id,
      };
    });

    const synced = items.filter((i) => i.syncStatus === "synced").length;
    const conflicts = items.filter((i) => i.syncStatus === "conflict").length;
    const unlinked = items.filter((i) => i.syncStatus === "unlinked").length;
    log.info("inventory-sync", `GET complete: ${items.length} items`, { synced, conflicts, unlinked });

    return NextResponse.json({ items, providerId });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    log.error("inventory-sync", `GET failed: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── POST: sync selected items ──

interface SyncAction {
  sourceId: string;
  action: "create" | "update-tp" | "update-source" | "skip";
}

export async function POST(req: Request) {
  try {
    const providerId = activeProvider(req) as ProviderId;
    const srcToken = sourceToken(req);
    const tpKey = truckpackerKey(req);
    const provider = getProvider(providerId);

    const body = await req.json();
    const actions: SyncAction[] = body.items ?? [];
    log.info("inventory-sync", `POST: ${actions.length} items to sync`, {
      provider: providerId,
      actions: actions.map((a) => `${a.sourceId}:${a.action}`).slice(0, 10),
    });

    // Load existing TP cases + categories for stamp matching
    const [cases, existingCats] = await Promise.all([
      listCases(tpKey),
      listCaseCategories(tpKey),
    ]);

    const stampMap = new Map<string, TPCase>();
    for (const c of cases) {
      const stamp = parseStamp(c.description);
      if (stamp && stamp.providerId === providerId) {
        stampMap.set(stamp.sourceId, c);
      }
    }

    const catMap = new Map<string, string>();
    for (const c of existingCats) catMap.set(c.name.trim().toLowerCase(), c._id);
    let colorIdx = existingCats.length;

    async function resolveCategory(name: string): Promise<string> {
      const key = name.trim().toLowerCase();
      if (catMap.has(key)) return catMap.get(key)!;
      const color = CATEGORY_COLORS[colorIdx++ % CATEGORY_COLORS.length];
      const cat = await createCaseCategory({ name, colorHex: color }, tpKey);
      catMap.set(key, cat._id);
      return cat._id;
    }

    let created = 0;
    let updated = 0;
    let sourceUpdated = 0;

    for (const action of actions) {
      if (action.action === "skip") continue;

      const equip = await provider.getEquipment(action.sourceId, srcToken);

      const l = equip.length ?? 0;
      const w = equip.width ?? 0;
      const h = equip.height ?? 0;
      const hasDims = l > 0 && w > 0 && h > 0;
      const dx = hasDims ? l * CM_TO_M : FALLBACK_DIM;
      const dy = hasDims ? w * CM_TO_M : FALLBACK_DIM;
      const dz = hasDims ? h * CM_TO_M : FALLBACK_DIM;

      if (action.action === "create") {
        const categoryId = await resolveCategory(equip.category);
        await createCase(
          {
            name: equip.name,
            dx,
            dy,
            dz,
            canRotate3d: false,
            categoryId,
            description: makeStamp(providerId, equip.sourceId),
            manufacturer: equip.code ?? undefined,
            weight: equip.weight ?? undefined,
          },
          tpKey
        );
        log.info("inventory-sync", `Created TP case for "${equip.name}"`, { sourceId: equip.sourceId, dx, dy, dz });
        created++;
      } else if (action.action === "update-tp") {
        const existing = stampMap.get(action.sourceId);
        if (existing) {
          await updateCase(
            existing._id,
            {
              name: equip.name,
              dx,
              dy,
              dz,
              weight: equip.weight ?? undefined,
            },
            tpKey
          );
          log.info("inventory-sync", `Updated TP case "${equip.name}"`, { tpCaseId: existing._id, dx, dy, dz });
          updated++;
        }
      } else if (action.action === "update-source") {
        const existing = stampMap.get(action.sourceId);
        if (existing && provider.updateEquipment) {
          const newDims = {
            length: Math.round(existing.dx / CM_TO_M * 100) / 100,
            width: Math.round(existing.dy / CM_TO_M * 100) / 100,
            height: Math.round(existing.dz / CM_TO_M * 100) / 100,
          };
          log.info("inventory-sync", `Pushing TP dims back to source "${equip.name}"`, { sourceId: action.sourceId, ...newDims });
          await provider.updateEquipment(
            action.sourceId,
            {
              length: newDims.length,
              width: newDims.width,
              height: newDims.height,
              weight: existing.weight ?? undefined,
            },
            srcToken
          );
          sourceUpdated++;
        }
      }
    }

    log.info("inventory-sync", `POST complete`, { created, updated, sourceUpdated });

    return NextResponse.json({
      success: true,
      created,
      updated,
      sourceUpdated,
      total: actions.filter((a) => a.action !== "skip").length,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    log.error("inventory-sync", `POST failed: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
