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
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Flex API ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

async function flexPut(path: string, body: unknown, token: string): Promise<void> {
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
    throw new Error(`Flex API PUT ${res.status}: ${await res.text()}`);
  }
}

// Flex5 inventory model (equipment)
interface FlexInventoryModel {
  id: number;
  name: string;
  shortName?: string;
  barcode?: string;
  manufacturer?: string;
  weight?: number;
  height?: number;
  modelLength?: number;
  width?: number;
  size?: string;
  groupId?: number;
  replacementCost?: number;
  masterQuantity?: number;
  virtualModel?: boolean;
  container?: boolean;
  stackable?: boolean;
  [key: string]: unknown;
}

// Flex5 inventory group
interface FlexInventoryGroup {
  id: number;
  name: string;
  [key: string]: unknown;
}

// Flex5 element (project) from search/grid
interface FlexElement {
  id: number;
  elementName?: string;
  elementNumber?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  [key: string]: unknown;
}

// Flex5 equipment list line item
interface FlexLineItem {
  id: number;
  modelId?: number;
  modelName?: string;
  quantity?: number;
  rate?: number;
  [key: string]: unknown;
}

// Cache for inventory group names
const groupCache = new Map<number, string>();

export const flexProvider: Provider = {
  id: "flex" as "rentman", // type workaround — registered properly in index.ts
  name: "Flex Rental Solutions",
  supportsWrite: true,

  async listEquipment(token) {
    // Load groups for category names
    if (groupCache.size === 0) {
      try {
        const groups = await flexGet<FlexInventoryGroup[]>(
          "/api/inventory-group/list", token
        );
        for (const g of groups) groupCache.set(g.id, g.name);
      } catch { /* groups not critical */ }
    }

    const items: ProviderEquipment[] = [];
    let page = 0;
    const pageSize = 100;

    while (true) {
      // Use the grid-node endpoint which returns paginated inventory
      const result = await flexGet<{
        content?: FlexInventoryModel[];
        totalElements?: number;
      }>(
        `/api/inventory-model/search?searchText=&page=${page}&size=${pageSize}`,
        token
      );

      const models = result.content ?? [];
      if (models.length === 0) break;

      for (const m of models) {
        items.push(mapModel(m));
      }
      if (models.length < pageSize) break;
      page++;
    }

    return items;
  },

  async getEquipment(id, token) {
    const model = await flexGet<FlexInventoryModel>(
      `/api/inventory-model/${id}`, token
    );
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
    // Elements are Flex's "projects"
    const result = await flexGet<{
      content?: FlexElement[];
    }>(
      `/api/element/search?page=0&size=50`, token
    );
    return (result.content ?? []).map((e) => ({
      sourceId: String(e.id),
      displayNumber: e.elementNumber ?? String(e.id),
      name: e.elementName ?? `Element ${e.id}`,
      startDate: e.startDate,
      endDate: e.endDate,
      color: undefined,
      tags: e.status,
    }));
  },

  async getProject(id, token) {
    const header = await flexGet<FlexElement>(
      `/api/element/${id}/header-data`, token
    );
    return {
      sourceId: String(header.id ?? id),
      displayNumber: header.elementNumber ?? String(id),
      name: header.elementName ?? `Element ${id}`,
      startDate: header.startDate,
      endDate: header.endDate,
      color: undefined,
      tags: header.status,
    };
  },

  async listProjectEquipment(projectId, token) {
    // Equipment list for an element
    const result = await flexGet<{
      content?: FlexLineItem[];
    }>(
      `/api/equipment-list/${projectId}`, token
    );

    // The response might be a direct array or paginated
    const items = Array.isArray(result) ? result : (result.content ?? []);

    return items.map((i) => ({
      lineId: String(i.id),
      equipmentSourceId: String(i.modelId ?? i.id),
      name: i.modelName ?? `Item ${i.id}`,
      quantity: i.quantity ?? 1,
      unitPrice: i.rate,
    }));
  },
};

function mapModel(m: FlexInventoryModel): ProviderEquipment {
  const groupName = m.groupId ? (groupCache.get(m.groupId) ?? "Uncategorized") : "Uncategorized";
  return {
    sourceId: String(m.id),
    name: m.name,
    code: m.barcode,
    category: groupName,
    weight: m.weight ?? undefined,
    length: m.modelLength ?? undefined, // Flex uses "modelLength" not "length"
    width: m.width ?? undefined,
    height: m.height ?? undefined,
    isPhysical: !m.virtualModel,
    stockQty: m.masterQuantity ?? undefined,
    price: m.replacementCost ?? undefined,
  };
}
