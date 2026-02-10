/**
 * Print Executor
 *
 * Executes print jobs on local printers.
 * Supports different document types and printer types.
 */

const printer = require('@thiagoelg/node-printer');
const { ThermalPrinter, PrinterTypes } = require('node-thermal-printer');
const PDFDocument = require('pdfkit');
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
   * @returns {Promise<void>}
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

      case 'label':
      case 'barcode':
      case 'qrcode':
        return this.printLabel(job, printerInfo);

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

    // Total
    printer.alignRight();
    printer.bold(true);
    printer.setTextDoubleHeight();
    printer.println(`TOTAL: ${content.total?.toFixed(2) || '0.00'} EUR`);
    printer.setTextNormal();
    printer.bold(false);
    printer.newLine();

    // Footer
    if (content.footer) {
      printer.alignCenter();
      printer.println(content.footer);
    }

    printer.newLine();
    printer.alignCenter();
    printer.println('Merci de votre visite !');
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
          // Print PDF using system printer
          printer.printFile({
            filename: pdfPath,
            printer: printerInfo.systemName,
            success: (jobID) => {
              // Clean up temp file
              setTimeout(() => {
                if (fs.existsSync(pdfPath)) {
                  fs.unlinkSync(pdfPath);
                }
              }, 5000);

              resolve();
            },
            error: (err) => {
              reject(new Error(`PDF print failed: ${err.message}`));
            }
          });
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
   * Print label (barcode/QR code)
   * @param {Object} job - Print job
   * @param {Object} printerInfo - Printer info
   * @returns {Promise<void>}
   */
  async printLabel(job, printerInfo) {
    // TODO: Implement label printing (Dymo, Brother, Zebra)
    // This requires specific drivers for label printers
    throw new Error('Label printing not yet implemented');
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
