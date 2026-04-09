import type { Pack } from "@/lib/truckpacker";
import type { ProviderId, ProviderEquipment } from "@/lib/providers/types";

/** Bracket code in Truck Packer names (pack + case entities). */
export const SOURCE_TAG_BY_PROVIDER: Record<ProviderId, string> = {
  rentman: "RM",
  flex: "FLX",
  currentrms: "CRM",
};

const KNOWN_CODES = "RM|FLX|CRM";

/** Safe token for stamps (job #, etc.). */
export function sanitizeJobKey(displayNumber: string): string {
  return displayNumber.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 24);
}

/**
 * Human-facing job ref for pack titles when display # is missing.
 */
export function effectiveJobKey(displayNumber: string, technicalSourceId: string): string {
  const s = sanitizeJobKey(displayNumber);
  if (s.length > 0) return s;
  return technicalSourceId.replace(/-/g, "").slice(0, 10).toUpperCase();
}

/** Pack match stamp, e.g. [FLX:4683] or [RM:196] — uses job / display #, not long API ids. */
export function packStampBracket(providerId: ProviderId, jobKey: string): string {
  const code = SOURCE_TAG_BY_PROVIDER[providerId];
  return `[${code}:${sanitizeJobKey(jobKey)}]`;
}

export function rentmanVehicleBracket(vehicleId: number): string {
  return `[RM:V${vehicleId}]`;
}

/** Rentman case line — equipment id alone stays short and globally unique. */
export function rentmanEquipmentBracket(equipId: number | string): string {
  return `[RM:${equipId}]`;
}

/**
 * Flex / CurrentRMS case line: job # + short local id (barcode or tail of UUID).
 */
export function humanEquipmentBracket(
  providerId: "flex" | "currentrms",
  jobKey: string,
  localEquipmentId: string
): string {
  const code = SOURCE_TAG_BY_PROVIDER[providerId];
  const j = sanitizeJobKey(jobKey);
  const loc = sanitizeJobKey(localEquipmentId).slice(0, 16);
  return `[${code}:${j}-${loc}]`;
}

const UUID_IN_BRACKET = new RegExp(
  `\\[(?:${KNOWN_CODES}):([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\\]$`
);

const HUMAN_EQUIP_FLX_CRM = new RegExp(
  `\\[(FLX|CRM):([a-zA-Z0-9._-]+)-([a-zA-Z0-9._-]+)\\]$`
);

const RENTMAN_EQUIP_AT_END = /\[RM:(\d+)\]$/;

export function isProviderManagedEntity(name: string): boolean {
  if (name.startsWith("SYNC LOG") || name.startsWith("SYNC:")) return true;
  if (/\[(?:RM|FLX|CRM):V\d+\]/.test(name)) return true;
  if (UUID_IN_BRACKET.test(name)) return true;
  if (HUMAN_EQUIP_FLX_CRM.test(name)) return true;
  if (RENTMAN_EQUIP_AT_END.test(name)) return true;
  return false;
}

/**
 * Assigns a short per-row local id for stamping (barcode preferred; collision-safe).
 */
export function buildEquipmentLocalIdMap(
  equips: Iterable<ProviderEquipment>
): Map<string, string> {
  const list = [...equips].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  const result = new Map<string, string>();
  const used = new Set<string>();

  function baseLocal(eq: ProviderEquipment): string {
    const c = (eq.code ?? "").replace(/[^a-zA-Z0-9]/g, "");
    if (c.length >= 4) return c.slice(0, 14).toUpperCase();
    return eq.sourceId.replace(/-/g, "").slice(-10).toUpperCase();
  }

  for (const eq of list) {
    let local = baseLocal(eq);
    if (used.has(local)) {
      const extra = eq.sourceId.replace(/-/g, "").slice(0, 6).toUpperCase();
      local = `${local.slice(0, 8)}${extra}`.slice(0, 16);
    }
    while (used.has(local)) {
      local = (local + "X").slice(0, 16);
    }
    used.add(local);
    result.set(eq.sourceId, local);
  }
  return result;
}

/**
 * Map entity name → equipment sourceId for diffing. `localIdBySourceId` from buildEquipmentLocalIdMap.
 */
export function resolveCaseEntityToSourceId(
  name: string,
  providerId: ProviderId,
  jobKey: string,
  localIdBySourceId: Map<string, string>
): string | null {
  if (/\[(?:RM|FLX|CRM):V\d+\]/.test(name)) return null;

  if (providerId === "rentman") {
    const m = name.match(RENTMAN_EQUIP_AT_END);
    return m ? m[1] : null;
  }

  const j = sanitizeJobKey(jobKey);

  const hum = name.match(HUMAN_EQUIP_FLX_CRM);
  if (hum && (hum[1] === "FLX" || hum[1] === "CRM")) {
    const jobPart = sanitizeJobKey(hum[2]);
    const locPart = hum[3].toUpperCase();
    if (jobPart !== j) return null;
    for (const [sid, loc] of localIdBySourceId.entries()) {
      if (loc.toUpperCase() === locPart) return sid;
    }
    return null;
  }

  const u = name.match(UUID_IN_BRACKET);
  if (u && (providerId === "flex" || providerId === "currentrms")) {
    return u[1];
  }

  // Mistaken [RM:uuid] on Flex equipment
  if (providerId === "flex" || providerId === "currentrms") {
    const m = name.match(/\[RM:([0-9a-fA-F-]{36})\]$/i);
    if (m) return m[1];
  }

  return null;
}

/**
 * Find pack: prefer human job stamp, then legacy technical ids (uuid / Rentman API id).
 */
export function findPackForProject(
  packs: Pack[],
  providerId: ProviderId,
  jobKey: string,
  technicalSourceIds: string[]
): Pack | undefined {
  const primary = packStampBracket(providerId, jobKey);
  let p = packs.find((x) => x.name?.includes(primary));
  if (p) return p;

  const code = SOURCE_TAG_BY_PROVIDER[providerId];
  for (const tid of technicalSourceIds) {
    if (!tid) continue;
    const needle = `[${code}:${tid}]`;
    const hit = packs.find((x) => x.name?.includes(needle));
    if (hit) return hit;
  }

  if (providerId === "flex" || providerId === "currentrms") {
    for (const tid of technicalSourceIds) {
      if (!tid) continue;
      const legacyRm = `[RM:${tid}]`;
      const hit = packs.find((x) => x.name?.includes(legacyRm));
      if (hit) return hit;
    }
  }

  return undefined;
}

/** `#4683 Name [FLX:4683]` — stamp uses job # only. */
export function formatPackDisplayName(
  providerId: ProviderId,
  displayNumber: string,
  projectName: string,
  jobKey: string
): string {
  const stamp = packStampBracket(providerId, jobKey);
  return `#${displayNumber} ${projectName.trim()} ${stamp}`;
}

/** True if the pack title still uses a legacy technical id / wrong provider code and should be renamed. */
export function packNeedsCanonicalRename(
  name: string | undefined,
  providerId: ProviderId,
  jobKey: string,
  technicalSourceIds: string[],
  canonical: string
): boolean {
  if (!name || name === canonical) return false;
  const j = sanitizeJobKey(jobKey);
  const stamp = packStampBracket(providerId, j);
  if (name.includes(stamp)) return false;

  const code = SOURCE_TAG_BY_PROVIDER[providerId];
  if (
    technicalSourceIds.some(
      (tid) => tid && sanitizeJobKey(tid) !== j && name.includes(`[${code}:${tid}]`)
    )
  ) {
    return true;
  }
  if (
    (providerId === "flex" || providerId === "currentrms") &&
    technicalSourceIds[0] &&
    name.includes(`[RM:${technicalSourceIds[0]}]`)
  ) {
    return true;
  }
  return false;
}
