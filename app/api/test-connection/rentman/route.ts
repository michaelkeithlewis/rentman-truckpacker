import { getProvider } from "@/lib/providers";
import { activeProvider, sourceToken } from "@/lib/tokens";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const providerId = activeProvider(req);
    const token = sourceToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "No API token configured" });
    }
    const provider = getProvider(providerId);
    const projects = await provider.listProjects(token);
    return NextResponse.json({
      ok: true,
      message: `Connected to ${provider.name} (${projects.length > 0 ? "data found" : "no projects"})`,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Connection failed";
    return NextResponse.json({ ok: false, error: msg });
  }
}
