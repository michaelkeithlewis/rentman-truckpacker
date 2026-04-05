/**
 * Simulates Rentman webhook events against the local server.
 *
 * Usage:
 *   npx tsx src/test-webhook.ts equipment-update 343
 *   npx tsx src/test-webhook.ts project-equipment-added 209
 *   npx tsx src/test-webhook.ts project-created 209
 *   npx tsx src/test-webhook.ts full-flow 209
 */

const BASE = "http://localhost:3456";

async function sendWebhook(payload: Record<string, unknown>) {
  console.log(`\n→ Sending: ${payload.eventType} ${payload.itemType}`);
  console.log(`  Items: ${JSON.stringify(payload.items)}`);

  const res = await fetch(`${BASE}/api/webhooks/rentman`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  console.log(`← Response (${res.status}):`, JSON.stringify(data));
  return data;
}

async function showLogs(limit = 5) {
  const res = await fetch(`${BASE}/api/logs?limit=${limit}`);
  const logs: Array<{
    level: string;
    source: string;
    message: string;
    durationMs?: number;
    data?: Record<string, unknown>;
  }> = await res.json();
  console.log(`\n--- Recent logs (${logs.length}) ---`);
  for (const l of logs) {
    const dur = l.durationMs ? ` (${l.durationMs}ms)` : "";
    const data = l.data ? ` ${JSON.stringify(l.data).slice(0, 100)}` : "";
    console.log(`  [${l.level.toUpperCase().padEnd(5)}] ${l.message}${dur}${data}`);
  }
}

const command = process.argv[2];
const id = process.argv[3] ?? "343";

const now = new Date().toISOString();
const base = {
  account: "buckeyproductions",
  user: { itemType: "Crew", id: 33, ref: "/crew/33" },
  eventDate: now,
};

async function main() {
  switch (command) {
    case "equipment-update": {
      console.log(`\nSimulating: Equipment #${id} was updated in Rentman`);
      console.log("Expected: Truck Packer case updated if synced, skipped if not\n");
      await sendWebhook({
        ...base,
        eventType: "update",
        itemType: "Equipment",
        items: [{ id: parseInt(id), ref: `/equipment/${id}`, parent: null }],
      });
      break;
    }

    case "project-equipment-added": {
      console.log(`\nSimulating: Equipment was added to project #${id} in Rentman`);
      console.log("Expected: Truck Packer pack rebuilt for this project\n");
      await sendWebhook({
        ...base,
        eventType: "create",
        itemType: "ProjectEquipment",
        items: [
          {
            id: 999,
            ref: "/projectequipment/999",
            parent: { id: parseInt(id), itemType: "Project", ref: `/projects/${id}` },
          },
        ],
      });
      break;
    }

    case "project-created": {
      console.log(`\nSimulating: Project #${id} was created in Rentman`);
      console.log("Expected: New Truck Packer pack created\n");
      await sendWebhook({
        ...base,
        eventType: "create",
        itemType: "Project",
        items: [{ id: parseInt(id), ref: `/projects/${id}`, parent: null }],
      });
      break;
    }

    case "full-flow": {
      console.log(`\n=== FULL FLOW TEST for project #${id} ===`);
      console.log("Step 1: Project created");
      await sendWebhook({
        ...base,
        eventType: "create",
        itemType: "Project",
        items: [{ id: parseInt(id), ref: `/projects/${id}`, parent: null }],
      });

      console.log("\nStep 2: Equipment added to project");
      await sendWebhook({
        ...base,
        eventType: "create",
        itemType: "ProjectEquipment",
        items: [
          {
            id: 999,
            ref: "/projectequipment/999",
            parent: { id: parseInt(id), itemType: "Project", ref: `/projects/${id}` },
          },
        ],
      });

      console.log("\nStep 3: Equipment dimensions updated");
      await sendWebhook({
        ...base,
        eventType: "update",
        itemType: "Equipment",
        items: [{ id: 343, ref: "/equipment/343", parent: null }],
      });
      break;
    }

    default:
      console.log(`
Webhook Test Tool — simulates Rentman events against your local server.

Usage:
  npx tsx src/test-webhook.ts <command> [id]

Commands:
  equipment-update <equipId>         Equipment was changed in Rentman
  project-equipment-added <projId>   Equipment was added to a project
  project-created <projId>           New project was created
  full-flow <projId>                 Run all 3 in sequence

Examples:
  npx tsx src/test-webhook.ts equipment-update 343
  npx tsx src/test-webhook.ts project-equipment-added 209
  npx tsx src/test-webhook.ts full-flow 209
`);
      process.exit(0);
  }

  await showLogs(10);
}

main().catch((e) => {
  console.error("\nFailed:", e.message ?? e);
  process.exit(1);
});
