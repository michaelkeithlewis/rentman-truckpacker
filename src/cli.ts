import { validateConfig } from "./config.js";
import * as rentman from "./rentman-client.js";
import * as tp from "./truckpacker-client.js";
import { syncProject, previewSync } from "./sync.js";

const HELP = `
╔══════════════════════════════════════════════════╗
║   Rentman → Truck Packer Sync Tool               ║
╚══════════════════════════════════════════════════╝

Usage:
  npm run list-projects          List recent Rentman projects
  npm run preview -- <projectId> Preview what would sync (dry run)
  npm run sync -- <projectId>    Sync a project into Truck Packer
  npm run list-cases             List existing Truck Packer cases

Examples:
  npm run list-projects
  npm run preview -- 12345
  npm run sync -- 12345
`;

async function main() {
  const command = process.argv[2];

  if (!command || command === "help" || command === "--help") {
    console.log(HELP);
    process.exit(0);
  }

  validateConfig();

  switch (command) {
    case "list-projects": {
      console.log("\nFetching recent Rentman projects...\n");
      const projects = await rentman.listProjects(20);
      if (projects.length === 0) {
        console.log("  No projects found.");
        break;
      }
      const maxName = Math.max(...projects.map((p) => (p.displayname ?? p.name).length));
      console.log(
        "  " +
          "ID".padEnd(8) +
          "Name".padEnd(maxName + 2) +
          "Period"
      );
      console.log("  " + "─".repeat(8 + maxName + 2 + 30));
      for (const p of projects) {
        const name = p.displayname ?? p.name;
        const start = p.usageperiod_start
          ? new Date(p.usageperiod_start).toLocaleDateString()
          : "–";
        const end = p.usageperiod_end
          ? new Date(p.usageperiod_end).toLocaleDateString()
          : "–";
        console.log(
          "  " +
            String(p.id).padEnd(8) +
            name.padEnd(maxName + 2) +
            `${start} → ${end}`
        );
      }
      console.log();
      console.log(`  Run: npm run sync -- <ID>  to sync a project\n`);
      break;
    }

    case "preview": {
      const projectId = parseInt(process.argv[3], 10);
      if (!projectId) {
        console.error("Usage: npm run preview -- <projectId>");
        process.exit(1);
      }
      console.log(`\nPreviewing sync for project ${projectId}...\n`);
      const items = await previewSync(projectId);
      if (items.length === 0) {
        console.log("  No equipment found for this project.");
        break;
      }
      let totalEntities = 0;
      let virtualCount = 0;
      for (const item of items) {
        if (item.isVirtual) {
          console.log(`  ${item.name} x${item.quantity} — VIRTUAL (will be skipped)`);
          virtualCount++;
          continue;
        }
        const dimStr = `${item.dx.toFixed(2)} x ${item.dy.toFixed(2)} x ${item.dz.toFixed(2)} m`;
        const weightStr = item.weight ? ` (${item.weight} kg)` : "";
        const dimNote = item.hasDimensions ? "" : " [no dims → 0.3m fallback]";
        console.log(`  ${item.name} x${item.quantity}`);
        console.log(`    Size: ${dimStr}${weightStr}${dimNote}`);
        console.log(`    Category: ${item.category}`);
        totalEntities += item.quantity;
      }
      const physical = items.length - virtualCount;
      console.log(`\n  Physical items: ${physical} (${totalEntities} entities)`);
      if (virtualCount > 0) console.log(`  Virtual packages skipped: ${virtualCount}`);
      console.log(`\n  Ready? Run: npm run sync -- ${projectId}\n`);
      break;
    }

    case "sync": {
      const projectId = parseInt(process.argv[3], 10);
      if (!projectId) {
        console.error("Usage: npm run sync -- <projectId>");
        process.exit(1);
      }
      console.log(`\nSyncing Rentman project ${projectId} → Truck Packer...\n`);
      const result = await syncProject(projectId);
      console.log(`Open your pack: ${result.packUrl}\n`);
      break;
    }

    case "list-cases": {
      console.log("\nFetching Truck Packer cases...\n");
      const cases = await tp.listCases();
      if (cases.length === 0) {
        console.log("  No cases found.");
        break;
      }
      for (const c of cases) {
        console.log(
          `  ${c.name} — ${c.dx}x${c.dy}x${c.dz} m` +
            (c.weight ? ` (${c.weight} kg)` : "")
        );
      }
      console.log(`\n  Total: ${cases.length} cases\n`);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("\nError:", err.message ?? err);
  process.exit(1);
});
