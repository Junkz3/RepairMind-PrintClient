/**
 * RepairMind Print Client v2 - Electron Main Process
 *
 * Features:
 * - System tray icon (minimizes to tray)
 * - Auto-launch on system boot
 * - Background service for printing
 * - Auto-updates
 * - System metrics & diagnostics
 * - Connection state tracking
 */

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } = require('electron');
const path = require('path');
const AutoLaunch = require('auto-launch');
const log = require('electron-log');

// Configure logging
log.transports.file.level = 'info';
log.transports.file.maxSize = 10 * 1024 * 1024; // 10MB max log file

// electron-updater is lazy-loaded in setupAutoUpdater() to avoid
// accessing app.getVersion() before the app is ready.
let autoUpdater = null;

// Print Client Core
const PrintClientCore = require('../core/PrintClientCore');
const ConfigManager = require('../core/ConfigManager');

// Global references
let tray = null;
let mainWindow = null;
let printClient = null;
let isQuitting = false;
let configManager = null;

// Auto-launch configuration (initialized in app.whenReady)
let autoLauncher = null;

// ═══════════════════════════════════════════════════════════════
// APP LIFECYCLE
// ═══════════════════════════════════════════════════════════════

app.whenReady().then(() => {
  log.info('App starting...', { version: app.getVersion() });

  // Initialize configuration manager
  configManager = new ConfigManager();

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
  const icon = createTrayIcon('red');
  tray = new Tray(icon);

  tray.setToolTip('RepairMind Print Client');

  updateTrayMenu({
    connected: false,
    connectionState: 'disconnected',
    printers: [],
    autoLaunch: false,
    queueStats: null
  });

  tray.on('double-click', () => {
    showWindow();
  });

  log.info('Tray icon created');
}

function updateTrayMenu(status) {
  const { connected, connectionState, printers, autoLaunch, queueStats } = status;

  const stateLabel = {
    disconnected: '🔴 Disconnected',
    connecting: '🟡 Connecting...',
    authenticating: '🟡 Authenticating...',
    connected: '🟢 Connected',
    reconnecting: '🟡 Reconnecting...'
  };

  const queueLabel = queueStats
    ? `Queue: ${queueStats.queued} pending, ${queueStats.processing} printing`
    : 'Queue: idle';

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'RepairMind Print Client',
      enabled: false
    },
    { type: 'separator' },
    {
      label: stateLabel[connectionState] || stateLabel.disconnected,
      enabled: false
    },
    {
      label: `Printers: ${printers.length}`,
      enabled: false
    },
    {
      label: queueLabel,
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

  // Update icon color based on state
  const iconColor = connected ? 'green' : (connectionState === 'reconnecting' ? 'yellow' : 'red');
  tray.setImage(createTrayIcon(iconColor));
}

function createTrayIcon(color) {
  const size = 16;
  const canvas = Buffer.from(
    color === 'green'
      ? 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAACTSURBVHgBpZKBCYAgEEV/TeAIjuIIbdQIuUGt0CS1gW1iZ2jIVaTnhw+Cvs8/OYDJA4Y8kR3ZR2/kmazxJbpUEfQ/Dm/UG7wVwHkjlQdMFfDdJMFaACebnjJGyDWgcnZu1/lrCrl6NCoEHJBrDwEr5NrT6ko/UV8xdLAC2N49mlc5CylpYh8wCwqrvbBGLoKGvz8Bfq0QPWEUo/EAAAAASUVORK5CYII='
      : color === 'yellow'
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

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
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

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

async function initializePrintClient() {
  try {
    printClient = new PrintClientCore({ configManager });

    // Connection events
    printClient.on('connected', () => {
      log.info('Print client connected to backend');
      refreshTray();
      sendToRenderer('status-update', {
        connected: true,
        connectionState: 'connected',
        printers: printClient.getPrinters()
      });
    });

    printClient.on('disconnected', () => {
      log.warn('Print client disconnected from backend');
      refreshTray();
      sendToRenderer('status-update', {
        connected: false,
        connectionState: 'disconnected',
        printers: printClient.getPrinters()
      });
    });

    printClient.on('reconnecting', (info) => {
      log.info('Reconnecting...', { attempt: info.attempt, delay: info.delay });
      refreshTray();
      sendToRenderer('status-update', {
        connected: false,
        connectionState: 'reconnecting',
        reconnectAttempt: info.attempt,
        printers: printClient.getPrinters()
      });
    });

    printClient.on('reconnect-failed', (info) => {
      log.warn('Reconnect attempt failed', { attempt: info.attempt, error: info.error });
    });

    printClient.on('connection-state', ({ from, to }) => {
      log.info(`Connection: ${from} → ${to}`);
      sendToRenderer('connection-state', { from, to });
    });

    // Printer events
    printClient.on('printers-updated', (printers) => {
      log.info('Printers updated', { count: printers.length });
      refreshTray();
      sendToRenderer('printers-update', printers);
    });

    printClient.on('printer-primary-changed', (printer) => {
      log.info('Printer primary changed', { printerId: printer.id, isPrimary: printer.isPrimary });
      sendToRenderer('printer-primary-changed', printer);
    });

    // Job events
    printClient.on('job-completed', (entry) => {
      log.info('Print job completed', { jobId: entry.id });
      sendToRenderer('job-completed', entry);
    });

    printClient.on('job-failed', (entry) => {
      log.error('Print job failed permanently', { jobId: entry.id, error: entry.error, retries: entry.retries });
      sendToRenderer('job-failed', entry);
    });

    printClient.on('job-retrying', (entry) => {
      log.warn('Print job retrying', { jobId: entry.id, retries: entry.retries, delay: entry.delay });
      sendToRenderer('job-retrying', entry);
    });

    printClient.on('job-queued', (entry) => {
      log.info('Print job queued', { jobId: entry.id });
      sendToRenderer('job-queued', entry);
    });

    printClient.on('job-expired', (entry) => {
      log.warn('Print job expired', { jobId: entry.id });
      sendToRenderer('job-expired', entry);
    });

    printClient.on('job-cancelled', (entry) => {
      log.info('Print job cancelled', { jobId: entry.id });
      sendToRenderer('job-cancelled', entry);
    });

    printClient.on('job-deduplicated', (info) => {
      log.info('Duplicate job rejected', { jobId: info.id });
    });

    // Info/Warning/Error
    printClient.on('info', (msg) => {
      log.info(msg);
      sendToRenderer('info', msg);
    });

    printClient.on('warning', (msg) => {
      log.warn(msg);
      sendToRenderer('warning', msg);
    });

    printClient.on('error', (error) => {
      log.error('Print client error', error);
      sendToRenderer('error', error.message || error);
    });

    await printClient.start();
    log.info('Print client initialized');

  } catch (error) {
    log.error('Failed to initialize print client', error);
  }
}

function refreshTray() {
  if (!tray) return;
  updateTrayMenu({
    connected: printClient?.isConnected() || false,
    connectionState: printClient?.getConnectionState() || 'disconnected',
    printers: printClient?.getPrinters() || [],
    autoLaunch: false, // Will be updated by setupAutoLaunch
    queueStats: printClient?.getQueueStats() || null
  });
}

// ═══════════════════════════════════════════════════════════════
// AUTO-LAUNCH
// ═══════════════════════════════════════════════════════════════

async function setupAutoLaunch() {
  try {
    const isEnabled = await autoLauncher.isEnabled();
    log.info('Auto-launch status', { enabled: isEnabled });
    refreshTray();
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
    refreshTray();
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
    sendToRenderer('update-available', info);
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded', { version: info.version });
    sendToRenderer('update-downloaded', info);
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
ipcMain.on('window-minimize', () => { mainWindow?.minimize(); });
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window-close', () => { mainWindow?.hide(); });

ipcMain.handle('get-status', () => {
  return {
    connected: printClient?.isConnected() || false,
    connectionState: printClient?.getConnectionState() || 'disconnected',
    printers: printClient?.getPrinters() || [],
    version: app.getVersion(),
    queueStats: printClient?.getQueueStats() || { queued: 0, processing: 0, completed: 0, failed: 0, expired: 0, total: 0 }
  };
});

ipcMain.handle('get-queue-stats', () => {
  return printClient?.getQueueStats() || { queued: 0, processing: 0, completed: 0, failed: 0, expired: 0, total: 0 };
});

ipcMain.handle('get-recent-jobs', () => {
  return printClient?.getRecentJobs(20) || [];
});

ipcMain.handle('get-metrics', () => {
  return printClient?.getMetrics() || {};
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

ipcMain.handle('set-primary-printer', async (event, { printerId, isPrimary }) => {
  if (!printClient) {
    return { success: false, error: 'Print client not initialized' };
  }
  if (!printClient.isConnected()) {
    return { success: false, error: 'Not connected to backend' };
  }
  try {
    const printer = await printClient.setPrimaryPrinter(printerId, isPrimary);
    log.info('Primary printer updated', { printerId, isPrimary });
    return { success: true, printer };
  } catch (error) {
    log.error('Set primary printer failed', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('cancel-job', async (event, { jobId }) => {
  if (!printClient) {
    return { success: false, error: 'Print client not initialized' };
  }
  const cancelled = printClient.cancelJob(jobId);
  return { success: cancelled };
});

ipcMain.handle('get-config', () => {
  if (!configManager) return {};
  return {
    ...configManager.getAll(),
    printClientConfig: printClient?.getConfig() || {}
  };
});

ipcMain.handle('update-config', async (event, config) => {
  if (printClient) {
    await printClient.updateConfig(config);
    log.info('Config updated');
    return { success: true };
  }
  return { success: false, error: 'Print client not initialized' };
});

ipcMain.handle('set-environment', async (event, environment) => {
  if (!configManager) {
    return { success: false, error: 'Config manager not initialized' };
  }

  try {
    configManager.setEnvironment(environment);
    log.info('Environment changed', { environment });

    if (printClient) {
      printClient.stop();
      await initializePrintClient();
    }

    return { success: true, environment };
  } catch (error) {
    log.error('Failed to set environment', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('login', async (event, { email, password }) => {
  if (!configManager) {
    return { success: false, error: 'Config manager not initialized' };
  }

  try {
    const backendUrl = configManager.getBackendUrl();
    const response = await fetch(`${backendUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        isPrintNode: true
      })
    });

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.message || 'Login failed' };
    }

    const response_data = await response.json();
    const { user, token } = response_data.data || response_data;

    configManager.saveLoginCredentials({
      token: token,
      tenantId: user.tenantId,
      apiKey: response_data.apiKey,
      user: user
    });

    log.info('Login successful', { email, tenantId: user.tenantId });

    if (printClient) {
      printClient.stop();
      await initializePrintClient();
    }

    return { success: true, user: user, tenantId: user.tenantId };
  } catch (error) {
    log.error('Login error', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('logout', async () => {
  if (!configManager) {
    return { success: false, error: 'Config manager not initialized' };
  }

  try {
    configManager.clearLoginCredentials();
    log.info('Logout successful');

    if (printClient) {
      printClient.stop();
    }

    return { success: true };
  } catch (error) {
    log.error('Logout error', error);
    return { success: false, error: error.message };
  }
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
