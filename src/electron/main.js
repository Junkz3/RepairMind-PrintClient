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

// Configure logging
log.transports.file.level = 'info';

// electron-updater is lazy-loaded in setupAutoUpdater() to avoid
// accessing app.getVersion() before the app is ready.
let autoUpdater = null;

// Print Client Core
const PrintClientCore = require('../core/PrintClientCore');

// Global references
let tray = null;
let mainWindow = null;
let printClient = null;
let isQuitting = false;

// Auto-launch configuration (initialized in app.whenReady)
let autoLauncher = null;

// ═══════════════════════════════════════════════════════════════
// APP LIFECYCLE
// ═══════════════════════════════════════════════════════════════

app.whenReady().then(() => {
  log.info('App starting...', { version: app.getVersion() });

  // Initialize auto-launcher now that app is ready
  autoLauncher = new AutoLaunch({
    name: 'RepairMind Print Client',
    path: app.getPath('exe')
  });

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
  isQuitting = true;
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
    width: 650,
    height: 750,
    minWidth: 500,
    minHeight: 600,
    show: false,
    frame: false,
    backgroundColor: '#0f0f0f',
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
    if (!isQuitting) {
      // Minimize to tray instead of closing
      event.preventDefault();
      mainWindow.hide();
      log.info('Window hidden to tray');
    }
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
      const printers = printClient.getPrinters();
      updateTrayMenu({
        connected: false,
        printers: printers,
        autoLaunch: false
      });

      if (mainWindow) {
        mainWindow.webContents.send('status-update', {
          connected: false,
          printers: printers
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

    printClient.on('job-completed', (entry) => {
      log.info('Print job completed', { jobId: entry.id });
      if (mainWindow) {
        mainWindow.webContents.send('job-completed', entry);
      }
    });

    printClient.on('job-failed', (entry) => {
      log.error('Print job failed permanently', { jobId: entry.id, error: entry.error, retries: entry.retries });
      if (mainWindow) {
        mainWindow.webContents.send('job-failed', entry);
      }
    });

    printClient.on('job-retrying', (entry) => {
      log.warn('Print job retrying', { jobId: entry.id, retries: entry.retries, delay: entry.delay });
      if (mainWindow) {
        mainWindow.webContents.send('job-retrying', entry);
      }
    });

    printClient.on('job-queued', (entry) => {
      log.info('Print job queued', { jobId: entry.id });
      if (mainWindow) {
        mainWindow.webContents.send('job-queued', entry);
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
  autoUpdater = require('electron-updater').autoUpdater;
  autoUpdater.logger = log;
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

// Window controls
ipcMain.on('window-minimize', () => {
  mainWindow?.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.on('window-close', () => {
  mainWindow?.hide();
});

ipcMain.handle('get-status', () => {
  return {
    connected: printClient?.isConnected() || false,
    printers: printClient?.getPrinters() || [],
    version: app.getVersion(),
    queueStats: printClient?.getQueueStats() || { queued: 0, processing: 0, completed: 0, failed: 0, total: 0 }
  };
});

ipcMain.handle('get-queue-stats', () => {
  return printClient?.getQueueStats() || { queued: 0, processing: 0, completed: 0, failed: 0, total: 0 };
});

ipcMain.handle('get-recent-jobs', () => {
  return printClient?.getRecentJobs(20) || [];
});

ipcMain.handle('refresh-printers', async () => {
  if (printClient) {
    return await printClient.refreshPrinters();
  }
  return [];
});

ipcMain.handle('test-print', async (event, { printerSystemName, type }) => {
  if (!printClient) {
    return { success: false, error: 'Print client not initialized' };
  }
  try {
    const job = printClient.testPrint(printerSystemName, type);
    log.info('Test print enqueued', { jobId: job.id, printer: printerSystemName, type });
    return { success: true, jobId: job.id };
  } catch (error) {
    log.error('Test print failed', error);
    return { success: false, error: error.message };
  }
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
  platform: process.platform
});
