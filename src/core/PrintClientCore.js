/**
 * Print Client Core - EventEmitter version for Electron
 *
 * Emits events instead of console.log for integration with Electron main process
 */

const EventEmitter = require('events');
const PrinterDetector = require('./printerDetector');
const SocketClient = require('./socketClient');
const PrintExecutor = require('./printExecutor');

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

      // Step 4: Start heartbeat
      this.startHeartbeat();
      this.emit('ready');

    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * Stop the print client
   */
  stop() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
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

    this.socket.on('new_print_job', async (job) => {
      this.emit('job-received', job);

      try {
        // Find printer
        const printer = this.registeredPrinters.get(job.printerSystemName);
        if (!printer) {
          throw new Error(`Printer not found: ${job.printerSystemName}`);
        }

        // Execute print job
        this.emit('job-executing', job);
        await this.socket.updateJobStatus(job.id, 'in_progress');

        await this.executor.execute(printer, job);

        // Mark as completed
        await this.socket.updateJobStatus(job.id, 'completed');
        this.emit('job-completed', job);

      } catch (error) {
        // Mark as failed
        await this.socket.updateJobStatus(job.id, 'failed', error.message);
        this.emit('job-failed', { job, error });
      }
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
