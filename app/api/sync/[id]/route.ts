import {
  getProject,
  getEquipment,
  listFolders,
  parseRefId,
} from "@/lib/rentman";
import {
  listCaseCategories,
  createCaseCategory,
  createPack,
  listPacks,
  getPackEntities,
  batchCreateEntities,
  batchDeleteEntities,
} from "@/lib/truckpacker";
import { rentmanToken, truckpackerKey } from "@/lib/tokens";
import { buildSyncCardEntity } from "@/lib/sync-card";
import type { SyncCardData } from "@/lib/sync-card";
import * as log from "@/lib/logger";
import { NextResponse } from "next/server";
import {
  effectiveJobKey,
  findPackForProject,
  formatPackDisplayName,
  rentmanEquipmentBracket,
} from "@/lib/source-tags";

const CM_TO_M = 0.01;
const FALLBACK = 0.3;
const COLORS = [
  "#4A90D9", "#E06C75", "#98C379", "#E5C07B", "#C678DD",
  "#56B6C2", "#D19A66", "#61AFEF", "#BE5046", "#7EC699",
];

interface SyncItem {
  equipmentId: number;
  quantity: number;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rmToken = rentmanToken(req);
    const tpKey = truckpackerKey(req);
    const { id } = await params;
    const projectId = parseInt(id, 10);

    let items: SyncItem[] | undefined;
    let mode: "create" | "update" = "create";
    let existingPackId: string | undefined;
    try {
      const body = await req.json();
      if (body?.items && Array.isArray(body.items)) items = body.items;
      if (body?.mode === "update" && body?.existingPackId) {
        mode = "update";
        existingPackId = body.existingPackId;
      }
    } catch { /* no body */ }

    if (!items) {
      return NextResponse.json(
        { error: "No items provided. Use the sync wizard." },
        { status: 400 }
      );
    }

    const [project, folders, existingCats] = await Promise.all([
      getProject(projectId, rmToken),
      listFolders(rmToken),
      listCaseCategories(tpKey),
    ]);

    const folderMap = new Map<number, string>();
    for (const f of folders) folderMap.set(f.id, f.path ?? f.name);

    const catMap = new Map<string, string>();
    for (const c of existingCats) catMap.set(c.name.trim().toLowerCase(), c._id);
    let colorIdx = existingCats.length;

    async function resolveCategory(name: string): Promise<string> {
      const key = name.trim().toLowerCase();
      if (catMap.has(key)) return catMap.get(key)!;
      const color = COLORS[colorIdx++ % COLORS.length];
      const cat = await createCaseCategory({ name, colorHex: color }, tpKey);
      catMap.set(key, cat._id);
      return cat._id;
    }

    const projectName = project.displayname ?? project.name;
    const jobKey = effectiveJobKey(String(project.number), String(projectId));
    const packTitle = formatPackDisplayName(
      "rentman",
      String(project.number),
      projectName,
      jobKey
    );

    // ── Pack: reuse existing or create new ──
    let packId: string;
    if (mode === "update" && existingPackId) {
      // Clear old entities from the pack
      const oldEntities = await getPackEntities(existingPackId, tpKey);
      if (oldEntities.length > 0) {
        const CHUNK = 50;
        const ids = oldEntities.map((e) => e._id);
        for (let i = 0; i < ids.length; i += CHUNK) {
          await batchDeleteEntities(existingPackId, ids.slice(i, i + CHUNK), tpKey);
        }
      }
      packId = existingPackId;
    } else {
      const pack = await createPack({ name: packTitle }, tpKey);
      packId = pack._id;
    }

    // ── Build entities ──
    type EntityInput = Parameters<typeof batchCreateEntities>[0][number];
    const entities: EntityInput[] = [];
    let xOffset = 0;
    let skippedVirtual = 0;
    let missingDimensions = 0;
    let uniqueItems = 0;

    for (const item of items) {
      const equip = await getEquipment(item.equipmentId, rmToken);
      if (equip.is_physical === "Virtual package") {
        skippedVirtual++;
        continue;
      }

      uniqueItems++;
      const l = equip.length ?? 0;
      const w = equip.width ?? 0;
      const h = equip.height ?? 0;
      const hasDims = l > 0 && w > 0 && h > 0;
      if (!hasDims) missingDimensions++;
      const dx = hasDims ? l * CM_TO_M : FALLBACK;
      const dy = hasDims ? w * CM_TO_M : FALLBACK;
      const dz = hasDims ? h * CM_TO_M : FALLBACK;
      const weight = equip.weight && equip.weight > 0 ? equip.weight : undefined;

      let folderPath = "Uncategorized";
      if (equip.folder) {
        try {
          folderPath = folderMap.get(parseRefId(equip.folder)) ?? "Uncategorized";
        } catch { /* skip */ }
      }
      const categoryId = await resolveCategory(folderPath);
      const baseName = equip.displayname ?? equip.name;
      const qty = item.quantity;

      for (let i = 0; i < qty; i++) {
        const label = qty > 1 ? `${baseName} #${i + 1}` : baseName;
        entities.push({
          name: `${label} ${rentmanEquipmentBracket(equip.id)}`,
          type: "case",
          packId,
          visible: true,
          childrenIds: [],
          position: { x: xOffset, y: 0, z: 0 },
          quaternion: { x: 0, y: 0, z: 0, w: 1 },
          size: { x: dx, y: dy, z: dz },
          caseData: {
            weight,
            manufacturer: `Rentman #${equip.id}`,
            canRotate3d: false,
            categoryId,
          },
        });
        xOffset += dx + 0.05;
      }
    }

    // Add sync card
    const syncLogCat = await resolveCategory("Sync Log");
    const now = new Date().toISOString();
    const cardData: SyncCardData = {
      projectName,
      projectId,
      provider: "Rentman",
      projectCreated: now,
      lastSynced: now,
      totalItems: uniqueItems,
      totalEntities: entities.length,
      missingDimensions,
    };
    entities.push(buildSyncCardEntity(packId, syncLogCat, cardData));

    log.info("sync", `Syncing "${projectName}": ${entities.length} entities (${missingDimensions} missing dims)`, { packId, mode });

    const CHUNK = 50;
    for (let i = 0; i < entities.length; i += CHUNK) {
      await batchCreateEntities(entities.slice(i, i + CHUNK), tpKey);
    }

    return NextResponse.json({
      success: true,
      packId,
      packUrl: `https://app.truckpacker.com/packs/${packId}`,
      entitiesCreated: entities.length - 1, // exclude sync card from count
      skippedVirtual,
      missingDimensions,
      projectName,
      mode,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// GET: check for existing pack for this Rentman project
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tpKey = truckpackerKey(req);
    const rmToken = rentmanToken(req);
    const { id } = await params;
    const projectId = parseInt(id, 10);

    if (!rmToken) {
      return NextResponse.json(
        { error: "Rentman token required to resolve project number" },
        { status: 401 }
      );
    }

    const project = await getProject(projectId, rmToken);
    const jobKey = effectiveJobKey(String(project.number), String(projectId));
    const packs = await listPacks(tpKey);
    const match = findPackForProject(packs, "rentman", jobKey, [String(projectId)]);

    return NextResponse.json({
      existingPack: match
        ? { id: match._id, name: match.name }
        : null,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
