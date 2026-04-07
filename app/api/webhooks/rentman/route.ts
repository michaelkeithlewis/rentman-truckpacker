import { NextResponse } from "next/server";
import * as log from "@/lib/logger";
import {
  listCases,
  listCaseCategories,
  listPacks,
  updateCase,
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
  // Extract the project ID from the webhook payload
  let projectId: number | null = null;

  if (payload.itemType === "Project") {
    if (payload.eventType === "delete") {
      log.info("webhook", "Project deleted — no action");
      return;
    }
    const first = payload.items[0];
    projectId = typeof first === "number" ? first : first?.id ?? null;
  } else {
    // ProjectEquipment, ProjectEquipmentGroup, ProjectVehicle, ProjectFunction
    // → get project from parent
    const first = payload.items[0];
    if (typeof first !== "number" && first?.parent) {
      projectId = first.parent.id;
    }
  }

  if (!projectId) {
    log.warn("webhook", "Could not determine project ID from payload");
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
