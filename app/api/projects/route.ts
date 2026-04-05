import { getProvider } from "@/lib/providers";
import { activeProvider, sourceToken } from "@/lib/tokens";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const providerId = activeProvider(req);
    const token = sourceToken(req);
    const provider = getProvider(providerId);
    const projects = await provider.listProjects(token);
    return NextResponse.json(projects);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
