/**
 * Preload Script v2 - Secure IPC Bridge
 *
 * Exposes safe APIs to the renderer process
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),

  // Status & diagnostics
  getStatus: () => ipcRenderer.invoke('get-status'),
  getMetrics: () => ipcRenderer.invoke('get-metrics'),

  // Queue
  getQueueStats: () => ipcRenderer.invoke('get-queue-stats'),
  getRecentJobs: () => ipcRenderer.invoke('get-recent-jobs'),
  cancelJob: (jobId) => ipcRenderer.invoke('cancel-job', { jobId }),

  // Printers
  refreshPrinters: () => ipcRenderer.invoke('refresh-printers'),
  testPrint: (printerSystemName, type) => ipcRenderer.invoke('test-print', { printerSystemName, type }),
  setPrimaryPrinter: (printerId, isPrimary) => ipcRenderer.invoke('set-primary-printer', { printerId, isPrimary }),

  // Configuration
  getConfig: () => ipcRenderer.invoke('get-config'),
  updateConfig: (config) => ipcRenderer.invoke('update-config', config),
  setEnvironment: (environment) => ipcRenderer.invoke('set-environment', environment),

  // Authentication
  login: (email, password) => ipcRenderer.invoke('login', { email, password }),
  logout: () => ipcRenderer.invoke('logout'),

  // Auto-updater
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),

  // Event listeners — connection
  onStatusUpdate: (callback) => {
    ipcRenderer.on('status-update', (event, data) => callback(data));
  },
  onConnectionState: (callback) => {
    ipcRenderer.on('connection-state', (event, data) => callback(data));
  },

  // Event listeners — printers
  onPrintersUpdate: (callback) => {
    ipcRenderer.on('printers-update', (event, data) => callback(data));
  },
  onPrinterPrimaryChanged: (callback) => {
    ipcRenderer.on('printer-primary-changed', (event, data) => callback(data));
  },

  // Event listeners — jobs
  onJobCompleted: (callback) => {
    ipcRenderer.on('job-completed', (event, data) => callback(data));
  },
  onJobFailed: (callback) => {
    ipcRenderer.on('job-failed', (event, data) => callback(data));
  },
  onJobRetrying: (callback) => {
    ipcRenderer.on('job-retrying', (event, data) => callback(data));
  },
  onJobQueued: (callback) => {
    ipcRenderer.on('job-queued', (event, data) => callback(data));
  },
  onJobExpired: (callback) => {
    ipcRenderer.on('job-expired', (event, data) => callback(data));
  },
  onJobCancelled: (callback) => {
    ipcRenderer.on('job-cancelled', (event, data) => callback(data));
  },

  // Event listeners — info/warning/error
  onInfo: (callback) => {
    ipcRenderer.on('info', (event, msg) => callback(msg));
  },
  onWarning: (callback) => {
    ipcRenderer.on('warning', (event, msg) => callback(msg));
  },
  onError: (callback) => {
    ipcRenderer.on('error', (event, message) => callback(message));
  },

  // Event listeners — updates
  onUpdateAvailable: (callback) => {
    ipcRenderer.on('update-available', (event, info) => callback(info));
  },
  onUpdateDownloaded: (callback) => {
    ipcRenderer.on('update-downloaded', (event, info) => callback(info));
  }
});
