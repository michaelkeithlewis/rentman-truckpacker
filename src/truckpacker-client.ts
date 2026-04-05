import { config } from "./config.js";

const { baseUrl, apiKey } = config.truckpacker;

interface TPResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

async function tpFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Truck Packer API ${res.status} ${res.statusText}: ${body}`);
  }
  const json = (await res.json()) as TPResponse<T>;
  if (!json.success) {
    throw new Error(`Truck Packer API error: ${json.error ?? "unknown"}`);
  }
  return json.data;
}

// ---------- Types ----------

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

export interface TPCaseCategory {
  _id: string;
  name: string;
  colorHex: string;
}

export interface TPContainer {
  _id: string;
  name: string;
  description?: string;
  code?: string;
  type: string;
  dx: number;
  dy: number;
  dz: number;
  payloadCapacity?: number;
}

export interface TPPack {
  _id: string;
  name?: string;
  folderId?: string;
}

export interface TPEntity {
  _id: string;
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
  containerData?: {
    type: string;
    payloadCapacity?: number;
  };
  groupData?: {
    colorHex: string;
  };
}

// ---------- Case Categories ----------

export async function listCaseCategories(): Promise<TPCaseCategory[]> {
  return tpFetch<TPCaseCategory[]>("/case-categories");
}

export async function createCaseCategory(
  data: Pick<TPCaseCategory, "name" | "colorHex">
): Promise<TPCaseCategory> {
  return tpFetch<TPCaseCategory>("/case-categories", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ---------- Cases ----------

export async function listCases(): Promise<TPCase[]> {
  return tpFetch<TPCase[]>("/cases");
}

export async function createCase(data: {
  name: string;
  dx: number;
  dy: number;
  dz: number;
  canRotate3d: boolean;
  categoryId: string;
  description?: string;
  manufacturer?: string;
  weight?: number;
}): Promise<TPCase> {
  return tpFetch<TPCase>("/cases", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateCase(
  id: string,
  data: Partial<Omit<TPCase, "_id">>
): Promise<TPCase> {
  return tpFetch<TPCase>(`/cases/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteCase(id: string): Promise<void> {
  await tpFetch(`/cases/${id}`, { method: "DELETE" });
}

// ---------- Containers ----------

export async function listContainers(): Promise<TPContainer[]> {
  return tpFetch<TPContainer[]>("/containers");
}

export async function createContainer(data: {
  name: string;
  type: string;
  dx: number;
  dy: number;
  dz: number;
  description?: string;
  code?: string;
  payloadCapacity?: number;
}): Promise<TPContainer> {
  return tpFetch<TPContainer>("/containers", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ---------- Packs ----------

export async function listPacks(): Promise<TPPack[]> {
  return tpFetch<TPPack[]>("/packs");
}

export async function getPack(id: string): Promise<TPPack> {
  return tpFetch<TPPack>(`/packs/${id}`);
}

export async function createPack(data: {
  name?: string;
  folderId?: string;
}): Promise<TPPack> {
  return tpFetch<TPPack>("/packs", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deletePack(id: string): Promise<void> {
  await tpFetch(`/packs/${id}`, { method: "DELETE" });
}

// ---------- Entities ----------

export async function getPackEntities(packId: string): Promise<TPEntity[]> {
  return tpFetch<TPEntity[]>(`/packs/${packId}/entities`);
}

export async function batchCreateEntities(entities: Array<{
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
  containerData?: {
    type: string;
    payloadCapacity?: number;
  };
  groupData?: {
    colorHex: string;
  };
}>): Promise<TPEntity[]> {
  return tpFetch<TPEntity[]>("/entities:batchCreate", {
    method: "POST",
    body: JSON.stringify({ entities }),
  });
}

export async function batchDeleteEntities(
  packId: string,
  ids: string[]
): Promise<void> {
  await tpFetch("/entities:batchDelete", {
    method: "POST",
    body: JSON.stringify({ packId, ids }),
  });
}
