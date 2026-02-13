#!/usr/bin/env node

/**
 * RepairMind Print Client v2 - Headless CLI Mode
 *
 * Uses PrintClientCore (same as Electron) for consistent behavior.
 * Suitable for server deployments without a GUI.
 */

require('dotenv').config();
const chalk = require('chalk');
const ora = require('ora');
const PrintClientCore = require('./PrintClientCore');
const ConfigManager = require('./ConfigManager');

class HeadlessPrintClient {
  constructor() {
    this.core = null;
    this.metricsInterval = null;
  }

  async start() {
    console.log(chalk.blue.bold('\n  RepairMind Print Client v2.0.0 (Headless)\n'));

    // Initialize ConfigManager (works without Electron via electron-store fallback)
    let configManager;
    try {
      configManager = await ConfigManager.create();
    } catch (_) {
      // electron-store may fail without Electron — use env vars
      configManager = null;
    }

    const config = {
      websocketUrl: process.env.WEBSOCKET_URL || 'wss://ws-dev.repairmind.fr',
      backendUrl: process.env.BACKEND_URL || 'https://ws-dev.repairmind.fr',
      tenantId: process.env.TENANT_ID,
      clientId: process.env.CLIENT_ID || `${require('os').hostname()}-cli-${Date.now()}`,
      apiKey: process.env.API_KEY,
      token: process.env.TOKEN,
      heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL) || 30000,
      autoRegister: process.env.AUTO_REGISTER !== 'false'
    };

    if (configManager) {
      config.configManager = configManager;
    }

    this.core = new PrintClientCore(config);

    // Setup event listeners
    this.setupEvents();

    // Start
    const spinner = ora('Starting print client...').start();

    try {
      await this.core.start();
      spinner.succeed('Print client started');
    } catch (error) {
      spinner.warn(`Started with issues: ${error.message}`);
      console.log(chalk.yellow('  Will auto-reconnect in background...\n'));
    }

    // Print status
    const printers = this.core.getPrinters();
    if (printers.length > 0) {
      console.log(chalk.green(`\n  Printers detected: ${printers.length}`));
      printers.forEach((p, i) => {
        console.log(chalk.gray(`    ${i + 1}. ${p.displayName} (${p.type}, ${p.interface})`));
      });
    } else {
      console.log(chalk.yellow('\n  No printers detected.'));
    }

    console.log(chalk.gray('\n  Press Ctrl+C to exit\n'));

    // Periodic metrics display
    this.metricsInterval = setInterval(() => {
      const m = this.core.getMetrics();
      const state = m.connectionState === 'connected' ? chalk.green('connected') : chalk.red(m.connectionState);
      console.log(chalk.gray(
        `  [${new Date().toLocaleTimeString()}] ` +
        `State: ${state} | ` +
        `Jobs: ${m.jobsCompleted}/${m.jobsReceived} completed | ` +
        `Queue: ${m.queueStats.queued} pending | ` +
        `Uptime: ${m.uptimeFormatted}`
      ));
    }, 60000);
  }

  setupEvents() {
    this.core.on('connected', () => {
      console.log(chalk.green('  [Connected] to RepairMind ERP'));
    });

    this.core.on('disconnected', () => {
      console.log(chalk.yellow('  [Disconnected] from server'));
    });

    this.core.on('reconnecting', (info) => {
      console.log(chalk.yellow(`  [Reconnecting] attempt #${info.attempt} in ${info.delay / 1000}s...`));
    });

    this.core.on('reconnect-failed', (info) => {
      console.log(chalk.red(`  [Reconnect failed] attempt #${info.attempt}: ${info.error}`));
    });

    this.core.on('job-received', (job) => {
      console.log(chalk.blue(`  [Job received] #${job.id} (${job.documentType}) → ${job.printerSystemName}`));
    });

    this.core.on('job-completed', (entry) => {
      console.log(chalk.green(`  [Job completed] #${entry.id}`));
    });

    this.core.on('job-failed', (entry) => {
      console.log(chalk.red(`  [Job failed] #${entry.id}: ${entry.error}`));
    });

    this.core.on('job-retrying', (entry) => {
      console.log(chalk.yellow(`  [Job retrying] #${entry.id} (attempt ${entry.retries}/${entry.maxRetries})`));
    });

    this.core.on('job-expired', (entry) => {
      console.log(chalk.gray(`  [Job expired] #${entry.id}`));
    });

    this.core.on('info', (msg) => {
      console.log(chalk.cyan(`  [Info] ${msg}`));
    });

    this.core.on('warning', (msg) => {
      console.log(chalk.yellow(`  [Warning] ${msg}`));
    });

    this.core.on('error', (error) => {
      console.error(chalk.red(`  [Error] ${error.message || error}`));
    });
  }

  async shutdown() {
    console.log(chalk.yellow('\n  Shutting down...\n'));

    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }

    if (this.core) {
      // Print final metrics
      const m = this.core.getMetrics();
      console.log(chalk.gray(`  Final stats: ${m.jobsCompleted} completed, ${m.jobsFailed} failed, ${m.reconnections} reconnections`));
      console.log(chalk.gray(`  Uptime: ${m.uptimeFormatted}`));

      this.core.stop();
    }

    console.log(chalk.green('  Shutdown complete\n'));
    process.exit(0);
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

const client = new HeadlessPrintClient();

process.on('SIGINT', () => client.shutdown());
process.on('SIGTERM', () => client.shutdown());

client.start().catch((error) => {
  console.error(chalk.red('\n  Fatal error:'), error);
  process.exit(1);
});
