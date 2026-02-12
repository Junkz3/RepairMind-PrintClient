/**
 * Print Client Core v2 - EventEmitter orchestrator
 *
 * Key improvements over v1:
 * - Pending jobs sync on reconnect
 * - Re-register printers on reconnect
 * - System metrics tracking (uptime, success rate, throughput)
 * - Parallel job processing per printer
 * - Structured event emissions for observability
 */

const EventEmitter = require('events');
const path = require('path');
const PrinterDetector = require('./printerDetector');
const SocketClient = require('./socketClient');
const PrintExecutor = require('./printExecutor');
const JobQueue = require('./jobQueue');
const ConfigManager = require('./ConfigManager');
const SpoolerMonitor = require('./spoolerMonitor');

class PrintClientCore extends EventEmitter {
  constructor(config = {}) {
    super();

    this.configManager = config.configManager || new ConfigManager();
    const envConfig = this.configManager.getEnvironmentConfig();

    this.config = {
      backendUrl: config.backendUrl || envConfig.backendUrl,
      websocketUrl: config.websocketUrl || envConfig.websocketUrl,
      tenantId: config.tenantId || this.configManager.getTenantId(),
      clientId: config.clientId || this.configManager.getClientId(),
      apiKey: config.apiKey || this.configManager.getApiKey(),
      token: config.token || this.configManager.getToken(),
      heartbeatInterval: config.heartbeatInterval || this.configManager.getHeartbeatInterval(),
      autoRegister: config.autoRegister !== undefined ? config.autoRegister : this.configManager.getAutoRegister()
    };

    this.detector = new PrinterDetector();
    this.executor = new PrintExecutor();
    this.spoolerMonitor = new SpoolerMonitor({ logger: this });
    this.socket = null;
    this.detectedPrinters = [];
    this.registeredPrinters = new Map();
    this.heartbeatInterval = null;
    this.connected = false;

    // System metrics
    this.metrics = {
      startedAt: null,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      reconnections: 0,
      jobsReceived: 0,
      jobsCompleted: 0,
      jobsFailed: 0,
      pendingJobsSynced: 0
    };

    // Job queue with persistent storage
    const storePath = config.queueStorePath || path.join(
      require('os').homedir(), '.repairmind-print', 'job-queue.json'
    );
    this.jobQueue = new JobQueue({ storePath });
    this.setupQueueListeners();
  }

  /**
   * Start the print client
   */
  async start() {
    this.metrics.startedAt = Date.now();
    this.emit('starting');

    // Step 1: Detect printers
    try {
      this.detectedPrinters = await this.detector.detectPrinters();
      this.emit('printers-updated', this.detectedPrinters);
    } catch (error) {
      this.emit('error', new Error(`Printer detection failed: ${error.message}`));
      this.detectedPrinters = [];
    }

    if (this.detectedPrinters.length === 0) {
      this.emit('warning', 'No printers detected.');
    }

    // Start job queue timers (works even without backend)
    this.jobQueue.startRetryTimer();

    // Step 2: Connect to backend
    try {
      this.socket = new SocketClient({
        url: this.config.websocketUrl,
        tenantId: this.config.tenantId,
        clientId: this.config.clientId,
        apiKey: this.config.apiKey,
        token: this.config.token
      });

      this.setupSocketListeners();
      await this.socket.connect();

      this.connected = true;
      this.metrics.lastConnectedAt = Date.now();
      this.emit('connected');

      // Step 3: Register printers
      if (this.detectedPrinters.length > 0 && this.config.autoRegister) {
        await this._registerAllPrinters();
      }

      // Step 4: Sync pending jobs from server
      await this._syncPendingJobs();

      // Step 5: Start heartbeat
      this.startHeartbeat();
      this.emit('ready');

    } catch (error) {
      this.emit('error', error);
      // Socket will auto-reconnect — don't throw
    }
  }

  /**
   * Register all detected printers with backend
   * @private
   */
  async _registerAllPrinters() {
    for (const printer of this.detectedPrinters) {
      try {
        await this.socket.registerPrinter(printer);
        this.registeredPrinters.set(printer.systemName, printer);
        this.emit('printer-registered', printer);
      } catch (error) {
        this.emit('error', new Error(`Failed to register printer ${printer.displayName}: ${error.message}`));
      }
    }
  }

  /**
   * Sync pending jobs from backend after connect/reconnect
   * @private
   */
  async _syncPendingJobs() {
    if (!this.socket || !this.connected) return;

    try {
      const response = await this.socket.getAllPendingJobs();
      const jobs = response?.jobs || response || [];

      if (Array.isArray(jobs) && jobs.length > 0) {
        let synced = 0;
        for (const job of jobs) {
          const enqueued = this.jobQueue.enqueue(job);
          if (enqueued) {
            synced++;
            this.metrics.jobsReceived++;
          }
        }
        if (synced > 0) {
          this.metrics.pendingJobsSynced += synced;
          this.emit('info', `Synced ${synced} pending jobs from server`);
        }
      }
    } catch (error) {
      // Non-fatal — server may not support getAllPendingJobs
      this.emit('warning', `Could not sync pending jobs: ${error.message}`);
    }
  }

  /**
   * Setup queue event listeners and execute callback
   */
  setupQueueListeners() {
    this.jobQueue.setExecuteCallback(async (job) => {
      const printer = this.registeredPrinters.get(job.printerSystemName)
        || this.detectedPrinters.find(p => p.systemName === job.printerSystemName);

      if (!printer) {
        throw new Error(`Printer not found: ${job.printerSystemName}`);
      }

      // Update backend: job sent to printer
      if (this.socket && this.connected) {
        this.socket.updateJobStatus(job.id, 'sent').catch(() => {});
      }

      // Execute print
      const result = await this.executor.executePrintJob(job, printer);
      const osJobId = result?.osJobId || null;

      // Monitor spooler for real status (with safety timeout)
      await new Promise((resolve) => {
        let resolved = false;
        const done = () => { if (!resolved) { resolved = true; resolve(); } };

        // Safety timeout: if spooler never reports terminal status, don't hang forever
        // SpoolerMonitor has its own 2min timeout, but this is a fallback
        const safetyTimer = setTimeout(() => {
          this.emit('warning', `Job #${job.id}: spooler monitor safety timeout — assuming completed`);
          if (this.socket && this.connected) {
            this.socket.updateJobStatus(job.id, 'completed', { message: 'Safety timeout' });
          }
          done();
        }, 150000); // 2.5 min (above spooler's 2min)

        const cancelMonitor = this.spoolerMonitor.monitor(printer.systemName, osJobId, (status, details) => {
          if (status === 'completed') {
            clearTimeout(safetyTimer);
            if (this.socket && this.connected) {
              this.socket.updateJobStatus(job.id, 'completed', details);
            }
            done();
          } else if (status === 'failed') {
            clearTimeout(safetyTimer);
            if (this.socket && this.connected) {
              this.socket.updateJobStatus(job.id, 'failed', details);
            }
            done();
          } else if (status === 'printing' && details?.hasError) {
            this.emit('warning', `Job #${job.id}: ${details.message}`);
          }
        });
      });
    });

    // Relay queue events
    this.jobQueue.on('job-queued', (entry) => this.emit('job-queued', entry));

    this.jobQueue.on('job-processing', (entry) => this.emit('job-executing', entry.job));

    this.jobQueue.on('job-completed', (entry) => {
      this.metrics.jobsCompleted++;
      this.emit('job-completed', entry);
    });

    this.jobQueue.on('job-failed', (entry) => {
      this.metrics.jobsFailed++;
      if (this.socket && this.connected) {
        this.socket.updateJobStatus(entry.id, 'failed', entry.error).catch(() => {});
      }
      this.emit('job-failed', entry);
    });

    this.jobQueue.on('job-retrying', (entry) => this.emit('job-retrying', entry));

    this.jobQueue.on('job-expired', (entry) => {
      if (this.socket && this.connected) {
        this.socket.updateJobStatus(entry.id, 'expired', { reason: 'TTL exceeded' }).catch(() => {});
      }
      this.emit('job-expired', entry);
    });

    this.jobQueue.on('job-deduplicated', (info) => this.emit('job-deduplicated', info));

    this.jobQueue.on('job-cancelled', (entry) => {
      if (this.socket && this.connected) {
        this.socket.updateJobStatus(entry.id, 'cancelled').catch(() => {});
      }
      this.emit('job-cancelled', entry);
    });

    this.jobQueue.on('error', (error) => this.emit('error', error));
  }

  /**
   * Setup socket event listeners
   */
  setupSocketListeners() {
    // Connected (initial or state change)
    this.socket.on('state_change', ({ from, to }) => {
      this.emit('connection-state', { from, to });
    });

    this.socket.on('disconnected', () => {
      this.connected = false;
      this.metrics.lastDisconnectedAt = Date.now();
      this.emit('disconnected');
    });

    this.socket.on('reconnecting', (info) => {
      this.emit('reconnecting', info);
    });

    this.socket.on('reconnect_failed', (info) => {
      this.emit('reconnect-failed', info);
    });

    // Reconnected — re-register printers + sync pending jobs
    this.socket.on('reconnected', async () => {
      this.connected = true;
      this.metrics.lastConnectedAt = Date.now();
      this.metrics.reconnections++;
      this.emit('connected');
      this.emit('info', `Reconnected (attempt #${this.metrics.reconnections})`);

      // Sync pending jobs from backend
      await this._syncPendingJobs();
    });

    // New print job from server
    this.socket.on('new_print_job', (job) => {
      this.metrics.jobsReceived++;
      this.emit('job-received', job);
      this.jobQueue.enqueue(job);
    });

    // Pending jobs pushed by server (on connect or broadcast)
    this.socket.on('pending_jobs', (data) => {
      const jobs = data?.jobs || data || [];
      if (Array.isArray(jobs)) {
        let synced = 0;
        for (const job of jobs) {
          if (this.jobQueue.enqueue(job)) synced++;
        }
        if (synced > 0) {
          this.emit('info', `Received ${synced} pending jobs from server`);
        }
      }
    });

    this.socket.on('error', (error) => this.emit('error', error));
  }

  /**
   * Start heartbeat to keep printers online
   */
  startHeartbeat() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);

    this.heartbeatInterval = setInterval(() => {
      if (this.socket && this.connected) {
        this.socket.sendHeartbeat();
        this.emit('heartbeat-sent');
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * Stop the print client
   */
  stop() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.spoolerMonitor) {
      this.spoolerMonitor.destroy();
    }

    if (this.jobQueue) {
      this.jobQueue.destroy();
    }

    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    this.connected = false;
    this.emit('stopped');
  }

  /**
   * Get detected printers
   */
  getPrinters() {
    return this.detectedPrinters;
  }

  /**
   * Check if connected
   */
  isConnected() {
    return this.connected;
  }

  /**
   * Get connection state from socket
   */
  getConnectionState() {
    return this.socket?.getState() || 'disconnected';
  }

  /**
   * Get queue statistics
   */
  getQueueStats() {
    return this.jobQueue.getStats();
  }

  /**
   * Get recent jobs from queue
   */
  getRecentJobs(limit = 20) {
    return this.jobQueue.getRecentJobs(limit);
  }

  /**
   * Get system metrics
   */
  getMetrics() {
    const queueStats = this.jobQueue.getStats();
    const uptime = this.metrics.startedAt ? Date.now() - this.metrics.startedAt : 0;
    const total = this.metrics.jobsCompleted + this.metrics.jobsFailed;
    const successRate = total > 0 ? ((this.metrics.jobsCompleted / total) * 100).toFixed(1) : '100.0';

    return {
      ...this.metrics,
      uptime,
      uptimeFormatted: this._formatUptime(uptime),
      successRate: parseFloat(successRate),
      connectionState: this.getConnectionState(),
      queueStats
    };
  }

  /**
   * Format uptime to human readable
   * @private
   */
  _formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  /**
   * Get configuration
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  async updateConfig(newConfig) {
    const needsRestart =
      newConfig.backendUrl !== this.config.backendUrl ||
      newConfig.websocketUrl !== this.config.websocketUrl ||
      newConfig.tenantId !== this.config.tenantId;

    Object.assign(this.config, newConfig);
    this.emit('config-updated', this.config);

    if (needsRestart && this.connected) {
      this.emit('info', 'Restarting client with new configuration...');
      this.stop();
      await this.start();
    }
  }

  /**
   * Manually register a printer
   */
  async registerPrinter(printerData) {
    if (!this.socket || !this.connected) {
      throw new Error('Not connected to backend');
    }

    await this.socket.registerPrinter(printerData);
    this.registeredPrinters.set(printerData.systemName, printerData);
    this.emit('printer-registered', printerData);
    this.emit('printers-updated', Array.from(this.registeredPrinters.values()));
  }

  /**
   * Cancel a job
   */
  cancelJob(jobId) {
    return this.jobQueue.cancelJob(jobId);
  }

  /**
   * Send a test print job directly (no WebSocket needed)
   */
  testPrint(printerSystemName, type = 'thermal') {
    const testId = `test-${Date.now()}`;
    const testJobs = {
      thermal: {
        id: testId,
        documentType: 'receipt',
        printerSystemName,
        content: {
          storeName: 'RepairMind',
          storeAddress: '123 Test Street, Paris',
          receiptNumber: testId,
          clientName: 'Client Test',
          phone: '01 23 45 67 89',
          items: [
            { description: 'Réparation écran', quantity: 1, price: 89.99 },
            { description: 'Protection verre trempé', quantity: 2, price: 14.99 },
            { description: 'Main d\'oeuvre', quantity: 1, price: 25.00 }
          ],
          total: 144.97,
          footer: '** TEST IMPRESSION **'
        },
        options: {}
      },
      pdf: {
        id: testId,
        documentType: 'invoice',
        printerSystemName,
        content: {
          invoiceNumber: testId,
          companyName: 'RepairMind SAS',
          companyAddress: '123 Test Street, 75001 Paris',
          companyPhone: '01 23 45 67 89',
          clientName: 'Client Test',
          clientAddress: '456 Avenue du Test, 75002 Paris',
          clientPhone: '09 87 65 43 21',
          items: [
            { description: 'Réparation écran iPhone 15', quantity: 1, price: 189.00 },
            { description: 'Batterie neuve', quantity: 1, price: 49.99 },
            { description: 'Main d\'oeuvre', quantity: 1, price: 35.00 }
          ],
          total: 273.99,
          footer: '** TEST IMPRESSION — Ce document n\'a aucune valeur **'
        },
        options: {}
      },
      label: {
        id: testId,
        documentType: 'label',
        printerSystemName,
        content: {
          title: 'iPhone 15 Pro Max',
          subtitle: 'Réparation écran',
          sku: 'RM-2024-' + testId.slice(-4),
          price: '189.00 EUR',
          barcodeText: '3760123456789'
        },
        options: {}
      }
    };

    const job = testJobs[type];
    if (!job) {
      throw new Error(`Unknown test type: ${type}. Use: thermal, pdf, label`);
    }

    this.emit('job-received', job);
    this.jobQueue.enqueue(job);
    return job;
  }

  /**
   * Refresh printer list
   */
  async refreshPrinters() {
    this.detectedPrinters = await this.detector.detectPrinters();
    this.emit('printers-updated', this.detectedPrinters);

    if (this.connected && this.socket) {
      for (const printer of this.detectedPrinters) {
        if (!this.registeredPrinters.has(printer.systemName)) {
          try {
            await this.socket.registerPrinter(printer);
            this.registeredPrinters.set(printer.systemName, printer);
            this.emit('printer-registered', printer);
          } catch (error) {
            this.emit('error', new Error(`Failed to register printer ${printer.displayName}: ${error.message}`));
          }
        }
      }
    }

    return this.detectedPrinters;
  }
}

module.exports = PrintClientCore;
