/**
 * Spooler Monitor
 *
 * Polls the OS print spooler to track real job status.
 * Works on Windows (Win32 API) and Linux (CUPS) via node-printer.
 *
 * Status flow: sent → printing → completed/failed
 */

const printer = require('@thiagoelg/node-printer');

class SpoolerMonitor {
  constructor({ logger } = {}) {
    // Wrap logger to support both console-style and EventEmitter-style loggers
    if (logger && typeof logger.info === 'function') {
      this.logger = logger;
    } else {
      this.logger = {
        info: (...args) => console.log(...args),
        warn: (...args) => console.warn(...args),
        error: (...args) => console.error(...args),
      };
    }
    this.activeJobs = new Map(); // osJobId -> { printerName, callback, interval }
    this.pollInterval = 2000; // 2 seconds
    this.maxPollTime = 120000; // 2 minutes max monitoring per job
  }

  /**
   * Monitor a print job in the OS spooler
   * @param {string} printerName - System printer name
   * @param {number|string} osJobId - OS spooler job ID
   * @param {Function} onStatusChange - Callback: (status, details) => void
   *   status: 'printing' | 'completed' | 'failed'
   *   details: { message, osStatus }
   * @returns {Function} cancel - Call to stop monitoring
   */
  monitor(printerName, osJobId, onStatusChange) {
    const startTime = Date.now();
    const jobKey = `${printerName}:${osJobId}`;

    // If no valid job ID, resolve immediately as completed (Electron print path)
    if (!osJobId && osJobId !== 0) {
      this.logger.info(`[SpoolerMonitor] No OS job ID — marking as completed`);
      setTimeout(() => onStatusChange('completed', { message: 'Sent to printer (no spooler tracking)' }), 500);
      return () => {};
    }

    const numericJobId = typeof osJobId === 'string' ? parseInt(osJobId, 10) : osJobId;

    this.logger.info(`[SpoolerMonitor] Monitoring job ${numericJobId} on ${printerName}`);

    let lastStatus = null;
    let sawPrinting = false;   // Did we ever see the job actively PRINTING?
    let lastHadError = false;  // Was the last known status an error state?

    const interval = setInterval(() => {
      try {
        // Timeout protection
        if (Date.now() - startTime > this.maxPollTime) {
          this.logger.warn(`[SpoolerMonitor] Timeout monitoring job ${numericJobId} — assuming completed`);
          this._cleanup(jobKey);
          onStatusChange('completed', { message: 'Monitoring timeout — assumed completed', osStatus: lastStatus });
          return;
        }

        let jobInfo;
        try {
          jobInfo = printer.getJob(printerName, numericJobId);
        } catch (err) {
          // Job no longer exists in spooler — determine if completed or cancelled
          this._cleanup(jobKey);
          if (sawPrinting && !lastHadError) {
            // We saw it printing normally then it disappeared → completed
            this.logger.info(`[SpoolerMonitor] Job ${numericJobId} finished printing and removed from spooler`);
            onStatusChange('completed', { message: 'Job finished and removed from spooler' });
          } else if (lastHadError) {
            // Last state was an error (paper out, blocked) then disappeared → likely cancelled
            this.logger.info(`[SpoolerMonitor] Job ${numericJobId} disappeared after error — marking as failed`);
            onStatusChange('failed', { message: 'Job removed from spooler after error (likely cancelled)', osStatus: lastStatus });
          } else {
            // Never saw it print, just disappeared → cancelled or removed
            this.logger.info(`[SpoolerMonitor] Job ${numericJobId} disappeared without printing — marking as failed`);
            onStatusChange('failed', { message: 'Job removed from spooler before printing (cancelled)', osStatus: lastStatus });
          }
          return;
        }

        if (!jobInfo) {
          // Job disappeared from spooler — same logic
          this._cleanup(jobKey);
          if (sawPrinting && !lastHadError) {
            onStatusChange('completed', { message: 'Job completed (removed from spooler)' });
          } else {
            onStatusChange('failed', { message: 'Job removed from spooler (cancelled)', osStatus: lastStatus });
          }
          return;
        }

        // status is an array of status strings
        const statusArr = Array.isArray(jobInfo.status) ? jobInfo.status : [jobInfo.status];
        const statusStr = statusArr.join(',');

        // Only report if status changed
        if (statusStr !== lastStatus) {
          lastStatus = statusStr;
          this.logger.info(`[SpoolerMonitor] Job ${numericJobId} status: ${statusStr}`);
        }

        // Check for terminal states
        if (statusArr.includes('PRINTED')) {
          this._cleanup(jobKey);
          onStatusChange('completed', { message: 'Printing completed', osStatus: statusArr });
          return;
        }

        if (statusArr.includes('CANCELLED')) {
          this._cleanup(jobKey);
          onStatusChange('failed', { message: 'Job cancelled in spooler', osStatus: statusArr });
          return;
        }

        if (statusArr.includes('ABORTED')) {
          this._cleanup(jobKey);
          onStatusChange('failed', { message: 'Job aborted by spooler', osStatus: statusArr });
          return;
        }

        // Check for error states (paper jam, out of paper, etc.)
        if (statusArr.includes('BLOCKED') || statusArr.includes('ERROR') || statusArr.includes('OFFLINE') || statusArr.includes('PAPEROUT') || statusArr.includes('PAPER_OUT')) {
          lastHadError = true;
          // Don't mark as failed yet — these can be temporary
          // Report as still printing but with error details
          onStatusChange('printing', {
            message: `Printer issue: ${statusArr.join(', ')}`,
            osStatus: statusArr,
            hasError: true
          });
          return;
        }

        // PRINTING or PENDING — still in progress
        if (statusArr.includes('PRINTING')) {
          sawPrinting = true;
          lastHadError = false; // Clear error flag when printing resumes
          onStatusChange('printing', { message: 'Printing in progress', osStatus: statusArr });
        }

      } catch (error) {
        this.logger.error(`[SpoolerMonitor] Error polling job ${numericJobId}:`, error.message);
        // Don't fail on transient errors — keep polling
      }
    }, this.pollInterval);

    // Store reference for cleanup
    this.activeJobs.set(jobKey, { interval });

    // Return cancel function
    return () => this._cleanup(jobKey);
  }

  /**
   * Cleanup monitoring for a job
   * @private
   */
  _cleanup(jobKey) {
    const entry = this.activeJobs.get(jobKey);
    if (entry) {
      clearInterval(entry.interval);
      this.activeJobs.delete(jobKey);
    }
  }

  /**
   * Stop all active monitors
   */
  destroy() {
    for (const [key] of this.activeJobs) {
      this._cleanup(key);
    }
  }
}

module.exports = SpoolerMonitor;
