/**
 * Smart packing algorithm: positions items inside a container following
 * real-world touring/production loading rules.
 *
 * Rules:
 * 1. Build rows across the container width (Z axis)
 * 2. Sort by category, then by X-depth (similar depths = flat rows), then heaviest first
 * 3. Large items on the floor first, small items stacked on top
 * 4. Tight rows, zero gaps between items
 * 5. Load bar gaps (~0.05m) every 2.4–4.8m along X
 * 6. canRotate3d = false (everything stays upright)
 */

import type { batchCreateEntities } from "@/lib/truckpacker";

type EntityInput = Parameters<typeof batchCreateEntities>[0][number];

const LOAD_BAR_INTERVAL = 3.0; // meters between load bar gaps
const LOAD_BAR_GAP = 0.05; // meters gap for load bar
const STACKABLE_MAX_FOOTPRINT = 0.61; // ~24" — items smaller than this can stack
const STACKABLE_MAX_HEIGHT = 0.5; // items shorter than this are stackable

interface PackableItem {
  name: string;
  /** Provider equipment source id (Rentman numeric id as string, Flex UUID, etc.) */
  sourceId: string;
  dx: number; // length (X)
  dy: number; // height (Y)
  dz: number; // width (Z)
  weight?: number;
  categoryId: string;
  category: string;
}

interface PackedEntity {
  item: PackableItem;
  position: { x: number; y: number; z: number };
}

function isStackable(item: PackableItem): boolean {
  return (
    (item.dx <= STACKABLE_MAX_FOOTPRINT && item.dz <= STACKABLE_MAX_FOOTPRINT) ||
    item.dy <= STACKABLE_MAX_HEIGHT
  );
}

/**
 * Arranges items inside a container using row-based packing with
 * category grouping, stacking, and load bar spacing.
 */
export function smartPack(
  items: PackableItem[],
  containerWidth: number,
  containerHeight: number
): PackedEntity[] {
  // Separate floor items from stackable items
  const floorItems: PackableItem[] = [];
  const stackableItems: PackableItem[] = [];

  for (const item of items) {
    if (isStackable(item)) {
      stackableItems.push(item);
    } else {
      floorItems.push(item);
    }
  }

  // Sort floor items: by category, then by X-depth (similar depths form flat rows), then heaviest first
  floorItems.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    const depthDiff = Math.abs(a.dx - b.dx);
    if (depthDiff > 0.1) return b.dx - a.dx; // similar depths together
    return (b.weight ?? 0) - (a.weight ?? 0); // heaviest first
  });

  // Sort stackable items by category too
  stackableItems.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return (b.weight ?? 0) - (a.weight ?? 0);
  });

  const placed: PackedEntity[] = [];

  // Track the floor layout for stacking: grid of { topY, dx, dz, x, z }
  const floorSlots: Array<{
    x: number;
    z: number;
    dx: number;
    dz: number;
    topY: number;
    category: string;
  }> = [];

  // Place floor items in rows
  let xCursor = 0;
  let zCursor = 0;
  let rowMaxDepth = 0;
  let distanceSinceLoadBar = 0;

  for (const item of floorItems) {
    // Check if item fits in current row
    if (zCursor + item.dz > containerWidth && zCursor > 0) {
      // Row full — advance X
      xCursor += rowMaxDepth;
      distanceSinceLoadBar += rowMaxDepth;

      // Insert load bar gap if needed
      if (distanceSinceLoadBar >= LOAD_BAR_INTERVAL) {
        xCursor += LOAD_BAR_GAP;
        distanceSinceLoadBar = 0;
      }

      zCursor = 0;
      rowMaxDepth = 0;
    }

    const pos = {
      x: xCursor + item.dx / 2,
      y: item.dy / 2,
      z: zCursor + item.dz / 2,
    };

    placed.push({ item, position: pos });

    floorSlots.push({
      x: xCursor,
      z: zCursor,
      dx: item.dx,
      dz: item.dz,
      topY: item.dy,
      category: item.category,
    });

    zCursor += item.dz; // flush, no gap
    if (item.dx > rowMaxDepth) rowMaxDepth = item.dx;
  }

  // Stacking pass: place stackable items on top of floor items
  for (const item of stackableItems) {
    let bestSlot: (typeof floorSlots)[0] | null = null;
    let bestScore = -1;

    for (const slot of floorSlots) {
      // Can it fit on top? Check footprint and height
      if (item.dz > slot.dz + 0.05 || item.dx > slot.dx + 0.05) continue;
      if (slot.topY + item.dy > containerHeight) continue;

      // Prefer same category, then lowest current height
      let score = 100 - slot.topY * 10;
      if (slot.category === item.category) score += 50;
      if (score > bestScore) {
        bestScore = score;
        bestSlot = slot;
      }
    }

    if (bestSlot) {
      const pos = {
        x: bestSlot.x + item.dx / 2,
        y: bestSlot.topY + item.dy / 2,
        z: bestSlot.z + item.dz / 2,
      };
      placed.push({ item, position: pos });
      bestSlot.topY += item.dy; // raise the stack height
    } else {
      // No stackable spot — place on the floor at the end
      if (zCursor + item.dz > containerWidth && zCursor > 0) {
        xCursor += rowMaxDepth;
        zCursor = 0;
        rowMaxDepth = 0;
      }
      placed.push({
        item,
        position: {
          x: xCursor + item.dx / 2,
          y: item.dy / 2,
          z: zCursor + item.dz / 2,
        },
      });
      zCursor += item.dz;
      if (item.dx > rowMaxDepth) rowMaxDepth = item.dx;
    }
  }

  return placed;
}

/**
 * Converts packed results into Truck Packer entity inputs.
 */
export function packedToEntities(
  packed: PackedEntity[],
  packId: string,
  quantities: Map<string, number>,
  opts: {
    equipmentStamp: (sourceId: string) => string;
    manufacturerLabel: (sourceId: string) => string;
  }
): EntityInput[] {
  const entityCountByEquip = new Map<string, number>();

  return packed.map((p) => {
    const sid = p.item.sourceId;
    const count = (entityCountByEquip.get(sid) ?? 0) + 1;
    entityCountByEquip.set(sid, count);
    const totalQty = quantities.get(sid) ?? 1;
    const stamp = opts.equipmentStamp(sid);
    const name =
      totalQty > 1
        ? `${p.item.name} #${count} ${stamp}`
        : `${p.item.name} ${stamp}`;

    return {
      name,
      type: "case" as const,
      packId,
      visible: true,
      childrenIds: [],
      position: p.position,
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      size: { x: p.item.dx, y: p.item.dy, z: p.item.dz },
      caseData: {
        weight: p.item.weight,
        manufacturer: opts.manufacturerLabel(sid),
        canRotate3d: false,
        categoryId: p.item.categoryId,
      },
    };
  });
}
