import { config } from "./config.js";

const { baseUrl, token } = config.rentman;

async function rentmanFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Rentman API ${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// ---------- Types ----------

export interface RentmanProject {
  id: number;
  displayname: string;
  name: string;
  usageperiod_start?: string;
  usageperiod_end?: string;
  planperiod_start?: string;
  planperiod_end?: string;
  weight?: number;
  volume?: number;
  color?: string;
  tags?: string;
  [key: string]: unknown;
}

export interface RentmanEquipment {
  id: number;
  displayname: string;
  name: string;
  code?: string;
  folder?: string; // reference path like "/folders/21"
  type?: string; // "item", "set", "case", etc.
  is_physical?: string; // "Physical equipment", "Virtual package"
  weight?: number;
  length?: number; // centimeters
  width?: number; // centimeters
  height?: number; // centimeters
  volume?: number;
  packed_per?: number;
  defaultgroup?: string;
  [key: string]: unknown;
}

export interface RentmanProjectEquipment {
  id: number;
  displayname: string;
  equipment: string; // reference path like "/equipment/123"
  quantity: number;
  quantity_total?: number;
  unit_price?: number;
  is_option?: boolean;
  name?: string;
  equipment_group?: string;
  [key: string]: unknown;
}

export interface RentmanFolder {
  id: number;
  displayname: string;
  name: string;
  path: string; // e.g. "Audio/Amplifiers"
  parent?: string | null;
  [key: string]: unknown;
}

interface RentmanListResponse<T> {
  data: T[];
  itemCount?: number;
  limit?: number;
  offset?: number;
  next_page_url?: string;
}

// ---------- API Methods ----------

export async function listProjects(
  limit = 25,
  offset = 0
): Promise<RentmanProject[]> {
  const res = await rentmanFetch<RentmanListResponse<RentmanProject>>(
    `/projects?limit=${limit}&offset=${offset}`
  );
  return res.data;
}

export async function getProject(projectId: number): Promise<RentmanProject> {
  const res = await rentmanFetch<{ data: RentmanProject }>(
    `/projects/${projectId}`
  );
  return res.data;
}

export async function listProjectEquipment(
  projectId: number
): Promise<RentmanProjectEquipment[]> {
  const all: RentmanProjectEquipment[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const res = await rentmanFetch<RentmanListResponse<RentmanProjectEquipment>>(
      `/projects/${projectId}/projectequipment?limit=${limit}&offset=${offset}`
    );
    all.push(...res.data);
    if (res.data.length < limit) break;
    offset += limit;
  }

  return all;
}

export async function getEquipment(
  equipmentId: number
): Promise<RentmanEquipment> {
  const res = await rentmanFetch<{ data: RentmanEquipment }>(
    `/equipment/${equipmentId}`
  );
  return res.data;
}

export async function listEquipment(
  limit = 100,
  offset = 0
): Promise<RentmanEquipment[]> {
  const res = await rentmanFetch<RentmanListResponse<RentmanEquipment>>(
    `/equipment?limit=${limit}&offset=${offset}`
  );
  return res.data;
}

export async function getFolder(folderId: number): Promise<RentmanFolder> {
  const res = await rentmanFetch<{ data: RentmanFolder }>(
    `/folders/${folderId}`
  );
  return res.data;
}

export async function listFolders(): Promise<RentmanFolder[]> {
  const all: RentmanFolder[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const res = await rentmanFetch<RentmanListResponse<RentmanFolder>>(
      `/folders?limit=${limit}&offset=${offset}`
    );
    all.push(...res.data);
    if (res.data.length < limit) break;
    offset += limit;
  }

  return all;
}

/**
 * Extracts a numeric ID from a Rentman reference path like "/equipment/123"
 */
export function parseRefId(ref: string): number {
  const match = ref.match(/\/(\d+)$/);
  if (!match) throw new Error(`Cannot parse Rentman reference: ${ref}`);
  return parseInt(match[1], 10);
}
