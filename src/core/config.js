/**
 * Environment Configuration
 *
 * Defines available environments and their settings
 */

const ENVIRONMENTS = {
  development: {
    name: 'Development',
    backendUrl: 'https://ws-dev.repairmind.fr',
    websocketUrl: 'wss://ws-dev.repairmind.fr',
    apiVersion: 'v1'
  },
  production: {
    name: 'Production',
    backendUrl: 'https://app.repairmind.fr',
    websocketUrl: 'wss://app.repairmind.fr',
    apiVersion: 'v1'
  }
};

const DEFAULT_CONFIG = {
  environment: 'development',
  heartbeatInterval: 30000,
  autoRegister: true,
  autoLaunch: false,
  clientId: null,
  tenantId: null,
  apiKey: null,
  token: null,
  user: null
};

module.exports = {
  ENVIRONMENTS,
  DEFAULT_CONFIG
};
