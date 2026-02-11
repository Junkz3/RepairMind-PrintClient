/**
 * Print Client Core - EventEmitter version for Electron
 *
 * Emits events instead of console.log for integration with Electron main process
 */

const EventEmitter = require('events');
const path = require('path');
const PrinterDetector = require('./printerDetector');
const SocketClient = require('./socketClient');
const PrintExecutor = require('./printExecutor');
const JobQueue = require('./jobQueue');

class PrintClientCore extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      backendUrl: config.backendUrl || process.env.BACKEND_URL || 'http://localhost:5001',
      websocketUrl: config.websocketUrl || process.env.WEBSOCKET_URL || 'ws://localhost:5001',
      tenantId: config.tenantId || process.env.TENANT_ID,
      clientId: config.clientId || process.env.CLIENT_ID || `client-${Date.now()}`,
      apiKey: config.apiKey || process.env.API_KEY,
      heartbeatInterval: parseInt(config.heartbeatInterval || process.env.HEARTBEAT_INTERVAL || 30000),
      autoRegister: config.autoRegister !== false
    };

    this.detector = new PrinterDetector();
    this.executor = new PrintExecutor();
    this.socket = null;
    this.detectedPrinters = [];
    this.registeredPrinters = new Map();
    this.heartbeatInterval = null;
    this.connected = false;

    // Job queue with persistent storage
    const storePath = config.queueStorePath || path.join(
      require('os').tmpdir(), 'repairmind-print', 'job-queue.json'
    );
    this.jobQueue = new JobQueue({ storePath });
    this.setupQueueListeners();
  }

  /**
   * Start the print client
   */
  async start() {
    this.emit('starting');

    // Step 1: Detect printers (always runs, independent of backend)
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

    // Start job queue retry timer (works even without backend)
    this.jobQueue.startRetryTimer();

    // Step 2: Connect to backend (non-blocking — printers show even if offline)
    try {
      this.socket = new SocketClient({
        url: this.config.websocketUrl,
        tenantId: this.config.tenantId,
        clientId: this.config.clientId,
        apiKey: this.config.apiKey
      });

      this.setupSocketListeners();

      await this.socket.connect();
      await this.socket.authenticate();

      this.connected = true;
      this.emit('connected');

      // Step 3: Register printers with backend
      if (this.detectedPrinters.length > 0 && this.config.autoRegister) {
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

      // Step 4: Start heartbeat and job queue retry timer
      this.startHeartbeat();
      this.jobQueue.startRetryTimer();
      this.emit('ready');

    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * Setup queue event listeners and execute callback
   */
  setupQueueListeners() {
    // The execute callback runs the actual print job
    this.jobQueue.setExecuteCallback(async (job) => {
      // Find printer in registered (backend) or detected (local) printers
      const printer = this.registeredPrinters.get(job.printerSystemName)
        || this.detectedPrinters.find(p => p.systemName === job.printerSystemName);
      if (!printer) {
        throw new Error(`Printer not found: ${job.printerSystemName}`);
      }

      // Update backend status (skip if not connected — test mode)
      if (this.socket && this.connected) {
        await this.socket.updateJobStatus(job.id, 'in_progress');
      }

      // Execute print
      await this.executor.executePrintJob(job, printer);

      // Update backend status
      if (this.socket && this.connected) {
        await this.socket.updateJobStatus(job.id, 'completed');
      }
    });

    // Relay queue events
    this.jobQueue.on('job-queued', (entry) => {
      this.emit('job-queued', entry);
    });

    this.jobQueue.on('job-processing', (entry) => {
      this.emit('job-executing', entry.job);
    });

    this.jobQueue.on('job-completed', (entry) => {
      this.emit('job-completed', entry);
    });

    this.jobQueue.on('job-failed', (entry) => {
      // Update backend with final failure
      if (this.socket && this.connected) {
        this.socket.updateJobStatus(entry.id, 'failed', entry.error).catch(() => {});
      }
      this.emit('job-failed', entry);
    });

    this.jobQueue.on('job-retrying', (entry) => {
      this.emit('job-retrying', entry);
    });

    this.jobQueue.on('error', (error) => {
      this.emit('error', error);
    });
  }

  /**
   * Stop the print client
   */
  stop() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
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
   * Setup socket event listeners
   */
  setupSocketListeners() {
    this.socket.on('connected', () => {
      this.connected = true;
      this.emit('connected');
    });

    this.socket.on('disconnected', () => {
      this.connected = false;
      this.emit('disconnected');
    });

    this.socket.on('new_print_job', (job) => {
      this.emit('job-received', job);
      this.jobQueue.enqueue(job);
    });

    this.socket.on('error', (error) => {
      this.emit('error', error);
    });
  }

  /**
   * Start heartbeat to keep printers online
   */
  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.socket && this.connected) {
        this.socket.sendHeartbeat();
        this.emit('heartbeat-sent');
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * Get registered printers
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
   * Send a test print job directly (no WebSocket needed)
   * @param {string} printerSystemName - Target printer
   * @param {string} type - 'thermal', 'pdf', or 'label'
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

    // Enqueue directly — bypasses WebSocket
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

    // Register new printers with backend if connected
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
