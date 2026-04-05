import type {
  Provider,
  ProviderEquipment,
  ProviderProject,
  ProviderProjectEquipmentLine,
} from "./types";

const BASE = "https://api.current-rms.com/api/v1";

async function crmsGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`CurrentRMS ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

async function crmsPut(
  path: string,
  body: unknown,
  token: string
): Promise<void> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`CurrentRMS PUT ${res.status}: ${await res.text()}`);
  }
}

interface CRMSProduct {
  id: number;
  name: string;
  description?: string;
  product_group_id?: number;
  product_group_name?: string;
  weight?: number;
  // CurrentRMS uses custom fields for dimensions — these are common field names
  custom_fields?: Record<string, unknown>;
  replacement_charge?: number;
  quantity_owned?: number;
  [key: string]: unknown;
}

interface CRMSOpportunity {
  id: number;
  subject: string;
  starts_at?: string;
  ends_at?: string;
  state_name?: string;
  [key: string]: unknown;
}

export const currentrmsProvider: Provider = {
  id: "currentrms",
  name: "Current RMS",
  supportsWrite: true,

  async listEquipment(token) {
    const items: ProviderEquipment[] = [];
    let page = 1;
    while (true) {
      const res = await crmsGet<{ products: CRMSProduct[] }>(
        `/products?per_page=100&page=${page}`,
        token
      );
      if (!res.products || res.products.length === 0) break;
      for (const p of res.products) {
        items.push(mapProduct(p));
      }
      if (res.products.length < 100) break;
      page++;
    }
    return items;
  },

  async getEquipment(id, token) {
    const res = await crmsGet<{ product: CRMSProduct }>(
      `/products/${id}`,
      token
    );
    return mapProduct(res.product);
  },

  async updateEquipment(id, fields, token) {
    const body: Record<string, unknown> = {};
    if (fields.name !== undefined) body.name = fields.name;
    if (fields.weight !== undefined) body.weight = fields.weight;
    await crmsPut(`/products/${id}`, { product: body }, token);
  },

  async listProjects(token) {
    const res = await crmsGet<{ opportunities: CRMSOpportunity[] }>(
      `/opportunities?per_page=50&page=1`,
      token
    );
    return (res.opportunities ?? []).map((o) => ({
      sourceId: String(o.id),
      displayNumber: String(o.id),
      name: o.subject,
      startDate: o.starts_at,
      endDate: o.ends_at,
    }));
  },

  async getProject(id, token) {
    const res = await crmsGet<{ opportunity: CRMSOpportunity }>(
      `/opportunities/${id}`,
      token
    );
    const o = res.opportunity;
    return {
      sourceId: String(o.id),
      displayNumber: String(o.id),
      name: o.subject,
      startDate: o.starts_at,
      endDate: o.ends_at,
    };
  },

  async listProjectEquipment(projectId, token) {
    const res = await crmsGet<{
      opportunity_items: Array<{
        id: number;
        product_id: number;
        product_name: string;
        quantity: number;
        charge_total?: number;
      }>;
    }>(`/opportunities/${projectId}/opportunity_items?per_page=100`, token);
    return (res.opportunity_items ?? []).map((i) => ({
      lineId: String(i.id),
      equipmentSourceId: String(i.product_id),
      name: i.product_name,
      quantity: i.quantity,
      unitPrice: i.charge_total,
    }));
  },
};

function mapProduct(p: CRMSProduct): ProviderEquipment {
  return {
    sourceId: String(p.id),
    name: p.name,
    code: undefined,
    category: p.product_group_name ?? "Uncategorized",
    weight: p.weight ?? undefined,
    length: undefined,
    width: undefined,
    height: undefined,
    isPhysical: true,
    stockQty: p.quantity_owned ?? undefined,
    price: p.replacement_charge ?? undefined,
  };
}
