/**
 * Flex Rental Solutions provider — built from the Flex5 OpenAPI spec.
 *
 * API reference: https://{site}.flexrentalsolutions.com/f5/swagger-ui.html
 * Auth: X-Auth-Token header
 *
 * Key mappings:
 *   Equipment    = InventoryModel     (/api/inventory-model)
 *   Projects     = Element            (/api/element)
 *   Line items   = EquipmentListLineItemNode via eqlist-line-item
 *   Categories   = InventoryGroup     (/api/inventory-group)
 *   Dimensions   = weight, height, modelLength (not "length"), width
 */

import type {
  Provider,
  ProviderEquipment,
  ProviderProject,
  ProviderProjectEquipmentLine,
} from "./types";

function getBaseUrl(): string {
  const url = process.env.FLEX_BASE_URL;
  if (!url) throw new Error("FLEX_BASE_URL not set (e.g. https://yoursite.flexrentalsolutions.com/f5/api)");
  return url.replace(/\/+$/, "");
}

async function flexGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    headers: {
      "X-Auth-Token": token,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Flex ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

async function flexPut<T = void>(path: string, body: unknown, token: string): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    method: "PUT",
    headers: {
      "X-Auth-Token": token,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Flex PUT ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

// ── Flex5 types from OpenAPI spec ──

interface InventoryModel {
  id: string;
  name: string;
  barcode?: string;
  manufacturer?: string;
  size?: string;
  weight?: number;
  height?: number;
  modelLength?: number; // "length" is reserved in Flex, uses "modelLength"
  width?: number;
  weightUnitId?: string;
  linearUnitId?: string;
  groupId?: string;
  masterQuantity?: number;
  replacementCost?: number;
  virtualModel?: boolean;
  container?: boolean;
  vehicle?: boolean;
  stackable?: boolean;
  shortName?: string;
  shortNameOrName?: string;
}

interface InventoryGroup {
  id: string | number;
  name: string;
}

// PageProjectElementSearchEntry.content[]
interface ProjectElementSearchEntry {
  id: string;
  name: string;
  documentNumber?: string;
  definitionName?: string;
  parentName?: string;
}

// EquipmentList (the full project/element record)
interface EquipmentList {
  id: string;
  name?: string;
  displayName?: string;
  documentNumber?: string;
  parentElementId?: string;
  plannedStartDate?: string;
  plannedEndDate?: string;
  eventDate?: string;
  showStartDate?: string;
  showEndDate?: string;
  statusId?: string;
  weight?: number;
}

// EquipmentListLineItemNode
interface LineItemNode {
  id: string;
  displayName?: string;
  resourceId?: string;
  resourceBarcode?: string;
  group?: boolean;
  leaf?: boolean;
  virtual?: boolean;
  lineQtyInfo?: { requiredQty?: number };
}

// Paginated response wrapper
interface Page<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  size: number;
  number: number;
}

// ── Group name cache ──

const groupCache = new Map<string, string>();

async function loadGroups(token: string) {
  if (groupCache.size > 0) return;
  try {
    const groups = await flexGet<InventoryGroup[]>("/api/inventory-group/list", token);
    for (const g of groups) groupCache.set(String(g.id), g.name);
  } catch { /* non-critical */ }
}

// ── Provider implementation ──

export const flexProvider: Provider = {
  id: "flex" as "rentman", // type cast — registered properly in index.ts
  name: "Flex Rental Solutions",
  supportsWrite: true,

  async listEquipment(token) {
    await loadGroups(token);

    const items: ProviderEquipment[] = [];
    let page = 0;
    const pageSize = 100;

    while (true) {
      const result = await flexGet<Page<InventoryModel>>(
        `/api/inventory-model/search?searchText=&page=${page}&size=${pageSize}`,
        token
      );
      const models = result.content ?? [];
      if (models.length === 0) break;

      for (const m of models) items.push(mapModel(m));
      if (models.length < pageSize) break;
      page++;
    }

    return items;
  },

  async getEquipment(id, token) {
    await loadGroups(token);
    const model = await flexGet<InventoryModel>(`/api/inventory-model/${id}`, token);
    return mapModel(model);
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
    const result = await flexGet<Page<ProjectElementSearchEntry>>(
      "/api/element/search?searchText=&rootElementsOnly=true&page=0&size=50",
      token
    );
    return (result.content ?? []).map((e) => ({
      sourceId: String(e.id),
      displayNumber: e.documentNumber ?? String(e.id),
      name: e.name ?? `Element ${e.id}`,
      startDate: undefined,
      endDate: undefined,
      color: undefined,
      tags: e.definitionName,
    }));
  },

  async getProject(id, token) {
    // Get the full equipment list record which has dates and details
    const el = await flexGet<EquipmentList>(`/api/equipment-list/${id}`, token);
    return {
      sourceId: String(el.id ?? id),
      displayNumber: el.documentNumber ?? String(id),
      name: el.displayName ?? el.name ?? `Element ${id}`,
      startDate: el.plannedStartDate ?? el.showStartDate ?? el.eventDate,
      endDate: el.plannedEndDate ?? el.showEndDate,
      color: undefined,
      tags: undefined,
    };
  },

  async listProjectEquipment(projectId, token) {
    // Get line items via the eqlist-line-item endpoint
    // First we need a root line item — use node-list with the equipment list ID
    const items: ProviderProjectEquipmentLine[] = [];

    try {
      const result = await flexGet<Page<LineItemNode>>(
        `/api/eqlist-line-item/node-list/root?equipmentListId=${projectId}&page=0&size=200`,
        token
      );

      for (const node of result.content ?? []) {
        if (node.group || node.virtual) continue; // skip group headers and virtual items
        if (!node.resourceId) continue;

        items.push({
          lineId: String(node.id),
          equipmentSourceId: String(node.resourceId),
          name: node.displayName ?? `Item ${node.id}`,
          quantity: node.lineQtyInfo?.requiredQty ?? 1,
        });
      }
    } catch {
      // Fallback: try the line-item row-data endpoint
      try {
        const rows = await flexGet<{ content?: Array<{ id: string; dataMap?: Record<string, unknown> }> }>(
          `/api/line-item/${projectId}/row-data/`,
          token
        );
        for (const row of rows.content ?? []) {
          items.push({
            lineId: String(row.id),
            equipmentSourceId: String(row.id),
            name: `Line ${row.id}`,
            quantity: 1,
          });
        }
      } catch { /* give up */ }
    }

    return items;
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
