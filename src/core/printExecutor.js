/**
 * Print Executor
 *
 * Executes print jobs on local printers.
 * Supports different document types and printer types.
 */

const printer = require('@thiagoelg/node-printer');
const { ThermalPrinter, PrinterTypes } = require('node-thermal-printer');
const PDFDocument = require('pdfkit');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

class PrintExecutor {
  constructor() {
    this.tempDir = path.join(os.tmpdir(), 'repairmind-print');
    this.ensureTempDir();
  }

  /**
   * Ensure temp directory exists
   */
  ensureTempDir() {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Execute a print job
   * @param {Object} job - Print job object
   * @param {Object} printerInfo - Printer information
   * @returns {Promise<{osJobId: number|null}>} OS spooler job ID if available
   */
  async executePrintJob(job, printerInfo) {
    switch (job.documentType) {
      case 'receipt':
      case 'ticket':
        return this.printThermal(job, printerInfo);

      case 'invoice':
      case 'quote':
      case 'delivery_note':
      case 'report':
        return this.printPDF(job, printerInfo);

      case 'pdf_raw':
        return this.printPDFFromSource(job, printerInfo);

      case 'label':
      case 'barcode':
      case 'qrcode':
        return this.printLabel(job, printerInfo);

      case 'raw':
        return this.printRaw(job, printerInfo);

      default:
        throw new Error(`Unsupported document type: ${job.documentType}`);
    }
  }

  /**
   * Print thermal receipt/ticket
   * @param {Object} job - Print job
   * @param {Object} printerInfo - Printer info
   * @returns {Promise<void>}
   */
  async printThermal(job, printerInfo) {
    try {
      // Detect printer type (EPSON or STAR)
      const printerType = this.detectThermalPrinterType(printerInfo.systemName);

      const thermalPrinter = new ThermalPrinter({
        type: printerType,
        interface: `printer:${printerInfo.systemName}`,
        driver: printer,
        width: job.options?.paperSize === '58mm' ? 32 : 48,
        characterSet: 'PC437_USA'
      });

      const isConnected = await thermalPrinter.isPrinterConnected();
      if (!isConnected) {
        throw new Error('Thermal printer not connected');
      }

      // Build thermal receipt
      await this.buildThermalReceipt(thermalPrinter, job.content);

      // Execute print
      await thermalPrinter.execute();

      // Clear buffer
      thermalPrinter.clear();
    } catch (error) {
      throw new Error(`Thermal print failed: ${error.message}`);
    }
  }

  /**
   * Build thermal receipt content
   * @param {ThermalPrinter} printer - Thermal printer instance
   * @param {Object} content - Receipt content
   * @returns {Promise<void>}
   */
  async buildThermalReceipt(printer, content) {
    printer.alignCenter();
    printer.bold(true);
    printer.setTextDoubleHeight();
    printer.println(content.storeName || 'RepairMind');
    printer.setTextNormal();
    printer.bold(false);
    printer.newLine();

    if (content.storeAddress) {
      printer.println(content.storeAddress);
    }

    printer.drawLine();

    // Ticket/Receipt number
    if (content.ticketNumber || content.receiptNumber) {
      printer.alignCenter();
      printer.bold(true);
      printer.println(`#${content.ticketNumber || content.receiptNumber}`);
      printer.bold(false);
      printer.newLine();
    }

    // Date
    printer.alignLeft();
    printer.println(`Date: ${new Date().toLocaleString()}`);
    printer.newLine();

    // Client info
    if (content.clientName) {
      printer.println(`Client: ${content.clientName}`);
    }
    if (content.phone) {
      printer.println(`Phone: ${content.phone}`);
    }
    printer.newLine();

    // Items
    if (content.items && content.items.length > 0) {
      printer.drawLine();

      for (const item of content.items) {
        printer.leftRight(
          `${item.quantity}x ${item.description}`,
          `${(item.price * item.quantity).toFixed(2)}`
        );
      }

      printer.drawLine();
    }

    // Total (only if provided)
    if (content.total !== undefined && content.total !== null) {
      printer.alignRight();
      printer.bold(true);
      printer.setTextDoubleHeight();
      printer.println(`TOTAL: ${content.total.toFixed(2)} EUR`);
      printer.setTextNormal();
      printer.bold(false);
      printer.newLine();
    }

    // Footer
    if (content.footer) {
      printer.alignCenter();
      printer.println(content.footer);
    }

    // Thank you message (only for real receipts with items)
    if (content.items && content.items.length > 0) {
      printer.newLine();
      printer.alignCenter();
      printer.println('Merci de votre visite !');
    }

    printer.newLine();
    printer.newLine();

    // Cut paper
    printer.cut();
  }

  /**
   * Print PDF document
   * @param {Object} job - Print job
   * @param {Object} printerInfo - Printer info
   * @returns {Promise<void>}
   */
  async printPDF(job, printerInfo) {
    // If backend sent a pre-rendered PDF (URL or base64), print it directly
    if (job.content.pdfUrl || job.content.pdfBase64) {
      return this.printPDFFromSource(job, printerInfo);
    }

    // Otherwise generate PDF from structured content (legacy behavior)
    return new Promise((resolve, reject) => {
      try {
        const pdfPath = path.join(this.tempDir, `job_${job.id}.pdf`);

        // Create PDF
        const doc = new PDFDocument({
          size: job.options?.paperSize || 'A4',
          margins: job.options?.margins || { top: 50, bottom: 50, left: 50, right: 50 }
        });

        const stream = fs.createWriteStream(pdfPath);

        doc.pipe(stream);

        // Build PDF content
        this.buildPDFDocument(doc, job.content, job.documentType);

        doc.end();

        stream.on('finish', () => {
          this.sendFileToPrinter(pdfPath, printerInfo.systemName)
            .then(resolve)
            .catch(reject);
        });

        stream.on('error', (error) => {
          reject(new Error(`PDF creation failed: ${error.message}`));
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Print a PDF from URL or base64 source
   * @param {Object} job - Print job with content.pdfUrl or content.pdfBase64
   * @param {Object} printerInfo - Printer info
   */
  async printPDFFromSource(job, printerInfo) {
    const pdfPath = path.join(this.tempDir, `job_${job.id}.pdf`);

    try {
      if (job.content.pdfUrl) {
        // Download PDF from URL
        await this.downloadFile(job.content.pdfUrl, pdfPath);
      } else if (job.content.pdfBase64) {
        // Decode base64 to file
        const buffer = Buffer.from(job.content.pdfBase64, 'base64');
        fs.writeFileSync(pdfPath, buffer);
      } else {
        throw new Error('No PDF source provided (pdfUrl or pdfBase64 required)');
      }

      await this.sendFileToPrinter(pdfPath, printerInfo.systemName);
    } catch (error) {
      throw new Error(`PDF print failed: ${error.message}`);
    }
  }

  /**
   * Download a file from URL to local path
   * @param {string} url - Source URL
   * @param {string} destPath - Destination file path
   */
  async downloadFile(url, destPath, _redirectCount = 0) {
    // Guard against infinite redirects
    if (_redirectCount > 5) {
      throw new Error('Download failed: too many redirects');
    }

    const https = url.startsWith('https') ? require('https') : require('http');

    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };

      const file = fs.createWriteStream(destPath);

      // Timeout: 30s for download
      const timer = setTimeout(() => {
        req.destroy();
        file.close();
        if (fs.existsSync(destPath)) try { fs.unlinkSync(destPath); } catch (_) {}
        settle(reject, new Error('Download failed: timeout (30s)'));
      }, 30000);

      const req = https.get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          clearTimeout(timer);
          file.close();
          if (fs.existsSync(destPath)) try { fs.unlinkSync(destPath); } catch (_) {}
          return this.downloadFile(response.headers.location, destPath, _redirectCount + 1)
            .then(r => settle(resolve, r)).catch(e => settle(reject, e));
        }

        if (response.statusCode !== 200) {
          clearTimeout(timer);
          file.close();
          if (fs.existsSync(destPath)) try { fs.unlinkSync(destPath); } catch (_) {}
          return settle(reject, new Error(`Download failed: HTTP ${response.statusCode}`));
        }

        response.pipe(file);

        file.on('finish', () => {
          clearTimeout(timer);
          file.close(() => settle(resolve));
        });
      });

      req.on('error', (error) => {
        clearTimeout(timer);
        file.close();
        if (fs.existsSync(destPath)) try { fs.unlinkSync(destPath); } catch (_) {}
        settle(reject, new Error(`Download failed: ${error.message}`));
      });
    });
  }

  /**
   * Send a file to a system printer (platform-aware)
   * @param {string} filePath - Path to file to print
   * @param {string} printerName - System printer name
   * @returns {Promise<{osJobId: number|null}>} OS spooler job ID if available
   */
  sendFileToPrinter(filePath, printerName, options = {}) {
    const cleanupLater = () => {
      setTimeout(() => {
        if (fs.existsSync(filePath)) {
          try { fs.unlinkSync(filePath); } catch (_) {}
        }
      }, 15000);
    };

    // Windows/macOS: use Electron's webContents.print() — Chromium rasterizes the PDF
    // via the OS printer driver. Works with all printers (label, thermal, inkjet, laser).
    if (process.platform === 'win32' || process.platform === 'darwin') {
      try {
        const { BrowserWindow } = require('electron');
        return this.printFileElectron(filePath, printerName, BrowserWindow, options)
          .then(() => { cleanupLater(); return { osJobId: null }; });
      } catch (_) {
        // Electron not available (CLI mode) — fallback to lpr on macOS
        if (process.platform === 'darwin') {
          return this.printFileUnix(filePath, printerName, 'lpr').then(() => { cleanupLater(); return { osJobId: null }; });
        }
      }
    }

    // Linux: use lp for job ID tracking
    if (process.platform === 'linux') {
      return this.printFileLinux(filePath, printerName).then((result) => { cleanupLater(); return result; });
    }

    // Fallback
    return this.printFileUnix(filePath, printerName, 'lpr').then(() => { cleanupLater(); return { osJobId: null }; });
  }

  /**
   * Print file on Linux using lp (parses job ID from output)
   * @param {string} filePath - Path to file
   * @param {string} printerName - Printer name
   * @returns {Promise<{osJobId: number|null}>}
   */
  printFileLinux(filePath, printerName) {
    return new Promise((resolve, reject) => {
      execFile('lp', ['-d', printerName, filePath], { timeout: 30000 }, (error, stdout) => {
        if (error) {
          reject(new Error(`Print failed: ${error.message}`));
        } else {
          // lp output: "request id is MyPrinter-123 (1 file(s))"
          const match = stdout.match(/request id is \S+-(\d+)/);
          const osJobId = match ? parseInt(match[1], 10) : null;
          resolve({ osJobId });
        }
      });
    });
  }

  /**
   * Print file using Electron's hidden BrowserWindow + webContents.print()
   * Uses Chromium's built-in PDF renderer — works on all platforms.
   * @param {string} filePath - Path to PDF file
   * @param {string} printerName - Target printer name
   * @param {typeof import('electron').BrowserWindow} BrowserWindow
   */
  printFileElectron(filePath, printerName, BrowserWindow, options = {}) {
    return new Promise((resolve, reject) => {
      const win = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      });

      // Load PDF via file:// URL — Chromium renders it natively
      const fileUrl = `file://${filePath.replace(/\\/g, '/')}`;
      win.loadURL(fileUrl);

      win.webContents.on('did-finish-load', () => {
        // Small delay to let the PDF renderer finish
        setTimeout(() => {
          const printOptions = {
            silent: true,
            deviceName: printerName,
            printBackground: true
          };

          // Pass custom page size if provided (width/height in microns)
          if (options.pageSize) {
            printOptions.pageSize = options.pageSize;
          }

          win.webContents.print(printOptions, (success, failureReason) => {
            win.destroy();
            if (success) {
              resolve();
            } else {
              reject(new Error(`Electron print failed: ${failureReason}`));
            }
          });
        }, 500);
      });

      win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        win.destroy();
        reject(new Error(`Failed to load PDF: ${errorDescription}`));
      });

      // Safety timeout
      setTimeout(() => {
        if (!win.isDestroyed()) {
          win.destroy();
          reject(new Error('Print timeout (30s)'));
        }
      }, 30000);
    });
  }

  /**
   * Print file on macOS/Linux using lpr/lp
   * @param {string} filePath - Path to file
   * @param {string} printerName - Printer name
   * @param {string} command - 'lpr' (macOS/Win) or 'lp' (Linux)
   */
  printFileUnix(filePath, printerName, command) {
    return new Promise((resolve, reject) => {
      const args = command === 'lpr'
        ? ['-P', printerName, filePath]
        : ['-d', printerName, filePath];

      execFile(command, args, { timeout: 30000 }, (error) => {
        if (error) {
          reject(new Error(`Print failed: ${error.message}`));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Build PDF document content
   * @param {PDFDocument} doc - PDF document
   * @param {Object} content - Document content
   * @param {string} documentType - Document type
   */
  buildPDFDocument(doc, content, documentType) {
    // Header
    doc.fontSize(20).text(this.getDocumentTitle(documentType), { align: 'center' });
    doc.moveDown();

    // Document number
    if (content.invoiceNumber || content.quoteNumber || content.ticketNumber) {
      doc.fontSize(12).text(
        `N° ${content.invoiceNumber || content.quoteNumber || content.ticketNumber}`,
        { align: 'right' }
      );
    }

    doc.moveDown();

    // Company info
    if (content.companyName) {
      doc.fontSize(10);
      doc.text(content.companyName);
      if (content.companyAddress) doc.text(content.companyAddress);
      if (content.companyPhone) doc.text(`Tel: ${content.companyPhone}`);
    }

    doc.moveDown();

    // Client info
    if (content.clientName) {
      doc.fontSize(10);
      doc.text('Client:');
      doc.text(content.clientName);
      if (content.clientAddress) doc.text(content.clientAddress);
      if (content.clientPhone) doc.text(`Tel: ${content.clientPhone}`);
    }

    doc.moveDown(2);

    // Items table
    if (content.items && content.items.length > 0) {
      // Table header
      doc.fontSize(10).fillColor('black');
      const tableTop = doc.y;
      const descriptionX = 50;
      const quantityX = 350;
      const priceX = 420;
      const totalX = 490;

      doc.text('Description', descriptionX, tableTop);
      doc.text('Qté', quantityX, tableTop);
      doc.text('Prix', priceX, tableTop);
      doc.text('Total', totalX, tableTop);

      doc.moveTo(50, doc.y + 5).lineTo(550, doc.y + 5).stroke();
      doc.moveDown();

      // Table rows
      let yPos = doc.y;

      for (const item of content.items) {
        doc.text(item.description || item.name, descriptionX, yPos, { width: 280 });
        doc.text(item.quantity.toString(), quantityX, yPos);
        doc.text(`${item.price.toFixed(2)}`, priceX, yPos);
        doc.text(`${(item.quantity * item.price).toFixed(2)}`, totalX, yPos);

        yPos += 25;
      }

      doc.moveTo(50, yPos).lineTo(550, yPos).stroke();
      doc.y = yPos + 10;
    }

    doc.moveDown(2);

    // Total
    if (content.total !== undefined) {
      doc.fontSize(14).fillColor('black');
      doc.text(`Total: ${content.total.toFixed(2)} EUR`, { align: 'right' });
    }

    // Footer
    if (content.footer) {
      doc.moveDown(3);
      doc.fontSize(8).fillColor('gray');
      doc.text(content.footer, { align: 'center' });
    }
  }

  /**
   * Print label (ZPL, raw data, or generated PDF label)
   * @param {Object} job - Print job
   * @param {Object} printerInfo - Printer info
   */
  async printLabel(job, printerInfo) {
    const content = job.content;

    // Mode 1: Raw ZPL commands (Zebra printers)
    if (content.zpl) {
      return this.printRawData(content.zpl, printerInfo.systemName, 'RAW');
    }

    // Mode 2: Raw data (any format — EPL, TSPL, etc.)
    if (content.rawData) {
      return this.printRawData(content.rawData, printerInfo.systemName, 'RAW');
    }

    // Mode 3: Pre-rendered label as base64/URL
    if (content.pdfUrl || content.pdfBase64) {
      return this.printPDFFromSource(job, printerInfo);
    }

    // Mode 4: Generate simple label PDF from structured content
    return this.printGeneratedLabel(job, printerInfo);
  }

  /**
   * Generate and print a label using Electron's hidden BrowserWindow.
   * Renders HTML at exact label dimensions with @page CSS, then prints
   * via webContents.print() with matching pageSize in microns.
   * This avoids PDF rasterization issues with label printers (DYMO, etc.).
   *
   * @param {Object} job - Print job
   * @param {Object} printerInfo - Printer info
   */
  async printGeneratedLabel(job, printerInfo) {
    const content = job.content;

    // Label dimensions in mm (default 62x29mm for DYMO standard address)
    const labelWidthMm = job.options?.labelWidthMm || 62;
    const labelHeightMm = job.options?.labelHeightMm || 29;

    // Build HTML label
    const html = this.buildLabelHTML(content, labelWidthMm, labelHeightMm);
    const htmlPath = path.join(this.tempDir, `label_${job.id}.html`);
    fs.writeFileSync(htmlPath, html, 'utf8');

    try {
      const { BrowserWindow } = require('electron');
      await this.printHTMLLabel(htmlPath, printerInfo.systemName, labelWidthMm, labelHeightMm, BrowserWindow);
    } finally {
      // Cleanup
      setTimeout(() => {
        try { if (fs.existsSync(htmlPath)) fs.unlinkSync(htmlPath); } catch (_) {}
      }, 15000);
    }

    return { osJobId: null };
  }

  /**
   * Build HTML string for a label with exact dimensions via @page CSS
   */
  buildLabelHTML(content, widthMm, heightMm) {
    const lines = [];

    if (content.title) {
      lines.push(`<div style="font-size:10pt;font-weight:bold;text-align:center">${this.escapeHTML(content.title)}</div>`);
    }
    if (content.subtitle) {
      lines.push(`<div style="font-size:7pt;text-align:center">${this.escapeHTML(content.subtitle)}</div>`);
    }
    if (content.sku) {
      lines.push(`<div style="font-size:7pt;text-align:center">${this.escapeHTML(content.sku)}</div>`);
    }
    if (content.price) {
      lines.push(`<div style="font-size:12pt;font-weight:bold;text-align:center;margin-top:2mm">${this.escapeHTML(String(content.price))}</div>`);
    }
    if (content.barcodeText) {
      lines.push(`<div style="font-size:6pt;text-align:center;margin-top:1mm">${this.escapeHTML(content.barcodeText)}</div>`);
    }

    // DYMO and most label printers feed the short edge first.
    // Use landscape so text reads naturally on the label.
    return `<!DOCTYPE html>
<html><head><style>
  @page { size: ${widthMm}mm ${heightMm}mm landscape; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${widthMm}mm; height: ${heightMm}mm;
    font-family: Arial, Helvetica, sans-serif;
    display: flex; flex-direction: column;
    justify-content: center; align-items: center;
    padding: 1mm 2mm;
  }
</style></head><body>${lines.join('\n')}</body></html>`;
  }

  /**
   * Escape HTML special characters
   */
  escapeHTML(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /**
   * Print an HTML file to a label printer via Electron BrowserWindow
   */
  printHTMLLabel(htmlPath, printerName, widthMm, heightMm, BrowserWindow) {
    return new Promise((resolve, reject) => {
      const win = new BrowserWindow({
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
      });

      win.loadFile(htmlPath);

      win.webContents.on('did-finish-load', () => {
        setTimeout(() => {
          win.webContents.print({
            silent: true,
            deviceName: printerName,
            printBackground: true,
            landscape: true,
            margins: { marginType: 'none' },
            pageSize: {
              width: widthMm * 1000,   // microns
              height: heightMm * 1000  // microns
            }
          }, (success, failureReason) => {
            win.destroy();
            if (success) {
              resolve();
            } else {
              reject(new Error(`Label print failed: ${failureReason}`));
            }
          });
        }, 300);
      });

      win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        win.destroy();
        reject(new Error(`Failed to load label HTML: ${errorDescription}`));
      });

      setTimeout(() => {
        if (!win.isDestroyed()) {
          win.destroy();
          reject(new Error('Label print timeout (30s)'));
        }
      }, 30000);
    });
  }

  /**
   * Print raw data directly to printer (ZPL, EPL, PCL, PostScript, etc.)
   * @param {string|Buffer} data - Raw data to send
   * @param {string} printerName - System printer name
   * @param {string} doctype - Document type for the driver (RAW, TEXT, etc.)
   */
  printRawData(data, printerName, doctype = 'RAW') {
    return new Promise((resolve, reject) => {
      try {
        printer.printDirect({
          data: typeof data === 'string' ? Buffer.from(data) : data,
          printer: printerName,
          type: doctype,
          success: (jobId) => resolve({ osJobId: jobId ? parseInt(jobId, 10) : null }),
          error: (err) => reject(new Error(`Raw print failed: ${err.message}`))
        });
      } catch (error) {
        reject(new Error(`Raw print failed: ${error.message}`));
      }
    });
  }

  /**
   * Print raw document type (any data sent directly to printer)
   * @param {Object} job - Print job with content.rawData or content.data
   * @param {Object} printerInfo - Printer info
   */
  async printRaw(job, printerInfo) {
    const data = job.content.rawData || job.content.data;
    if (!data) {
      throw new Error('No raw data provided (rawData or data field required)');
    }

    const doctype = job.options?.doctype || 'RAW';
    return this.printRawData(data, printerInfo.systemName, doctype);
  }

  /**
   * Detect thermal printer type (EPSON or STAR)
   * @param {string} printerName - Printer name
   * @returns {string} PrinterTypes constant
   */
  detectThermalPrinterType(printerName) {
    const name = printerName.toLowerCase();

    if (name.includes('star') || name.includes('tsp')) {
      return PrinterTypes.STAR;
    }

    // Default to EPSON (most compatible)
    return PrinterTypes.EPSON;
  }

  /**
   * Get document title based on type
   * @param {string} documentType - Document type
   * @returns {string}
   */
  getDocumentTitle(documentType) {
    const titles = {
      invoice: 'FACTURE',
      quote: 'DEVIS',
      delivery_note: 'BON DE LIVRAISON',
      report: 'RAPPORT',
      ticket: 'BON DE RÉPARATION'
    };

    return titles[documentType] || 'DOCUMENT';
  }
}

module.exports = PrintExecutor;
