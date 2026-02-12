/**
 * Lightweight i18n module for RepairMind Print Client
 *
 * Language is loaded from user preferences (ERP tenant/user settings).
 * Supports dot-notation keys and simple interpolation.
 */

const translations = {
  // ═══════════════════════════════════════════════════════════
  // ENGLISH (fallback)
  // ═══════════════════════════════════════════════════════════
  en: {
    login: {
      title: 'RepairMind Print Client',
      subtitle: 'Sign in with your RepairMind account',
      email: 'Email',
      emailPlaceholder: 'your.email@company.com',
      password: 'Password',
      submit: 'Sign in',
      connecting: 'Connecting...',
      fillAllFields: 'Please fill in all fields',
      error: 'Connection error: {{message}}',
      failed: 'Login failed'
    },
    header: {
      title: 'Print Client',
      subtitle: 'RepairMind print manager'
    },
    env: {
      development: 'Development',
      production: 'Production'
    },
    printers: {
      title: 'Printers',
      noPrinters: 'No printers detected',
      default: 'Default',
      primary: 'Primary',
      setPrimary: 'Set as primary',
      unsetPrimary: 'Remove primary',
      online: 'Online',
      offline: 'Offline',
      test: 'Test',
      testThermal: 'Thermal Receipt',
      testPdf: 'PDF Invoice',
      testLabel: 'Label'
    },
    printerTypes: {
      thermal: 'Thermal',
      label: 'Label Printer',
      laser: 'Laser',
      inkjet: 'Inkjet',
      dotmatrix: 'Dot Matrix',
      generic: 'Printer'
    },
    printerUsage: {
      thermal: 'Receipts, repair tickets',
      label: 'Labels, barcodes, QR codes',
      laser: 'Invoices, quotes, reports',
      inkjet: 'Invoices, quotes, reports',
      dotmatrix: 'Delivery notes, multi-part forms',
      generic: 'General documents'
    },
    jobs: {
      title: 'Recent Jobs',
      noJobs: 'No recent jobs',
      unknownPrinter: 'Unknown printer',
      completed: 'Completed',
      failed: 'Failed ({{retries}}/{{maxRetries}})',
      retrying: 'Retrying ({{retries}}/{{maxRetries}})',
      queued: 'Queued',
      processing: 'Printing...',
      invoice: 'Invoice',
      receipt: 'Receipt',
      ticket: 'Repair Ticket',
      label: 'Label',
      quote: 'Quote',
      report: 'Report',
      delivery_note: 'Delivery Note'
    },
    status: {
      connected: 'Connected',
      disconnected: 'Disconnected'
    },
    queue: {
      inQueue: 'in queue'
    },
    toast: {
      testSent: 'Test {{type}} sent to {{printer}}',
      testFailed: 'Test failed: {{error}}',
      loginSuccess: 'Login successful',
      logoutSuccess: 'Logged out',
      refreshFailed: 'Failed to refresh printers',
      jobFailed: 'Job #{{id}} failed after {{retries}} retries: {{error}}',
      jobRetrying: 'Job #{{id}} retrying ({{retries}}/{{maxRetries}})...',
      primarySet: '{{printer}} set as primary',
      primaryUnset: '{{printer}} is no longer primary',
      primaryFailed: 'Failed to set primary: {{error}}'
    },
    actions: {
      logoutConfirm: 'Are you sure you want to log out?'
    },
    updates: {
      title: 'Update Available',
      available: 'Version {{version}} is available',
      download: 'Download Update',
      downloading: 'Downloading...',
      install: 'Install & Restart',
      downloaded: 'Version {{version}} downloaded — ready to install'
    }
  },

  // ═══════════════════════════════════════════════════════════
  // FRENCH
  // ═══════════════════════════════════════════════════════════
  fr: {
    login: {
      title: 'RepairMind Print Client',
      subtitle: 'Connectez-vous avec votre compte RepairMind',
      email: 'Email',
      emailPlaceholder: 'votre.email@entreprise.com',
      password: 'Mot de passe',
      submit: 'Se connecter',
      connecting: 'Connexion en cours...',
      fillAllFields: 'Veuillez remplir tous les champs',
      error: 'Erreur de connexion : {{message}}',
      failed: 'Échec de la connexion'
    },
    header: {
      title: 'Print Client',
      subtitle: 'Gestionnaire d\'impression RepairMind'
    },
    env: {
      development: 'Développement',
      production: 'Production'
    },
    printers: {
      title: 'Imprimantes',
      noPrinters: 'Aucune imprimante détectée',
      default: 'Par défaut',
      primary: 'Principale',
      setPrimary: 'Définir comme principale',
      unsetPrimary: 'Retirer principale',
      online: 'En ligne',
      offline: 'Hors ligne',
      test: 'Test',
      testThermal: 'Ticket thermique',
      testPdf: 'Facture PDF',
      testLabel: 'Étiquette'
    },
    printerTypes: {
      thermal: 'Thermique',
      label: 'Étiqueteuse',
      laser: 'Laser',
      inkjet: 'Jet d\'encre',
      dotmatrix: 'Matricielle',
      generic: 'Imprimante'
    },
    printerUsage: {
      thermal: 'Tickets, bons de réparation',
      label: 'Étiquettes, codes-barres, QR',
      laser: 'Factures, devis, rapports',
      inkjet: 'Factures, devis, rapports',
      dotmatrix: 'Bons de livraison, liasses',
      generic: 'Documents généraux'
    },
    jobs: {
      title: 'Jobs récents',
      noJobs: 'Aucun job récent',
      unknownPrinter: 'Imprimante inconnue',
      completed: 'Terminé',
      failed: 'Échoué ({{retries}}/{{maxRetries}})',
      retrying: 'Nouvelle tentative ({{retries}}/{{maxRetries}})',
      queued: 'En attente',
      processing: 'Impression...',
      invoice: 'Facture',
      receipt: 'Reçu',
      ticket: 'Bon de réparation',
      label: 'Étiquette',
      quote: 'Devis',
      report: 'Rapport',
      delivery_note: 'Bon de livraison'
    },
    status: {
      connected: 'Connecté',
      disconnected: 'Déconnecté'
    },
    queue: {
      inQueue: 'en attente'
    },
    toast: {
      testSent: 'Test {{type}} envoyé à {{printer}}',
      testFailed: 'Échec du test : {{error}}',
      loginSuccess: 'Connexion réussie',
      logoutSuccess: 'Déconnexion réussie',
      refreshFailed: 'Échec du rafraîchissement des imprimantes',
      jobFailed: 'Job #{{id}} échoué après {{retries}} tentatives : {{error}}',
      jobRetrying: 'Job #{{id}} nouvelle tentative ({{retries}}/{{maxRetries}})...',
      primarySet: '{{printer}} définie comme principale',
      primaryUnset: '{{printer}} n\'est plus principale',
      primaryFailed: 'Échec : {{error}}'
    },
    actions: {
      logoutConfirm: 'Êtes-vous sûr de vouloir vous déconnecter ?'
    },
    updates: {
      title: 'Mise à jour disponible',
      available: 'La version {{version}} est disponible',
      download: 'Télécharger',
      downloading: 'Téléchargement...',
      install: 'Installer et redémarrer',
      downloaded: 'Version {{version}} téléchargée — prête à installer'
    }
  }
};

// ═══════════════════════════════════════════════════════════════
// i18n API
// ═══════════════════════════════════════════════════════════════

let currentLocale = 'en';

/**
 * Set the active locale
 * @param {string} lang - Language code ('fr', 'en')
 */
function setLocale(lang) {
  currentLocale = translations[lang] ? lang : 'en';
}

/**
 * Get the active locale
 * @returns {string}
 */
function getLocale() {
  return currentLocale;
}

/**
 * Translate a key with optional interpolation
 * @param {string} key - Dot-notation key (e.g. 'printers.title')
 * @param {Object} [params] - Interpolation values (e.g. { type: 'pdf' })
 * @returns {string}
 */
function t(key, params) {
  let value = resolve(translations[currentLocale], key);

  // Fallback to English
  if (value === undefined && currentLocale !== 'en') {
    value = resolve(translations.en, key);
  }

  // Fallback to raw key
  if (value === undefined) {
    return key;
  }

  // Interpolation: replace {{var}} with params.var
  if (params) {
    return value.replace(/\{\{(\w+)\}\}/g, (_, k) => params[k] !== undefined ? params[k] : `{{${k}}}`);
  }

  return value;
}

/**
 * Resolve a dot-notation path on an object
 * @param {Object} obj
 * @param {string} path
 * @returns {*}
 */
function resolve(obj, path) {
  if (!obj) return undefined;
  return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}
