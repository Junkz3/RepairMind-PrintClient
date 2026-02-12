/**
 * Configuration Manager
 *
 * Manages persistent configuration using electron-store
 */

const Store = require('electron-store');
const { ENVIRONMENTS, DEFAULT_CONFIG } = require('./config');
const os = require('os');

class ConfigManager {
  constructor() {
    this.store = new Store({
      name: 'repairmind-print-client',
      defaults: DEFAULT_CONFIG
    });
  }

  /**
   * Get current environment
   * @returns {'development'|'production'}
   */
  getEnvironment() {
    return this.store.get('environment', DEFAULT_CONFIG.environment);
  }

  /**
   * Set environment
   * @param {'development'|'production'} env
   */
  setEnvironment(env) {
    if (!ENVIRONMENTS[env]) {
      throw new Error(`Invalid environment: ${env}`);
    }
    this.store.set('environment', env);
  }

  /**
   * Get environment configuration
   * @returns {Object}
   */
  getEnvironmentConfig() {
    const env = this.getEnvironment();
    return ENVIRONMENTS[env];
  }

  /**
   * Get backend URL for current environment
   * @returns {string}
   */
  getBackendUrl() {
    return this.getEnvironmentConfig().backendUrl;
  }

  /**
   * Get WebSocket URL for current environment
   * @returns {string}
   */
  getWebsocketUrl() {
    return this.getEnvironmentConfig().websocketUrl;
  }

  /**
   * Get or generate client ID
   * @returns {string}
   */
  getClientId() {
    let clientId = this.store.get('clientId');
    if (!clientId) {
      clientId = `${os.hostname()}-${Date.now()}`;
      this.store.set('clientId', clientId);
    }
    return clientId;
  }

  /**
   * Get tenant ID
   * @returns {string|null}
   */
  getTenantId() {
    return this.store.get('tenantId');
  }

  /**
   * Set tenant ID
   * @param {string} tenantId
   */
  setTenantId(tenantId) {
    this.store.set('tenantId', tenantId);
  }

  /**
   * Get API key
   * @returns {string|null}
   */
  getApiKey() {
    return this.store.get('apiKey');
  }

  /**
   * Set API key
   * @param {string} apiKey
   */
  setApiKey(apiKey) {
    this.store.set('apiKey', apiKey);
  }

  /**
   * Get authentication token
   * @returns {string|null}
   */
  getToken() {
    return this.store.get('token');
  }

  /**
   * Set authentication token
   * @param {string} token
   */
  setToken(token) {
    this.store.set('token', token);
  }

  /**
   * Get user data
   * @returns {Object|null}
   */
  getUser() {
    return this.store.get('user');
  }

  /**
   * Set user data
   * @param {Object} user
   */
  setUser(user) {
    this.store.set('user', user);
  }

  /**
   * Check if user is authenticated
   * @returns {boolean}
   */
  isAuthenticated() {
    return !!this.getToken() && !!this.getTenantId();
  }

  /**
   * Save login credentials
   * @param {Object} credentials
   */
  saveLoginCredentials({ token, tenantId, apiKey, user }) {
    this.setToken(token);
    this.setTenantId(tenantId);
    if (apiKey) this.setApiKey(apiKey);
    if (user) this.setUser(user);
  }

  /**
   * Clear login credentials (logout)
   */
  clearLoginCredentials() {
    this.store.delete('token');
    this.store.delete('tenantId');
    this.store.delete('apiKey');
    this.store.delete('user');
  }

  /**
   * Get heartbeat interval
   * @returns {number}
   */
  getHeartbeatInterval() {
    return this.store.get('heartbeatInterval', DEFAULT_CONFIG.heartbeatInterval);
  }

  /**
   * Set heartbeat interval
   * @param {number} interval
   */
  setHeartbeatInterval(interval) {
    this.store.set('heartbeatInterval', interval);
  }

  /**
   * Get auto-register setting
   * @returns {boolean}
   */
  getAutoRegister() {
    return this.store.get('autoRegister', DEFAULT_CONFIG.autoRegister);
  }

  /**
   * Set auto-register setting
   * @param {boolean} enabled
   */
  setAutoRegister(enabled) {
    this.store.set('autoRegister', enabled);
  }

  /**
   * Get auto-launch setting
   * @returns {boolean}
   */
  getAutoLaunch() {
    return this.store.get('autoLaunch', DEFAULT_CONFIG.autoLaunch);
  }

  /**
   * Set auto-launch setting
   * @param {boolean} enabled
   */
  setAutoLaunch(enabled) {
    this.store.set('autoLaunch', enabled);
  }

  /**
   * Get all configuration
   * @returns {Object}
   */
  getAll() {
    return {
      environment: this.getEnvironment(),
      environmentConfig: this.getEnvironmentConfig(),
      clientId: this.getClientId(),
      tenantId: this.getTenantId(),
      apiKey: this.getApiKey(),
      token: this.getToken(),
      user: this.getUser(),
      heartbeatInterval: this.getHeartbeatInterval(),
      autoRegister: this.getAutoRegister(),
      autoLaunch: this.getAutoLaunch(),
      isAuthenticated: this.isAuthenticated()
    };
  }

  /**
   * Reset to defaults
   */
  reset() {
    this.store.clear();
  }
}

module.exports = ConfigManager;
