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
import { isSyncCard } from "@/lib/sync-card";

const CM_TO_M = 0.01;
const FALLBACK = 0.3;
const COLORS = [
  "#4A90D9", "#E06C75", "#98C379", "#E5C07B", "#C678DD",
  "#56B6C2", "#D19A66", "#61AFEF", "#BE5046", "#7EC699",
];

const RM_TAG_RE = /\[RM:(\w+)\]/;
const RM_VEHICLE_RE = /\[RM:V(\d+)\]/;

function isRentmanEntity(e: TPEntity): boolean {
  return RM_TAG_RE.test(e.name);
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
    // Assign folder based on project end date: past = archive, future = active
    let folderId: string | undefined;
    const endDate = project.usageperiod_end ?? project.planperiod_end;
    if (endDate) {
      const isPast = new Date(endDate) < new Date();
      const archiveFolder = process.env.TRUCKPACKER_FOLDER_ARCHIVE;
      const activeFolder = process.env.TRUCKPACKER_FOLDER_ACTIVE;
      folderId = isPast ? archiveFolder : activeFolder;
    }
    const pack = await createPack({
      name: `[RM:${pid}] #${pNum} ${pName}`,
      folderId: folderId || undefined,
    }, tpKey);
    packId = pack._id;
    allPacks.push(pack);
    isNewPack = true;
  }

  // Get existing entities in the pack
  const existingEntities = isNewPack ? [] : await getPackEntities(packId, tpKey);

  // Separate Rentman-owned entities from TP-native ones
  const rmEntities = existingEntities.filter(isRentmanEntity);
  // TP-native entities are NEVER touched

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
  const toAdd: Parameters<typeof batchCreateEntities>[0] = [];
  let unchanged = 0;

  // Check for equipment that was REMOVED from the project
  for (const [tag, entities] of existingRmCounts) {
    const eqId = parseInt(tag, 10);
    if (!desiredEquip.has(eqId)) {
      // This equipment is no longer on the project — delete all its entities
      for (const e of entities) toDelete.push(e._id);
    }
  }

  // Check for equipment that needs to be ADDED or has QUANTITY changes
  // New items are placed to the left of the pack (negative X) with a gap,
  // so they're clearly separate from the container. Sync card is at x=-8.
  let newItemX = -2;
  let newItemZ = 0;
  let newItemRowDepth = 0;

  for (const [eqId, { equip: eq, qty }] of desiredEquip) {
    const tag = String(eqId);
    const existingList = existingRmCounts.get(tag) ?? [];
    const existingCount = existingList.length;

    const l = eq.length ?? 0, w = eq.width ?? 0, h = eq.height ?? 0;
    // Items without dims are already filtered out above, so these will always have values
    const dx = l * CM_TO_M;
    const dy = h * CM_TO_M;
    const dz = w * CM_TO_M;

    if (existingCount === qty) {
      // Correct count — leave them alone (they may have been repositioned by the user)
      unchanged += qty;
      continue;
    }

    if (existingCount > qty) {
      // Too many — delete the extras
      const extras = existingList.slice(qty);
      for (const e of extras) toDelete.push(e._id);
      unchanged += qty;
      continue;
    }

    // Need more — keep existing ones, add the difference
    unchanged += existingCount;
    const toAddCount = qty - existingCount;

    let fp = "Uncategorized";
    if (eq.folder) { try { fp = folderMap.get(parseRefId(eq.folder)) ?? fp; } catch {} }
    const catId = await resolveCategory(fp);
    const nm = eq.displayname ?? eq.name;

    for (let i = 0; i < toAddCount; i++) {
      const idx = existingCount + i + 1;
      // Place new items OUTSIDE the pack (negative X) so they don't
      // disrupt any manually arranged layout inside the container
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
          categoryId: catId,
        },
      });
      newItemZ += dz;
      if (dx > newItemRowDepth) newItemRowDepth = dx;
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
