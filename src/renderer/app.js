/**
 * Renderer Process - UI Logic
 */

// State
let printers = [];
let recentJobs = [];
let config = {};
let isAuthenticated = false;

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
const queueIndicator = document.getElementById('queue-indicator');
const queueCountEl = document.getElementById('queue-count');

// Login elements
const loginScreen = document.getElementById('login-screen');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const loginBtn = document.getElementById('login-btn');
const appVersionSpan = document.getElementById('app-version');

// ═══════════════════════════════════════════════════════════════
// i18n — Apply translations to static HTML elements
// ═══════════════════════════════════════════════════════════════

function applyStaticTranslations() {
    const map = {
        'i18n-login-title': 'login.title',
        'i18n-login-subtitle': 'login.subtitle',
        'i18n-email-label': 'login.email',
        'i18n-password-label': 'login.password',
        'i18n-login-btn': 'login.submit',
        'i18n-env-dev': 'env.development',
        'i18n-env-prod': 'env.production',
        'i18n-header-title': 'header.title',
        'i18n-header-subtitle': 'header.subtitle',
        'i18n-printers-title': 'printers.title',
        'i18n-jobs-title': 'jobs.title',
        'i18n-queue-label': 'queue.inQueue',
        'i18n-update-title': 'updates.title'
    };

    for (const [id, key] of Object.entries(map)) {
        const el = document.getElementById(id);
        if (el) el.textContent = t(key);
    }

    // Placeholders
    const emailInput = document.getElementById('login-email');
    if (emailInput) emailInput.placeholder = t('login.emailPlaceholder');

    // Update download/install buttons
    if (downloadUpdateBtn) downloadUpdateBtn.textContent = t('updates.download');
    if (installUpdateBtn) installUpdateBtn.textContent = t('updates.install');
}

// ═══════════════════════════════════════════════════════════════
// AUTHENTICATION
// ═══════════════════════════════════════════════════════════════

async function checkAuthentication() {
    const cfg = await window.electronAPI.getConfig();
    config = cfg;
    isAuthenticated = cfg.isAuthenticated || false;

    // Set locale from user preferences (before showing any UI)
    const lang = cfg.user?.preferences?.language || 'en';
    setLocale(lang);
    applyStaticTranslations();

    if (!isAuthenticated) {
        showLoginScreen();
    } else {
        hideLoginScreen();
    }

    return isAuthenticated;
}

function showLoginScreen() {
    loginScreen.style.display = 'flex';
    document.querySelector('.container').style.display = 'none';
}

function hideLoginScreen() {
    loginScreen.style.display = 'none';
    document.querySelector('.container').style.display = 'block';
}

async function handleLogin(event) {
    event.preventDefault();

    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const environment = document.querySelector('input[name="environment"]:checked').value;

    if (!email || !password) {
        showLoginError(t('login.fillAllFields'));
        return;
    }

    // Disable button and show loading state
    loginBtn.disabled = true;
    const originalHTML = loginBtn.innerHTML;
    loginBtn.innerHTML = `<span>${t('login.connecting')}</span>`;

    // Hide previous errors
    loginError.style.display = 'none';

    try {
        // Set environment first
        await window.electronAPI.setEnvironment(environment);

        // Login
        const result = await window.electronAPI.login(email, password);

        if (result.success) {
            showToast(t('toast.loginSuccess'), 'success');
            isAuthenticated = true;
            hideLoginScreen();

            // Reinitialize app with new credentials
            await init();
        } else {
            showLoginError(result.error || t('login.failed'));
        }
    } catch (error) {
        showLoginError(t('login.error', { message: error.message }));
    } finally {
        loginBtn.disabled = false;
        loginBtn.innerHTML = originalHTML;
    }
}

function showLoginError(message) {
    loginError.textContent = message;
    loginError.style.display = 'flex';
}

async function handleLogout() {
    if (confirm(t('actions.logoutConfirm'))) {
        await window.electronAPI.logout();
        isAuthenticated = false;
        showLoginScreen();
        showToast(t('toast.logoutSuccess'), 'info');
    }
}

// ═══════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════

async function init() {
    // Check authentication first
    const authenticated = await checkAuthentication();
    if (!authenticated) {
        return; // Stop here if not authenticated
    }
    // Setup window controls
    setupWindowControls();

    // Get initial status
    const status = await window.electronAPI.getStatus();
    updateStatus(status);
    updateQueueIndicator(status.queueStats);
    versionSpan.textContent = status.version;

    // Load persisted recent jobs from queue
    const persistedJobs = await window.electronAPI.getRecentJobs();
    if (persistedJobs && persistedJobs.length > 0) {
        recentJobs = persistedJobs.map(entry => ({
            ...entry.job,
            status: entry.status,
            retries: entry.retries,
            maxRetries: entry.maxRetries,
            error: entry.error,
            timestamp: new Date(entry.updatedAt)
        }));
        renderJobs();
    }

    // Get config
    config = await window.electronAPI.getConfig();

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

    // Printer primary changed (from another client or server)
    window.electronAPI.onPrinterPrimaryChanged((updatedPrinter) => {
        const printer = printers.find(p => p.id === updatedPrinter.id);
        if (printer) {
            // If setting as primary, unset others of same type
            if (updatedPrinter.isPrimary) {
                printers.forEach(p => {
                    if (p.type === printer.type) p.isPrimary = false;
                });
            }
            printer.isPrimary = updatedPrinter.isPrimary;
            renderPrinters();
        }
    });

    // Job completed
    window.electronAPI.onJobCompleted((entry) => {
        addRecentJob(entry.job || entry, 'completed', entry);
        refreshQueueStats();
    });

    // Job failed permanently
    window.electronAPI.onJobFailed((entry) => {
        addRecentJob(entry.job, 'failed', entry);
        showToast(t('toast.jobFailed', { id: entry.id, retries: entry.retries, error: entry.error }), 'error');
        refreshQueueStats();
    });

    // Job retrying
    window.electronAPI.onJobRetrying((entry) => {
        addRecentJob(entry.job, 'retrying', entry);
        showToast(t('toast.jobRetrying', { id: entry.id, retries: entry.retries, maxRetries: entry.maxRetries }), 'info');
        refreshQueueStats();
    });

    // Job queued
    window.electronAPI.onJobQueued((entry) => {
        addRecentJob(entry.job, 'queued', entry);
        refreshQueueStats();
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

    // Refresh printers
    refreshPrintersBtn.addEventListener('click', async () => {
        refreshPrintersBtn.classList.add('spinning');
        refreshPrintersBtn.disabled = true;

        try {
            await window.electronAPI.refreshPrinters();
        } catch (e) {
            showToast(t('toast.refreshFailed'), 'error');
        }

        refreshPrintersBtn.classList.remove('spinning');
        refreshPrintersBtn.disabled = false;
    });

    // Download update
    downloadUpdateBtn.addEventListener('click', async () => {
        downloadUpdateBtn.disabled = true;
        downloadUpdateBtn.textContent = t('updates.downloading');
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
        statusText.textContent = t('status.connected');
    } else {
        statusDot.classList.remove('online');
        statusDot.classList.add('offline');
        statusText.textContent = t('status.disconnected');
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
            <div class="empty-state" style="grid-column: 1 / -1;">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.3">
                    <polyline points="6 9 6 2 18 2 18 9"></polyline>
                    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                    <rect x="6" y="14" width="12" height="8"></rect>
                </svg>
                <p>${t('printers.noPrinters')}</p>
            </div>`;
        return;
    }

    printersList.innerHTML = printers.map(printer => {
        const isDefault = printer.metadata?.isDefault;
        const isPrimary = printer.isPrimary || false;
        const hasDbId = !!printer.id;
        const typeLabel = t(`printerTypes.${printer.type}`);
        const interfaceLabel = (printer.interface || 'unknown').toUpperCase();
        const primaryTitle = isPrimary ? t('printers.unsetPrimary') : t('printers.setPrimary');

        return `
            <div class="printer-card fade-in type-${printer.type}${isDefault ? ' is-default' : ''}${isPrimary ? ' is-primary' : ''}">
                ${isPrimary ? `<span class="primary-badge">${t('printers.primary')}</span>` : ''}
                ${!isPrimary && isDefault ? `<span class="default-badge">${t('printers.default')}</span>` : ''}
                ${hasDbId ? `<button class="btn-star${isPrimary ? ' active' : ''}" data-printer-id="${printer.id}" data-is-primary="${isPrimary}" title="${primaryTitle}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="${isPrimary ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                    </svg>
                </button>` : ''}
                <div class="printer-icon-large">
                    ${getPrinterIcon(printer.type)}
                </div>
                <div class="printer-card-name" title="${printer.displayName}">${printer.displayName}</div>
                <div class="printer-card-type">${typeLabel}</div>
                <div class="printer-card-interface">${interfaceLabel}</div>
                <div class="printer-card-status">
                    <span class="dot"></span>
                    ${t('printers.online')}
                </div>
                <div class="printer-card-actions">
                    <div class="test-dropdown">
                        <button class="btn-test" title="${t('printers.test')}">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polygon points="5 3 19 12 5 21 5 3"></polygon>
                            </svg>
                            ${t('printers.test')}
                        </button>
                        <div class="test-menu">
                            <button class="test-menu-item" data-printer="${printer.systemName}" data-type="thermal">${t('printers.testThermal')}</button>
                            <button class="test-menu-item" data-printer="${printer.systemName}" data-type="pdf">${t('printers.testPdf')}</button>
                            <button class="test-menu-item" data-printer="${printer.systemName}" data-type="label">${t('printers.testLabel')}</button>
                        </div>
                    </div>
                </div>
            </div>`;
    }).join('');

    // Bind test print buttons
    document.querySelectorAll('.btn-test').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const menu = btn.nextElementSibling;
            document.querySelectorAll('.test-menu.open').forEach(m => {
                if (m !== menu) m.classList.remove('open');
            });
            menu.classList.toggle('open');
        });
    });

    document.querySelectorAll('.test-menu-item').forEach(item => {
        item.addEventListener('click', async (e) => {
            e.stopPropagation();
            const printerName = item.dataset.printer;
            const type = item.dataset.type;

            item.parentElement.classList.remove('open');

            const result = await window.electronAPI.testPrint(printerName, type);
            if (result.success) {
                showToast(t('toast.testSent', { type, printer: printerName }), 'success');
            } else {
                showToast(t('toast.testFailed', { error: result.error }), 'error');
            }
        });
    });

    // Bind star (primary) buttons
    document.querySelectorAll('.btn-star').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const printerId = parseInt(btn.dataset.printerId);
            const currentlyPrimary = btn.dataset.isPrimary === 'true';
            const newPrimary = !currentlyPrimary;

            btn.disabled = true;
            try {
                const result = await window.electronAPI.setPrimaryPrinter(printerId, newPrimary);
                if (result.success) {
                    // Update local state
                    const printer = printers.find(p => p.id === printerId);
                    if (printer) {
                        // If setting as primary, unset others of same type
                        if (newPrimary) {
                            printers.forEach(p => {
                                if (p.type === printer.type) p.isPrimary = false;
                            });
                        }
                        printer.isPrimary = newPrimary;
                    }
                    renderPrinters();
                    const displayName = printer?.displayName || `#${printerId}`;
                    showToast(t(newPrimary ? 'toast.primarySet' : 'toast.primaryUnset', { printer: displayName }), 'success');
                } else {
                    showToast(t('toast.primaryFailed', { error: result.error }), 'error');
                }
            } catch (error) {
                showToast(t('toast.primaryFailed', { error: error.message }), 'error');
            }
            btn.disabled = false;
        });
    });
}

// Close test menus when clicking outside
document.addEventListener('click', () => {
    document.querySelectorAll('.test-menu.open').forEach(m => m.classList.remove('open'));
});

function getPrinterIcon(type) {
    const size = 22;
    const icons = {
        thermal: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 6V2h12v4"/><path d="M6 18v2h12v-2"/><path d="M10 10h4"/><path d="M10 13h4"/></svg>`,
        label: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.5" fill="currentColor"/></svg>`,
        laser: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/><circle cx="18" cy="11" r="1" fill="currentColor"/></svg>`,
        inkjet: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/><path d="M12 5l-1.5 3a1.5 1.5 0 1 0 3 0L12 5z" fill="currentColor" stroke="none"/></svg>`,
        dotmatrix: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="10" rx="1"/><path d="M6 7V4h12v3"/><path d="M6 17v3h12v-3"/><circle cx="8" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="16" cy="12" r="1" fill="currentColor"/></svg>`,
        generic: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>`
    };
    return icons[type] || icons.generic;
}

// ═══════════════════════════════════════════════════════════════
// JOBS
// ═══════════════════════════════════════════════════════════════

function addRecentJob(job, status, entry = null) {
    // Update existing job if already in list (e.g. queued → processing → completed)
    const existingIndex = recentJobs.findIndex(j => j.id === job.id);
    const jobData = {
        ...job,
        status,
        retries: entry?.retries || 0,
        maxRetries: entry?.maxRetries || 3,
        error: entry?.error || null,
        timestamp: new Date()
    };

    if (existingIndex >= 0) {
        recentJobs[existingIndex] = jobData;
    } else {
        recentJobs.unshift(jobData);
        if (recentJobs.length > 20) {
            recentJobs = recentJobs.slice(0, 20);
        }
    }
    renderJobs();
}

function getStatusBadge(job) {
    if (job.status === 'failed') {
        return t('jobs.failed', { retries: job.retries, maxRetries: job.maxRetries });
    }
    if (job.status === 'retrying') {
        return t('jobs.retrying', { retries: job.retries, maxRetries: job.maxRetries });
    }
    return t(`jobs.${job.status}`) || job.status;
}

function renderJobs() {
    if (recentJobs.length === 0) {
        jobsList.innerHTML = `
            <div class="empty-state">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.3">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                </svg>
                <p>${t('jobs.noJobs')}</p>
            </div>`;
        return;
    }

    jobsList.innerHTML = recentJobs.map(job => `
        <div class="job-item fade-in">
            <div class="job-info">
                <div class="job-id">Job #${job.id}</div>
                <div class="job-printer">${job.printerSystemName || t('jobs.unknownPrinter')}${job.error ? ` — ${job.error}` : ''}</div>
            </div>
            <span class="job-status ${job.status}">${getStatusBadge(job)}</span>
        </div>
    `).join('');
}

async function refreshQueueStats() {
    const stats = await window.electronAPI.getQueueStats();
    updateQueueIndicator(stats);
}

function updateQueueIndicator(stats) {
    if (!stats) return;
    const pending = stats.queued + stats.processing;
    if (pending > 0) {
        queueIndicator.style.display = 'flex';
        queueCountEl.textContent = pending;
    } else {
        queueIndicator.style.display = 'none';
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
    document.getElementById('update-message').textContent = t('updates.available', { version: info.version });
}

function showInstallButton(info) {
    downloadUpdateBtn.style.display = 'none';
    installUpdateBtn.style.display = 'inline-flex';
    document.getElementById('update-message').textContent = t('updates.downloaded', { version: info.version });
}

// ═══════════════════════════════════════════════════════════════
// LOGIN EVENT LISTENERS
// ═══════════════════════════════════════════════════════════════

loginForm?.addEventListener('submit', handleLogin);

// Environment change
document.querySelectorAll('input[name="environment"]').forEach(radio => {
    radio.addEventListener('change', () => {
        // Update visual feedback
        loginError.style.display = 'none';
    });
});

// Start app
init();
