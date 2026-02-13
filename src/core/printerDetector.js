/**
 * Printer Detector
 *
 * Detects and identifies local printers (USB, network, system).
 * Determines printer type and capabilities.
 */

const printer = require('@thiagoelg/node-printer');

class PrinterDetector {
  constructor() {
    this.printers = [];
  }

  /**
   * Detect all available printers
   * @returns {Promise<Array>} Array of detected printers
   */
  async detectPrinters() {
    try {
      const systemPrinters = printer.getPrinters();

      this.printers = systemPrinters.map(p => this.mapPrinterInfo(p));

      return this.printers;
    } catch (error) {
      throw new Error(`Failed to detect printers: ${error.message}`);
    }
  }

  /**
   * Map system printer info to RepairMind format
   * @param {Object} systemPrinter - System printer object
   * @returns {Object} Mapped printer info
   */
  mapPrinterInfo(systemPrinter) {
    const type = this.detectPrinterType(systemPrinter);
    const interfaceType = this.detectInterface(systemPrinter);

    return {
      systemName: systemPrinter.name,
      displayName: systemPrinter.displayName || systemPrinter.name,
      type,
      interface: interfaceType,
      driver: systemPrinter.driver || 'Generic',
      capabilities: {
        color: this.supportsColor(systemPrinter, type),
        duplex: this.supportsDuplex(systemPrinter, type),
        paperSizes: this.getSupportedPaperSizes(systemPrinter),
        maxWidth: this.getMaxWidth(type),
        cutter: type === 'thermal' || type === 'label',
        cashDrawer: type === 'thermal'
      },
      metadata: {
        isDefault: systemPrinter.isDefault || false,
        status: systemPrinter.status || 'unknown',
        portName: systemPrinter.portName || null,
        location: systemPrinter.location || null,
        comment: systemPrinter.comment || null
      }
    };
  }

  /**
   * Detect printer type based on name and attributes
   * @param {Object} printer - System printer object
   * @returns {string} Printer type
   */
  detectPrinterType(printer) {
    const name = (printer.name + ' ' + (printer.displayName || '') + ' ' + (printer.driver || '')).toLowerCase();

    // Thermal / POS receipt printers
    const thermalKeywords = [
      'thermal', 'receipt', 'pos ', 'pos-',
      // Epson POS
      'epson tm', 'tm-t', 'tm-m', 'tm-l', 'tm-u', 'tm-p', 'tm-h',
      // Star Micronics
      'star tsp', 'star sm', 'star mc', 'star mp', 'tsp100', 'tsp650', 'tsp700', 'tsp800',
      'mcp31', 'mc-print',
      // Bixolon
      'bixolon', 'srp-', 'spp-', 'spb-',
      // Citizen
      'citizen ct', 'citizen cl', 'ct-s', 'ct-e', 'cl-s',
      // Custom (Italian POS brand)
      'custom kube', 'custom plus', 'custom q',
      // Sewoo / Lukhan
      'sewoo', 'slk-t',
      // Rongta
      'rongta', 'rp328', 'rp80',
      // Xprinter
      'xprinter', 'xp-', 'xp58', 'xp80',
      // Munbyn
      'munbyn',
      // HOIN
      'hoin',
      // SNBC
      'snbc', 'btp-',
      // Sam4s
      'sam4s', 'ellix',
      // Metapace
      'metapace t-',
      // Posiflex / Aures
      'posiflex pp', 'aures odp'
    ];
    if (thermalKeywords.some(k => name.includes(k))) {
      return 'thermal';
    }

    // Label / barcode printers
    const labelKeywords = [
      'label', 'barcode', 'étiquette',
      // Dymo
      'dymo', 'labelwriter', 'labelmanager',
      // Brother label
      'brother ql', 'brother pt', 'brother td', 'ql-', 'pt-p',
      // Zebra
      'zebra', 'zd', 'zt', 'gk4', 'gx4', 'zq', 'tlp', 'lp28',
      // TSC
      'tsc ', 'ttp-', 'tdp-', 'te200', 'te300',
      // Godex
      'godex', 'g500', 'ez',
      // SATO
      'sato', 'cl4nx', 'ct4-lx',
      // Cab
      'cab eos', 'cab mach', 'cab squix',
      // Honeywell / Intermec
      'honeywell pc', 'intermec', 'pm43', 'pm23', 'pc43',
      // Argox
      'argox', 'os-2',
      // Niimbot
      'niimbot', 'b21', 'b1', 'd11'
    ];
    if (labelKeywords.some(k => name.includes(k))) {
      return 'label';
    }

    // Laser printers (check before inkjet — some MFPs match both)
    const laserKeywords = [
      'laserjet', 'laser',
      // HP
      'hp lj', 'hp color lj', 'hp mfp',
      // Brother laser
      'brother hl', 'brother mfc', 'brother dcp', 'hl-l', 'mfc-l', 'dcp-l',
      // Samsung / HP (ex-Samsung)
      'samsung ml', 'samsung clx', 'samsung sl', 'samsung xpress',
      // Canon laser
      'canon lbp', 'imageclass', 'i-sensys', 'imagerunner',
      // Lexmark
      'lexmark ms', 'lexmark mx', 'lexmark cs', 'lexmark cx',
      // Xerox
      'xerox', 'phaser', 'versalink', 'workcentre', 'altalink',
      // Kyocera
      'kyocera', 'ecosys', 'taskalfa',
      // Ricoh
      'ricoh sp', 'ricoh mp', 'ricoh im',
      // Konica Minolta
      'bizhub', 'konica',
      // OKI
      'oki c', 'oki b', 'oki mc', 'oki mb',
      // Pantum
      'pantum'
    ];
    if (laserKeywords.some(k => name.includes(k))) {
      return 'laser';
    }

    // Dot matrix printers
    const dotmatrixKeywords = [
      'dot matrix', 'dotmatrix', 'impact',
      'epson lq', 'epson lx', 'epson fx', 'fx-', 'dfx-', 'lq-', 'lx-',
      'oki ml', 'oki microline',
      'printronix'
    ];
    if (dotmatrixKeywords.some(k => name.includes(k))) {
      return 'dotmatrix';
    }

    // Inkjet printers
    const inkjetKeywords = [
      'inkjet', 'ink jet',
      // HP
      'deskjet', 'officejet', 'envy', 'smart tank', 'hp ink',
      // Canon
      'pixma', 'maxify', 'megatank', 'selphy', 'canon ts',
      // Epson inkjet
      'stylus', 'expression', 'workforce', 'ecotank', 'et-',
      // Brother inkjet
      'brother mfc-j', 'brother dcp-j', 'mfc-j', 'dcp-j'
    ];
    if (inkjetKeywords.some(k => name.includes(k))) {
      return 'inkjet';
    }

    // Default
    return 'generic';
  }

  /**
   * Detect printer interface (USB, network, etc.)
   * @param {Object} printer - System printer object
   * @returns {string} Interface type
   */
  detectInterface(printer) {
    const portName = (printer.portName || '').toLowerCase();
    const name = (printer.name || '').toLowerCase();
    const uri = (printer.uri || printer.options?.['device-uri'] || '').toLowerCase();

    // 1. Check portName (Windows typically provides this)
    if (portName.includes('usb')) return 'usb';
    if (portName.includes('tcp') || portName.includes('ip') || portName.includes('net')) return 'network';
    if (portName.includes('bt') || portName.includes('bluetooth')) return 'bluetooth';
    if (portName.includes('com') || portName.includes('serial')) return 'serial';
    if (portName.includes('lpt') || portName.includes('parallel')) return 'parallel';

    // 2. Check CUPS device-uri (Linux/macOS)
    if (uri) {
      if (uri.startsWith('usb://') || uri.includes('/usb/')) return 'usb';
      if (uri.startsWith('ipp://') || uri.startsWith('ipps://') || uri.startsWith('http://') || uri.startsWith('https://') || uri.startsWith('socket://') || uri.startsWith('lpd://')) return 'network';
      if (uri.startsWith('dnssd://') || uri.includes('._ipp.') || uri.includes('._pdl-datastream.')) return 'network';
      if (uri.startsWith('bluetooth://') || uri.startsWith('bth://')) return 'bluetooth';
      if (uri.startsWith('serial://') || uri.startsWith('/dev/tty')) return 'serial';
      if (uri.startsWith('parallel://') || uri.startsWith('/dev/lp')) return 'parallel';
    }

    // 3. Heuristic: hex suffix in name = network discovery (mDNS/Bonjour/WSD)
    //    e.g. "HP_DeskJet_2800_series_31A660" — the _XXXXXX is the MAC tail
    if (/[_-][0-9a-f]{4,6}$/i.test(printer.name || '')) return 'network';

    // 4. Heuristic from printer name
    if (name.includes('wifi') || name.includes('wireless') || name.includes('airprint')) return 'network';

    return 'unknown';
  }

  /**
   * Check if printer supports color
   * @param {Object} printer - System printer object
   * @returns {boolean}
   */
  supportsColor(printer, type) {
    // Thermal, label, and dot matrix are always monochrome
    if (type === 'thermal' || type === 'dotmatrix' || type === 'label') {
      return false;
    }

    const name = (printer.name + ' ' + (printer.displayName || '')).toLowerCase();
    if (name.includes('color') || name.includes('colour') || name.includes('clx') || name.includes('cs-') || name.includes('oki c')) {
      return true;
    }

    // Inkjet printers are typically color
    if (type === 'inkjet') {
      return true;
    }

    return false;
  }

  /**
   * Check if printer supports duplex (two-sided printing)
   * @param {Object} printer - System printer object
   * @param {string} type - Detected printer type
   * @returns {boolean}
   */
  supportsDuplex(printer, type) {
    // Thermal, label, and dot matrix don't support duplex
    if (type === 'thermal' || type === 'label' || type === 'dotmatrix') {
      return false;
    }

    const name = (printer.name + ' ' + (printer.displayName || '')).toLowerCase();
    if (name.includes('duplex') || name.includes('double') || name.includes('mfp') || name.includes('mfc')) {
      return true;
    }

    return false;
  }

  /**
   * Get supported paper sizes
   * @param {Object} printer - System printer object
   * @returns {Array<string>}
   */
  getSupportedPaperSizes(printer) {
    const type = this.detectPrinterType(printer);

    if (type === 'thermal') {
      return ['80mm', '58mm'];
    }

    if (type === 'label') {
      return ['Label', 'Continuous'];
    }

    // Default office printers
    return ['A4', 'Letter'];
  }

  /**
   * Get max paper width (mm)
   * @param {string} type - Printer type
   * @returns {number}
   */
  getMaxWidth(type) {
    switch (type) {
      case 'thermal':
        return 80;
      case 'label':
        return 62; // Dymo/Brother standard
      case 'laser':
      case 'inkjet':
      case 'generic':
        return 210; // A4 width
      case 'dotmatrix':
        return 240; // Continuous paper
      default:
        return 210;
    }
  }

  /**
   * Check if a specific printer is available
   * @param {string} systemName - System printer name
   * @returns {Promise<boolean>}
   */
  async isPrinterAvailable(systemName) {
    try {
      const printers = printer.getPrinters();
      return printers.some(p => p.name === systemName);
    } catch (error) {
      return false;
    }
  }

  /**
   * Get default printer
   * @returns {Object|null}
   */
  getDefaultPrinter() {
    try {
      const defaultPrinter = printer.getDefaultPrinterName();

      if (defaultPrinter) {
        const printers = printer.getPrinters();
        const systemPrinter = printers.find(p => p.name === defaultPrinter);
        return systemPrinter ? this.mapPrinterInfo(systemPrinter) : null;
      }

      return null;
    } catch (error) {
      return null;
    }
  }
}

module.exports = PrinterDetector;
