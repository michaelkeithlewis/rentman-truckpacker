"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cachedApi, api } from "@/lib/api";
import { SetupGuard } from "./setup-guard";

interface Project {
  sourceId: string;
  displayNumber: string;
  name: string;
  color?: string;
  tags?: string;
  startDate?: string;
  endDate?: string;
  weight?: number;
  volume?: number;
}

function fmt(iso?: string) {
  if (!iso) return "–";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  useEffect(() => {
    cachedApi<Project[]>("projects", "/api/projects")
      .then(setProjects)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleSyncAll() {
    setSyncingAll(true);
    setSyncMsg(null);
    try {
      const res = await api<{ synced: number; skipped: number; notConfirmed: number; total: number }>(
        "/api/sync-all",
        { method: "POST" }
      );
      setSyncMsg(
        `Synced ${res.synced} confirmed projects to Truck Packer` +
        (res.notConfirmed > 0 ? ` (${res.notConfirmed} not confirmed, ${res.skipped} no equipment)` : "")
      );
    } catch (e: unknown) {
      setSyncMsg(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncingAll(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-red-700">
        <p className="font-medium">Failed to load projects</p>
        <p className="text-sm mt-1">{error}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-8 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-gray-500 mt-1">
            {projects.length} projects from Rentman. Click one to see equipment,
            or sync all at once.
          </p>
        </div>
        <button
          onClick={handleSyncAll}
          disabled={syncingAll}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white px-5 py-2.5 rounded-lg font-medium text-sm transition flex items-center gap-2 flex-shrink-0"
        >
          {syncingAll ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
              Syncing all…
            </>
          ) : (
            "Sync All to Truck Packer"
          )}
        </button>
      </div>

      {syncMsg && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-6 text-sm text-green-700">
          {syncMsg}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((p) => (
          <Link
            key={p.sourceId}
            href={`/projects/${p.sourceId}`}
            className="bg-white rounded-lg border border-gray-200 hover:border-indigo-300 hover:shadow-md transition-all p-5 flex gap-4"
          >
            <div
              className="w-1 rounded-full flex-shrink-0"
              style={{ backgroundColor: p.color ? `#${p.color}` : "#94a3b8" }}
            />
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold text-gray-900 truncate">
                <span className="text-gray-400 font-normal">#{p.displayNumber}</span>{" "}
                {p.name}
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                {fmt(p.startDate)} → {fmt(p.endDate)}
              </p>
              <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
                {p.weight ? <span>{p.weight.toFixed(0)} kg</span> : null}
                {p.volume ? <span>{p.volume.toFixed(2)} m³</span> : null}
                {p.tags ? (
                  <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                    {p.tags}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="text-gray-300 self-center">→</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <SetupGuard>
      <Dashboard />
    </SetupGuard>
  );
}
