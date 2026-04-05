/**
 * Simple in-process lock to prevent concurrent full syncs from racing.
 */

const globalKey = Symbol.for("app.syncLock");
const g = globalThis as unknown as Record<symbol, boolean>;

export function isSyncing(): boolean {
  return g[globalKey] === true;
}

export function acquireLock(): boolean {
  if (g[globalKey]) return false;
  g[globalKey] = true;
  return true;
}

export function releaseLock(): void {
  g[globalKey] = false;
}
