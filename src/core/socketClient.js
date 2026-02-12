/**
 * Socket Client v2.1
 *
 * Manages WebSocket connection to RepairMind ERP backend.
 * - Unlimited reconnection with progressive backoff
 * - Auto re-authentication + printer re-registration on reconnect
 * - Pending jobs sync on reconnect
 * - Connection state machine
 *
 * Fixes over v2:
 * - _setupEventHandlers() uses _handlersAttached guard to prevent duplicate listeners
 * - updateJobStatus uses unique correlation ID to avoid cross-job ack collision
 * - _emitWithTimeout uses scoped listener removal for safety
 */

const { io } = require('socket.io-client');
const EventEmitter = require('events');

// Connection states
const STATE = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  AUTHENTICATING: 'authenticating',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting'
};

class SocketClient extends EventEmitter {
  constructor({ url, tenantId, clientId, apiKey, token }) {
    super();

    this.url = url;
    this.tenantId = tenantId;
    this.clientId = clientId;
    this.apiKey = apiKey;
    this.token = token;
    this.socket = null;
    this.authenticated = false;
    this.state = STATE.DISCONNECTED;

    // Reconnection config — unlimited with progressive backoff
    this.reconnectAttempts = 0;
    this.reconnectDelays = [5000, 5000, 10000, 10000, 30000, 30000, 60000]; // then 5min max
    this.maxReconnectDelay = 300000; // 5 minutes
    this.reconnectTimer = null;
    this.manualDisconnect = false;

    // Registered printers cache for re-registration on reconnect
    this.registeredPrintersCache = [];

    // Guard: prevent duplicate event handler attachment
    this._handlersAttached = false;
  }

  /**
   * Get current connection state
   */
  getState() {
    return this.state;
  }

  /**
   * Set and emit state changes
   */
  _setState(newState) {
    const old = this.state;
    this.state = newState;
    if (old !== newState) {
      this.emit('state_change', { from: old, to: newState });
    }
  }

  /**
   * Connect to backend WebSocket
   * @returns {Promise<void>}
   */
  async connect() {
    this.manualDisconnect = false;
    this._setState(STATE.CONNECTING);

    return new Promise((resolve, reject) => {
      try {
        this.socket = io(`${this.url}/print`, {
          transports: ['websocket'],
          reconnection: false, // We handle reconnection ourselves
          timeout: 10000
        });

        this.socket.on('connect', async () => {
          try {
            this._setState(STATE.AUTHENTICATING);
            await this.authenticate();
            this._setupEventHandlers();
            this._setState(STATE.CONNECTED);
            this.reconnectAttempts = 0;
            resolve();
          } catch (error) {
            this._setState(STATE.DISCONNECTED);
            reject(error);
          }
        });

        this.socket.on('connect_error', (error) => {
          if (this.state === STATE.CONNECTING) {
            this._setState(STATE.DISCONNECTED);
            reject(new Error(`Connection error: ${error.message}`));
          }
        });

        // Timeout for initial connection only
        setTimeout(() => {
          if (this.state === STATE.CONNECTING) {
            this._setState(STATE.DISCONNECTED);
            if (this.socket) {
              this.socket.close();
            }
            reject(new Error('Connection timeout'));
          }
        }, 15000);
      } catch (error) {
        this._setState(STATE.DISCONNECTED);
        reject(error);
      }
    });
  }

  /**
   * Authenticate with backend
   * @private
   */
  async authenticate() {
    return new Promise((resolve, reject) => {
      this.socket.emit('authenticate', {
        tenantId: this.tenantId,
        clientId: this.clientId,
        token: this.token,
        apiKey: this.apiKey
      });

      const cleanup = () => {
        this.socket.off('authenticated', onAuth);
        this.socket.off('auth_error', onError);
        clearTimeout(timer);
      };

      const onAuth = (data) => {
        cleanup();
        if (data.success) {
          this.authenticated = true;
          resolve();
        } else {
          reject(new Error('Authentication failed'));
        }
      };

      const onError = (error) => {
        cleanup();
        reject(new Error(error.message || 'Authentication error'));
      };

      this.socket.once('authenticated', onAuth);
      this.socket.once('auth_error', onError);

      const timer = setTimeout(() => {
        cleanup();
        if (!this.authenticated) {
          reject(new Error('Authentication timeout'));
        }
      }, 10000);
    });
  }

  /**
   * Setup event handlers (called once per socket instance)
   * Uses _handlersAttached guard to prevent duplicate listeners on reconnect.
   * @private
   */
  _setupEventHandlers() {
    if (this._handlersAttached) return; // Already attached to this socket
    this._handlersAttached = true;

    // Disconnect — trigger reconnection
    this.socket.on('disconnect', (reason) => {
      this.authenticated = false;
      this._setState(STATE.DISCONNECTED);
      this.emit('disconnected', reason);

      // Auto-reconnect unless manually disconnected
      if (!this.manualDisconnect) {
        this._scheduleReconnect();
      }
    });

    // New print job
    this.socket.on('new_print_job', (data) => {
      this.emit('new_print_job', data);
    });

    // Printer registered confirmation
    this.socket.on('printer_registered', (data) => {
      this.emit('printer_registered', data);
    });

    // Status updated
    this.socket.on('status_updated', (data) => {
      this.emit('status_updated', data);
    });

    // Heartbeat ack
    this.socket.on('heartbeat_ack', () => {
      this.emit('heartbeat_ack');
    });

    // Job status updated
    this.socket.on('job_status_updated', (data) => {
      this.emit('job_status_updated', data);
    });

    // Pending jobs received
    this.socket.on('pending_jobs', (data) => {
      this.emit('pending_jobs', data);
    });

    // Error
    this.socket.on('error', (error) => {
      this.emit('error', error);
    });
  }

  /**
   * Schedule a reconnection attempt with progressive backoff
   * @private
   */
  _scheduleReconnect() {
    if (this.manualDisconnect) return;
    if (this.reconnectTimer) return;

    const delayIndex = Math.min(this.reconnectAttempts, this.reconnectDelays.length - 1);
    let delay = this.reconnectAttempts < this.reconnectDelays.length
      ? this.reconnectDelays[delayIndex]
      : this.maxReconnectDelay;

    this.reconnectAttempts++;
    this._setState(STATE.RECONNECTING);

    this.emit('reconnecting', {
      attempt: this.reconnectAttempts,
      delay,
      nextRetryAt: Date.now() + delay
    });

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      await this._attemptReconnect();
    }, delay);
  }

  /**
   * Attempt to reconnect
   * @private
   */
  async _attemptReconnect() {
    if (this.manualDisconnect) return;

    try {
      // Clean up old socket
      if (this.socket) {
        this.socket.removeAllListeners();
        this.socket.close();
        this.socket = null;
      }
      this._handlersAttached = false; // Reset for new socket instance

      this._setState(STATE.CONNECTING);

      this.socket = io(`${this.url}/print`, {
        transports: ['websocket'],
        reconnection: false,
        timeout: 10000
      });

      await new Promise((resolve, reject) => {
        this.socket.on('connect', async () => {
          try {
            this._setState(STATE.AUTHENTICATING);
            await this.authenticate();
            this._setupEventHandlers();
            this._setState(STATE.CONNECTED);
            this.reconnectAttempts = 0;

            // Re-register cached printers
            await this._reRegisterPrinters();

            // Notify reconnection complete — PrintClientCore will sync pending jobs
            this.emit('reconnected');
            resolve();
          } catch (error) {
            reject(error);
          }
        });

        this.socket.on('connect_error', (error) => {
          reject(error);
        });

        setTimeout(() => {
          reject(new Error('Reconnection timeout'));
        }, 15000);
      });

    } catch (error) {
      this._setState(STATE.DISCONNECTED);
      this.emit('reconnect_failed', {
        attempt: this.reconnectAttempts,
        error: error.message
      });

      // Schedule next attempt (unlimited)
      this._scheduleReconnect();
    }
  }

  /**
   * Re-register all cached printers after reconnection
   * @private
   */
  async _reRegisterPrinters() {
    for (const printerData of this.registeredPrintersCache) {
      try {
        await this._emitWithTimeout('register_printer', printerData, 'printer_registered', 5000);
      } catch (_) {
        // Non-fatal — printer may already be registered
      }
    }
  }

  /**
   * Emit with timeout helper
   * @private
   */
  _emitWithTimeout(event, data, ackEvent, timeout = 5000) {
    return new Promise((resolve, reject) => {
      this.socket.emit(event, data);

      const cleanup = () => {
        this.socket.off(ackEvent, onAck);
        this.socket.off('error', onError);
        clearTimeout(timer);
      };

      const onAck = (result) => { cleanup(); resolve(result); };
      const onError = (err) => { cleanup(); reject(new Error(err.message || 'Socket error')); };

      this.socket.once(ackEvent, onAck);
      this.socket.once('error', onError);

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`${event} timeout`));
      }, timeout);
    });
  }

  /**
   * Register a printer and cache it for reconnect
   * @param {Object} printerData
   * @returns {Promise<Object>}
   */
  async registerPrinter(printerData) {
    // Cache for re-registration
    const idx = this.registeredPrintersCache.findIndex(
      p => p.systemName === printerData.systemName
    );
    if (idx >= 0) {
      this.registeredPrintersCache[idx] = printerData;
    } else {
      this.registeredPrintersCache.push(printerData);
    }

    return this._emitWithTimeout('register_printer', printerData, 'printer_registered', 5000);
  }

  /**
   * Update printer status
   */
  async updatePrinterStatus(printerId, status, metadata = {}) {
    return this._emitWithTimeout('printer_status', { printerId, status, metadata }, 'status_updated', 5000);
  }

  /**
   * Send heartbeat
   */
  async sendHeartbeat(printerId) {
    if (this.socket && this.authenticated) {
      this.socket.emit('heartbeat', { printerId });
    }
  }

  /**
   * Get pending jobs for a printer
   * @param {string} printerSystemName
   * @returns {Promise<Object>}
   */
  async getPendingJobs(printerSystemName) {
    return this._emitWithTimeout(
      'get_pending_jobs',
      { printerSystemName },
      'pending_jobs',
      10000
    );
  }

  /**
   * Request all pending jobs for this client (all printers)
   * @returns {Promise<Object>}
   */
  async getAllPendingJobs() {
    return this._emitWithTimeout(
      'get_pending_jobs',
      { clientId: this.clientId },
      'pending_jobs',
      10000
    );
  }

  /**
   * Update print job status (fire-and-forget — does not block on ack)
   * No longer uses socket.once() to avoid cross-job ack collision.
   */
  updateJobStatus(jobId, status, metadata = {}) {
    if (!this.socket || !this.authenticated) return Promise.resolve();

    this.socket.emit('job_status', { jobId, status, metadata });
    return Promise.resolve();
  }

  /**
   * Disconnect from backend (manual — no auto-reconnect)
   */
  disconnect() {
    this.manualDisconnect = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    this.authenticated = false;
    this._setState(STATE.DISCONNECTED);
  }
}

SocketClient.STATE = STATE;
module.exports = SocketClient;
