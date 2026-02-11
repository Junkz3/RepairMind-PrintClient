/**
 * Preload Script - Secure IPC Bridge
 *
 * Exposes safe APIs to the renderer process
 */

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),

  // Get current status
  getStatus: () => ipcRenderer.invoke('get-status'),

  // Queue stats and recent jobs
  getQueueStats: () => ipcRenderer.invoke('get-queue-stats'),
  getRecentJobs: () => ipcRenderer.invoke('get-recent-jobs'),

  // Refresh printers
  refreshPrinters: () => ipcRenderer.invoke('refresh-printers'),

  // Test print (no backend needed)
  testPrint: (printerSystemName, type) => ipcRenderer.invoke('test-print', { printerSystemName, type }),

  // Get configuration
  getConfig: () => ipcRenderer.invoke('get-config'),

  // Update configuration
  updateConfig: (config) => ipcRenderer.invoke('update-config', config),

  // Auto-updater
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),

  // Event listeners
  onStatusUpdate: (callback) => {
    ipcRenderer.on('status-update', (event, data) => callback(data));
  },

  onPrintersUpdate: (callback) => {
    ipcRenderer.on('printers-update', (event, data) => callback(data));
  },

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

  onError: (callback) => {
    ipcRenderer.on('error', (event, message) => callback(message));
  },

  onUpdateAvailable: (callback) => {
    ipcRenderer.on('update-available', (event, info) => callback(info));
  },

  onUpdateDownloaded: (callback) => {
    ipcRenderer.on('update-downloaded', (event, info) => callback(info));
  }
});
