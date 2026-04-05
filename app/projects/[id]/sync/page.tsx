"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";

const LARGE_QTY_THRESHOLD = 6;

interface EquipmentLine {
  lineId: number;
  name: string;
  code?: string;
  quantity: number;
  folder: string;
  weight?: number;
  length?: number;
  width?: number;
  height?: number;
  hasDimensions: boolean;
  isPhysical?: string;
  equipmentId: number;
}

interface Project {
  displayname: string;
  name: string;
  color?: string;
  usageperiod_start?: string;
  usageperiod_end?: string;
}

interface SyncItem {
  lineId: number;
  name: string;
  code?: string;
  originalQty: number;
  selectedQty: number;
  included: boolean;
  isLargeQty: boolean;
  isVirtual: boolean;
  folder: string;
  weight?: number;
  hasDimensions: boolean;
  equipmentId: number;
}

interface SyncResult {
  packUrl: string;
  entitiesCreated: number;
  skippedVirtual: number;
  projectName: string;
  mode: "create" | "update";
}

interface ExistingPack {
  id: string;
  name: string;
}

type Step = "configure" | "syncing" | "done";

export default function SyncWizard() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [items, setItems] = useState<SyncItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("configure");
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [existingPack, setExistingPack] = useState<ExistingPack | null>(null);
  const [syncMode, setSyncMode] = useState<"create" | "update">("create");

  useEffect(() => {
    Promise.all([
      api<{ project: Project; equipment: EquipmentLine[] }>(`/api/projects/${id}`),
      api<{ existingPack: ExistingPack | null }>(`/api/sync/${id}`),
    ])
      .then(([{ project: p, equipment }, { existingPack: ep }]) => {
        setProject(p);
        setItems(
          equipment.map((e) => ({
            lineId: e.lineId,
            name: e.name,
            code: e.code,
            originalQty: e.quantity,
            selectedQty: e.quantity,
            included: e.isPhysical !== "Virtual package",
            isLargeQty: e.quantity >= LARGE_QTY_THRESHOLD,
            isVirtual: e.isPhysical === "Virtual package",
            folder: e.folder,
            weight: e.weight,
            hasDimensions: e.hasDimensions,
            equipmentId: e.equipmentId,
          }))
        );
        if (ep) {
          setExistingPack(ep);
          setSyncMode("update"); // default to update if pack exists
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  function toggleItem(lineId: number) {
    setItems((prev) =>
      prev.map((i) => (i.lineId === lineId ? { ...i, included: !i.included } : i))
    );
  }

  function updateQty(lineId: number, qty: number) {
    setItems((prev) =>
      prev.map((i) =>
        i.lineId === lineId ? { ...i, selectedQty: Math.max(0, qty) } : i
      )
    );
  }

  const included = items.filter((i) => i.included && !i.isVirtual);
  const totalEntities = included.reduce((s, i) => s + i.selectedQty, 0);
  const largeItems = included.filter((i) => i.isLargeQty);

  async function handleSync() {
    setStep("syncing");
    setSyncError(null);
    try {
      const syncItems = included.map((i) => ({
        equipmentId: i.equipmentId,
        quantity: i.selectedQty,
      }));
      const payload: Record<string, unknown> = { items: syncItems };
      if (syncMode === "update" && existingPack) {
        payload.mode = "update";
        payload.existingPackId = existingPack.id;
      }
      const result = await api<SyncResult>(`/api/sync/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setSyncResult(result);
      setStep("done");
    } catch (e: unknown) {
      setSyncError(e instanceof Error ? e.message : "Sync failed");
      setStep("configure");
    }
  }

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
        <Link href="/" className="text-sm underline mt-3 inline-block">← Back</Link>
      </div>
    );
  }

  // ──── STEP: Done ────
  if (step === "done" && syncResult) {
    return (
      <div className="max-w-xl mx-auto text-center py-16">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <span className="text-3xl text-green-600">✓</span>
        </div>
        <h1 className="text-2xl font-bold mb-2">
          {syncResult.mode === "update" ? "Pack Updated" : "Sync Complete"}
        </h1>
        <p className="text-gray-500 mb-2">
          {syncResult.mode === "update" ? "Updated" : "Created"}{" "}
          <strong>{syncResult.entitiesCreated}</strong> entities in Truck Packer
          for &quot;{syncResult.projectName}&quot;
        </p>
        {syncResult.skippedVirtual > 0 && (
          <p className="text-sm text-gray-400 mb-6">
            {syncResult.skippedVirtual} virtual packages skipped
          </p>
        )}
        <div className="flex gap-3 justify-center">
          <a
            href={syncResult.packUrl}
            target="_blank"
            rel="noopener"
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-lg font-medium text-sm transition"
          >
            Open in Truck Packer ↗
          </a>
          <Link
            href={`/projects/${id}`}
            className="border border-gray-300 hover:bg-gray-50 px-6 py-2.5 rounded-lg text-sm transition"
          >
            Back to Project
          </Link>
        </div>
      </div>
    );
  }

  // ──── STEP: Syncing ────
  if (step === "syncing") {
    return (
      <div className="max-w-xl mx-auto text-center py-16">
        <div className="animate-spin rounded-full h-12 w-12 border-2 border-indigo-600 border-t-transparent mx-auto mb-6" />
        <h1 className="text-xl font-bold mb-2">Syncing to Truck Packer…</h1>
        <p className="text-gray-500">
          Creating {totalEntities} entities from {included.length} items
        </p>
      </div>
    );
  }

  // ──── STEP: Configure ────
  return (
    <div>
      <Link
        href={`/projects/${id}`}
        className="text-sm text-gray-500 hover:text-gray-900 transition mb-4 inline-block"
      >
        ← Back to Project
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-2xl font-bold">Sync Wizard</h1>
          <p className="text-gray-500 mt-1">
            Review and configure items before syncing to Truck Packer
          </p>
        </div>
      </div>

      {syncError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 text-red-700">
          <p className="font-medium">Sync failed</p>
          <p className="text-sm mt-1">{syncError}</p>
        </div>
      )}

      {/* Existing pack detected */}
      {existingPack && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <p className="font-medium text-blue-800 mb-2">
            This project was already synced to Truck Packer
          </p>
          <p className="text-sm text-blue-700 mb-3">
            Pack &quot;{existingPack.name}&quot; already exists. Choose how to proceed:
          </p>
          <div className="flex gap-3">
            <label
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm cursor-pointer transition ${
                syncMode === "update"
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-blue-800 border-blue-200 hover:border-blue-400"
              }`}
            >
              <input
                type="radio"
                name="syncMode"
                checked={syncMode === "update"}
                onChange={() => setSyncMode("update")}
                className="sr-only"
              />
              Update existing pack
            </label>
            <label
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm cursor-pointer transition ${
                syncMode === "create"
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-blue-800 border-blue-200 hover:border-blue-400"
              }`}
            >
              <input
                type="radio"
                name="syncMode"
                checked={syncMode === "create"}
                onChange={() => setSyncMode("create")}
                className="sr-only"
              />
              Create new pack
            </label>
          </div>
        </div>
      )}

      {/* Large quantity warnings */}
      {largeItems.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
          <p className="font-medium text-amber-800 mb-1">
            {largeItems.length} item{largeItems.length > 1 ? "s" : ""} with large
            quantities
          </p>
          <p className="text-sm text-amber-700 mb-3">
            Items with {LARGE_QTY_THRESHOLD}+ units will create many individual
            entities in Truck Packer. You can reduce the quantity below if needed.
          </p>
          <div className="space-y-2">
            {largeItems.map((item) => (
              <div
                key={item.lineId}
                className="flex items-center gap-3 bg-white rounded-lg px-3 py-2 border border-amber-100"
              >
                <span className="font-medium text-sm flex-1">{item.name}</span>
                <span className="text-xs text-amber-600">
                  {item.originalQty} units → {item.selectedQty} entities
                </span>
                <input
                  type="number"
                  min={0}
                  max={item.originalQty}
                  value={item.selectedQty}
                  onChange={(e) => updateQty(item.lineId, parseInt(e.target.value) || 0)}
                  className="w-20 px-2 py-1 text-sm border border-amber-200 rounded text-center focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Item table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="w-10 px-4 py-2" />
              <th className="text-left px-4 py-2 font-medium text-gray-600">Item</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Category</th>
              <th className="text-right px-4 py-2 font-medium text-gray-600">Qty</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Dims</th>
              <th className="text-right px-4 py-2 font-medium text-gray-600">Weight</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.lineId}
                className={`border-b border-gray-100 last:border-0 transition ${
                  item.isVirtual
                    ? "opacity-40"
                    : !item.included
                      ? "opacity-50 bg-gray-50"
                      : item.isLargeQty
                        ? "bg-amber-50/50"
                        : "hover:bg-gray-50"
                }`}
              >
                <td className="px-4 py-2.5 text-center">
                  {item.isVirtual ? (
                    <span className="text-xs text-gray-300" title="Virtual packages are always skipped">–</span>
                  ) : (
                    <input
                      type="checkbox"
                      checked={item.included}
                      onChange={() => toggleItem(item.lineId)}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <span className="font-medium">{item.name}</span>
                  {item.isVirtual && (
                    <span className="ml-2 text-xs bg-purple-50 text-purple-500 px-1.5 py-0.5 rounded-full">
                      virtual
                    </span>
                  )}
                  {item.isLargeQty && !item.isVirtual && (
                    <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                      {item.originalQty} units
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-gray-500 text-xs">{item.folder}</td>
                <td className="px-4 py-2.5 text-right">
                  {item.isVirtual ? (
                    "–"
                  ) : item.isLargeQty ? (
                    <input
                      type="number"
                      min={0}
                      max={item.originalQty}
                      value={item.selectedQty}
                      onChange={(e) => updateQty(item.lineId, parseInt(e.target.value) || 0)}
                      className="w-16 px-2 py-0.5 text-sm border border-gray-200 rounded text-center focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  ) : (
                    item.selectedQty
                  )}
                </td>
                <td className="px-4 py-2.5 text-gray-500">
                  {item.hasDimensions ? "✓" : <span className="text-gray-300">–</span>}
                </td>
                <td className="px-4 py-2.5 text-right text-gray-500">
                  {item.weight ? `${item.weight} kg` : "–"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer: summary + sync button */}
      <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 -mx-6 px-6 py-4 flex items-center justify-between">
        <div className="text-sm text-gray-600">
          <strong>{included.length}</strong> items,{" "}
          <strong>{totalEntities}</strong> total entities
          {items.some((i) => i.isVirtual) && (
            <span className="text-gray-400">
              {" "}
              ({items.filter((i) => i.isVirtual).length} virtual skipped)
            </span>
          )}
        </div>
        <button
          onClick={handleSync}
          disabled={totalEntities === 0}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white px-6 py-2.5 rounded-lg font-medium text-sm transition"
        >
          {syncMode === "update" && existingPack
            ? `Update pack with ${totalEntities} entities →`
            : `Sync ${totalEntities} entities to Truck Packer →`}
        </button>
      </div>
    </div>
  );
}
