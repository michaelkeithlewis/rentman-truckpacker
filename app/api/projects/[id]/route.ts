import { getProvider } from "@/lib/providers";
import { activeProvider, sourceToken } from "@/lib/tokens";
import { NextResponse } from "next/server";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const providerId = activeProvider(req);
    const token = sourceToken(req);
    const provider = getProvider(providerId);
    const { id } = await params;

    const [project, lines] = await Promise.all([
      provider.getProject(id, token),
      provider.listProjectEquipment(id, token),
    ]);

    // Fetch full equipment details in parallel (batches of 10)
    const uniqueIds = [...new Set(lines.map((l) => l.equipmentSourceId).filter(Boolean))];
    const equipMap = new Map<string, Awaited<ReturnType<typeof provider.getEquipment>>>();
    const BATCH = 10;
    for (let i = 0; i < uniqueIds.length; i += BATCH) {
      const batch = uniqueIds.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map((eid) => provider.getEquipment(eid, token).catch(() => null))
      );
      for (const eq of results) {
        if (eq) equipMap.set(eq.sourceId, eq);
      }
    }

    const equipment = lines.map((line) => {
      const eq = equipMap.get(line.equipmentSourceId);
      const hasDims =
        (eq?.length ?? 0) > 0 && (eq?.width ?? 0) > 0 && (eq?.height ?? 0) > 0;
      return {
        lineId: line.lineId,
        name: eq?.name ?? line.name,
        code: eq?.code,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        type: undefined,
        isPhysical: eq?.isPhysical ? "Physical equipment" : "Virtual package",
        unit: eq?.unit,
        folder: eq?.category ?? "Uncategorized",
        weight: eq?.weight,
        length: eq?.length,
        width: eq?.width,
        height: eq?.height,
        hasDimensions: hasDims,
        equipmentId: eq ? parseInt(eq.sourceId, 10) || 0 : 0,
      };
    });

    return NextResponse.json({ project, equipment });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
