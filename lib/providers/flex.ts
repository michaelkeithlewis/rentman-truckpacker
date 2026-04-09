/**
 * Flex Rental Solutions provider — built from the Flex5 OpenAPI spec
 * and live API testing against ecp.flexrentalsolutions.com.
 *
 * Key discoveries from testing:
 * - Projects = Elements with definition "Quote" (9bfb850c-b117-11df-b8d5-00e08175e43e)
 * - List projects via /api/element-list/row-data?definitionId=QUOTE_DEF_ID
 * - Line items via /api/line-item/{elementId}/row-data/?codeList=RESOURCE_NAME
 *   Returns flat array with resourceId per row. Quantity = count of rows per resourceId.
 * - Equipment = InventoryModel (/api/inventory-model/{id})
 * - Dimension field is "modelLength" not "length"
 * - IDs are UUIDs (strings), not integers
 */

import type {
  Provider,
  ProviderEquipment,
  ProviderProject,
  ProviderProjectEquipmentLine,
} from "./types";

function getBaseUrl(): string {
  let url = process.env.FLEX_BASE_URL;
  if (!url) throw new Error("FLEX_BASE_URL not set (e.g. https://yoursite.flexrentalsolutions.com/f5)");
  url = url.replace(/\/+$/, "");
  if (url.endsWith("/api")) url = url.slice(0, -4);
  return url;
}

async function flexGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    headers: { "X-Auth-Token": token, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Flex ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

async function flexPut(path: string, body: unknown, token: string): Promise<void> {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    method: "PUT",
    headers: { "X-Auth-Token": token, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Flex PUT ${res.status}: ${await res.text()}`);
  }
}

// ── Types from live API responses ──

interface InventoryModel {
  id: string;
  name: string;
  barcode?: string;
  manufacturer?: string;
  weight?: number;
  height?: number;
  modelLength?: number;
  width?: number;
  groupId?: string;
  masterQuantity?: number;
  replacementCost?: number;
  virtualModel?: boolean;
  shortNameOrName?: string;
}

interface InventoryGroup {
  id: string;
  name: string;
}

// element-list/row-data response item
interface ElementListRow {
  id: string;
  name?: string;
  documentNumber?: string;
  parentId?: string;
  [key: string]: unknown;
}

// line-item/row-data response item
interface LineItemRow {
  id: string;
  resourceId?: string;
  rootLineId?: string;
  leaf?: boolean;
  ordinal?: number;
}

interface Page<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
}

// ── Group cache ──

const groupCache = new Map<string, string>();

async function loadGroups(token: string) {
  if (groupCache.size > 0) return;
  try {
    const groups = await flexGet<InventoryGroup[]>("/api/inventory-group/list", token);
    for (const g of groups) groupCache.set(String(g.id), g.name);
  } catch { /* non-critical */ }
}

// ── Provider ──

export const flexProvider: Provider = {
  id: "flex",
  name: "Flex Rental Solutions",
  supportsWrite: true,

  async listEquipment(token) {
    await loadGroups(token);
    const items: ProviderEquipment[] = [];
    let page = 0;
    while (true) {
      const result = await flexGet<Page<InventoryModel>>(
        `/api/inventory-model/search?searchText=&page=${page}&size=100`, token
      );
      for (const m of result.content ?? []) items.push(mapModel(m));
      if ((result.content?.length ?? 0) < 100) break;
      page++;
    }
    return items;
  },

  async getEquipment(id, token) {
    await loadGroups(token);
    return mapModel(await flexGet<InventoryModel>(`/api/inventory-model/${id}`, token));
  },

  async updateEquipment(id, fields, token) {
    const body: Record<string, unknown> = {};
    if (fields.name !== undefined) body.name = fields.name;
    if (fields.weight !== undefined) body.weight = fields.weight;
    if (fields.length !== undefined) body.modelLength = fields.length;
    if (fields.width !== undefined) body.width = fields.width;
    if (fields.height !== undefined) body.height = fields.height;
    await flexPut(`/api/inventory-model/${id}`, body, token);
  },

  async listProjects(token) {
    // Quotes are the main project type in Flex
    // Use element-list/row-data with the Quote definition ID
    const result = await flexGet<Page<ElementListRow>>(
      "/api/element-list/row-data?definitionId=9bfb850c-b117-11df-b8d5-00e08175e43e&headerFieldTypeIds=DOCUMENT_NUMBER,NAME&page=0&size=50",
      token
    );
    return (result.content ?? []).map((e) => ({
      sourceId: String(e.id),
      displayNumber: e.documentNumber ?? String(e.id).slice(0, 8),
      name: e.name ?? `Quote ${e.documentNumber ?? e.id}`,
      startDate: undefined,
      endDate: undefined,
    }));
  },

  async getProject(id, token) {
    // Try equipment-list which has full details
    try {
      const el = await flexGet<{
        id: string; displayName?: string; name?: string; documentNumber?: string;
        plannedStartDate?: string; plannedEndDate?: string; eventDate?: string;
      }>(`/api/equipment-list/${id}`, token);
      return {
        sourceId: String(el.id ?? id),
        displayNumber: el.documentNumber ?? String(id).slice(0, 8),
        name: el.displayName ?? el.name ?? `Element ${id}`,
        startDate: el.plannedStartDate ?? el.eventDate,
        endDate: el.plannedEndDate,
      };
    } catch {
      // Fallback
      return {
        sourceId: String(id),
        displayNumber: String(id).slice(0, 8),
        name: `Element ${id}`,
      };
    }
  },

  async listProjectEquipment(projectId, token) {
    // Get line items — each row has a resourceId (inventory model)
    // Quantity = count of rows with the same resourceId
    const rows = await flexGet<LineItemRow[]>(
      `/api/line-item/${projectId}/row-data/?codeList=RESOURCE_NAME`,
      token
    );

    if (!Array.isArray(rows) || rows.length === 0) return [];

    // Count quantity per resource — DON'T look up each model here
    // to avoid burning API rate limits. The sync engine will call
    // getEquipment() for each unique resource when it needs details.
    const byResource = new Map<string, { count: number; lineId: string }>();
    for (const row of rows) {
      if (!row.resourceId) continue;
      const existing = byResource.get(row.resourceId);
      if (existing) {
        existing.count++;
      } else {
        byResource.set(row.resourceId, { count: 1, lineId: row.id });
      }
    }

    return [...byResource.entries()].map(([resourceId, { count, lineId }]) => ({
      lineId,
      equipmentSourceId: resourceId,
      name: resourceId, // placeholder — sync engine resolves via getEquipment
      quantity: count,
    }));
  },
};

function mapModel(m: InventoryModel): ProviderEquipment {
  const groupName = m.groupId ? (groupCache.get(String(m.groupId)) ?? "Uncategorized") : "Uncategorized";
  return {
    sourceId: String(m.id),
    name: m.shortNameOrName ?? m.name,
    code: m.barcode,
    category: groupName,
    weight: m.weight ?? undefined,
    length: m.modelLength ?? undefined,
    width: m.width ?? undefined,
    height: m.height ?? undefined,
    isPhysical: !m.virtualModel,
    stockQty: m.masterQuantity ? Math.round(m.masterQuantity) : undefined,
    price: m.replacementCost ?? undefined,
  };
}
