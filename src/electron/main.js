/**
 * RepairMind Print Client - Electron Main Process
 *
 * Features:
 * - System tray icon (minimizes to tray)
 * - Auto-launch on system boot
 * - Background service for printing
 * - Auto-updates
 */

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } = require('electron');
const path = require('path');
const AutoLaunch = require('auto-launch');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');

// Configure logging
log.transports.file.level = 'info';
autoUpdater.logger = log;

// Print Client Core
const PrintClientCore = require('../core/index');

// Global references
let tray = null;
let mainWindow = null;
let printClient = null;

// Auto-launch configuration
const autoLauncher = new AutoLaunch({
  name: 'RepairMind Print Client',
  path: app.getPath('exe')
});

// ═══════════════════════════════════════════════════════════════
// APP LIFECYCLE
// ═══════════════════════════════════════════════════════════════

app.whenReady().then(() => {
  log.info('App starting...', { version: app.getVersion() });

  // Create tray icon first
  createTray();

  // Initialize print client
  initializePrintClient();

  // Setup auto-launch
  setupAutoLaunch();

  // Setup auto-updater
  setupAutoUpdater();

  // Create window (hidden by default)
  if (process.argv.includes('--dev')) {
    createWindow();
  }

  log.info('App ready!');
});

// Prevent app from quitting when all windows are closed (tray app)
app.on('window-all-closed', (e) => {
  // Keep app running in tray
  log.info('All windows closed, staying in tray');
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Quit when requested
app.on('before-quit', () => {
  log.info('App quitting...');
  if (printClient) {
    printClient.stop();
  }
});

// ═══════════════════════════════════════════════════════════════
// SYSTEM TRAY
// ═══════════════════════════════════════════════════════════════

function createTray() {
  // Create tray icon (red by default - disconnected)
  const icon = createTrayIcon('red');
  tray = new Tray(icon);

  tray.setToolTip('RepairMind Print Client');

  updateTrayMenu({
    connected: false,
    printers: [],
    autoLaunch: false
  });

  // Double-click to show window
  tray.on('double-click', () => {
    showWindow();
  });

  log.info('Tray icon created');
}

function updateTrayMenu(status) {
  const { connected, printers, autoLaunch } = status;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'RepairMind Print Client',
      enabled: false
    },
    { type: 'separator' },
    {
      label: connected ? '🟢 Connected' : '🔴 Disconnected',
      enabled: false
    },
    {
      label: `Printers: ${printers.length}`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Show Window',
      click: () => showWindow()
    },
    {
      label: 'View Logs',
      click: () => {
        require('electron').shell.openPath(log.transports.file.getFile().path);
      }
    },
    { type: 'separator' },
    {
      label: 'Auto-start on boot',
      type: 'checkbox',
      checked: autoLaunch,
      click: async (menuItem) => {
        await toggleAutoLaunch(menuItem.checked);
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  // Update icon color
  const iconColor = connected ? 'green' : 'red';
  tray.setImage(createTrayIcon(iconColor));
}

function createTrayIcon(color) {
  // Create a simple colored dot as icon (16x16)
  // In production, use proper icon files
  const size = 16;
  const canvas = Buffer.from(
    color === 'green'
      ? 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAACTSURBVHgBpZKBCYAgEEV/TeAIjuIIbdQIuUGt0CS1gW1iZ2jIVaTnhw+Cvs8/OYDJA4Y8kR3ZR2/kmazxJbpUEfQ/Dm/UG7wVwHkjlQdMFfDdJMFaACebnjJGyDWgcnZu1/lrCrl6NCoEHJBrDwEr5NrT6ko/UV8xdLAC2N49mlc5CylpYh8wCwqrvbBGLoKGvz8Bfq0QPWEUo/EAAAAASUVORK5CYII='
      : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAACTSURBVHgBpZKBCYAgEEV/TeAIjuIIbdQIuUGt0CS1gW1iZ2jIVaTnhw+Cvs8/OYDJA4Y8kR3ZR2/kmazxJbpUEfQ/Dm/UG7wVwHkjlQdMFfDdJMFaACebnjJGyDWgcnZu1/lrCrl6NCoEHJBrDwEr5NrT6ko/UV8xdLAC2N49mlc5CylpYh8wCwqrvbBGLoKGvz8Bfq0QPWEUo/EAAAAASUVORK5CYII=',
    'base64'
  );

  return nativeImage.createFromDataURL(canvas.toString());
}

// ═══════════════════════════════════════════════════════════════
// WINDOW MANAGEMENT
// ═══════════════════════════════════════════════════════════════

function createWindow() {
  if (mainWindow) {
    mainWindow.show();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 600,
    height: 700,
    show: false,
    icon: path.join(__dirname, '../../build/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Open DevTools in dev mode
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('close', (event) => {
    // Minimize to tray instead of closing
    event.preventDefault();
    mainWindow.hide();
    log.info('Window hidden to tray');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  log.info('Window created');
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
  }
  mainWindow.show();
  mainWindow.focus();
}

// ═══════════════════════════════════════════════════════════════
// PRINT CLIENT CORE
// ═══════════════════════════════════════════════════════════════

async function initializePrintClient() {
  try {
    printClient = new PrintClientCore();

    // Listen to print client events
    printClient.on('connected', () => {
      log.info('Print client connected to backend');
      updateTrayMenu({
        connected: true,
        printers: printClient.getPrinters(),
        autoLaunch: false
      });

      if (mainWindow) {
        mainWindow.webContents.send('status-update', {
          connected: true,
          printers: printClient.getPrinters()
        });
      }
    });

    printClient.on('disconnected', () => {
      log.warn('Print client disconnected from backend');
      updateTrayMenu({
        connected: false,
        printers: [],
        autoLaunch: false
      });

      if (mainWindow) {
        mainWindow.webContents.send('status-update', {
          connected: false,
          printers: []
        });
      }
    });

    printClient.on('printers-updated', (printers) => {
      log.info('Printers updated', { count: printers.length });
      updateTrayMenu({
        connected: printClient.isConnected(),
        printers: printers,
        autoLaunch: false
      });

      if (mainWindow) {
        mainWindow.webContents.send('printers-update', printers);
      }
    });

    printClient.on('job-completed', (job) => {
      log.info('Print job completed', { jobId: job.id });
      if (mainWindow) {
        mainWindow.webContents.send('job-completed', job);
      }
    });

    printClient.on('error', (error) => {
      log.error('Print client error', error);
      if (mainWindow) {
        mainWindow.webContents.send('error', error.message);
      }
    });

    await printClient.start();
    log.info('Print client initialized');

  } catch (error) {
    log.error('Failed to initialize print client', error);
  }
}

// ═══════════════════════════════════════════════════════════════
// AUTO-LAUNCH
// ═══════════════════════════════════════════════════════════════

async function setupAutoLaunch() {
  try {
    const isEnabled = await autoLauncher.isEnabled();
    log.info('Auto-launch status', { enabled: isEnabled });

    // Update tray menu
    updateTrayMenu({
      connected: printClient?.isConnected() || false,
      printers: printClient?.getPrinters() || [],
      autoLaunch: isEnabled
    });
  } catch (error) {
    log.error('Failed to check auto-launch status', error);
  }
}

async function toggleAutoLaunch(enable) {
  try {
    if (enable) {
      await autoLauncher.enable();
      log.info('Auto-launch enabled');
    } else {
      await autoLauncher.disable();
      log.info('Auto-launch disabled');
    }

    updateTrayMenu({
      connected: printClient?.isConnected() || false,
      printers: printClient?.getPrinters() || [],
      autoLaunch: enable
    });
  } catch (error) {
    log.error('Failed to toggle auto-launch', error);
  }
}

// ═══════════════════════════════════════════════════════════════
// AUTO-UPDATER
// ═══════════════════════════════════════════════════════════════

function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    log.info('Update available', { version: info.version });
    if (mainWindow) {
      mainWindow.webContents.send('update-available', info);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded', { version: info.version });
    if (mainWindow) {
      mainWindow.webContents.send('update-downloaded', info);
    }
  });

  // Check for updates after 30 seconds
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 30000);
}

// ═══════════════════════════════════════════════════════════════
// IPC HANDLERS
// ═══════════════════════════════════════════════════════════════

ipcMain.handle('get-status', () => {
  return {
    connected: printClient?.isConnected() || false,
    printers: printClient?.getPrinters() || [],
    version: app.getVersion()
  };
});

ipcMain.handle('get-config', () => {
  return printClient?.getConfig() || {};
});

ipcMain.handle('update-config', async (event, config) => {
  if (printClient) {
    await printClient.updateConfig(config);
    log.info('Config updated');
    return { success: true };
  }
  return { success: false, error: 'Print client not initialized' };
});

ipcMain.handle('check-for-updates', async () => {
  return await autoUpdater.checkForUpdates();
});

ipcMain.handle('download-update', async () => {
  return await autoUpdater.downloadUpdate();
});

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall(false, true);
});

log.info('Main process initialized', {
  version: app.getVersion(),
  platform: process.platform
});
