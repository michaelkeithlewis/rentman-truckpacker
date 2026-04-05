"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { api, getActiveProvider } from "@/lib/api";
import { SetupGuard } from "@/app/setup-guard";

type SyncStatus = "synced" | "source-changed" | "tp-changed" | "conflict" | "unlinked";

interface SyncedItem {
  sourceId: string;
  name: string;
  code?: string;
  category: string;
  isPhysical: boolean;
  syncStatus: SyncStatus;
  sourceValues: { length?: number; width?: number; height?: number; weight?: number };
  tpValues?: { length?: number; width?: number; height?: number; weight?: number };
  tpCaseId?: string;
}

interface SyncResponse {
  items: SyncedItem[];
  providerId: string;
}

const STATUS_CONFIG: Record<SyncStatus, { label: string; color: string; bg: string; icon: string }> = {
  synced: { label: "Synced", color: "text-green-700", bg: "bg-green-50 border-green-200", icon: "✓" },
  "source-changed": { label: "Source changed", color: "text-amber-700", bg: "bg-amber-50 border-amber-200", icon: "↓" },
  "tp-changed": { label: "TP changed", color: "text-blue-700", bg: "bg-blue-50 border-blue-200", icon: "↑" },
  conflict: { label: "Conflict", color: "text-red-700", bg: "bg-red-50 border-red-200", icon: "!" },
  unlinked: { label: "Not synced", color: "text-gray-400", bg: "bg-gray-50 border-gray-200", icon: "–" },
};

function StatusBadge({ status, onClick }: { status: SyncStatus; onClick?: () => void }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium ${cfg.bg} ${cfg.color} ${onClick ? "cursor-pointer hover:opacity-80" : "cursor-default"}`}
    >
      <span>{cfg.icon}</span>
      {cfg.label}
    </button>
  );
}

function DiffPopover({
  item,
  providerName,
  supportsWrite,
  onResolve,
  onClose,
}: {
  item: SyncedItem;
  providerName: string;
  supportsWrite: boolean;
  onResolve: (sourceId: string, action: "update-tp" | "update-source") => void;
  onClose: () => void;
}) {
  const s = item.sourceValues;
  const t = item.tpValues;
  const fields = [
    { label: "Length", src: s.length, tp: t?.length, unit: "cm" },
    { label: "Width", src: s.width, tp: t?.width, unit: "cm" },
    { label: "Height", src: s.height, tp: t?.height, unit: "cm" },
    { label: "Weight", src: s.weight, tp: t?.weight, unit: "kg" },
  ];
  const hasDiff = fields.some((f) => (f.src ?? 0) !== (f.tp ?? 0));

  return (
    <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl border border-gray-200 p-6 w-[420px] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold text-lg mb-1">{item.name}</h3>
        <p className="text-sm text-gray-500 mb-4">Values differ between {providerName} and Truck Packer</p>

        <table className="w-full text-sm mb-4">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-1 font-medium text-gray-500">Field</th>
              <th className="text-right py-1 font-medium text-gray-500">{providerName}</th>
              <th className="text-right py-1 font-medium text-gray-500">Truck Packer</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => {
              const differs = (f.src ?? 0) !== (f.tp ?? 0);
              return (
                <tr key={f.label} className={differs ? "bg-amber-50" : ""}>
                  <td className="py-1.5">{f.label}</td>
                  <td className="py-1.5 text-right font-mono text-xs">
                    {f.src ?? "–"} {f.src ? f.unit : ""}
                  </td>
                  <td className="py-1.5 text-right font-mono text-xs">
                    {f.tp ?? "–"} {f.tp ? f.unit : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {hasDiff && (
          <div className="flex gap-2">
            <button
              onClick={() => onResolve(item.sourceId, "update-tp")}
              className="flex-1 px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
            >
              Use {providerName} values
            </button>
            {supportsWrite && (
              <button
                onClick={() => onResolve(item.sourceId, "update-source")}
                className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition"
              >
                Use Truck Packer values
              </button>
            )}
            <button
              onClick={onClose}
              className="px-3 py-2 text-sm text-gray-500 hover:text-gray-900 transition"
            >
              Skip
            </button>
          </div>
        )}
        {!hasDiff && (
          <p className="text-sm text-green-600">Values are in sync.</p>
        )}
      </div>
    </div>
  );
}

function InventoryBrowser() {
  const [items, setItems] = useState<SyncedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [folderFilter, setFolderFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [diffItem, setDiffItem] = useState<SyncedItem | null>(null);
  const [providerName, setProviderName] = useState("Source");
  const [supportsWrite, setSupportsWrite] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<SyncResponse>("/api/inventory-sync");
      setItems(data.items);
      const pId = data.providerId;
      setProviderName(pId === "currentrms" ? "Current RMS" : "Rentman");
      setSupportsWrite(pId === "currentrms");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const folders = useMemo(() => {
    const set = new Set(items.map((i) => i.category));
    return [...set].sort();
  }, [items]);

  const filtered = useMemo(() => {
    let result = items;
    if (folderFilter !== "all") {
      result = result.filter((i) => i.category === folderFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (i) => i.name.toLowerCase().includes(q) || (i.code?.toLowerCase().includes(q) ?? false)
      );
    }
    return result;
  }, [items, search, folderFilter]);

  const counts = useMemo(() => {
    const c = { synced: 0, conflict: 0, unlinked: 0, total: filtered.length };
    for (const i of filtered) {
      if (i.syncStatus === "synced") c.synced++;
      else if (i.syncStatus === "conflict" || i.syncStatus === "source-changed" || i.syncStatus === "tp-changed") c.conflict++;
      else c.unlinked++;
    }
    return c;
  }, [filtered]);

  function toggleAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((i) => i.sourceId)));
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function syncSelected() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const actions = filtered
        .filter((i) => selected.has(i.sourceId))
        .map((i) => ({
          sourceId: i.sourceId,
          action: i.syncStatus === "unlinked" ? "create" as const : "update-tp" as const,
        }));
      const res = await api<{ created: number; updated: number; total: number }>(
        "/api/inventory-sync",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: actions }),
        }
      );
      setSyncMsg(`Done: ${res.created} created, ${res.updated} updated`);
      setSelected(new Set());
      await loadData();
    } catch (e: unknown) {
      setSyncMsg(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function resolveConflict(sourceId: string, action: "update-tp" | "update-source") {
    setDiffItem(null);
    try {
      await api("/api/inventory-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ sourceId, action }] }),
      });
      await loadData();
    } catch (e: unknown) {
      setSyncMsg(e instanceof Error ? e.message : "Resolution failed");
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
        <p className="font-medium">Failed to load inventory</p>
        <p className="text-sm mt-1">{error}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Inventory</h1>
          <p className="text-gray-500 mt-1">
            {items.length} items from {providerName} — synced with Truck Packer cases
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadData}
            disabled={loading}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition"
          >
            Check for Changes
          </button>
          <button
            onClick={syncSelected}
            disabled={syncing || selected.size === 0}
            className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-gray-300 transition"
          >
            {syncing ? "Syncing…" : `Sync ${selected.size} selected`}
          </button>
        </div>
      </div>

      {syncMsg && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4 text-sm text-green-700">
          {syncMsg}
        </div>
      )}

      {/* Stats */}
      <div className="flex gap-4 text-sm mb-4 flex-wrap">
        <span className="text-green-600">{counts.synced} synced</span>
        <span className="text-red-600">{counts.conflict} with changes</span>
        <span className="text-gray-400">{counts.unlinked} not synced</span>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <input
          type="text"
          placeholder="Search by name or code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm flex-1 min-w-[200px] focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
        <select
          value={folderFilter}
          onChange={(e) => setFolderFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="all">All categories ({items.length})</option>
          {folders.map((f) => (
            <option key={f} value={f}>
              {f} ({items.filter((i) => i.category === f).length})
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  checked={selected.size === filtered.length && filtered.length > 0}
                  onChange={toggleAll}
                  className="rounded border-gray-300 text-indigo-600"
                />
              </th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">Status</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">Name</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">Code</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">Category</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">Dimensions</th>
              <th className="text-right px-3 py-2 font-medium text-gray-600">Weight</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr
                key={item.sourceId}
                className={`border-b border-gray-100 last:border-0 hover:bg-gray-50 transition ${
                  !item.isPhysical ? "opacity-40" : ""
                }`}
              >
                <td className="px-3 py-2.5 text-center">
                  <input
                    type="checkbox"
                    checked={selected.has(item.sourceId)}
                    onChange={() => toggle(item.sourceId)}
                    className="rounded border-gray-300 text-indigo-600"
                  />
                </td>
                <td className="px-3 py-2.5">
                  <StatusBadge
                    status={item.syncStatus}
                    onClick={
                      item.syncStatus !== "unlinked" && item.syncStatus !== "synced"
                        ? () => setDiffItem(item)
                        : item.syncStatus === "synced"
                          ? () => setDiffItem(item)
                          : undefined
                    }
                  />
                </td>
                <td className="px-3 py-2.5 font-medium">{item.name}</td>
                <td className="px-3 py-2.5 text-gray-400 font-mono text-xs">{item.code ?? "–"}</td>
                <td className="px-3 py-2.5 text-gray-500 text-xs">{item.category}</td>
                <td className="px-3 py-2.5 text-gray-500">
                  {item.sourceValues.length && item.sourceValues.width && item.sourceValues.height
                    ? `${item.sourceValues.length} × ${item.sourceValues.width} × ${item.sourceValues.height} cm`
                    : "–"}
                </td>
                <td className="px-3 py-2.5 text-right text-gray-500">
                  {item.sourceValues.weight ? `${item.sourceValues.weight} kg` : "–"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Diff popover */}
      {diffItem && (
        <DiffPopover
          item={diffItem}
          providerName={providerName}
          supportsWrite={supportsWrite}
          onResolve={resolveConflict}
          onClose={() => setDiffItem(null)}
        />
      )}
    </div>
  );
}

export default function Page() {
  return (
    <SetupGuard>
      <InventoryBrowser />
    </SetupGuard>
  );
}
