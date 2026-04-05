"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";

interface LogEntry {
  ts: string;
  level: "info" | "warn" | "error" | "debug";
  source: string;
  message: string;
  data?: Record<string, unknown>;
  durationMs?: number;
}

const LEVEL_STYLE: Record<string, { text: string; bg: string }> = {
  info: { text: "text-blue-700", bg: "bg-blue-50" },
  warn: { text: "text-amber-700", bg: "bg-amber-50" },
  error: { text: "text-red-700", bg: "bg-red-50" },
  debug: { text: "text-gray-500", bg: "bg-gray-50" },
};

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [autoRefresh, setAutoRefresh] = useState(true);

  const loadLogs = useCallback(async () => {
    try {
      const level = filter === "all" ? "" : `&level=${filter}`;
      const data = await api<LogEntry[]>(`/api/logs?limit=200${level}`);
      setLogs(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadLogs();
    if (!autoRefresh) return;
    const id = setInterval(loadLogs, 3000);
    return () => clearInterval(id);
  }, [loadLogs, autoRefresh]);

  async function clearAll() {
    await api("/api/logs", { method: "DELETE" });
    setLogs([]);
  }

  function formatTime(ts: string) {
    return new Date(ts).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Activity Log</h1>
          <p className="text-gray-500 mt-1">
            {logs.length} recent events — {autoRefresh ? "auto-refreshing every 3s" : "paused"}
          </p>
        </div>
        <div className="flex gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
          >
            <option value="all">All levels</option>
            <option value="info">Info</option>
            <option value="warn">Warnings</option>
            <option value="error">Errors</option>
            <option value="debug">Debug</option>
          </select>
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-4 py-2 text-sm border rounded-lg transition ${
              autoRefresh
                ? "border-green-300 bg-green-50 text-green-700"
                : "border-gray-300 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {autoRefresh ? "Live" : "Paused"}
          </button>
          <button
            onClick={clearAll}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600 transition"
          >
            Clear
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-indigo-600 border-t-transparent" />
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg mb-1">No log entries yet</p>
          <p className="text-sm">Activity will appear here as the system processes syncs and webhooks</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm font-mono">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-xs">
                <th className="text-left px-3 py-2 font-medium text-gray-500 w-20">Time</th>
                <th className="text-left px-3 py-2 font-medium text-gray-500 w-16">Level</th>
                <th className="text-left px-3 py-2 font-medium text-gray-500 w-32">Source</th>
                <th className="text-left px-3 py-2 font-medium text-gray-500">Message</th>
                <th className="text-right px-3 py-2 font-medium text-gray-500 w-16">ms</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((entry, i) => {
                const style = LEVEL_STYLE[entry.level] ?? LEVEL_STYLE.info;
                return (
                  <tr
                    key={`${entry.ts}-${i}`}
                    className={`border-b border-gray-100 last:border-0 ${style.bg}`}
                  >
                    <td className="px-3 py-1.5 text-gray-400 text-xs whitespace-nowrap">
                      {formatTime(entry.ts)}
                    </td>
                    <td className={`px-3 py-1.5 text-xs font-semibold uppercase ${style.text}`}>
                      {entry.level}
                    </td>
                    <td className="px-3 py-1.5 text-gray-500 text-xs">{entry.source}</td>
                    <td className="px-3 py-1.5 text-gray-900 text-xs">
                      {entry.message}
                      {entry.data && (
                        <span className="text-gray-400 ml-2">
                          {JSON.stringify(entry.data).slice(0, 120)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right text-gray-400 text-xs">
                      {entry.durationMs ?? ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
