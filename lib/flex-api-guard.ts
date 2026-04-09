/**
 * Flex has a hard daily cap (e.g. 10,000 requests). When we hit 429 with that message,
 * pause auto-sync until UTC midnight so we don't burn the next day's quota immediately.
 */

import * as log from "@/lib/logger";

const PAUSE_UNTIL = Symbol.for("rentman-truckpacker.flexDailyPauseUntilMs");

function slot(): Record<symbol, number | undefined> {
  return globalThis as unknown as Record<symbol, number | undefined>;
}

export function isFlexDailyQuotaPaused(): boolean {
  const until = slot()[PAUSE_UNTIL];
  if (typeof until !== "number") return false;
  if (Date.now() >= until) {
    delete slot()[PAUSE_UNTIL];
    return false;
  }
  return true;
}

export function pauseFlexUntilNextUtcDay(reason: string): void {
  const now = new Date();
  const nextUtcMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
    0
  );
  slot()[PAUSE_UNTIL] = nextUtcMidnight;
  const resume = new Date(nextUtcMidnight).toISOString();
  log.warn("flex-api", `${reason} — Flex auto-sync paused until ${resume} UTC`);
}

export function flexDailyQuotaResumeAt(): string | null {
  const until = slot()[PAUSE_UNTIL];
  if (typeof until !== "number" || Date.now() >= until) return null;
  return new Date(until).toISOString();
}

/** True when Flex returned 429 and body mentions the daily / 10k cap. */
export function isFlexDailyQuota429Error(message: string): boolean {
  if (!message.includes("429")) return false;
  const m = message.toLowerCase();
  return (
    m.includes("10,000") ||
    m.includes("10000") ||
    m.includes("for today") ||
    m.includes("maximum api request limit")
  );
}
