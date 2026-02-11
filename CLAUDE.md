# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RepairMind Print Client is a cross-platform Electron desktop app that detects local printers and executes print jobs received from the RepairMind ERP backend via WebSocket. It runs as a system tray application.

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
3. **Service layer** (`src/core/`) — printerDetector, socketClient, printExecutor as separate modules
4. **Renderer layer** (`src/renderer/`) — UI state and DOM manipulation via `window.electronAPI`

### IPC pattern

- **Renderer → Main**: `ipcRenderer.invoke()` for request/response (get-status, get-config, update-config, update lifecycle)
- **Main → Renderer**: `webContents.send()` broadcasts (status-update, printers-update, job-completed, error, update events)
- **Preload bridge** (`src/electron/preload.js`): contextBridge exposes `electronAPI` object — context isolation is on, nodeIntegration is off

### Core event flow

PrintClientCore emits events (connected, disconnected, printers-updated, job-completed, error, etc.) consumed by main.js, which relays them to the renderer via IPC.

### Backend communication

Socket.io client connects to the RepairMind backend. Heartbeats sent every 30s to keep printer status online. Print jobs arrive as WebSocket events and are dispatched to the appropriate executor.

### Print execution

Three print modes handled by `printExecutor.js`:
- **Thermal** — ESC/POS via node-thermal-printer (EPSON/STAR)
- **PDF** — Generated with PDFKit, sent to system printer
- **Labels** — Specialized label printing

## Key Dependencies

- `electron` ^28 — desktop framework
- `socket.io-client` ^4 — WebSocket to backend
- `@thiagoelg/node-printer` — native printer detection (C++ addon)
- `node-thermal-printer` — ESC/POS thermal printing
- `pdfkit` — PDF generation
- `electron-updater` — auto-update via GitHub releases
- `electron-log` — logging
- `auto-launch` — start on system boot

## Configuration

Config via `.env` file or runtime update through the UI. See `.env.example` for available variables (BACKEND_URL, WEBSOCKET_URL, TENANT_ID, CLIENT_ID, API_KEY, etc.).
