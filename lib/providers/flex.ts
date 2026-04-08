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
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Flex API PUT ${res.status}: ${await res.text()}`);
  }
}

// Flex5 data models — field names may vary per instance.
// These are based on common Flex5 API structures.
interface FlexAsset {
  assetId: number;
  name: string;
  description?: string;
  barcode?: string;
  categoryName?: string;
  categoryId?: number;
  weight?: number;
  length?: number;
  width?: number;
  height?: number;
  isContainer?: boolean;
  replacementCost?: number;
  ownedQuantity?: number;
  [key: string]: unknown;
}

interface FlexProject {
  projectId: number;
  name: string;
  projectNumber?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  statusName?: string;
  [key: string]: unknown;
}

interface FlexProjectItem {
  itemId: number;
  assetId: number;
  assetName: string;
  quantity: number;
  rate?: number;
  [key: string]: unknown;
}

export const flexProvider: Provider = {
  id: "flex" as never, // extends ProviderId below
  name: "Flex Rental Solutions",
  supportsWrite: true,

  async listEquipment(token) {
    const items: ProviderEquipment[] = [];
    let page = 0;
    const pageSize = 100;

    while (true) {
      const assets = await flexGet<FlexAsset[]>(
        `/assets?offset=${page * pageSize}&limit=${pageSize}`,
        token
      );
      if (!assets || assets.length === 0) break;

      for (const a of assets) {
        items.push(mapAsset(a));
      }
      if (assets.length < pageSize) break;
      page++;
    }

    return items;
  },

  async getEquipment(id, token) {
    const asset = await flexGet<FlexAsset>(`/assets/${id}`, token);
    return mapAsset(asset);
  },

  async updateEquipment(id, fields, token) {
    const body: Record<string, unknown> = {};
    if (fields.name !== undefined) body.name = fields.name;
    if (fields.weight !== undefined) body.weight = fields.weight;
    if (fields.length !== undefined) body.length = fields.length;
    if (fields.width !== undefined) body.width = fields.width;
    if (fields.height !== undefined) body.height = fields.height;
    await flexPut(`/assets/${id}`, body, token);
  },

  async listProjects(token) {
    const projects = await flexGet<FlexProject[]>(
      `/projects?offset=0&limit=50`,
      token
    );
    return (projects ?? []).map((p) => ({
      sourceId: String(p.projectId),
      displayNumber: p.projectNumber ?? String(p.projectId),
      name: p.name,
      startDate: p.startDate,
      endDate: p.endDate,
      color: undefined,
      tags: p.statusName,
    }));
  },

  async getProject(id, token) {
    const p = await flexGet<FlexProject>(`/projects/${id}`, token);
    return {
      sourceId: String(p.projectId),
      displayNumber: p.projectNumber ?? String(p.projectId),
      name: p.name,
      startDate: p.startDate,
      endDate: p.endDate,
      color: undefined,
      tags: p.statusName,
    };
  },

  async listProjectEquipment(projectId, token) {
    const items = await flexGet<FlexProjectItem[]>(
      `/projects/${projectId}/items?offset=0&limit=200`,
      token
    );
    return (items ?? []).map((i) => ({
      lineId: String(i.itemId),
      equipmentSourceId: String(i.assetId),
      name: i.assetName,
      quantity: i.quantity,
      unitPrice: i.rate,
    }));
  },
};

function mapAsset(a: FlexAsset): ProviderEquipment {
  return {
    sourceId: String(a.assetId),
    name: a.name,
    code: a.barcode,
    category: a.categoryName ?? "Uncategorized",
    weight: a.weight ?? undefined,
    length: a.length ?? undefined,
    width: a.width ?? undefined,
    height: a.height ?? undefined,
    isPhysical: !a.isContainer,
    stockQty: a.ownedQuantity ?? undefined,
    price: a.replacementCost ?? undefined,
  };
}
