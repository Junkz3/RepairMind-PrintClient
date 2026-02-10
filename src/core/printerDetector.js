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
        color: this.supportsColor(systemPrinter),
        duplex: this.supportsDuplex(systemPrinter),
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
    const name = (printer.name + ' ' + (printer.displayName || '')).toLowerCase();

    // Thermal printers
    if (
      name.includes('thermal') ||
      name.includes('receipt') ||
      name.includes('pos') ||
      name.includes('epson tm') ||
      name.includes('star tsp') ||
      name.includes('bixolon') ||
      name.includes('citizen ct')
    ) {
      return 'thermal';
    }

    // Label printers
    if (
      name.includes('label') ||
      name.includes('dymo') ||
      name.includes('brother ql') ||
      name.includes('zebra') ||
      name.includes('godex')
    ) {
      return 'label';
    }

    // Laser printers
    if (
      name.includes('laserjet') ||
      name.includes('laser') ||
      name.includes('hp lj') ||
      name.includes('brother hl') ||
      name.includes('samsung ml')
    ) {
      return 'laser';
    }

    // Dot matrix printers
    if (
      name.includes('dot matrix') ||
      name.includes('epson lq') ||
      name.includes('fx-') ||
      name.includes('dfx-')
    ) {
      return 'dotmatrix';
    }

    // Inkjet printers (default for consumer printers)
    if (
      name.includes('deskjet') ||
      name.includes('officejet') ||
      name.includes('pixma') ||
      name.includes('stylus') ||
      name.includes('expression')
    ) {
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

    if (portName.includes('usb')) return 'usb';
    if (portName.includes('tcp') || portName.includes('ip') || portName.includes('net')) return 'network';
    if (portName.includes('bt') || portName.includes('bluetooth')) return 'bluetooth';
    if (portName.includes('com') || portName.includes('serial')) return 'serial';
    if (portName.includes('lpt') || portName.includes('parallel')) return 'parallel';

    return 'unknown';
  }

  /**
   * Check if printer supports color
   * @param {Object} printer - System printer object
   * @returns {boolean}
   */
  supportsColor(printer) {
    const name = (printer.name + ' ' + (printer.displayName || '')).toLowerCase();

    // Thermal and dot matrix printers are monochrome
    if (name.includes('thermal') || name.includes('dot matrix')) {
      return false;
    }

    // Check for color keywords
    if (name.includes('color') || name.includes('colour')) {
      return true;
    }

    // Default: assume no color (conservative)
    return false;
  }

  /**
   * Check if printer supports duplex (two-sided printing)
   * @param {Object} printer - System printer object
   * @returns {boolean}
   */
  supportsDuplex(printer) {
    const name = (printer.name + ' ' + (printer.displayName || '')).toLowerCase();

    // Thermal, label, and dot matrix don't support duplex
    if (name.includes('thermal') || name.includes('label') || name.includes('dot matrix')) {
      return false;
    }

    // Check for duplex keywords
    if (name.includes('duplex') || name.includes('double') || name.includes('mfp')) {
      return true;
    }

    // Default: no duplex
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
