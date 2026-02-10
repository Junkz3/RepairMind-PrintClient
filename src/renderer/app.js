/**
 * Renderer Process - UI Logic
 */

// State
let printers = [];
let recentJobs = [];
let config = {};

// DOM Elements
const statusDot = document.querySelector('.status-dot');
const statusText = document.getElementById('status-text');
const printerCount = document.getElementById('printer-count');
const printersList = document.getElementById('printers-list');
const jobsList = document.getElementById('jobs-list');
const versionSpan = document.getElementById('version');
const configForm = document.getElementById('config-form');
const refreshPrintersBtn = document.getElementById('refresh-printers');
const updateSection = document.getElementById('update-section');
const downloadUpdateBtn = document.getElementById('download-update');
const installUpdateBtn = document.getElementById('install-update');

// Initialize
async function init() {
    // Get initial status
    const status = await window.electronAPI.getStatus();
    updateStatus(status);
    versionSpan.textContent = status.version;

    // Get config
    config = await window.electronAPI.getConfig();
    populateConfigForm(config);

    // Setup event listeners
    setupEventListeners();
}

// Setup event listeners
function setupEventListeners() {
    // Status updates
    window.electronAPI.onStatusUpdate((status) => {
        updateStatus(status);
    });

    // Printers updates
    window.electronAPI.onPrintersUpdate((updatedPrinters) => {
        printers = updatedPrinters;
        renderPrinters();
    });

    // Job completed
    window.electronAPI.onJobCompleted((job) => {
        addRecentJob(job, 'completed');
    });

    // Errors
    window.electronAPI.onError((message) => {
        showNotification('Error', message, 'error');
    });

    // Update available
    window.electronAPI.onUpdateAvailable((info) => {
        showUpdateSection(info);
    });

    // Update downloaded
    window.electronAPI.onUpdateDownloaded((info) => {
        showInstallButton(info);
    });

    // Form submission
    configForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveConfig();
    });

    // Refresh printers
    refreshPrintersBtn.addEventListener('click', async () => {
        refreshPrintersBtn.disabled = true;
        refreshPrintersBtn.textContent = 'Refreshing...';

        // The main process will handle this and send updates
        setTimeout(() => {
            refreshPrintersBtn.disabled = false;
            refreshPrintersBtn.textContent = 'Refresh Printers';
        }, 2000);
    });

    // Download update
    downloadUpdateBtn.addEventListener('click', async () => {
        downloadUpdateBtn.disabled = true;
        downloadUpdateBtn.textContent = 'Downloading...';
        await window.electronAPI.downloadUpdate();
    });

    // Install update
    installUpdateBtn.addEventListener('click', async () => {
        await window.electronAPI.installUpdate();
    });
}

// Update status display
function updateStatus(status) {
    if (status.connected) {
        statusDot.classList.remove('offline');
        statusDot.classList.add('online');
        statusText.textContent = 'Connected';
    } else {
        statusDot.classList.remove('online');
        statusDot.classList.add('offline');
        statusText.textContent = 'Disconnected';
    }

    if (status.printers) {
        printers = status.printers;
        renderPrinters();
    }
}

// Render printers list
function renderPrinters() {
    printerCount.textContent = printers.length;

    if (printers.length === 0) {
        printersList.innerHTML = '<p class="empty-state">No printers detected</p>';
        return;
    }

    printersList.innerHTML = printers.map(printer => `
        <div class="printer-item">
            <div class="printer-icon">${getPrinterIcon(printer.type)}</div>
            <div class="printer-info">
                <div class="printer-name">${printer.displayName}</div>
                <div class="printer-type">${printer.type} • ${printer.interface || 'unknown'}</div>
            </div>
            <span class="printer-status online">Online</span>
        </div>
    `).join('');
}

// Get printer icon
function getPrinterIcon(type) {
    const icons = {
        thermal: '🎟️',
        laser: '🖨️',
        inkjet: '🖨️',
        label: '🏷️',
        generic: '🖨️'
    };
    return icons[type] || icons.generic;
}

// Add recent job
function addRecentJob(job, status) {
    recentJobs.unshift({ ...job, status, timestamp: new Date() });
    if (recentJobs.length > 10) {
        recentJobs = recentJobs.slice(0, 10);
    }
    renderJobs();
}

// Render jobs list
function renderJobs() {
    if (recentJobs.length === 0) {
        jobsList.innerHTML = '<p class="empty-state">No recent jobs</p>';
        return;
    }

    jobsList.innerHTML = recentJobs.map(job => `
        <div class="job-item">
            <div class="job-info">
                <div class="job-id">Job #${job.id}</div>
                <div class="job-printer">${job.printerSystemName || 'Unknown printer'}</div>
            </div>
            <span class="job-status ${job.status}">${job.status}</span>
        </div>
    `).join('');
}

// Populate config form
function populateConfigForm(cfg) {
    document.getElementById('backend-url').value = cfg.backendUrl || '';
    document.getElementById('websocket-url').value = cfg.websocketUrl || '';
    document.getElementById('tenant-id').value = cfg.tenantId || '';
    document.getElementById('client-id').value = cfg.clientId || '';
    document.getElementById('api-key').value = cfg.apiKey || '';
}

// Save config
async function saveConfig() {
    const newConfig = {
        backendUrl: document.getElementById('backend-url').value,
        websocketUrl: document.getElementById('websocket-url').value,
        tenantId: document.getElementById('tenant-id').value,
        clientId: document.getElementById('client-id').value,
        apiKey: document.getElementById('api-key').value
    };

    const result = await window.electronAPI.updateConfig(newConfig);

    if (result.success) {
        showNotification('Success', 'Configuration saved and client restarted', 'success');
    } else {
        showNotification('Error', result.error, 'error');
    }
}

// Show notification
function showNotification(title, message, type) {
    // Simple alert for now - can be replaced with a toast library
    alert(`${title}: ${message}`);
}

// Show update section
function showUpdateSection(info) {
    updateSection.style.display = 'block';
    document.getElementById('update-message').textContent = `Version ${info.version} is available`;
}

// Show install button
function showInstallButton(info) {
    downloadUpdateBtn.style.display = 'none';
    installUpdateBtn.style.display = 'inline-block';
    document.getElementById('update-message').textContent = `Version ${info.version} downloaded - ready to install`;
}

// Start app
init();
