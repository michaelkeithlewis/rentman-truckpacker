import { NextResponse } from "next/server";
import * as log from "@/lib/logger";
import {
  listCases,
  listCaseCategories,
  listPacks,
  updateCase,
  getPackEntities,
  batchDeleteEntities,
} from "@/lib/truckpacker";
import {
  getEquipment as rmGetEquipment,
  getProject as rmGetProject,
  listFolders,
} from "@/lib/rentman";
import { parseStamp } from "@/lib/providers";
import { syncOneProject } from "@/lib/incremental-sync";
import crypto from "crypto";

const CM_TO_M = 0.01;
const FALLBACK = 0.3;

const RELEVANT_ITEM_TYPES = new Set([
  "Project",
  "ProjectEquipment",
  "ProjectEquipmentGroup",
  "ProjectVehicle",
  "ProjectFunction",
  "Equipment",
]);

interface WebhookPayload {
  account: string;
  user: { itemType: string; id: number; ref: string } | null;
  eventType: "create" | "update" | "delete";
  itemType: string;
  items: Array<{
    id: number;
    ref: string;
    parent?: { id: number; itemType: string; ref: string } | null;
  }> | number[];
  eventDate: string;
}

function getTokens() {
  return {
    rmToken: process.env.RENTMAN_API_TOKEN ?? "",
    tpKey: process.env.TRUCKPACKER_API_KEY ?? "",
  };
}

function verifySignature(body: string, digest: string | null, secret: string): boolean {
  if (!digest || !secret) return true;
  const parts = digest.split("=");
  if (parts.length !== 2) return false;
  const [algo, hash] = parts;
  const computed = crypto.createHmac(algo, secret).update(body).digest("hex");
  return computed === hash;
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const digest = req.headers.get("digest");
  const webhookSecret = process.env.RENTMAN_WEBHOOK_SECRET ?? "";

  if (webhookSecret && !verifySignature(rawBody, digest, webhookSecret)) {
    log.warn("webhook", "Invalid webhook signature — rejecting");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    log.error("webhook", "Invalid JSON in webhook body");
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  log.info("webhook", `Received: ${payload.eventType} ${payload.itemType}`, {
    account: payload.account,
    itemCount: Array.isArray(payload.items) ? payload.items.length : 0,
  });

  if (!RELEVANT_ITEM_TYPES.has(payload.itemType)) {
    return NextResponse.json({ status: "ignored" });
  }

  const { rmToken, tpKey } = getTokens();
  if (!rmToken || !tpKey) {
    log.error("webhook", "Missing API tokens");
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  try {
    if (payload.itemType === "Equipment") {
      await handleEquipmentChange(payload, rmToken, tpKey);
    } else {
      // Extract the specific project ID and sync ONLY that project
      await handleProjectChange(payload, rmToken, tpKey);
    }
    return NextResponse.json({ status: "processed" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    log.error("webhook", `Processing failed: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * Equipment dimensions changed → update matching TP case.
 */
async function handleEquipmentChange(
  payload: WebhookPayload,
  rmToken: string,
  tpKey: string
) {
  if (payload.eventType === "delete") return;

  const cases = await listCases(tpKey);

  for (const item of payload.items) {
    if (typeof item === "number") continue;
    const equipId = item.id;

    const tpCase = cases.find((c) => {
      const stamp = parseStamp(c.description);
      return stamp?.providerId === "rentman" && stamp.sourceId === String(equipId);
    });

    if (!tpCase) continue;

    const equip = await rmGetEquipment(equipId, rmToken);
    const l = equip.length ?? 0, w = equip.width ?? 0, h = equip.height ?? 0;
    const hasDims = l > 0 && w > 0 && h > 0;

    await updateCase(
      tpCase._id,
      {
        name: equip.displayname ?? equip.name,
        dx: hasDims ? l * CM_TO_M : FALLBACK,
        dy: hasDims ? w * CM_TO_M : FALLBACK,
        dz: hasDims ? h * CM_TO_M : FALLBACK,
        weight: equip.weight ?? undefined,
      },
      tpKey
    );

    log.info("webhook", `Updated TP case "${tpCase.name}" from equipment #${equipId}`);
  }
}

/**
 * Project/ProjectEquipment/ProjectVehicle changed → sync ONLY that project.
 */
async function handleProjectChange(
  payload: WebhookPayload,
  rmToken: string,
  tpKey: string
) {
  // Extract the project ID from the webhook payload.
  // Rentman's hierarchy: Project → Subproject → EquipmentGroup → Equipment
  // The parent ref might be the equipment GROUP, not the project itself.
  // We need to walk up until we find itemType "Project" or "Subproject".
  let projectId: number | null = null;

  if (payload.itemType === "Project") {
    if (payload.eventType === "delete") {
      log.info("webhook", "Project deleted — no action");
      return;
    }
    const first = payload.items[0];
    projectId = typeof first === "number" ? first : first?.id ?? null;
  } else {
    const first = payload.items[0];
    if (typeof first === "number") {
      if (payload.eventType === "delete") {
        await handleDeleteEvent(payload, rmToken, tpKey);
        return;
      }
      // Non-delete with a bare number — can't resolve
      return;
    }

    if (first?.parent) {
      if (first.parent.itemType === "Project") {
        // Direct parent is the project
        projectId = first.parent.id;
      } else if (first.parent.itemType === "Subproject") {
        // Parent is a subproject — resolve to its project via API
        try {
          const sub = await import("@/lib/rentman").then(m =>
            m.rentmanGet<{ project: string }>(`/subprojects/${first.parent!.id}`, rmToken)
          );
          const match = sub.project.match(/\/projects\/(\d+)/);
          if (match) projectId = parseInt(match[1], 10);
        } catch {
          log.warn("webhook", `Could not resolve subproject #${first.parent.id} to project`);
        }
      } else {
        // Parent is something else (EquipmentGroup, Function, etc.)
        // Try fetching the parent to find ITS parent (the project/subproject)
        try {
          const parentRef = first.parent.ref;
          const parentData = await import("@/lib/rentman").then(m =>
            m.rentmanGet<{ project?: string; parent?: { id: number; itemType: string } }>(parentRef, rmToken)
          );
          if (parentData.project) {
            const match = parentData.project.match(/\/projects\/(\d+)/);
            if (match) projectId = parseInt(match[1], 10);
          }
        } catch {
          log.warn("webhook", `Could not resolve parent ${first.parent.ref} to project`);
        }
      }
    }
  }

  if (!projectId) {
    log.warn("webhook", `Could not determine project ID from ${payload.itemType} ${payload.eventType} — will be picked up by next auto-sync`);
    return;
  }

  log.info("webhook", `Syncing single project #${projectId}`);

  // Fetch just what we need for this one project
  const [project, folders, allPacks, existingCats] = await Promise.all([
    rmGetProject(projectId, rmToken),
    listFolders(rmToken),
    listPacks(tpKey),
    listCaseCategories(tpKey),
  ]);

  const folderMap = new Map<number, string>();
  for (const f of folders) folderMap.set(f.id, f.path ?? f.name);

  const catMap = new Map<string, string>();
  for (const c of existingCats) catMap.set(c.name.trim().toLowerCase(), c._id);
  const colorIdx = { i: existingCats.length };

  const result = await syncOneProject(
    project, allPacks, folderMap, catMap, colorIdx, rmToken, tpKey
  );

  if (result) {
    log.info("webhook", `Project #${projectId} synced: +${result.added} -${result.removed} =${result.unchanged}`);
  } else {
    log.info("webhook", `Project #${projectId} skipped (not confirmed or no equipment)`);
  }
}

/**
 * Handle delete events by running an incremental sync on all confirmed projects.
 * Delete payloads only contain ProjectEquipment/ProjectVehicle IDs (not Equipment
 * or Vehicle IDs), so we can't match entities directly. Instead, the incremental
 * sync detects what's missing from each Rentman project and removes it from TP.
 */
async function handleDeleteEvent(
  payload: WebhookPayload,
  rmToken: string,
  tpKey: string
) {
  const ids = (payload.items as number[]).join(", ");
  log.info("webhook", `Delete ${payload.itemType} #${ids} — running incremental sync on all projects`);

  const { listProjects, listFolders } = await import("@/lib/rentman");

  const [projects, folders, allPacks, existingCats] = await Promise.all([
    listProjects(100, rmToken),
    listFolders(rmToken),
    listPacks(tpKey),
    listCaseCategories(tpKey),
  ]);

  const folderMap = new Map<number, string>();
  for (const f of folders) folderMap.set(f.id, f.path ?? f.name);

  const catMap = new Map<string, string>();
  for (const c of existingCats) catMap.set(c.name.trim().toLowerCase(), c._id);
  const colorIdx = { i: existingCats.length };

  // Only sync projects that HAVE packs (don't create new ones on a delete event)
  const packProjects = new Set(
    allPacks
      .filter(p => p.name?.startsWith("[RM:"))
      .map(p => p.name?.match(/\[RM:(\d+)\]/)?.[1])
      .filter(Boolean)
  );

  let synced = 0;
  for (const project of projects) {
    if (!packProjects.has(String(project.id))) continue;
    try {
      const result = await syncOneProject(
        project, allPacks, folderMap, catMap, colorIdx, rmToken, tpKey
      );
      if (result && (result.removed > 0 || result.added > 0)) {
        log.info("webhook", `Delete sync: "${project.name}" +${result.added} -${result.removed}`);
      }
      synced++;
    } catch (e) {
      log.error("webhook", `Delete sync failed for "${project.name}": ${e instanceof Error ? e.message : e}`);
    }
  }

  log.info("webhook", `Delete sync complete: checked ${synced} projects`);
}
