---
name: rentman-truckpacker-sync
description: >-
  Sync equipment from Rentman rental projects into Truck Packer 3D load plans.
  Use when the user asks about Rentman-to-Truck-Packer integration, equipment
  syncing, truck loading from rental projects, or the rentman-truckpacker tool.
---

# Rentman → Truck Packer Sync

## Overview

This repo contains a CLI tool that bridges two APIs:
- **Rentman** (rental management for live events) → source of equipment data
- **Truck Packer** (3D truck loading optimization) → destination for load plans

## Architecture

```
Rentman API                    This Tool                  Truck Packer API
───────────                    ─────────                  ────────────────
GET /projects          →  list-projects command
GET /projects/:id/     →  fetch equipment list
    projectequipment
GET /equipment/:id     →  get dimensions/weight  →  POST /case-categories
                                                  →  POST /cases
                                                  →  POST /packs
                                                  →  POST /entities:batchCreate
```

## Key Data Mappings

| Rentman              | Truck Packer        | Notes |
|----------------------|---------------------|-------|
| Project              | Pack                | 1:1, pack named after project |
| Equipment item       | Case                | Dimensions converted cm → m |
| Equipment folder     | Case Category       | Auto-created with colors |
| Equipment quantity   | Entity count        | One entity per physical item |
| outer_length/width/height | dx/dy/dz (meters) | Outer dims preferred over inner |

## API Authentication

| Service       | Token format    | Where to find |
|---------------|-----------------|---------------|
| Rentman       | Bearer token    | Configuration → Extensions → Webshop → "show token" |
| Truck Packer  | `tp_` prefix    | Settings → API Keys |

Both stored in `.env` (see `.env.example`).

## CLI Commands

```bash
npm run list-projects           # show Rentman projects with IDs
npm run preview -- <projectId>  # dry-run showing what would sync
npm run sync -- <projectId>     # create a Truck Packer pack from project
npm run list-cases              # show existing Truck Packer cases
```

## Extending

### Adding transport/vehicle sync
Rentman has `/projects/:id/transport` — map vehicles to Truck Packer containers via `POST /containers`.

### Webhook-driven sync
Rentman webhooks fire on project changes. Set up a small HTTP server to receive them and trigger `syncProject()` automatically.

### Bidirectional sync
Truck Packer packs can be read via `GET /packs/:id/entities`. You could write load plan status back to Rentman as project notes.

## API References

- Rentman: https://api.rentman.net/
- Truck Packer: https://www.truckpacker.com/docs/api
- Truck Packer base URL: `https://steady-beagle-345.convex.site/api/v1`
- Rate limit: 200 req/min (Truck Packer), varies (Rentman)
