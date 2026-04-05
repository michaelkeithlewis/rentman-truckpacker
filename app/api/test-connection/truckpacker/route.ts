import { truckpackerKey } from "@/lib/tokens";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const key = truckpackerKey(req);
    const res = await fetch(
      "https://steady-beagle-345.convex.site/api/v1/packs",
      {
        headers: { Authorization: `Bearer ${key}` },
        cache: "no-store",
      }
    );
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `Truck Packer returned ${res.status}` },
        { status: 200 }
      );
    }
    const json = await res.json();
    if (!json.success) {
      return NextResponse.json({ ok: false, error: json.error ?? "Unknown" });
    }
    const count = json.data?.length ?? 0;
    return NextResponse.json({ ok: true, message: `Connected (${count} packs)` });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Connection failed";
    return NextResponse.json({ ok: false, error: msg });
  }
}
