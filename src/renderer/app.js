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
const toastContainer = document.getElementById('toast-container');
const settingsPanel = document.getElementById('settings-panel');
const settingsOverlay = document.getElementById('settings-overlay');

// ═══════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════

async function init() {
    // Setup window controls
    setupWindowControls();

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

// ═══════════════════════════════════════════════════════════════
// WINDOW CONTROLS
// ═══════════════════════════════════════════════════════════════

function setupWindowControls() {
    document.getElementById('btn-minimize').addEventListener('click', () => {
        window.electronAPI.windowMinimize();
    });

    document.getElementById('btn-maximize').addEventListener('click', () => {
        window.electronAPI.windowMaximize();
    });

    document.getElementById('btn-close').addEventListener('click', () => {
        window.electronAPI.windowClose();
    });

    // Settings panel
    document.getElementById('btn-settings').addEventListener('click', () => {
        openSettings();
    });

    document.getElementById('btn-close-settings').addEventListener('click', () => {
        closeSettings();
    });

    settingsOverlay.addEventListener('click', () => {
        closeSettings();
    });
}

function openSettings() {
    settingsPanel.classList.add('open');
    settingsOverlay.classList.add('open');
}

function closeSettings() {
    settingsPanel.classList.remove('open');
    settingsOverlay.classList.remove('open');
}

// ═══════════════════════════════════════════════════════════════
// EVENT LISTENERS
// ═══════════════════════════════════════════════════════════════

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
        showToast(message, 'error');
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
        refreshPrintersBtn.classList.add('spinning');
        refreshPrintersBtn.disabled = true;

        try {
            await window.electronAPI.refreshPrinters();
        } catch (e) {
            showToast('Failed to refresh printers', 'error');
        }

        refreshPrintersBtn.classList.remove('spinning');
        refreshPrintersBtn.disabled = false;
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

// ═══════════════════════════════════════════════════════════════
// STATUS
// ═══════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════
// PRINTERS
// ═══════════════════════════════════════════════════════════════

function renderPrinters() {
    printerCount.textContent = printers.length;

    if (printers.length === 0) {
        printersList.innerHTML = `
            <div class="empty-state">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.3">
                    <polyline points="6 9 6 2 18 2 18 9"></polyline>
                    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                    <rect x="6" y="14" width="12" height="8"></rect>
                </svg>
                <p>No printers detected</p>
            </div>`;
        return;
    }

    printersList.innerHTML = printers.map(printer => `
        <div class="printer-item fade-in">
            <div class="printer-icon">
                ${getPrinterIcon(printer.type)}
            </div>
            <div class="printer-info">
                <div class="printer-name">${printer.displayName}</div>
                <div class="printer-type">${printer.type} &middot; ${printer.interface || 'unknown'}</div>
            </div>
            <span class="printer-status online">Online</span>
        </div>
    `).join('');
}

function getPrinterIcon(type) {
    const icons = {
        thermal: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 2v4M18 2v4M6 18v4M18 18v4"/></svg>',
        label: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
        generic: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>'
    };
    return icons[type] || icons.generic;
}

// ═══════════════════════════════════════════════════════════════
// JOBS
// ═══════════════════════════════════════════════════════════════

function addRecentJob(job, status) {
    recentJobs.unshift({ ...job, status, timestamp: new Date() });
    if (recentJobs.length > 10) {
        recentJobs = recentJobs.slice(0, 10);
    }
    renderJobs();
}

function renderJobs() {
    if (recentJobs.length === 0) {
        jobsList.innerHTML = `
            <div class="empty-state">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.3">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                </svg>
                <p>No recent jobs</p>
            </div>`;
        return;
    }

    jobsList.innerHTML = recentJobs.map(job => `
        <div class="job-item fade-in">
            <div class="job-info">
                <div class="job-id">Job #${job.id}</div>
                <div class="job-printer">${job.printerSystemName || 'Unknown printer'}</div>
            </div>
            <span class="job-status ${job.status}">${job.status}</span>
        </div>
    `).join('');
}

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

function populateConfigForm(cfg) {
    document.getElementById('backend-url').value = cfg.backendUrl || '';
    document.getElementById('websocket-url').value = cfg.websocketUrl || '';
    document.getElementById('tenant-id').value = cfg.tenantId || '';
    document.getElementById('client-id').value = cfg.clientId || '';
    document.getElementById('api-key').value = cfg.apiKey || '';
}

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
        showToast('Configuration saved and client restarted', 'success');
    } else {
        showToast(result.error, 'error');
    }
}

// ═══════════════════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════

function showToast(message, type = 'info') {
    const iconSvg = {
        success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
        error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
        info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>'
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <div class="toast-icon">${iconSvg[type] || iconSvg.info}</div>
        <span>${message}</span>
    `;

    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('removing');
        toast.addEventListener('animationend', () => toast.remove());
    }, 4000);
}

// ═══════════════════════════════════════════════════════════════
// UPDATES
// ═══════════════════════════════════════════════════════════════

function showUpdateSection(info) {
    updateSection.style.display = 'block';
    document.getElementById('update-message').textContent = `Version ${info.version} is available`;
}

function showInstallButton(info) {
    downloadUpdateBtn.style.display = 'none';
    installUpdateBtn.style.display = 'inline-flex';
    document.getElementById('update-message').textContent = `Version ${info.version} downloaded - ready to install`;
}

// Start app
init();
