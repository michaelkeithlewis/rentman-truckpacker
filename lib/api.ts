"use client";

// ── Token helpers ──

export type ProviderId = "rentman" | "currentrms" | "flex";

export function getActiveProvider(): ProviderId {
  if (typeof window === "undefined") return "rentman";
  return (localStorage.getItem("active_provider") as ProviderId) ?? "rentman";
}

export function setActiveProvider(id: ProviderId) {
  if (typeof window !== "undefined") localStorage.setItem("active_provider", id);
}

export function getTokens() {
  if (typeof window === "undefined") return { rentman: "", currentrms: "", flex: "", truckpacker: "" };
  return {
    rentman: localStorage.getItem("rentman_token") ?? "",
    currentrms: localStorage.getItem("currentrms_token") ?? "",
    flex: localStorage.getItem("flex_token") ?? "",
    truckpacker: localStorage.getItem("truckpacker_key") ?? "",
  };
}

export function hasTokens() {
  const tokens = getTokens();
  const provider = getActiveProvider();
  const sourceToken = provider === "currentrms" ? tokens.currentrms : tokens.rentman;
  return Boolean(sourceToken && tokens.truckpacker);
}

function tokenHeaders(): Record<string, string> {
  const { rentman, currentrms, flex, truckpacker } = getTokens();
  const h: Record<string, string> = {};
  h["x-active-provider"] = getActiveProvider();
  if (rentman) h["x-rentman-token"] = rentman;
  if (currentrms) h["x-currentrms-token"] = currentrms;
  if (flex) h["x-flex-token"] = flex;
  if (truckpacker) h["x-truckpacker-key"] = truckpacker;
  return h;
}

// ── Fetch wrapper ──

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { ...tokenHeaders(), ...init?.headers },
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(json.error ?? `API ${res.status}`);
  }
  return json as T;
}

// ── Session cache ──
// Caches Rentman data per-session so navigating between pages is instant.

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  data: T;
  ts: number;
}

export function cacheGet<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(`cache:${key}`);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    if (Date.now() - entry.ts > CACHE_TTL) {
      sessionStorage.removeItem(`cache:${key}`);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

export function cacheSet<T>(key: string, data: T) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      `cache:${key}`,
      JSON.stringify({ data, ts: Date.now() } satisfies CacheEntry<T>)
    );
  } catch {
    // sessionStorage full or unavailable
  }
}

/**
 * Fetch with session cache. Returns cached data immediately if available,
 * otherwise fetches and caches.
 */
export async function cachedApi<T>(
  cacheKey: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const cached = cacheGet<T>(cacheKey);
  if (cached) return cached;
  const data = await api<T>(path, init);
  cacheSet(cacheKey, data);
  return data;
}
