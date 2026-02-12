/**
 * Socket Client
 *
 * Manages WebSocket connection to RepairMind ERP backend.
 * Handles authentication, printer registration, and job updates.
 */

const { io } = require('socket.io-client');
const EventEmitter = require('events');

class SocketClient extends EventEmitter {
  constructor({ url, tenantId, clientId, apiKey, token }) {
    super();

    this.url = url;
    this.tenantId = tenantId;
    this.clientId = clientId;
    this.apiKey = apiKey; // Deprecated - use token instead
    this.token = token; // JWT token from login
    this.socket = null;
    this.authenticated = false;
  }

  /**
   * Connect to backend WebSocket
   * @returns {Promise<void>}
   */
  async connect() {
    return new Promise((resolve, reject) => {
      try {
        // Connect to /print namespace
        this.socket = io(`${this.url}/print`, {
          transports: ['websocket'],
          reconnection: true,
          reconnectionAttempts: 10,
          reconnectionDelay: 5000
        });

        // Connection established
        this.socket.on('connect', async () => {
          try {
            await this.authenticate();
            this.setupEventHandlers();
            resolve();
          } catch (error) {
            reject(error);
          }
        });

        // Connection error
        this.socket.on('connect_error', (error) => {
          reject(new Error(`Connection error: ${error.message}`));
        });

        // Timeout after 10 seconds
        setTimeout(() => {
          if (!this.authenticated) {
            reject(new Error('Connection timeout'));
          }
        }, 10000);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Authenticate with backend
   * @returns {Promise<void>}
   * @private
   */
  async authenticate() {
    return new Promise((resolve, reject) => {
      this.socket.emit('authenticate', {
        tenantId: this.tenantId,
        clientId: this.clientId,
        token: this.token, // Use JWT token
        apiKey: this.apiKey // Fallback for backward compatibility
      });

      // Wait for authentication response
      this.socket.once('authenticated', (data) => {
        if (data.success) {
          this.authenticated = true;
          resolve();
        } else {
          reject(new Error('Authentication failed'));
        }
      });

      this.socket.once('auth_error', (error) => {
        reject(new Error(error.message || 'Authentication error'));
      });

      // Timeout
      setTimeout(() => {
        if (!this.authenticated) {
          reject(new Error('Authentication timeout'));
        }
      }, 5000);
    });
  }

  /**
   * Setup event handlers
   * @private
   */
  setupEventHandlers() {
    // Disconnect
    this.socket.on('disconnect', (reason) => {
      this.authenticated = false;
      this.emit('disconnect', reason);
    });

    // Reconnect
    this.socket.on('reconnect', async () => {
      await this.authenticate();
      this.emit('reconnect');
    });

    // Error
    this.socket.on('error', (error) => {
      this.emit('error', error);
    });

    // New print job (pushed from server)
    this.socket.on('new_print_job', (data) => {
      this.emit('new_print_job', data);
    });

    // Printer registered
    this.socket.on('printer_registered', (data) => {
      this.emit('printer_registered', data);
    });

    // Status updated
    this.socket.on('status_updated', (data) => {
      this.emit('status_updated', data);
    });

    // Heartbeat acknowledgment
    this.socket.on('heartbeat_ack', () => {
      // Heartbeat received
    });

    // Job status updated
    this.socket.on('job_status_updated', (data) => {
      this.emit('job_status_updated', data);
    });

    // Pending jobs received
    this.socket.on('pending_jobs', (data) => {
      this.emit('pending_jobs', data);
    });
  }

  /**
   * Register a printer
   * @param {Object} printerData - Printer information
   * @returns {Promise<Object>}
   */
  async registerPrinter(printerData) {
    return new Promise((resolve, reject) => {
      this.socket.emit('register_printer', printerData);

      this.socket.once('printer_registered', (data) => {
        resolve(data);
      });

      this.socket.once('error', (error) => {
        reject(new Error(error.message));
      });

      // Timeout
      setTimeout(() => {
        reject(new Error('Register printer timeout'));
      }, 5000);
    });
  }

  /**
   * Update printer status
   * @param {number} printerId - Printer ID
   * @param {string} status - New status (online, offline, busy, error)
   * @param {Object} metadata - Additional metadata
   * @returns {Promise<Object>}
   */
  async updatePrinterStatus(printerId, status, metadata = {}) {
    return new Promise((resolve, reject) => {
      this.socket.emit('printer_status', {
        printerId,
        status,
        metadata
      });

      this.socket.once('status_updated', (data) => {
        resolve(data);
      });

      this.socket.once('error', (error) => {
        reject(new Error(error.message));
      });

      // Timeout
      setTimeout(() => {
        reject(new Error('Update printer status timeout'));
      }, 5000);
    });
  }

  /**
   * Send heartbeat
   * @param {number} printerId - Printer ID
   * @returns {Promise<void>}
   */
  async sendHeartbeat(printerId) {
    this.socket.emit('heartbeat', { printerId });
  }

  /**
   * Get pending jobs for a printer
   * @param {number} printerId - Printer ID
   * @returns {Promise<Object>}
   */
  async getPendingJobs(printerId) {
    return new Promise((resolve, reject) => {
      this.socket.emit('get_pending_jobs', { printerId });

      this.socket.once('pending_jobs', (data) => {
        resolve(data);
      });

      this.socket.once('error', (error) => {
        reject(new Error(error.message));
      });

      // Timeout
      setTimeout(() => {
        reject(new Error('Get pending jobs timeout'));
      }, 5000);
    });
  }

  /**
   * Update print job status
   * @param {number} jobId - Job ID
   * @param {string} status - New status (sent, printing, completed, failed)
   * @param {Object} metadata - Additional metadata
   * @returns {Promise<Object>}
   */
  async updateJobStatus(jobId, status, metadata = {}) {
    return new Promise((resolve, reject) => {
      this.socket.emit('job_status', {
        jobId,
        status,
        metadata
      });

      this.socket.once('job_status_updated', (data) => {
        resolve(data);
      });

      this.socket.once('error', (error) => {
        reject(new Error(error.message));
      });

      // Timeout
      setTimeout(() => {
        reject(new Error('Update job status timeout'));
      }, 5000);
    });
  }

  /**
   * Disconnect from backend
   */
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.authenticated = false;
    }
  }
}

module.exports = SocketClient;
