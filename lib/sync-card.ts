/**
 * Builds a "Sync Card" entity — a flat placard inside a Truck Packer pack
 * showing sync status at a glance. Short label to avoid text overlap.
 */

import type { batchCreateEntities } from "@/lib/truckpacker";

type EntityInput = Parameters<typeof batchCreateEntities>[0][number];

export interface SyncCardData {
  projectName: string;
  projectId: number | string;
  provider: string;
  status?: string;
  projectCreated: string;
  lastSynced: string;
  totalItems: number;
  totalEntities: number;
  missingDimensions: number;
  vehicleName?: string;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function buildSyncCardName(data: SyncCardData): string {
  const line1 = `SYNC: ${data.projectName}`;
  const line2Parts: string[] = [];
  if (data.status) line2Parts.push(data.status);
  if (data.vehicleName) line2Parts.push(data.vehicleName);
  line2Parts.push(`${data.totalItems} items`);
  if (data.missingDimensions > 0) line2Parts.push(`${data.missingDimensions} no dims`);
  const line2 = line2Parts.join(" | ");
  const line3 = `Created ${fmtDate(data.projectCreated)} | Synced ${fmtDate(data.lastSynced)}`;
  return `${line1} | ${line2} | ${line3}`;
}

export function buildSyncCardEntity(
  packId: string,
  categoryId: string,
  data: SyncCardData
): EntityInput {
  return {
    name: buildSyncCardName(data),
    type: "case",
    packId,
    visible: true,
    childrenIds: [],
    // Placed far to the left, well away from the new-items staging area
    position: { x: -8, y: 0.01, z: 1.25 },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
    size: { x: 4, y: 0.02, z: 2.5 },
    caseData: {
      weight: 0,
      manufacturer: `sync-card:${data.provider}:${data.projectId}`,
      canRotate3d: false,
      categoryId,
    },
  };
}

export function isSyncCard(manufacturer?: string): boolean {
  return manufacturer?.startsWith("sync-card:") ?? false;
}
