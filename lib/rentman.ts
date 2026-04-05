const BASE = "https://api.rentman.net";

export async function rentmanGet<T>(
  path: string,
  token?: string
): Promise<T> {
  const t = token ?? process.env.RENTMAN_API_TOKEN;
  if (!t) throw new Error("No Rentman token. Add one in Settings.");
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${t}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Rentman ${res.status}: ${await res.text()}`);
  }
  return ((await res.json()) as { data: T }).data;
}

// ---------- Types ----------

export interface Project {
  id: number;
  number: number;
  displayname: string;
  name: string;
  created?: string;
  color?: string;
  tags?: string;
  usageperiod_start?: string;
  usageperiod_end?: string;
  planperiod_start?: string;
  planperiod_end?: string;
  weight?: number;
  volume?: number;
  power?: number;
  location?: string;
  customer?: string;
  [key: string]: unknown;
}

export interface ProjectEquipmentLine {
  id: number;
  displayname: string;
  equipment: string;
  quantity: number;
  quantity_total?: number;
  unit_price?: number;
  is_option?: boolean;
  name?: string;
  equipment_group?: string;
  discount?: number;
  [key: string]: unknown;
}

export interface Equipment {
  id: number;
  displayname: string;
  name: string;
  code?: string;
  folder?: string;
  type?: string;
  is_physical?: string;
  weight?: number;
  length?: number;
  width?: number;
  height?: number;
  volume?: number;
  packed_per?: number;
  defaultgroup?: string;
  price?: number;
  subrental_costs?: number;
  current_quantity?: number;
  unit?: string;
  image?: string | null;
  [key: string]: unknown;
}

export interface Folder {
  id: number;
  name: string;
  displayname: string;
  path: string;
  parent?: string | null;
}

export interface Contact {
  id: number;
  displayname: string;
  name: string;
  [key: string]: unknown;
}

// ---------- Helpers ----------

export function parseRefId(ref: string): number {
  const m = ref.match(/\/(\d+)$/);
  if (!m) throw new Error(`Bad ref: ${ref}`);
  return parseInt(m[1], 10);
}

// ---------- Fetchers ----------

export async function listProjects(limit = 50, token?: string): Promise<Project[]> {
  return rentmanGet<Project[]>(`/projects?limit=${limit}`, token);
}

export async function getProject(id: number, token?: string): Promise<Project> {
  return rentmanGet<Project>(`/projects/${id}`, token);
}

export async function listProjectEquipment(
  projectId: number,
  token?: string
): Promise<ProjectEquipmentLine[]> {
  const all: ProjectEquipmentLine[] = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const page = await rentmanGet<ProjectEquipmentLine[]>(
      `/projects/${projectId}/projectequipment?limit=${limit}&offset=${offset}`,
      token
    );
    all.push(...page);
    if (page.length < limit) break;
    offset += limit;
  }
  return all;
}

export async function listEquipment(token?: string): Promise<Equipment[]> {
  const all: Equipment[] = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const page = await rentmanGet<Equipment[]>(
      `/equipment?limit=${limit}&offset=${offset}`,
      token
    );
    all.push(...page);
    if (page.length < limit) break;
    offset += limit;
  }
  return all;
}

export async function getEquipment(id: number, token?: string): Promise<Equipment> {
  return rentmanGet<Equipment>(`/equipment/${id}`, token);
}

export async function listFolders(token?: string): Promise<Folder[]> {
  const all: Folder[] = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const page = await rentmanGet<Folder[]>(
      `/folders?limit=${limit}&offset=${offset}`,
      token
    );
    all.push(...page);
    if (page.length < limit) break;
    offset += limit;
  }
  return all;
}

export async function getContact(id: number, token?: string): Promise<Contact> {
  return rentmanGet<Contact>(`/contacts/${id}`, token);
}

// Subproject status IDs that represent "ready to pack"
const PACKABLE_STATUSES = new Set([3, 4, 5]); // Confirmed, Prepped, On location

const STATUS_NAMES: Record<number, string> = {
  1: "Pending", 2: "Canceled", 3: "Confirmed", 4: "Prepped",
  5: "On location", 6: "Returned", 7: "Inquiry", 8: "Concept",
};

export interface Subproject {
  id: number;
  status: string;
  name: string;
  displayname: string;
  [key: string]: unknown;
}

export interface ProjectStatus {
  id: number;
  name: string;
  isPackable: boolean;
}

export async function getProjectStatus(
  projectId: number,
  token?: string
): Promise<ProjectStatus> {
  const subs = await rentmanGet<Subproject[]>(
    `/projects/${projectId}/subprojects?limit=10`,
    token
  );
  if (subs.length === 0) return { id: 0, name: "Unknown", isPackable: false };
  for (const s of subs) {
    try {
      const statusId = parseRefId(s.status);
      return {
        id: statusId,
        name: STATUS_NAMES[statusId] ?? `Status ${statusId}`,
        isPackable: PACKABLE_STATUSES.has(statusId),
      };
    } catch {
      continue;
    }
  }
  return { id: 0, name: "Unknown", isPackable: false };
}

export async function isProjectConfirmed(
  projectId: number,
  token?: string
): Promise<boolean> {
  const status = await getProjectStatus(projectId, token);
  return status.isPackable;
}
