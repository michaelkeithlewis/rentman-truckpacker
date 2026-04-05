import {
  listEquipment as rmListEquipment,
  getEquipment as rmGetEquipment,
  listFolders,
  listProjects as rmListProjects,
  getProject as rmGetProject,
  listProjectEquipment as rmListProjectEquipment,
  parseRefId,
} from "@/lib/rentman";
import type {
  Provider,
  ProviderEquipment,
  ProviderProject,
  ProviderProjectEquipmentLine,
} from "./types";

async function buildFolderMap(token: string): Promise<Map<number, string>> {
  const folders = await listFolders(token);
  const m = new Map<number, string>();
  for (const f of folders) m.set(f.id, f.path ?? f.name);
  return m;
}

function resolveFolder(
  ref: string | undefined,
  map: Map<number, string>
): string {
  if (!ref) return "Uncategorized";
  try {
    return map.get(parseRefId(ref)) ?? "Uncategorized";
  } catch {
    return "Uncategorized";
  }
}

export const rentmanProvider: Provider = {
  id: "rentman",
  name: "Rentman",
  supportsWrite: false,

  async listEquipment(token) {
    const [equipment, folderMap] = await Promise.all([
      rmListEquipment(token),
      buildFolderMap(token),
    ]);
    return equipment.map((e) => ({
      sourceId: String(e.id),
      name: e.displayname ?? e.name,
      code: e.code,
      category: resolveFolder(e.folder, folderMap),
      weight: e.weight ?? undefined,
      length: e.length ?? undefined,
      width: e.width ?? undefined,
      height: e.height ?? undefined,
      isPhysical: e.is_physical !== "Virtual package",
      stockQty: e.current_quantity ?? undefined,
      unit: e.unit,
      price: e.price,
    }));
  },

  async getEquipment(id, token) {
    const [e, folderMap] = await Promise.all([
      rmGetEquipment(parseInt(id, 10), token),
      buildFolderMap(token),
    ]);
    return {
      sourceId: String(e.id),
      name: e.displayname ?? e.name,
      code: e.code,
      category: resolveFolder(e.folder, folderMap),
      weight: e.weight ?? undefined,
      length: e.length ?? undefined,
      width: e.width ?? undefined,
      height: e.height ?? undefined,
      isPhysical: e.is_physical !== "Virtual package",
      stockQty: e.current_quantity ?? undefined,
      unit: e.unit,
      price: e.price,
    };
  },

  async listProjects(token) {
    const projects = await rmListProjects(50, token);
    return projects.map((p) => ({
      sourceId: String(p.id),
      displayNumber: String(p.number ?? p.id),
      name: p.displayname ?? p.name,
      startDate: p.usageperiod_start,
      endDate: p.usageperiod_end,
      color: p.color,
      tags: p.tags,
      weight: p.weight,
      volume: p.volume,
    }));
  },

  async getProject(id, token) {
    const p = await rmGetProject(parseInt(id, 10), token);
    return {
      sourceId: String(p.id),
      displayNumber: String(p.number ?? p.id),
      name: p.displayname ?? p.name,
      startDate: p.usageperiod_start,
      endDate: p.usageperiod_end,
      color: p.color,
      tags: p.tags,
      weight: p.weight,
      volume: p.volume,
    };
  },

  async listProjectEquipment(projectId, token) {
    const lines = await rmListProjectEquipment(parseInt(projectId, 10), token);
    return lines.map((l) => {
      let equipId = "";
      try {
        equipId = String(parseRefId(l.equipment));
      } catch { /* skip */ }
      return {
        lineId: String(l.id),
        equipmentSourceId: equipId,
        name: l.displayname,
        quantity: l.quantity,
        unitPrice: l.unit_price,
      };
    });
  },
};
