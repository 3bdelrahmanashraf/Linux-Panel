<h1 align="center">Project Zomboid Control Panel</h1>

<p align="center">
  <a href="https://github.com/3bdelrahmanashraf/Project-Zomboid-Control-Panel/releases/latest"><img src="https://img.shields.io/github/v/release/3bdelrahmanashraf/Project-Zomboid-Control-Panel?style=for-the-badge&amp;logo=github&amp;color=7E846B" alt="Latest release"></a>
  <a href="https://github.com/3bdelrahmanashraf/Project-Zomboid-Control-Panel/releases"><img src="https://img.shields.io/github/downloads/3bdelrahmanashraf/Project-Zomboid-Control-Panel/total?style=for-the-badge&amp;logo=github&amp;color=7E846B" alt="Downloads"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-7E846B?style=for-the-badge" alt="MIT license"></a>
  <a href="https://github.com/3bdelrahmanashraf/Project-Zomboid-Control-Panel"><img src="https://img.shields.io/badge/platform-Linux%20%7C%20Docker-5F6B4A?style=for-the-badge&amp;logo=linux" alt="Linux and Docker"></a>
</p>

<p align="center"><em>A charcoal-and-sage command deck for Project Zomboid dedicated servers.</em></p>

**Project Zomboid Control Panel** is a self-hosted web application for running,
watching, configuring, and repairing a Project Zomboid dedicated server. It
puts the console, players, mods, exports, backups, scheduler, world tools, and
settings behind one operator surface instead of a pile of separate utilities.

**Based on [fpsacha/zomboid-control-panel](https://github.com/fpsacha/zomboid-control-panel)** —
this repository is an independently edited version with design overrides, a
renamed identity, detached update/support links, export and upload fixes, and
live-server tuning. The proven server-control layer is kept; the experience
around it is rebuilt.

> **Operator rule:** stop PZ before restarting the panel for a config change,
> then restore `autoStartServer=true` and start PZ again. This avoids duplicate
> process ownership and stale startup-script regeneration.

---

## Contents

- [Project status](#project-status)
- [Quick start](#quick-start)
  - [Docker](#docker)
  - [Run from source](#run-from-source)
  - [First login](#first-login)
- [Run shape](#run-shape)
- [Control surface](#control-surface)
- [Configuration](#configuration)
- [What is changed / what is kept](#what-is-changed--what-is-kept)
- [Troubleshooting](#troubleshooting)
- [Files](#files)
- [Development](#development)
- [Updates and the upstream boundary](#updates-and-the-upstream-boundary)
- [API overview](#api-overview)
- [Contributing](#contributing)
- [License](#license)

---

## Project status

This is a snapshot of what is present in this fork, not a release schedule.
The client/server compatibility version is intentionally kept at `1.4.11` so
the running server and browser client continue to match.

| Area | State | Notes |
|---|---|---|
| Panel shell | Shipped | Charcoal (`#111111`) / sage (`#7E846B`) tokens, top dropdown nav on desktop, bottom pop-up dock on small screens. |
| Server lifecycle | Preserved | Start, stop, restart, save, install, update, and guarded state transitions. |
| Mods and exports | Extended | 340 required of 355 tracked IDs; byte-accurate ZIP progress, link validation, single-flight uploads. |
| Upstream detachment | Done | Self-update checks, docs, badges, in-app links, scripts, and CI point only to this repository. |
| PanelBridge Workshop item | Intentionally inherited | Workshop ID unchanged so existing servers keep working. Republishing under a new Steam identity is a separate step. |
| Vehicle-entry warning | Suppressed, verifying | `VehicleClaims4220MP` still fails closed on invalid claims; the misleading player notification is removed. |
| RCON mismatch diagnostics | Deprioritized | Treated as diagnostics for this deployment, not a panel failure. |

---

## Quick start

### Docker

The repository ships a full `docker-compose.yml`. It builds locally by default
and tags the image under this project's namespace.

```bash
git clone https://github.com/3bdelrahmanashraf/Project-Zomboid-Control-Panel.git
cd Project-Zomboid-Control-Panel

# Review volume paths and ports before starting.
nano docker-compose.yml

docker compose up -d --build
docker compose logs -f panel
```

Open <http://localhost:3001> and create the first administrator account.

> To use the published image instead of building locally, set the image to
> `ghcr.io/3bdelrahmanashraf/pz-control-panel:latest` once that image exists.
> Until then, the local `build:` context is the safe path.

### Run from source

Requirements:

- Node.js 20.12.2 or newer (Node 22 recommended)
- npm 10+
- A Project Zomboid dedicated server installation
- The PanelBridge mod installed on the server for deep integration

```bash
git clone https://github.com/3bdelrahmanashraf/Project-Zomboid-Control-Panel.git
cd Project-Zomboid-Control-Panel

npm install
cd client && npm install && cd ..

npm run build
npm start
```

The panel listens on port `3001` by default. Set `PORT` to change it.

### First login

1. Open the panel URL.
2. Create the admin account with a strong, unique password.
3. Enable TOTP in **Settings → Security** and store recovery codes offline.
4. Add a server under **Servers**.
5. Point it at the real install path, data path, and server config path.
6. Install or verify PanelBridge.
7. Open **Dashboard** and confirm the state moves from `connecting` to `online`.

A red or amber status is not always a failure. The panel separates host
reachability, server process state, RCON state, and bridge state.

---

## Run shape

```text
┌──────────────────────┐        HTTPS / WebSocket        ┌────────────────────────┐
│  React + Vite client │  ◄───────────────────────────►  │  Node.js / Express     │
│  Charcoal & Sage UI  │        REST + live events       │  panel service         │
└──────────────────────┘                                  └───────────┬────────────┘
                                                                     │
             ┌──────────────────────┬──────────────────────┬──────────┴──────────┐
             ▼                      ▼                      ▼                     ▼
     RCON / log watcher      Config file reader     PanelBridge file      External services
     (player commands)       (INI, sandbox, mods)   protocol              (VikingFile, Steam)
             │                      │                      │                     │
             └──────────────────────┴──────────────────────┴──────────┬──────────┘
                                                                      ▼
                                                           Project Zomboid server
```

| Piece | Role |
|---|---|
| `server/` | Express routes, auth, permissions, RCON, log parsing, backups, mod scanning, update checks, map proxy, Docker helpers. |
| `client/` | React app, route pages, shared UI primitives, i18n catalogs, and design-system CSS. |
| `client/src/index.css` | Source of truth for theme tokens and global visual rules. |
| `client/tailwind.config.js` | Maps design tokens into Tailwind utilities. |
| `data/db.json` | Local application state. Never commit this file. |
| PanelBridge (external) | Delivered by the existing Steam Workshop item; source is not included in this repo. |
| `docker/` | Docker, Docker Swarm, and Unraid support files. |
| `.github/workflows/` | CI, release, Docker publish, and demo Pages workflows. |

Data flow is direct: the client asks the panel, the panel reads local files
and talks to the server through RCON or PanelBridge, then normalized responses
and live events return to the UI. No original-author infrastructure is needed.

---

## Control surface

| Surface | What it does |
|---|---|
| Dashboard | Server state, uptime, player count, RCON and bridge health, recent events, quick actions. |
| Server control | Start, stop, restart, save, install, and update with confirmation and state guards. |
| Console | Live RCON command execution and player/game-master actions. |
| Players | Player list, moderation actions, and the character tab. |
| Mods | Installed/enabled mods, Workshop IDs, conflicts, file-level overlaps, optional mods. |
| Export Mods | `/export-mods`: mod count, byte size, folder search, accurate ZIP/progress, validated public links, copy buttons. |
| Backups | Cron schedules, retention, download, and preflighted restore. |
| Scheduler | Restart-aware jobs. |
| World | Map proxy, chunk maintenance, and world diagnostics. |
| Messages | Messages panel and Discord image upload flow. |
| Settings | General, server, security, integrations, automation, and About. |

The About tab and footer link only to this repository, its Releases, Issues,
and README. Ko-fi and the original Discord support channels are gone.

---

## Configuration

Configuration comes from environment variables plus the panel database.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | HTTP port for the panel |
| `HOST` | `0.0.0.0` | Bind address; use `127.0.0.1` behind a local reverse proxy |
| `NODE_ENV` | `production` | Runtime mode |
| `TZ` | `UTC` | Timezone for schedules and logs |
| `PUID` / `PGID` | `1000` | Container user/group for mounted server files |
| `JWT_SECRET` | generated | Session signing secret; set explicitly in production |
| `CORS_ORIGIN` | auto | Allowed browser origin; pin behind a reverse proxy |
| `GITHUB_REPOSITORY` | `3bdelrahmanashraf/Project-Zomboid-Control-Panel` | Update-check repository only |

Important database settings:

| Setting | Live value | Meaning |
|---|---|---|
| `autoStartServer` | `true` | Start PZ automatically with the panel |
| `serverAutoUpdate` | `false` | Do not auto-update PZ game files |
| `panelBridgeAutoUpdate` | off / locally controlled | Do not pull bridge updates from the original author |

Generated startup flags:

```bash
-XX:+PerfDisableSharedMem
-XX:+DisableExplicitGC
```

These reduce JVM pauses from shared-memory GC accounting and explicit GC calls.
The generator in `server/routes/server.js` writes them on every regeneration so
hand-edited scripts are not lost.

---

## What is changed / what is kept

| Changed | Kept |
|---|---|
| Visual language: charcoal/sage tokens, glassy cards, rounded controls, system font stack, subtle motion. | The exact 355 client mod IDs. |
| Shell: sidebar removed; top dropdown nav on desktop, bottom pop-up dock on mobile. | Required mods remain 340 of 355; optional mods stay outside `Mods=`. |
| Identity, badges, docs, in-app links, CI, install scripts, and self-update target. | Sandbox preset and character tab. |
| Export Mods page, byte-accurate ZIP progress, validated/cached public links, single-flight upload. | Messages panel and Discord image upload flow. |
| Performance: `MaxPacketsPerSecond=600` plus two JVM flags. | `/mods` ZIP export behavior. |
| Misleading vehicle-entry notification suppressed. | Fail-closed rejection of invalid vehicle claims. |
| Ko-fi and original Discord support channels removed. | `waterphysic` remains disabled. |
| No sidebar collapse preference; theme key stays `survival` for browser compatibility. | Client/server compatibility version `1.4.11`. |

The internal theme key remains `survival` only so existing browser preferences
keep working. It now renders the Charcoal & Sage palette.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Version-mismatch gate | Rebuild the client and restart the panel together. Do not mix version lines. |
| Server stays `connecting` | Check install paths, RCON port/password, and PZ logs. Full-mod startup takes 6–10 minutes. |
| Vehicle warning still appears | Confirm the patched `VehicleClaims_Server.lua` is loaded and PZ was fully restarted. Capture exact text and timestamp if it persists. |
| Export progress stops at 100% | The panel may be validating or uploading. Check `GET /api/mods/export-progress`; large uploads have a 3-hour timeout. |
| Public link says “File not found” | The cached VikingFile hash is stale. Trigger a fresh export; links are HEAD-checked and re-uploaded automatically. |
| RCON mismatch | Verify panel RCON port/password against the server INI. Treated as a diagnostic here, not a panel failure. |
| Panel restarted while PZ was up | Stop PZ first for restart-requiring changes, then restore `autoStartServer=true` and start PZ. |
| Navigation looks wrong after deploy | Hard-refresh the browser so the new hashed CSS/JS assets are picked up. |

---

## Files

| File | Purpose |
|---|---|
| `README.md` | This overview and operator guide. |
| `CHANGELOG.md` | Inherited history plus entries for this fork's redesign and overrides. |
| `LICENSE` | MIT notice, including the original attribution. |
| `client/src/components/Layout.tsx` | Top command bar, bottom dock, pop-up navigation list. |
| `client/src/index.css` | Charcoal & Sage tokens and global visual rules. |
| `client/src/lib/supportLinks.ts` | This repository's Releases, Issues, and docs links. |
| `server/services/panelUpdateChecker.js` | Self-update check against this repository only. |
| `server/routes/server.js` | Server lifecycle, config generator, and startup flags. |
| `server/routes/debug.js`, `server/routes/mapProxy.js` | Diagnostics and self-hosted map tile proxy. |
| PanelBridge (external) | Workshop-delivered bridge; no mod source is shipped here. |
| `docker/`, `docker-compose*.yml` | Container, Swarm, install, and Unraid deployment files. |
| `.github/workflows/` | CI, release, Docker publish, and demo Pages workflows. |
| `data/db.example.json`, `server/data/templates/` | Safe examples; real `data/db.json` is never committed. |

---

## Development

Useful scripts:

```bash
npm run dev                 # panel + client dev servers
npm run build               # production client build
npm test                    # server + client tests
npm run lint:server         # server lint
npm run check:i18n          # translation catalog checks
npm run check:package-version
npm run check:bridge-actions
npm run check:bridge-routes
npm run check:rcon-commands
```

Validation used for this fork:

- TypeScript build via `npm run build`;
- client and server lint;
- syntax checks on changed Node modules;
- targeted tests for export and VikingFile ZIP progress;
- live HEAD check of the cached VikingFile link;
- live server log check after the vehicle-claim patch.

### Local Node note

The build environment used a small Rolldown compatibility patch in
`node_modules` for Node 20.12.2. That patch is environment-specific and is not
part of the repository. Node 22 is recommended for clean installs.

### Adding a visual change

1. Change tokens in `client/src/index.css` before writing component CSS.
2. Add Tailwind mappings in `client/tailwind.config.js` when a new token is needed.
3. Prefer shared primitives in `client/src/components/ui/`.
4. Keep page-specific classes functional; let the design system carry the look.
5. Run `npm run build` and check both dark and light themes.

---

## Updates and the upstream boundary

### Based on upstream, edited here

This repository is based on
**[fpsacha/zomboid-control-panel](https://github.com/fpsacha/zomboid-control-panel)**.
It is not the upstream project and is not maintained by the original author.
The inherited server-control layer is kept, but the following have been
overridden here:

- product name, browser identity, theme color, badges, and metadata;
- visual system and navigation shell;
- self-update checks and in-app source links;
- support channels — Ko-fi and the original Discord links were removed;
- export/upload behavior and link validation;
- live-server performance settings and vehicle-warning suppression;
- install scripts, CI metadata, generator comments, and documentation.

### Panel self-update

The checker in `server/services/panelUpdateChecker.js` uses:

```js
const GITHUB_OWNER = "3bdelrahmanashraf";
const GITHUB_REPO = "Project-Zomboid-Control-Panel";
```

It checks only this repository's Releases. It does not query the original
author's repo.

### PanelBridge

The installed Workshop item ID stays unchanged so existing servers keep
working. Publishing a bridge item under a new Steam identity is intentionally a
separate future step because changing it can break live servers.

### What "detached" means

Detached:

- source repository and release checks;
- in-app source/support links;
- Ko-fi and original Discord channels;
- generated scripts and metadata;
- documentation and install templates.

Not detached:

- the existing Workshop item that delivers PanelBridge, whose source is intentionally not included here;
- historical `CHANGELOG.md` text describing past upstream releases;
- the inherited wire/API version number, kept stable for compatibility.

---

## API overview

The panel exposes a JSON API under `/api`. Authentication uses JWT cookies or
bearer tokens depending on the client flow. Mutating routes are permission-gated.

| Family | Examples |
|---|---|
| Server | `GET /api/server/status`, `POST /api/server/start`, `POST /api/server/stop` |
| Servers | `GET /api/servers`, `POST /api/servers/:id/switch` |
| RCON | `POST /api/rcon/command`, `GET /api/players` |
| Mods | `GET /api/mods`, `POST /api/mods/export-upload/start`, `GET /api/mods/export-progress` |
| Backups | `GET /api/backups`, `POST /api/backups/create`, `POST /api/backups/restore` |
| Settings | `GET /api/settings`, `PATCH /api/settings` |
| Security | `POST /api/security/totp`, `POST /api/security/recovery` |
| Updates | `GET /api/update/status`, `POST /api/update/check` |
| Diagnostics | `GET /api/diagnostics`, `GET /api/health` |

Export progress is asynchronous: `POST /api/mods/export-upload/start` returns
quickly and the client polls `GET /api/mods/export-progress`. The older
synchronous `POST /api/mods/export-upload` remains for compatibility.

---

## Contributing

Contributions are welcome, but this repo is intentionally independent. Before
opening a pull request:

1. Describe what changed and why.
2. Do not reintroduce upstream repository links, Ko-fi links, or old Discord invites.
3. Keep compatibility with the running client/server version gate unless both sides are bumped together.
4. Run the relevant build, lint, and test commands.
5. For visual changes, include dark and light theme screenshots when practical.

Issue reports should include:

- panel version;
- browser and OS;
- server OS and PZ build;
- exact reproduction steps;
- redacted logs;
- whether PanelBridge is connected.

Never include real passwords, JWTs, RCON credentials, Steam cookies, or
recovery codes.

---

## License

MIT License. See [LICENSE](./LICENSE).

Copyright (c) 2026 3bdelrahmanashraf.

The original project was MIT-licensed. That notice is preserved and updated for
this fork. You may use, modify, and redistribute this panel, including
commercially, provided the license notice is included.
