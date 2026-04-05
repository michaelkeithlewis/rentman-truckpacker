import { getRecentLogs, clearLogs } from "@/lib/logger";
import type { LogLevel } from "@/lib/logger";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "100", 10);
  const level = url.searchParams.get("level") as LogLevel | null;
  const logs = getRecentLogs(limit, level ?? undefined);
  return NextResponse.json(logs);
}

export async function DELETE() {
  clearLogs();
  return NextResponse.json({ cleared: true });
}
