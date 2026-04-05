export type ProviderId = "rentman" | "currentrms";

export interface ProviderEquipment {
  sourceId: string;
  name: string;
  code?: string;
  category: string;
  weight?: number;
  length?: number; // cm
  width?: number; // cm
  height?: number; // cm
  isPhysical: boolean;
  stockQty?: number;
  unit?: string;
  price?: number;
}

export interface ProviderProject {
  sourceId: string;
  displayNumber: string;
  name: string;
  startDate?: string;
  endDate?: string;
  color?: string;
  tags?: string;
  weight?: number;
  volume?: number;
}

export interface ProviderProjectEquipmentLine {
  lineId: string;
  equipmentSourceId: string;
  name: string;
  quantity: number;
  unitPrice?: number;
}

export interface Provider {
  id: ProviderId;
  name: string;
  supportsWrite: boolean;

  listEquipment(token: string): Promise<ProviderEquipment[]>;
  getEquipment(id: string, token: string): Promise<ProviderEquipment>;
  updateEquipment?(
    id: string,
    fields: Partial<Pick<ProviderEquipment, "length" | "width" | "height" | "weight" | "name">>,
    token: string
  ): Promise<void>;

  listProjects(token: string): Promise<ProviderProject[]>;
  getProject(id: string, token: string): Promise<ProviderProject>;
  listProjectEquipment(
    projectId: string,
    token: string
  ): Promise<ProviderProjectEquipmentLine[]>;
}

// Stamp format stored in Truck Packer case descriptions
export const STAMP_PREFIX = "sync";

export function makeStamp(providerId: ProviderId, sourceId: string): string {
  return `${STAMP_PREFIX}:${providerId}:${sourceId}`;
}

export function parseStamp(
  description: string | undefined
): { providerId: ProviderId; sourceId: string } | null {
  if (!description) return null;
  const m = description.match(
    new RegExp(`^${STAMP_PREFIX}:(rentman|currentrms):(\\S+)`)
  );
  if (!m) return null;
  return { providerId: m[1] as ProviderId, sourceId: m[2] };
}

export type SyncStatus =
  | "synced"
  | "source-changed"
  | "tp-changed"
  | "conflict"
  | "unlinked";

export interface SyncedItem {
  sourceId: string;
  name: string;
  code?: string;
  category: string;
  isPhysical: boolean;
  syncStatus: SyncStatus;
  sourceValues: { length?: number; width?: number; height?: number; weight?: number };
  tpValues?: { length?: number; width?: number; height?: number; weight?: number };
  tpCaseId?: string;
}
