"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { cachedApi } from "@/lib/api";
import { SetupGuard } from "@/app/setup-guard";

interface EquipmentLine {
  lineId: number;
  name: string;
  code?: string;
  quantity: number;
  unitPrice?: number;
  discount?: number;
  type?: string;
  isPhysical?: string;
  unit?: string;
  folder: string;
  weight?: number;
  length?: number;
  width?: number;
  height?: number;
  hasDimensions: boolean;
  equipmentId: number;
}

interface Project {
  sourceId: string;
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
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function dimStr(l?: number, w?: number, h?: number) {
  if (!l || !w || !h) return "–";
  return `${l} × ${w} × ${h} cm`;
}

function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [equipment, setEquipment] = useState<EquipmentLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    cachedApi<{ project: Project; equipment: EquipmentLine[] }>(`project:${id}`, `/api/projects/${id}`)
      .then((data) => {
        setProject(data.project);
        setEquipment(data.equipment);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-red-700">
        <p className="font-medium">Failed to load project</p>
        <p className="text-sm mt-1">{error}</p>
        <Link href="/" className="text-sm underline mt-3 inline-block">
          ← Back to projects
        </Link>
      </div>
    );
  }

  const physical = equipment.filter((e) => e.isPhysical !== "Virtual package");
  const virtual = equipment.filter((e) => e.isPhysical === "Virtual package");
  const totalQty = equipment.reduce((s, e) => s + e.quantity, 0);
  const withDims = physical.filter((e) => e.hasDimensions).length;

  // Group by folder
  const byFolder = new Map<string, EquipmentLine[]>();
  for (const e of equipment) {
    const group = byFolder.get(e.folder) ?? [];
    group.push(e);
    byFolder.set(e.folder, group);
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/"
          className="text-sm text-gray-500 hover:text-gray-900 transition mb-4 inline-block"
        >
          ← All Projects
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3">
              <div
                className="w-3 h-3 rounded-full"
                style={{
                  backgroundColor: project.color
                    ? `#${project.color}`
                    : "#94a3b8",
                }}
              />
              <h1 className="text-2xl font-bold">{project.name}</h1>
            </div>
            <p className="text-sm text-gray-400 mt-1 ml-6">
              {fmt(project.startDate)} → {fmt(project.endDate)}
            </p>
          </div>
          <Link
            href={`/projects/${id}/sync`}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg font-medium text-sm transition flex-shrink-0"
          >
            Sync to Truck Packer →
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <Stat label="Line items" value={equipment.length} />
        <Stat label="Total qty" value={totalQty} />
        <Stat
          label="Total weight"
          value={project.weight ? `${project.weight.toFixed(0)} kg` : "–"}
        />
        <Stat
          label="Total volume"
          value={project.volume ? `${project.volume.toFixed(2)} m³` : "–"}
        />
      </div>

      {/* Dimension coverage */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6 flex items-center gap-4">
        <div className="flex-1">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-600">Items with dimensions</span>
            <span className="font-medium">
              {withDims} / {physical.length} physical items
            </span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div
              className="bg-indigo-600 h-2 rounded-full transition-all"
              style={{
                width: `${physical.length > 0 ? (withDims / physical.length) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
        {virtual.length > 0 && (
          <span className="text-xs text-gray-400 flex-shrink-0">
            +{virtual.length} virtual
          </span>
        )}
      </div>

      {/* Equipment table grouped by folder */}
      {[...byFolder.entries()].map(([folder, items]) => (
        <div key={folder} className="mb-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
            {folder}
          </h3>
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-2 font-medium text-gray-600">
                    Name
                  </th>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">
                    Code
                  </th>
                  <th className="text-right px-4 py-2 font-medium text-gray-600">
                    Qty
                  </th>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">
                    Dimensions (L×W×H)
                  </th>
                  <th className="text-right px-4 py-2 font-medium text-gray-600">
                    Weight
                  </th>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">
                    Type
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr
                    key={e.lineId}
                    className="border-b border-gray-100 last:border-0 hover:bg-gray-50 transition"
                  >
                    <td className="px-4 py-2.5 font-medium">{e.name}</td>
                    <td className="px-4 py-2.5 text-gray-400 font-mono text-xs">
                      {e.code ?? "–"}
                    </td>
                    <td className="px-4 py-2.5 text-right">{e.quantity}</td>
                    <td className="px-4 py-2.5 text-gray-500">
                      {e.hasDimensions ? (
                        dimStr(e.length, e.width, e.height)
                      ) : (
                        <span className="text-gray-300">no dims</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-500">
                      {e.weight ? `${e.weight} kg` : "–"}
                    </td>
                    <td className="px-4 py-2.5">
                      {e.isPhysical === "Virtual package" ? (
                        <span className="text-xs bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full">
                          virtual
                        </span>
                      ) : (
                        <span className="text-xs bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full">
                          {e.type ?? "item"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <p className="text-xs text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="text-xl font-semibold mt-1">{value}</p>
    </div>
  );
}

export default function Page() {
  return (
    <SetupGuard>
      <ProjectDetail />
    </SetupGuard>
  );
}
