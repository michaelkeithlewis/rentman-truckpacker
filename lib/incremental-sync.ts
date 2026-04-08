/**
 * Incremental sync: diffs Rentman project data against existing Truck Packer
 * pack entities. Only adds/removes/updates Rentman-stamped entities.
 * TP-native entities (manually added in Truck Packer) are never touched.
 */

import * as log from "@/lib/logger";
import {
  getPackEntities,
  batchDeleteEntities,
  batchCreateEntities,
  createPack,
  listPacks,
  listCaseCategories,
  createCaseCategory,
} from "@/lib/truckpacker";
import type { TPEntity, Pack } from "@/lib/truckpacker";
import {
  rentmanGet,
  getEquipment as rmGetEquipment,
  listProjectEquipment,
  listFolders,
  parseRefId,
  getProjectStatus,
} from "@/lib/rentman";
import type { Equipment, Project, ProjectStatus } from "@/lib/rentman";
import { buildSyncCardEntity } from "@/lib/sync-card";
import type { SyncCardData } from "@/lib/sync-card";
import { smartPack, packedToEntities } from "@/lib/smart-pack";
import type { Provider, ProviderProject, ProviderEquipment } from "@/lib/providers/types";

const CM_TO_M = 0.01;
const FALLBACK = 0.3;
const COLORS = [
  "#4A90D9", "#E06C75", "#98C379", "#E5C07B", "#C678DD",
  "#56B6C2", "#D19A66", "#61AFEF", "#BE5046", "#7EC699",
];

const RM_TAG_RE = /\[RM:(\w+)\]/;
const RM_VEHICLE_RE = /\[RM:V(\d+)\]/;

function isRentmanEntity(e: TPEntity): boolean {
  return RM_TAG_RE.test(e.name) || e.name.startsWith("SYNC LOG") || e.name.startsWith("SYNC:");
}

function extractRmTag(name: string): string | null {
  const m = name.match(RM_TAG_RE);
  return m ? m[1] : null;
}

interface VehicleInfo {
  id: number;
  name: string;
  displayname: string;
  length: number;
  width: number;
  height: number;
  payload_capacity: number;
}

interface SyncProjectResult {
  added: number;
  removed: number;
  unchanged: number;
  vehicleAdded: boolean;
  vehicleRemoved: boolean;
}

/**
 * Incrementally sync a single Rentman project to its Truck Packer pack.
 */
export async function syncOneProject(
  project: Project,
  allPacks: Pack[],
  folderMap: Map<number, string>,
  catMap: Map<string, string>,
  colorIdx: { i: number },
  rmToken: string,
  tpKey: string
): Promise<SyncProjectResult | null> {
  const pid = project.id;
  const pNum = project.number ?? pid;
  const pName = (project.displayname ?? project.name).trim();

  const status = await getProjectStatus(pid, rmToken);
  if (!status.isPackable) return null;

  const lines = await listProjectEquipment(pid, rmToken);
  if (lines.length === 0) return null;

  async function resolveCategory(name: string): Promise<string> {
    const key = name.trim().toLowerCase();
    if (catMap.has(key)) return catMap.get(key)!;
    const color = COLORS[colorIdx.i++ % COLORS.length];
    const cat = await createCaseCategory({ name, colorHex: color }, tpKey);
    catMap.set(key, cat._id);
    return cat._id;
  }

  // Vehicle
  let vehicleName: string | undefined;
  let vehicle: VehicleInfo | undefined;
  try {
    const pvRes = await rentmanGet<Array<{ vehicle: string }>>(
      `/projects/${pid}/projectvehicles?limit=1`, rmToken
    );
    if (pvRes.length > 0 && pvRes[0].vehicle) {
      const vId = parseRefId(pvRes[0].vehicle);
      vehicle = await rentmanGet<VehicleInfo>(`/vehicles/${vId}`, rmToken);
      vehicleName = vehicle.displayname ?? vehicle.name;
    }
  } catch { /* no vehicle */ }

  // Find or create pack
  const stampPrefix = `[RM:${pid}]`;
  let existingPack = allPacks.find((p) => p.name?.startsWith(stampPrefix));
  let packId: string;
  let isNewPack = false;

  if (existingPack) {
    packId = existingPack._id;
  } else {
    const pack = await createPack({
      name: `[RM:${pid}] #${pNum} ${pName}`,
    }, tpKey);
    packId = pack._id;
    allPacks.push(pack);
    isNewPack = true;
  }

  // Get existing entities in the pack
  const existingEntities = isNewPack ? [] : await getPackEntities(packId, tpKey);

  // Separate Rentman-owned entities from TP-native ones
  const rmEntities = existingEntities.filter(isRentmanEntity);
  log.debug("sync", `Pack "${pName}": ${existingEntities.length} existing entities, ${rmEntities.length} RM-tagged`, { packId, isNewPack });

  // Build desired equipment map: equipId → count
  const desiredEquip = new Map<number, { equip: Equipment; qty: number }>();
  let missDims = 0, virtSkip = 0, uniq = 0;

  for (const line of lines) {
    let eqId: number;
    try { eqId = parseRefId(line.equipment); } catch { continue; }
    let eq: Equipment;
    try { eq = await rmGetEquipment(eqId, rmToken); } catch { continue; }
    if (eq.is_physical === "Virtual package") { virtSkip++; continue; }

    const hasDims = (eq.length ?? 0) > 0 && (eq.width ?? 0) > 0 && (eq.height ?? 0) > 0;
    if (!hasDims) { missDims++; continue; }

    uniq++;
    const existing = desiredEquip.get(eqId);
    if (existing) {
      existing.qty += line.quantity ?? 1;
    } else {
      desiredEquip.set(eqId, { equip: eq, qty: line.quantity ?? 1 });
    }
  }

  // Count existing RM entities per equipment ID
  const existingRmCounts = new Map<string, TPEntity[]>();
  const existingSyncCards: TPEntity[] = [];
  let existingVehicleEntity: TPEntity | undefined;

  for (const e of rmEntities) {
    if (e.name.startsWith("SYNC LOG") || e.name.startsWith("SYNC:")) {
      existingSyncCards.push(e);
      continue;
    }
    if (RM_VEHICLE_RE.test(e.name)) {
      existingVehicleEntity = e;
      continue;
    }
    const tag = extractRmTag(e.name);
    if (tag) {
      const list = existingRmCounts.get(tag) ?? [];
      list.push(e);
      existingRmCounts.set(tag, list);
    }
  }

  // Compute diff
  const toDelete: string[] = [];
  let toAdd: Parameters<typeof batchCreateEntities>[0] = [];
  let unchanged = 0;

  // Check for equipment that was REMOVED from the project
  for (const [tag, entities] of existingRmCounts) {
    const eqId = parseInt(tag, 10);
    if (!desiredEquip.has(eqId)) {
      for (const e of entities) toDelete.push(e._id);
    }
  }

  // Resolve categories for all equipment
  const equipCategories = new Map<number, { catId: string; catName: string }>();
  for (const [eqId, { equip: eq }] of desiredEquip) {
    let fp = "Uncategorized";
    if (eq.folder) { try { fp = folderMap.get(parseRefId(eq.folder)) ?? fp; } catch {} }
    const catId = await resolveCategory(fp);
    equipCategories.set(eqId, { catId, catName: fp });
  }

  // Smart pack when the pack has no equipment entities (new pack or previously empty)
  const hasExistingEquipment = [...existingRmCounts.values()].some(list => list.length > 0);

  if (isNewPack || !hasExistingEquipment) {
    // ── SMART PACKING: no existing equipment, arrange everything properly ──
    const containerWidth = vehicle ? (vehicle.width ?? 0) * CM_TO_M || 2.5 : 2.5;
    const containerHeight = vehicle ? (vehicle.height ?? 0) * CM_TO_M || 2.5 : 2.5;

    const packableItems: Array<{
      name: string; equipId: number;
      dx: number; dy: number; dz: number;
      weight?: number; categoryId: string; category: string;
    }> = [];
    const quantities = new Map<number, number>();

    for (const [eqId, { equip: eq, qty }] of desiredEquip) {
      const l = eq.length ?? 0, w = eq.width ?? 0, h = eq.height ?? 0;
      const dx = l * CM_TO_M, dy = h * CM_TO_M, dz = w * CM_TO_M;
      const cat = equipCategories.get(eqId)!;
      const nm = eq.displayname ?? eq.name;
      quantities.set(eqId, qty);

      for (let i = 0; i < qty; i++) {
        packableItems.push({
          name: nm, equipId: eqId,
          dx, dy, dz,
          weight: eq.weight && eq.weight > 0 ? eq.weight : undefined,
          categoryId: cat.catId, category: cat.catName,
        });
      }
    }

    const packed = smartPack(packableItems, containerWidth, containerHeight);
    toAdd = packedToEntities(packed, packId, quantities);
    unchanged = 0;

    log.info("sync", `Smart-packed ${toAdd.length} items into new pack "${pName}"`);
  } else {
    // ── SUBSEQUENT SYNC: Incremental diff, staging area for new items ──
    let newItemX = -2;
    let newItemZ = 0;
    let newItemRowDepth = 0;

    for (const [eqId, { equip: eq, qty }] of desiredEquip) {
      const tag = String(eqId);
      const existingList = existingRmCounts.get(tag) ?? [];
      const existingCount = existingList.length;

      const l = eq.length ?? 0, w = eq.width ?? 0, h = eq.height ?? 0;
      const dx = l * CM_TO_M, dy = h * CM_TO_M, dz = w * CM_TO_M;

      if (existingCount === qty) {
        unchanged += qty;
        continue;
      }

      if (existingCount > qty) {
        const extras = existingList.slice(qty);
        for (const e of extras) toDelete.push(e._id);
        unchanged += qty;
        continue;
      }

      // Need more — place new items in staging area (negative X)
      unchanged += existingCount;
      const toAddCount = qty - existingCount;
      const cat = equipCategories.get(eqId)!;
      const nm = eq.displayname ?? eq.name;

      for (let i = 0; i < toAddCount; i++) {
        const idx = existingCount + i + 1;
        if (newItemZ + dz > 3 && newItemZ > 0) {
          newItemX -= (newItemRowDepth + 0.1);
          newItemZ = 0;
          newItemRowDepth = 0;
        }
        toAdd.push({
          name: qty > 1 ? `${nm} #${idx} [RM:${eq.id}]` : `${nm} [RM:${eq.id}]`,
          type: "case", packId, visible: true, childrenIds: [],
          position: { x: newItemX - dx / 2, y: dy / 2, z: newItemZ + dz / 2 },
          quaternion: { x: 0, y: 0, z: 0, w: 1 },
          size: { x: dx, y: dy, z: dz },
          caseData: {
            weight: eq.weight && eq.weight > 0 ? eq.weight : undefined,
            manufacturer: `Rentman #${eq.id}`,
            canRotate3d: false,
            categoryId: cat.catId,
          },
        });
        newItemZ += dz;
        if (dx > newItemRowDepth) newItemRowDepth = dx;
      }
    }
  }

  // Vehicle diff
  let vehicleAdded = false;
  let vehicleRemoved = false;

  if (vehicle && vehicle.length > 0 && vehicle.width > 0 && vehicle.height > 0) {
    if (!existingVehicleEntity) {
      const cdx = vehicle.length * CM_TO_M;
      const cdy = vehicle.height * CM_TO_M;
      const cdz = vehicle.width * CM_TO_M;
      toAdd.push({
        name: `${vehicleName} [RM:V${vehicle.id}]`,
        type: "container", packId, visible: true, childrenIds: [],
        position: { x: cdx / 2, y: cdy / 2, z: cdz / 2 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        size: { x: cdx, y: cdy, z: cdz },
        containerData: { type: "box_truck", payloadCapacity: vehicle.payload_capacity },
      });
      vehicleAdded = true;
    }
    // If vehicle already exists, leave it (user may have repositioned)
  } else if (existingVehicleEntity) {
    toDelete.push(existingVehicleEntity._id);
    vehicleRemoved = true;
  }

  // Sync card: always update (delete ALL old cards + create one new)
  for (const card of existingSyncCards) toDelete.push(card._id);
  const slCat = await resolveCategory("Sync Log");
  const now = new Date().toISOString();
  toAdd.push(buildSyncCardEntity(packId, slCat, {
    projectName: `#${pNum} ${pName}`, projectId: pid, provider: "Rentman",
    status: status.name,
    projectCreated: project.created ?? now,
    lastSynced: now,
    totalItems: uniq, totalEntities: unchanged + toAdd.length,
    missingDimensions: missDims, vehicleName,
  } satisfies SyncCardData));

  // Execute diff
  if (toDelete.length > 0) {
    for (let i = 0; i < toDelete.length; i += 50)
      await batchDeleteEntities(packId, toDelete.slice(i, i + 50), tpKey);
  }
  if (toAdd.length > 0) {
    for (let i = 0; i < toAdd.length; i += 50)
      await batchCreateEntities(toAdd.slice(i, i + 50), tpKey);
  }

  const logParts = [`"${pName}": +${toAdd.length} -${toDelete.length} =${unchanged}`];
  if (vehicleAdded) logParts.push("vehicle added");
  if (vehicleRemoved) logParts.push("vehicle removed");
  log.info("sync", logParts.join(", "));

  return {
    added: toAdd.length,
    removed: toDelete.length,
    unchanged,
    vehicleAdded,
    vehicleRemoved,
  };
}

// ─────────────────────────────────────────────────────────────
// Provider-agnostic sync — works with any provider (Flex, CurrentRMS, etc.)
// ─────────────────────────────────────────────────────────────

export async function syncOneProjectGeneric(
  provider: Provider,
  project: ProviderProject,
  allPacks: Pack[],
  catMap: Map<string, string>,
  colorIdx: { i: number },
  srcToken: string,
  tpKey: string
): Promise<SyncProjectResult | null> {
  const pid = project.sourceId;
  const pNum = project.displayNumber ?? pid;
  const pName = project.name.trim();

  const lines = await provider.listProjectEquipment(pid, srcToken);
  if (lines.length === 0) return null;

  async function resolveCategory(name: string): Promise<string> {
    const key = name.trim().toLowerCase();
    if (catMap.has(key)) return catMap.get(key)!;
    const color = COLORS[colorIdx.i++ % COLORS.length];
    const cat = await createCaseCategory({ name, colorHex: color }, tpKey);
    catMap.set(key, cat._id);
    return cat._id;
  }

  // Find or create pack
  const stampPrefix = `[RM:${pid}]`;
  let existingPack = allPacks.find((p) => p.name?.startsWith(stampPrefix));
  let packId: string;
  let isNewPack = false;

  if (existingPack) {
    packId = existingPack._id;
  } else {
    const pack = await createPack({ name: `[RM:${pid}] #${pNum} ${pName}` }, tpKey);
    packId = pack._id;
    allPacks.push(pack);
    isNewPack = true;
  }

  const existingEntities = isNewPack ? [] : await getPackEntities(packId, tpKey);
  const rmEntities = existingEntities.filter(isRentmanEntity);
  log.debug("sync", `Pack "${pName}": ${existingEntities.length} existing, ${rmEntities.length} RM-tagged`, { packId, isNewPack });

  // Build desired equipment
  const desiredEquip = new Map<string, { equip: ProviderEquipment; qty: number }>();
  let missDims = 0, uniq = 0;

  for (const line of lines) {
    if (!line.equipmentSourceId) continue;
    let eq: ProviderEquipment;
    try { eq = await provider.getEquipment(line.equipmentSourceId, srcToken); } catch { continue; }
    if (!eq.isPhysical) continue;

    const hasDims = (eq.length ?? 0) > 0 && (eq.width ?? 0) > 0 && (eq.height ?? 0) > 0;
    if (!hasDims) { missDims++; continue; }

    uniq++;
    const existing = desiredEquip.get(eq.sourceId);
    if (existing) { existing.qty += line.quantity ?? 1; }
    else { desiredEquip.set(eq.sourceId, { equip: eq, qty: line.quantity ?? 1 }); }
  }

  // Count existing RM entities
  const existingRmCounts = new Map<string, TPEntity[]>();
  const existingSyncCards: TPEntity[] = [];

  for (const e of rmEntities) {
    if (e.name.startsWith("SYNC LOG") || e.name.startsWith("SYNC:")) {
      existingSyncCards.push(e);
      continue;
    }
    const tag = extractRmTag(e.name);
    if (tag) {
      const list = existingRmCounts.get(tag) ?? [];
      list.push(e);
      existingRmCounts.set(tag, list);
    }
  }

  // Resolve categories
  const equipCategories = new Map<string, string>();
  for (const [eqId, { equip: eq }] of desiredEquip) {
    const catId = await resolveCategory(eq.category);
    equipCategories.set(eqId, catId);
  }

  const toDelete: string[] = [];
  let toAdd: Parameters<typeof batchCreateEntities>[0] = [];
  let unchanged = 0;

  // Remove items no longer on the project
  for (const [tag, entities] of existingRmCounts) {
    if (!desiredEquip.has(tag)) {
      for (const e of entities) toDelete.push(e._id);
    }
  }

  const hasExistingEquipment = [...existingRmCounts.values()].some(list => list.length > 0);

  if (isNewPack || !hasExistingEquipment) {
    // Smart pack
    const packableItems: Array<{
      name: string; equipId: number; dx: number; dy: number; dz: number;
      weight?: number; categoryId: string; category: string;
    }> = [];
    const quantities = new Map<number, number>();

    for (const [, { equip: eq, qty }] of desiredEquip) {
      const dx = (eq.length ?? 0) * CM_TO_M;
      const dy = (eq.height ?? 0) * CM_TO_M;
      const dz = (eq.width ?? 0) * CM_TO_M;
      const catId = equipCategories.get(eq.sourceId)!;
      const numId = parseInt(eq.sourceId, 10) || 0;
      quantities.set(numId, qty);

      for (let i = 0; i < qty; i++) {
        packableItems.push({
          name: eq.name, equipId: numId, dx, dy, dz,
          weight: eq.weight, categoryId: catId, category: eq.category,
        });
      }
    }

    const packed = smartPack(packableItems, 2.5, 2.5);
    toAdd = packedToEntities(packed, packId, quantities);
    log.info("sync", `Smart-packed ${toAdd.length} items for "${pName}"`);
  } else {
    // Incremental — staging area for new items
    let newItemX = -2, newItemZ = 0, newItemRowDepth = 0;

    for (const [eqId, { equip: eq, qty }] of desiredEquip) {
      const existingList = existingRmCounts.get(eqId) ?? [];
      const existingCount = existingList.length;
      const dx = (eq.length ?? 0) * CM_TO_M;
      const dy = (eq.height ?? 0) * CM_TO_M;
      const dz = (eq.width ?? 0) * CM_TO_M;

      if (existingCount === qty) { unchanged += qty; continue; }
      if (existingCount > qty) {
        for (const e of existingList.slice(qty)) toDelete.push(e._id);
        unchanged += qty; continue;
      }

      unchanged += existingCount;
      const catId = equipCategories.get(eqId)!;

      for (let i = 0; i < qty - existingCount; i++) {
        const idx = existingCount + i + 1;
        if (newItemZ + dz > 3 && newItemZ > 0) {
          newItemX -= (newItemRowDepth + 0.1); newItemZ = 0; newItemRowDepth = 0;
        }
        toAdd.push({
          name: qty > 1 ? `${eq.name} #${idx} [RM:${eq.sourceId}]` : `${eq.name} [RM:${eq.sourceId}]`,
          type: "case", packId, visible: true, childrenIds: [],
          position: { x: newItemX - dx / 2, y: dy / 2, z: newItemZ + dz / 2 },
          quaternion: { x: 0, y: 0, z: 0, w: 1 },
          size: { x: dx, y: dy, z: dz },
          caseData: { weight: eq.weight, manufacturer: `${provider.name} #${eq.sourceId}`, canRotate3d: false, categoryId: catId },
        });
        newItemZ += dz;
        if (dx > newItemRowDepth) newItemRowDepth = dx;
      }
    }
  }

  // Sync cards
  for (const card of existingSyncCards) toDelete.push(card._id);
  const slCat = await resolveCategory("Sync Log");
  const now = new Date().toISOString();
  toAdd.push(buildSyncCardEntity(packId, slCat, {
    projectName: `#${pNum} ${pName}`, projectId: pid, provider: provider.name,
    projectCreated: project.startDate ?? now,
    lastSynced: now,
    totalItems: uniq, totalEntities: unchanged + toAdd.length,
    missingDimensions: missDims,
  } satisfies SyncCardData));

  if (toDelete.length > 0) {
    for (let i = 0; i < toDelete.length; i += 50)
      await batchDeleteEntities(packId, toDelete.slice(i, i + 50), tpKey);
  }
  if (toAdd.length > 0) {
    for (let i = 0; i < toAdd.length; i += 50)
      await batchCreateEntities(toAdd.slice(i, i + 50), tpKey);
  }

  log.info("sync", `"${pName}": +${toAdd.length} -${toDelete.length} =${unchanged}`);
  return { added: toAdd.length, removed: toDelete.length, unchanged, vehicleAdded: false, vehicleRemoved: false };
}
