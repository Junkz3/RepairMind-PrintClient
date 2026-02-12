# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RepairMind Print Client v2 is a cross-platform Electron desktop app that detects local printers and executes print jobs received from the RepairMind ERP backend via WebSocket. It runs as a system tray application.

## Commands

```bash
npm install                # Install dependencies (runs electron-builder install-app-deps as postinstall)
npm run dev                # Run in development mode (with DevTools)
npm start                  # Run normally
npm run build:win          # Build Windows x64 executable
npm run build:mac          # Build macOS app
npm run build:linux        # Build Linux package
npm run build:all          # Build for all platforms
npm run legacy:start       # Run headless CLI mode (node src/core/index.js)
```

No test or lint tooling is configured.

## IMPORTANT: Running Electron from Claude Code / VSCode

VSCode and Claude Code set `ELECTRON_RUN_AS_NODE=1` in the shell environment. This makes Electron run as plain Node.js instead of a desktop app, causing `app` to be `undefined` and a crash on `app.whenReady()`.

**Never run `npx electron .` directly from the Claude Code bash tool.** Instead, use `dev.bat` which clears the variable:

```bash
cmd /c "start \"RepairMind Dev\" c:\Users\E.repare\Documents\Repairmind\RepairMind-PrintClient\dev.bat"
```

Or to build the exe (doesn't need Electron runtime, so it works directly):
```bash
npm run build:win
```

## Architecture

**Plain JavaScript (ES6+), no TypeScript, no UI framework** — the renderer uses vanilla HTML/CSS/JS.

### Layer structure

1. **Electron layer** (`src/electron/main.js`) — BrowserWindow, system tray, IPC handlers, auto-updater
2. **Core layer** (`src/core/PrintClientCore.js`) — EventEmitter subclass orchestrating all business logic
3. **Service layer** (`src/core/`) — printerDetector, socketClient, printExecutor, jobQueue, spoolerMonitor
4. **Renderer layer** (`src/renderer/`) — UI state and DOM manipulation via `window.electronAPI`

### IPC pattern

- **Renderer → Main**: `ipcRenderer.invoke()` for request/response (get-status, get-config, get-metrics, cancel-job, etc.)
- **Main → Renderer**: `webContents.send()` broadcasts (status-update, connection-state, job-completed, job-expired, etc.)
- **Preload bridge** (`src/electron/preload.js`): contextBridge exposes `electronAPI` object — context isolation is on, nodeIntegration is off

### Core event flow

PrintClientCore emits events consumed by main.js, which relays them to the renderer via IPC:
- Connection: `connected`, `disconnected`, `reconnecting`, `reconnect-failed`, `connection-state`
- Jobs: `job-queued`, `job-executing`, `job-completed`, `job-failed`, `job-retrying`, `job-expired`, `job-cancelled`, `job-deduplicated`
- Printers: `printers-updated`, `printer-registered`
- Info: `info`, `warning`, `error`

### v2 Key Improvements

1. **Unlimited reconnection** — Progressive backoff (5s → 10s → 30s → 1min → 5min max), auto re-auth + re-register printers
2. **Per-printer parallel processing** — Jobs execute concurrently across different printers (no global sequential bottleneck)
3. **Idempotency** — Duplicate job IDs are rejected (prevents double-print on retry)
4. **Job TTL/Expiration** — Jobs auto-expire after 24h (configurable)
5. **Job priority** — `urgent`, `normal`, `low` — urgent jobs skip ahead in queue
6. **Pending jobs sync** — On reconnect, client fetches pending jobs from server
7. **System metrics** — Uptime, success rate, reconnections, jobs processed
8. **Job cancellation** — Cancel queued jobs from UI or IPC
9. **Connection state machine** — `disconnected` → `connecting` → `authenticating` → `connected` → `reconnecting`

### Backend communication

Socket.io client connects to `/print` namespace. Heartbeats every 30s. Key events:
- **Receive**: `new_print_job`, `pending_jobs`, `printer_registered`, `heartbeat_ack`
- **Send**: `authenticate`, `register_printer`, `heartbeat`, `job_status`, `get_pending_jobs`

### Print execution

Five print modes handled by `printExecutor.js`:
- **Thermal** — ESC/POS via node-thermal-printer (EPSON/STAR auto-detection)
- **PDF** — Generated with PDFKit or pre-rendered (URL/base64)
- **Labels** — ZPL raw, generated PDF, or pre-rendered
- **Raw** — Direct printer commands (PCL, PostScript, etc.)
- **PDF_raw** — Pre-rendered PDFs from URL or base64

## Key Dependencies

- `electron` ^28 — desktop framework
- `socket.io-client` ^4 — WebSocket to backend
- `@thiagoelg/node-printer` — native printer detection (C++ addon)
- `node-thermal-printer` — ESC/POS thermal printing
- `pdfkit` — PDF generation
- `electron-updater` — auto-update via GitHub releases
- `electron-log` — logging (10MB max file)
- `auto-launch` — start on system boot
- `electron-store` — persistent configuration

## Configuration

Config via `.env` file or runtime update through the UI. See `.env.example` for available variables (BACKEND_URL, WEBSOCKET_URL, TENANT_ID, CLIENT_ID, API_KEY, TOKEN, etc.).

### Job Queue Storage

Queue persists to `~/.repairmind-print/job-queue.json` and survives app crashes/restarts. Processing jobs are reset to `queued` on recovery.
