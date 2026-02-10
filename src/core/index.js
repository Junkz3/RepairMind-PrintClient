#!/usr/bin/env node

/**
 * RepairMind Print Client
 *
 * Detects local printers and executes print jobs from RepairMind ERP.
 * Connects to backend via WebSocket for real-time communication.
 */

require('dotenv').config();
const chalk = require('chalk');
const ora = require('ora');
const PrinterDetector = require('./printerDetector');
const SocketClient = require('./socketClient');
const PrintExecutor = require('./printExecutor');

class PrintClient {
  constructor() {
    this.detector = new PrinterDetector();
    this.executor = new PrintExecutor();
    this.socket = null;
    this.registeredPrinters = new Map(); // systemName -> printer object
    this.heartbeatInterval = null;
  }

  /**
   * Start the print client
   */
  async start() {
    console.log(chalk.blue.bold('\n🖨️  RepairMind Print Client v1.0.0\n'));

    // Step 1: Detect printers
    const spinner = ora('Detecting local printers...').start();
    try {
      const printers = await this.detector.detectPrinters();

      if (printers.length === 0) {
        spinner.warn('No printers detected');
        console.log(chalk.yellow('Please connect a printer and restart the client.'));
        process.exit(0);
      }

      spinner.succeed(`Detected ${printers.length} printer(s)`);

      printers.forEach((printer, index) => {
        console.log(chalk.green(`  ${index + 1}. ${printer.displayName} (${printer.type})`));
      });

      this.detectedPrinters = printers;
    } catch (error) {
      spinner.fail('Failed to detect printers');
      console.error(chalk.red(error.message));
      process.exit(1);
    }

    // Step 2: Connect to backend WebSocket
    console.log('');
    const connectSpinner = ora('Connecting to RepairMind ERP...').start();

    try {
      this.socket = new SocketClient({
        url: process.env.WEBSOCKET_URL || 'ws://localhost:5001',
        tenantId: process.env.TENANT_ID,
        clientId: process.env.CLIENT_ID,
        apiKey: process.env.API_KEY
      });

      await this.socket.connect();
      connectSpinner.succeed('Connected to RepairMind ERP');

      // Register event handlers
      this.setupEventHandlers();
    } catch (error) {
      connectSpinner.fail('Connection failed');
      console.error(chalk.red(error.message));
      process.exit(1);
    }

    // Step 3: Register printers
    if (process.env.AUTO_REGISTER === 'true') {
      console.log('');
      await this.registerPrinters();
    }

    // Step 4: Start heartbeat
    this.startHeartbeat();

    console.log(chalk.green.bold('\n✅ Print client is ready!\n'));
    console.log(chalk.gray('Press Ctrl+C to exit\n'));
  }

  /**
   * Register all detected printers with the backend
   */
  async registerPrinters() {
    const spinner = ora('Registering printers...').start();

    for (const printer of this.detectedPrinters) {
      try {
        const result = await this.socket.registerPrinter(printer);

        if (result.isNew) {
          spinner.info(`Registered new printer: ${result.printer.displayName}`);
        } else {
          spinner.info(`Updated printer: ${result.printer.displayName}`);
        }

        this.registeredPrinters.set(printer.systemName, result.printer);
      } catch (error) {
        spinner.warn(`Failed to register ${printer.displayName}: ${error.message}`);
      }
    }

    spinner.succeed(`Registered ${this.registeredPrinters.size} printer(s)`);
  }

  /**
   * Setup WebSocket event handlers
   */
  setupEventHandlers() {
    // New print job received
    this.socket.on('new_print_job', async (data) => {
      console.log(chalk.blue(`\n📄 New print job received: ${data.documentType} (ID: ${data.jobId})`));

      // Get pending jobs for this printer
      const pendingJobs = await this.socket.getPendingJobs(data.printerId);

      if (pendingJobs.jobs.length > 0) {
        await this.processPrintJobs(pendingJobs.jobs);
      }
    });

    // Error from server
    this.socket.on('error', (error) => {
      console.error(chalk.red(`\n❌ Error: ${error.message}`));
    });

    // Disconnected
    this.socket.on('disconnect', () => {
      console.log(chalk.yellow('\n⚠️  Disconnected from server'));
      this.stopHeartbeat();
    });

    // Reconnected
    this.socket.on('reconnect', () => {
      console.log(chalk.green('\n✅ Reconnected to server'));
      this.startHeartbeat();
    });
  }

  /**
   * Process pending print jobs
   */
  async processPrintJobs(jobs) {
    for (const job of jobs) {
      console.log(chalk.blue(`\nProcessing job #${job.id} (${job.documentType})...`));

      try {
        // Update status to "printing"
        await this.socket.updateJobStatus(job.id, 'printing');

        // Find printer
        const printer = Array.from(this.registeredPrinters.values()).find(
          p => p.id === job.printerId
        );

        if (!printer) {
          throw new Error('Printer not found');
        }

        // Execute print job
        const startTime = Date.now();
        await this.executor.executePrintJob(job, printer);
        const duration = Date.now() - startTime;

        // Update status to "completed"
        await this.socket.updateJobStatus(job.id, 'completed', {
          printedPages: 1, // TODO: Get actual page count
          duration
        });

        console.log(chalk.green(`✅ Job #${job.id} completed (${duration}ms)`));
      } catch (error) {
        console.error(chalk.red(`❌ Job #${job.id} failed: ${error.message}`));

        // Update status to "failed"
        await this.socket.updateJobStatus(job.id, 'failed', {
          error: error.message,
          stack: error.stack
        });
      }
    }
  }

  /**
   * Start heartbeat to keep printers online
   */
  startHeartbeat() {
    const interval = parseInt(process.env.HEARTBEAT_INTERVAL) || 30000;

    this.heartbeatInterval = setInterval(async () => {
      for (const printer of this.registeredPrinters.values()) {
        try {
          // Check if printer is still available
          const isAvailable = await this.detector.isPrinterAvailable(printer.systemName);

          const status = isAvailable ? 'online' : 'offline';

          // Send heartbeat + status
          await this.socket.sendHeartbeat(printer.id);
          await this.socket.updatePrinterStatus(printer.id, status);
        } catch (error) {
          console.error(chalk.red(`Heartbeat error for ${printer.displayName}: ${error.message}`));
        }
      }
    }, interval);
  }

  /**
   * Stop heartbeat
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    console.log(chalk.yellow('\n\n🛑 Shutting down...\n'));

    // Mark all printers as offline
    for (const printer of this.registeredPrinters.values()) {
      try {
        await this.socket.updatePrinterStatus(printer.id, 'offline');
      } catch (error) {
        // Ignore errors during shutdown
      }
    }

    // Stop heartbeat
    this.stopHeartbeat();

    // Disconnect socket
    if (this.socket) {
      this.socket.disconnect();
    }

    console.log(chalk.green('✅ Shutdown complete\n'));
    process.exit(0);
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

const client = new PrintClient();

// Handle graceful shutdown
process.on('SIGINT', () => client.shutdown());
process.on('SIGTERM', () => client.shutdown());

// Start client
client.start().catch((error) => {
  console.error(chalk.red('\n❌ Fatal error:'), error);
  process.exit(1);
});
