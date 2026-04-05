const BASE = "https://steady-beagle-345.convex.site/api/v1";

async function tpFetch<T>(path: string, apiKey?: string, init?: RequestInit): Promise<T> {
  const k = apiKey ?? process.env.TRUCKPACKER_API_KEY;
  if (!k) throw new Error("No Truck Packer API key. Add one in Settings.");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${k}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Truck Packer ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { success: boolean; data: T; error?: string };
  if (!json.success) throw new Error(json.error ?? "Unknown error");
  return json.data;
}

export interface CaseCategory {
  _id: string;
  name: string;
  colorHex: string;
}

export interface Pack {
  _id: string;
  name?: string;
  folderId?: string;
}

export interface TPCase {
  _id: string;
  name: string;
  description?: string;
  manufacturer?: string;
  weight?: number;
  dx: number;
  dy: number;
  dz: number;
  canRotate3d: boolean;
  categoryId: string;
}

export interface TPEntity {
  _id: string;
  name: string;
  type: "case" | "container" | "group";
  description?: string;
}

// ── Cases (library items) ──

export async function listCases(apiKey?: string): Promise<TPCase[]> {
  return tpFetch("/cases", apiKey);
}

export async function createCase(
  data: {
    name: string;
    dx: number;
    dy: number;
    dz: number;
    canRotate3d: boolean;
    categoryId: string;
    description?: string;
    manufacturer?: string;
    weight?: number;
  },
  apiKey?: string
): Promise<TPCase> {
  return tpFetch("/cases", apiKey, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateCase(
  id: string,
  data: Partial<{
    name: string;
    description: string;
    manufacturer: string;
    weight: number;
    dx: number;
    dy: number;
    dz: number;
    canRotate3d: boolean;
    categoryId: string;
  }>,
  apiKey?: string
): Promise<TPCase> {
  return tpFetch(`/cases/${id}`, apiKey, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

// ── Case Categories ──

export async function listCaseCategories(apiKey?: string): Promise<CaseCategory[]> {
  return tpFetch("/case-categories", apiKey);
}

export async function createCaseCategory(
  data: { name: string; colorHex: string },
  apiKey?: string
): Promise<CaseCategory> {
  return tpFetch("/case-categories", apiKey, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function listPacks(apiKey?: string): Promise<Pack[]> {
  return tpFetch("/packs", apiKey);
}

export async function createPack(data: { name?: string; folderId?: string }, apiKey?: string): Promise<Pack> {
  return tpFetch("/packs", apiKey, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getPackEntities(packId: string, apiKey?: string): Promise<TPEntity[]> {
  return tpFetch(`/packs/${packId}/entities`, apiKey);
}

export async function batchDeleteEntities(
  packId: string,
  ids: string[],
  apiKey?: string
): Promise<unknown> {
  return tpFetch("/entities:batchDelete", apiKey, {
    method: "POST",
    body: JSON.stringify({ packId, ids }),
  });
}

export async function batchCreateEntities(
  entities: Array<{
    name: string;
    type: "case" | "container" | "group";
    packId: string;
    visible: boolean;
    childrenIds: string[];
    position: { x: number; y: number; z: number };
    quaternion: { x: number; y: number; z: number; w: number };
    size: { x: number; y: number; z: number };
    caseData?: {
      weight?: number;
      manufacturer?: string;
      canRotate3d: boolean;
      categoryId: string;
    };
    containerData?: { type: string; payloadCapacity?: number };
    groupData?: { colorHex: string };
  }>,
  apiKey?: string
): Promise<unknown> {
  return tpFetch("/entities:batchCreate", apiKey, {
    method: "POST",
    body: JSON.stringify({ entities }),
  });
}
