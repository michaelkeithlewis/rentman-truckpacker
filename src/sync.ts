import * as rentman from "./rentman-client.js";
import * as tp from "./truckpacker-client.js";

// Rentman stores dimensions in centimeters; Truck Packer uses meters.
const CM_TO_M = 0.01;

// Fallback dimensions when equipment has no size data (0.3m cube).
const FALLBACK_SIZE = { x: 0.3, y: 0.3, z: 0.3 };

// Colors for auto-created categories.
const CATEGORY_COLORS = [
  "#4A90D9", "#E06C75", "#98C379", "#E5C07B", "#C678DD",
  "#56B6C2", "#D19A66", "#61AFEF", "#BE5046", "#7EC699",
];

function log(msg: string) {
  console.log(`  ${msg}`);
}

// ──────────────────────────────────────────────────
// Folder name cache — resolves "/folders/21" → "Audio"
// ──────────────────────────────────────────────────

const folderCache = new Map<number, string>();

async function loadFolders(): Promise<void> {
  if (folderCache.size > 0) return;
  const folders = await rentman.listFolders();
  for (const f of folders) {
    folderCache.set(f.id, f.path ?? f.name);
  }
}

function folderName(ref?: string): string {
  if (!ref) return "Uncategorized";
  try {
    const id = rentman.parseRefId(ref);
    return folderCache.get(id) ?? "Uncategorized";
  } catch {
    return "Uncategorized";
  }
}

// ──────────────────────────────────────────────────
// Category resolution
// ──────────────────────────────────────────────────

async function resolveCategory(
  name: string,
  existing: Map<string, string>,
  colorIndex: { i: number }
): Promise<string> {
  const normalized = name.trim().toLowerCase();
  if (existing.has(normalized)) return existing.get(normalized)!;

  const color = CATEGORY_COLORS[colorIndex.i % CATEGORY_COLORS.length];
  colorIndex.i++;

  log(`  Creating category "${name}" (${color})`);
  const cat = await tp.createCaseCategory({ name, colorHex: color });
  existing.set(normalized, cat._id);
  return cat._id;
}

// ──────────────────────────────────────────────────
// Dimension extraction
// ──────────────────────────────────────────────────

interface Dimensions {
  dx: number;
  dy: number;
  dz: number;
  weight?: number;
}

/**
 * Extracts dimensions from a Rentman equipment item.
 * Rentman stores L/W/H in centimeters; converts to meters for Truck Packer.
 */
function extractDimensions(equip: rentman.RentmanEquipment): Dimensions {
  const l = equip.length ?? 0;
  const w = equip.width ?? 0;
  const h = equip.height ?? 0;

  const hasDims = l > 0 && w > 0 && h > 0;
  return {
    dx: hasDims ? l * CM_TO_M : FALLBACK_SIZE.x,
    dy: hasDims ? w * CM_TO_M : FALLBACK_SIZE.y,
    dz: hasDims ? h * CM_TO_M : FALLBACK_SIZE.z,
    weight: equip.weight && equip.weight > 0 ? equip.weight : undefined,
  };
}

// ──────────────────────────────────────────────────
// Result types
// ──────────────────────────────────────────────────

export interface SyncResult {
  projectName: string;
  projectId: number;
  packId: string;
  packUrl: string;
  casesCreated: number;
  categoriesCreated: number;
  skippedVirtual: string[];
  missingDimensions: string[];
}

export interface PreviewItem {
  name: string;
  quantity: number;
  dx: number;
  dy: number;
  dz: number;
  weight?: number;
  category: string;
  hasDimensions: boolean;
  isVirtual: boolean;
}

// ──────────────────────────────────────────────────
// Preview (dry-run)
// ──────────────────────────────────────────────────

export async function previewSync(projectId: number): Promise<PreviewItem[]> {
  console.log("  Loading folder names...");
  await loadFolders();

  const projectEquip = await rentman.listProjectEquipment(projectId);
  const items: PreviewItem[] = [];

  for (const pe of projectEquip) {
    let equipId: number;
    try {
      equipId = rentman.parseRefId(pe.equipment);
    } catch {
      continue;
    }

    const equip = await rentman.getEquipment(equipId);
    const dims = extractDimensions(equip);
    const isVirtual = equip.is_physical === "Virtual package";
    const hasDims =
      (equip.length ?? 0) > 0 &&
      (equip.width ?? 0) > 0 &&
      (equip.height ?? 0) > 0;

    items.push({
      name: equip.displayname ?? equip.name,
      quantity: pe.quantity ?? 1,
      dx: dims.dx,
      dy: dims.dy,
      dz: dims.dz,
      weight: dims.weight,
      category: folderName(equip.folder),
      hasDimensions: hasDims,
      isVirtual,
    });
  }

  return items;
}

// ──────────────────────────────────────────────────
// Full sync
// ──────────────────────────────────────────────────

export async function syncProject(projectId: number): Promise<SyncResult> {
  console.log("\n[1/6] Loading Rentman folder names...");
  await loadFolders();
  log(`${folderCache.size} folders cached`);

  console.log("[2/6] Fetching project from Rentman...");
  const project = await rentman.getProject(projectId);
  const projectName = project.displayname ?? project.name;
  log(`Project: "${projectName}"`);
  if (project.usageperiod_start) {
    log(`Period: ${project.usageperiod_start} → ${project.usageperiod_end}`);
  }

  console.log("[3/6] Fetching project equipment...");
  const projectEquip = await rentman.listProjectEquipment(projectId);
  log(`${projectEquip.length} line items found`);

  console.log("[4/6] Resolving categories in Truck Packer...");
  const existingCats = await tp.listCaseCategories();
  const catMap = new Map<string, string>();
  for (const c of existingCats) {
    catMap.set(c.name.trim().toLowerCase(), c._id);
  }
  const colorIndex = { i: existingCats.length };
  let categoriesCreated = 0;

  console.log("[5/6] Mapping equipment...");
  const skippedVirtual: string[] = [];
  const missingDimensions: string[] = [];
  const caseEntities: Array<{
    name: string;
    quantity: number;
    dims: Dimensions;
    categoryId: string;
  }> = [];

  for (const pe of projectEquip) {
    let equipId: number;
    try {
      equipId = rentman.parseRefId(pe.equipment);
    } catch {
      continue;
    }

    const equip = await rentman.getEquipment(equipId);
    const name = equip.displayname ?? equip.name;

    // Skip virtual packages (sets without physical dimensions)
    if (equip.is_physical === "Virtual package") {
      skippedVirtual.push(name);
      log(`  SKIP (virtual): ${name}`);
      continue;
    }

    const dims = extractDimensions(equip);
    const hasDims =
      (equip.length ?? 0) > 0 &&
      (equip.width ?? 0) > 0 &&
      (equip.height ?? 0) > 0;

    if (!hasDims) missingDimensions.push(name);

    const catName = folderName(equip.folder);
    const sizeBefore = catMap.size;
    const categoryId = await resolveCategory(catName, catMap, colorIndex);
    if (catMap.size > sizeBefore) categoriesCreated++;

    const quantity = pe.quantity ?? 1;
    log(
      `  ${name} x${quantity} → ${dims.dx.toFixed(2)}×${dims.dy.toFixed(2)}×${dims.dz.toFixed(2)}m` +
        (dims.weight ? ` (${dims.weight}kg)` : "") +
        (!hasDims ? " [fallback dims]" : "")
    );

    caseEntities.push({ name, quantity, dims, categoryId });
  }

  console.log("[6/6] Building pack in Truck Packer...");
  const pack = await tp.createPack({ name: projectName });
  log(`Pack created: "${projectName}"`);

  // One entity per physical item (respecting quantity).
  const entities: Parameters<typeof tp.batchCreateEntities>[0] = [];
  let xOffset = 0;

  for (const item of caseEntities) {
    for (let i = 0; i < item.quantity; i++) {
      entities.push({
        name: item.quantity > 1 ? `${item.name} #${i + 1}` : item.name,
        type: "case",
        packId: pack._id,
        visible: true,
        childrenIds: [],
        position: { x: xOffset, y: 0, z: 0 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        size: { x: item.dims.dx, y: item.dims.dy, z: item.dims.dz },
        caseData: {
          weight: item.dims.weight,
          canRotate3d: false,
          categoryId: item.categoryId,
        },
      });
      xOffset += item.dims.dx + 0.05;
    }
  }

  // Batch in chunks of 50 (rate limit safety).
  const CHUNK = 50;
  for (let i = 0; i < entities.length; i += CHUNK) {
    const chunk = entities.slice(i, i + CHUNK);
    await tp.batchCreateEntities(chunk);
    log(`  Created entities ${i + 1}–${Math.min(i + CHUNK, entities.length)}`);
  }

  const packUrl = `https://app.truckpacker.com/packs/${pack._id}`;

  const result: SyncResult = {
    projectName,
    projectId,
    packId: pack._id,
    packUrl,
    casesCreated: entities.length,
    categoriesCreated,
    skippedVirtual,
    missingDimensions,
  };

  console.log("\n╔══ Sync Complete ═══════════════════════════╗");
  console.log(`║  Pack:        ${packUrl}`);
  console.log(`║  Entities:    ${entities.length} cases created`);
  console.log(`║  Categories:  ${categoriesCreated} new`);
  if (skippedVirtual.length > 0) {
    console.log(`║  Skipped:     ${skippedVirtual.length} virtual packages`);
  }
  if (missingDimensions.length > 0) {
    console.log(`║  No dims:     ${missingDimensions.length} items (using 0.3m fallback)`);
  }
  console.log("╚═══════════════════════════════════════════╝\n");

  return result;
}
