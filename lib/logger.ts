export type LogLevel = "info" | "warn" | "error" | "debug";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  source: string;
  message: string;
  data?: Record<string, unknown>;
  durationMs?: number;
}

// In-memory ring buffer. Uses globalThis to survive Next.js hot-reloads in dev.
const MAX_ENTRIES = 500;

const globalKey = Symbol.for("app.logEntries");
const g = globalThis as unknown as Record<symbol, LogEntry[]>;
if (!g[globalKey]) g[globalKey] = [];
const entries: LogEntry[] = g[globalKey];

function push(entry: LogEntry) {
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();

  const tag = `[${entry.ts}] [${entry.level.toUpperCase()}] [${entry.source}]`;
  const msg = `${tag} ${entry.message}`;
  const extra = entry.data ? ` ${JSON.stringify(entry.data)}` : "";
  const dur = entry.durationMs !== undefined ? ` (${entry.durationMs}ms)` : "";

  switch (entry.level) {
    case "error":
      console.error(msg + extra + dur);
      break;
    case "warn":
      console.warn(msg + extra + dur);
      break;
    case "debug":
      if (process.env.NODE_ENV === "development") console.log(msg + extra + dur);
      break;
    default:
      console.log(msg + extra + dur);
  }
}

export function log(
  level: LogLevel,
  source: string,
  message: string,
  data?: Record<string, unknown>
) {
  push({ ts: new Date().toISOString(), level, source, message, data });
}

export function info(source: string, message: string, data?: Record<string, unknown>) {
  log("info", source, message, data);
}

export function warn(source: string, message: string, data?: Record<string, unknown>) {
  log("warn", source, message, data);
}

export function error(source: string, message: string, data?: Record<string, unknown>) {
  log("error", source, message, data);
}

export function debug(source: string, message: string, data?: Record<string, unknown>) {
  log("debug", source, message, data);
}

/**
 * Times an async operation and logs the result.
 */
export async function timed<T>(
  source: string,
  label: string,
  fn: () => Promise<T>,
  data?: Record<string, unknown>
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    const ms = Date.now() - start;
    push({ ts: new Date().toISOString(), level: "info", source, message: `${label} OK`, data, durationMs: ms });
    return result;
  } catch (e) {
    const ms = Date.now() - start;
    const msg = e instanceof Error ? e.message : String(e);
    push({ ts: new Date().toISOString(), level: "error", source, message: `${label} FAILED: ${msg}`, data, durationMs: ms });
    throw e;
  }
}

export function getRecentLogs(limit = 100, level?: LogLevel): LogEntry[] {
  let result = entries.slice(-limit);
  if (level) result = result.filter((e) => e.level === level);
  return result.reverse();
}

export function clearLogs() {
  entries.length = 0;
}
