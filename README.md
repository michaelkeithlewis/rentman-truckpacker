# Rentman → Truck Packer Sync Service

Automatically syncs confirmed projects, equipment, and vehicles from [Rentman](https://rentman.io) (or [Current RMS](https://current-rms.com)) into [Truck Packer](https://truckpacker.com) 3D load plans.

## What It Does

- Pulls confirmed projects from Rentman every 5 minutes
- Creates a Truck Packer pack for each project with all equipment as 3D cases
- Assigns the project's vehicle as a container (if one is assigned with dimensions)
- Adds a sync card to each pack showing project info, status, and sync state
- Incremental sync: only adds/removes items that changed — never touches items you placed manually in Truck Packer
- Items without dimensions are skipped (forces users to add dims in Rentman first)
- New items are placed outside the container so they don't disrupt existing layouts

## Architecture

```
Rentman (source of truth)
  ↕ every 5 min (auto-poll) or instantly (webhook)
This Service (Next.js on Railway/Vercel/local)
  ↕ Truck Packer REST API
Truck Packer (3D load plans)
```

Each Rentman equipment item gets a `[RM:xxx]` tag in its Truck Packer entity name. This is how the sync identifies which items it owns vs. items you added manually. The sync never touches untagged items.

## Deployment: One Instance Per Customer

Yes — each customer gets their own deployment with their own environment variables. The service is stateless (no database), so deployments are lightweight.

### Railway (Recommended)

1. Fork or clone this repo
2. Connect to [Railway](https://railway.app)
3. Set environment variables (see below)
4. Railway auto-deploys on push
5. Optionally configure Rentman webhooks for instant sync (see below)

### Vercel

1. Push to GitHub
2. Import in [Vercel](https://vercel.com)
3. Set environment variables
4. Deploy

### Local / Self-Hosted

```bash
git clone <this-repo>
cd rentman-truckpacker
npm install
cp .env.example .env   # fill in your keys
npm run dev             # http://localhost:3456
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RENTMAN_API_TOKEN` | Yes | Rentman API token. Found in Rentman → Configuration → Extensions → Webshop → "show token" |
| `TRUCKPACKER_API_KEY` | Yes | Truck Packer API key. Generate in Truck Packer → Settings → API Keys (starts with `tp_`) |
| `RENTMAN_WEBHOOK_SECRET` | No | If set, validates webhook signatures from Rentman |

That's it. Two keys and you're running.

## How the Sync Works

### Auto-Polling (Default)

The service polls Rentman every 5 minutes automatically. No setup needed — it starts on boot.

1. Fetches all projects from Rentman
2. Filters to only **Confirmed**, **Prepped**, or **On Location** projects
3. For each project:
   - Checks if a Truck Packer pack exists (matched by `[RM:projectId]` in the pack name)
   - If no pack exists, creates one
   - Compares Rentman equipment list against existing pack entities
   - Adds new items (placed outside the container)
   - Removes items no longer on the project
   - Leaves manually-placed items untouched
   - Updates the sync card with current status

### Webhooks (Instant, Optional)

For instant sync, configure Rentman webhooks:

1. In Rentman, go to **Configuration → Integrations → Webhooks**
2. Set the URL to: `https://your-deployment.railway.app/api/webhooks/rentman`
3. Save

Now any change in Rentman (project created, equipment added/removed, vehicle assigned) triggers an immediate sync.

### Manual Sync

The web GUI at the deployment URL has a **"Sync All to Truck Packer"** button on the dashboard. There's also a per-project sync wizard for fine-grained control.

## Web GUI

The service includes a web interface at the deployment URL:

| Page | URL | Description |
|------|-----|-------------|
| Dashboard | `/` | All Rentman projects with "Sync All" button |
| Project Detail | `/projects/{id}` | Equipment list for a single project |
| Sync Wizard | `/projects/{id}/sync` | Review and configure items before syncing |
| Inventory | `/inventory` | Full Rentman equipment catalog with sync status |
| Activity Log | `/logs` | Real-time log of all sync activity |
| Settings | `/settings` | API keys and provider selection |

### Settings Page

Users can enter their own API keys in the browser (stored in localStorage). This is useful for:
- Testing with different accounts
- Letting non-technical users connect without editing `.env`
- The web GUI works with both localStorage keys and `.env` keys (localStorage takes priority)

## Multi-Provider Support

The service supports multiple rental management systems through a provider abstraction:

- **Rentman** — Read-only (API blocks writes). Equipment and projects sync to Truck Packer.
- **Current RMS** — Read/write. Bidirectional sync: changes in Truck Packer can be pushed back.

Switch providers in the Settings page. The sync logic, stamping, and dedup work identically regardless of provider.

## Entity Tagging Convention

| Entity | Tag Format | Purpose |
|--------|-----------|---------|
| Pack name | `[RM:{apiId}] #{number} {name}` | Dedup: finds existing pack for a project |
| Case entity name | `{name} [RM:{equipId}]` | Identifies Rentman-owned items (never touch untagged items) |
| Container entity name | `{vehicle} [RM:V{vehicleId}]` | Identifies Rentman-assigned vehicles |
| Sync card name | `SYNC: #{number} {name} \| status \| items \| dates` | Human-readable status inside the pack |
| Sync card manufacturer | `sync-card:{provider}:{projectId}` | Machine-readable sync card identifier |

## Inventory Sync (Cases Library)

The `/inventory` page syncs Rentman equipment to Truck Packer's **Cases library** (not per-pack entities). Each case gets a `sync:{provider}:{id}` stamp in its description field. The inventory sync:

- Detects which items are already synced vs. new
- Shows conflicts when dimensions differ between systems
- Lets you resolve conflicts: "Use Rentman values" or "Use Truck Packer values"
- Supports bidirectional write-back for providers that allow it (Current RMS)

## Testing Locally

### Simulate Webhooks

```bash
# Equipment was updated in Rentman
npm run test-webhook equipment-update 343

# Equipment was added to a project
npm run test-webhook project-equipment-added 209

# New project was created
npm run test-webhook project-created 209

# Run all 3 in sequence
npm run test-webhook full-flow 209
```

### Watch Logs

Open `http://localhost:3456/logs` — auto-refreshes every 3 seconds showing all sync activity.

## Project Structure

```
├── app/                          Next.js App Router
│   ├── api/
│   │   ├── projects/             Project list + detail endpoints
│   │   ├── equipment/            Full inventory endpoint
│   │   ├── inventory-sync/       Inventory sync engine (GET status, POST sync)
│   │   ├── sync/[id]/            Per-project pack sync
│   │   ├── sync-all/             Full project sync
│   │   ├── webhooks/rentman/     Webhook receiver
│   │   ├── test-connection/      Connection test endpoints
│   │   └── logs/                 Activity log API
│   ├── inventory/                Inventory browser page
│   ├── projects/[id]/            Project detail + sync wizard
│   ├── logs/                     Activity log viewer
│   └── settings/                 API keys + provider selection
├── lib/
│   ├── providers/                Provider abstraction layer
│   │   ├── types.ts              Shared interfaces
│   │   ├── rentman.ts            Rentman provider
│   │   ├── currentrms.ts         Current RMS provider
│   │   └── index.ts              Factory
│   ├── rentman.ts                Rentman API client
│   ├── truckpacker.ts            Truck Packer API client
│   ├── incremental-sync.ts       Core incremental sync logic
│   ├── auto-sync.ts              Background polling sync
│   ├── sync-lock.ts              Prevents concurrent syncs
│   ├── sync-card.ts              Sync status card builder
│   ├── logger.ts                 Structured logging
│   ├── tokens.ts                 Token extraction from headers/env
│   └── api.ts                    Client-side fetch wrapper
├── src/
│   ├── cli.ts                    CLI tool (legacy)
│   └── test-webhook.ts           Webhook simulation tool
├── instrumentation.ts            Auto-sync startup hook
└── .env.example                  Environment variable template
```

## FAQ

**Q: What happens if someone edits an item in Truck Packer that came from Rentman?**
The sync leaves it alone. It only removes items if they're no longer on the Rentman project. Positions, sizes, and any manual adjustments in TP are preserved.

**Q: What if I add a case manually in Truck Packer?**
It's safe. The sync only manages entities with `[RM:xxx]` tags. Anything without a tag is invisible to the sync.

**Q: What if equipment doesn't have dimensions in Rentman?**
It's skipped. The sync card shows how many items were skipped due to missing dimensions, prompting users to add them in Rentman.

**Q: Can I run this for multiple Rentman accounts?**
Yes — deploy one instance per customer, each with their own `RENTMAN_API_TOKEN` and `TRUCKPACKER_API_KEY`.

**Q: Does it work with Current RMS?**
Yes. Switch the provider in Settings. The sync logic is provider-agnostic.
