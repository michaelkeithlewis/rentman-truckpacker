import { listEquipment, listFolders, parseRefId } from "@/lib/rentman";
import { rentmanToken } from "@/lib/tokens";
import { NextResponse } from "next/server";

export interface EquipmentItem {
  id: number;
  name: string;
  code?: string;
  folder: string;
  type?: string;
  isPhysical?: string;
  weight?: number;
  length?: number;
  width?: number;
  height?: number;
  hasDimensions: boolean;
  unit?: string;
  price?: number;
  currentQuantity?: number;
}

export async function GET(req: Request) {
  try {
    const token = rentmanToken(req);
    const [equipment, folders] = await Promise.all([
      listEquipment(token),
      listFolders(token),
    ]);

    const folderMap = new Map<number, string>();
    for (const f of folders) folderMap.set(f.id, f.path ?? f.name);

    const items: EquipmentItem[] = equipment.map((e) => {
      let folderPath = "Uncategorized";
      if (e.folder) {
        try {
          folderPath = folderMap.get(parseRefId(e.folder)) ?? "Uncategorized";
        } catch { /* skip */ }
      }
      return {
        id: e.id,
        name: e.displayname ?? e.name,
        code: e.code,
        folder: folderPath,
        type: e.type,
        isPhysical: e.is_physical,
        weight: e.weight,
        length: e.length,
        width: e.width,
        height: e.height,
        hasDimensions:
          (e.length ?? 0) > 0 && (e.width ?? 0) > 0 && (e.height ?? 0) > 0,
        unit: e.unit,
        price: e.price,
        currentQuantity: e.current_quantity,
      };
    });

    return NextResponse.json(items);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
