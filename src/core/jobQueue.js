/**
 * Job Queue v2.1 - Bulletproof per-printer parallel processing
 *
 * Fixes over v2:
 * - Race condition guard: processNext() uses _processingLock to prevent concurrent starts
 * - Duplicate array entries: re-enqueue removes old terminal entry before pushing new one
 * - Debounced save: batches writeFileSync calls to avoid I/O bottleneck
 * - Atomic save: writes to .tmp then renames to prevent corruption on crash
 * - printerSystemName validation on enqueue
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

const PRIORITY = { urgent: 0, normal: 1, low: 2 };

class JobQueue extends EventEmitter {
  constructor(options = {}) {
    super();

    this.storePath = options.storePath || path.join(require('os').tmpdir(), 'repairmind-print', 'job-queue.json');
    this.maxRetries = options.maxRetries || 3;
    this.retryDelays = options.retryDelays || [5000, 15000, 60000];
    this.maxCompletedJobs = options.maxCompletedJobs || 100;
    this.defaultTTL = options.defaultTTL || 24 * 60 * 60 * 1000; // 24 hours

    this.jobs = [];
    this.processingPrinters = new Set(); // Track which printers are currently busy
    this._processingLock = false; // Guard against concurrent processNext() calls
    this.retryTimer = null;
    this.expirationTimer = null;
    this.executeCallback = null;

    // Debounced save
    this._saveTimer = null;
    this._saveDelay = 200; // ms — batch rapid save() calls

    // Metrics
    this.metrics = {
      totalEnqueued: 0,
      totalCompleted: 0,
      totalFailed: 0,
      totalExpired: 0,
      totalDeduplicated: 0,
      startedAt: Date.now()
    };

    this.load();
  }

  /**
   * Set the callback that executes a job
   * @param {Function} callback - async (job) => void
   */
  setExecuteCallback(callback) {
    this.executeCallback = callback;
  }

  /**
   * Add a job to the queue with idempotency check
   * @param {Object} job - Print job from backend
   * @param {Object} options - { priority: 'urgent'|'normal'|'low', ttl: ms }
   * @returns {boolean} true if enqueued, false if duplicate
   */
  enqueue(job, options = {}) {
    // Validate required fields
    const printerName = job.printerSystemName;
    if (!printerName) {
      this.emit('error', new Error(`Job ${job.id} rejected: missing printerSystemName`));
      return false;
    }

    // Idempotency: reject if job ID already exists and is not terminal
    const existingIdx = this.jobs.findIndex(j => j.id === job.id);
    if (existingIdx >= 0) {
      const existing = this.jobs[existingIdx];
      if (existing.status === 'queued' || existing.status === 'processing') {
        this.metrics.totalDeduplicated++;
        this.emit('job-deduplicated', { id: job.id });
        return false;
      }
      // Remove old terminal entry to prevent duplicates in array
      this.jobs.splice(existingIdx, 1);
    }

    const ttl = options.ttl || this.defaultTTL;
    const priority = options.priority || job.options?.priority || 'normal';

    const entry = {
      id: job.id,
      job,
      printerSystemName: printerName,
      status: 'queued',
      priority,
      retries: 0,
      maxRetries: this.maxRetries,
      nextRetry: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: Date.now() + ttl,
      error: null
    };

    this.jobs.push(entry);
    this.metrics.totalEnqueued++;
    this.save();
    this.emit('job-queued', entry);
    this.processNext();
    return true;
  }

  /**
   * Process the next queued job for each idle printer
   * This enables parallel printing across different printers
   */
  processNext() {
    if (!this.executeCallback) return;

    // Guard: prevent concurrent processNext() from starting duplicate jobs
    if (this._processingLock) return;
    this._processingLock = true;

    try {
      // Find all queued jobs ready to process, sorted by priority then creation time
      const readyJobs = this.jobs
        .filter(j =>
          j.status === 'queued' &&
          (j.nextRetry === null || j.nextRetry <= Date.now()) &&
          !this.processingPrinters.has(j.printerSystemName)
        )
        .sort((a, b) => {
          const pa = PRIORITY[a.priority] ?? 1;
          const pb = PRIORITY[b.priority] ?? 1;
          if (pa !== pb) return pa - pb;
          return a.createdAt - b.createdAt;
        });

      // Start one job per idle printer (parallel)
      for (const entry of readyJobs) {
        if (this.processingPrinters.has(entry.printerSystemName)) continue;
        this._processJob(entry);
      }
    } finally {
      this._processingLock = false;
    }
  }

  /**
   * Process a single job (runs concurrently per printer)
   * @private
   */
  async _processJob(entry) {
    this.processingPrinters.add(entry.printerSystemName);
    entry.status = 'processing';
    entry.updatedAt = Date.now();
    this.save();
    this.emit('job-processing', entry);

    try {
      await this.executeCallback(entry.job);

      entry.status = 'completed';
      entry.updatedAt = Date.now();
      entry.error = null;
      this.metrics.totalCompleted++;
      this.save();
      this.emit('job-completed', entry);

    } catch (error) {
      entry.error = error.message;
      entry.updatedAt = Date.now();

      if (entry.retries < entry.maxRetries) {
        entry.retries++;
        const delay = this.retryDelays[Math.min(entry.retries - 1, this.retryDelays.length - 1)];
        entry.nextRetry = Date.now() + delay;
        entry.status = 'queued';
        this.save();
        this.emit('job-retrying', { ...entry, delay });
      } else {
        entry.status = 'failed';
        this.metrics.totalFailed++;
        this.save();
        this.emit('job-failed', entry);
      }
    }

    this.processingPrinters.delete(entry.printerSystemName);
    this.trimHistory();

    // Continue processing next job for this printer
    this.processNext();
  }

  /**
   * Start timers for retry checking and TTL expiration
   */
  startRetryTimer() {
    if (this.retryTimer) return;

    // Retry timer — check every 5 seconds
    this.retryTimer = setInterval(() => {
      this.processNext();
    }, 5000);

    // Expiration timer — check every 60 seconds
    if (!this.expirationTimer) {
      this.expirationTimer = setInterval(() => {
        this._expireJobs();
      }, 60000);
    }
  }

  /**
   * Stop all timers
   */
  stopRetryTimer() {
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.expirationTimer) {
      clearInterval(this.expirationTimer);
      this.expirationTimer = null;
    }
  }

  /**
   * Expire jobs that exceeded their TTL
   * @private
   */
  _expireJobs() {
    const now = Date.now();
    let changed = false;

    for (const job of this.jobs) {
      if (job.status === 'queued' && job.expiresAt && job.expiresAt < now) {
        job.status = 'expired';
        job.updatedAt = now;
        job.error = 'Job expired (TTL exceeded)';
        this.metrics.totalExpired++;
        this.emit('job-expired', job);
        changed = true;
      }
    }

    if (changed) this.save();
  }

  /**
   * Get queue statistics
   */
  getStats() {
    const stats = { queued: 0, processing: 0, completed: 0, failed: 0, expired: 0, total: this.jobs.length };
    for (const job of this.jobs) {
      if (stats[job.status] !== undefined) stats[job.status]++;
    }
    return {
      ...stats,
      activePrinters: this.processingPrinters.size,
      metrics: { ...this.metrics }
    };
  }

  /**
   * Get recent jobs for UI display
   */
  getRecentJobs(limit = 20) {
    return [...this.jobs]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
      .map(entry => ({
        id: entry.id,
        job: entry.job,
        printerSystemName: entry.printerSystemName,
        status: entry.status,
        priority: entry.priority,
        retries: entry.retries,
        maxRetries: entry.maxRetries,
        error: entry.error,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        expiresAt: entry.expiresAt
      }));
  }

  /**
   * Cancel a specific job
   * @param {string} jobId
   * @returns {boolean} true if cancelled
   */
  cancelJob(jobId) {
    const job = this.jobs.find(j => j.id === jobId);
    if (!job || job.status === 'processing') return false;

    job.status = 'cancelled';
    job.updatedAt = Date.now();
    job.error = 'Cancelled by user';
    this.save();
    this.emit('job-cancelled', job);
    return true;
  }

  /**
   * Remove old completed/failed/expired jobs to prevent unbounded growth
   */
  trimHistory() {
    const terminal = this.jobs.filter(j =>
      j.status === 'completed' || j.status === 'failed' || j.status === 'expired' || j.status === 'cancelled'
    );
    if (terminal.length > this.maxCompletedJobs) {
      terminal.sort((a, b) => a.updatedAt - b.updatedAt);
      const toRemove = terminal.slice(0, terminal.length - this.maxCompletedJobs);
      const removeIds = new Set(toRemove.map(j => j.id));
      this.jobs = this.jobs.filter(j => !removeIds.has(j.id));
      this.save();
    }
  }

  /**
   * Load jobs from disk
   */
  load() {
    try {
      const dir = path.dirname(this.storePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Try main file first, fallback to .tmp if main is corrupt/missing
      let raw = null;
      if (fs.existsSync(this.storePath)) {
        try {
          raw = fs.readFileSync(this.storePath, 'utf-8');
          JSON.parse(raw); // Validate JSON
        } catch (_) {
          raw = null;
        }
      }
      if (!raw && fs.existsSync(this.storePath + '.tmp')) {
        try {
          raw = fs.readFileSync(this.storePath + '.tmp', 'utf-8');
          JSON.parse(raw); // Validate JSON
        } catch (_) {
          raw = null;
        }
      }

      if (raw) {
        const data = JSON.parse(raw);
        this.jobs = data.jobs || [];

        if (data.metrics) {
          Object.assign(this.metrics, data.metrics);
        }

        const now = Date.now();

        for (const job of this.jobs) {
          // Reset crashed processing jobs
          if (job.status === 'processing') {
            job.status = 'queued';
            job.nextRetry = null;
            job.updatedAt = now;
          }
          // Expire old jobs
          if (job.status === 'queued' && job.expiresAt && job.expiresAt < now) {
            job.status = 'expired';
            job.updatedAt = now;
            job.error = 'Job expired (TTL exceeded)';
            this.metrics.totalExpired++;
          }
          // Backfill expiresAt for old jobs without it
          if (!job.expiresAt && (job.status === 'queued')) {
            job.expiresAt = now + this.defaultTTL;
          }
          // Backfill priority
          if (!job.priority) {
            job.priority = 'normal';
          }
          // Backfill printerSystemName
          if (!job.printerSystemName && job.job) {
            job.printerSystemName = job.job.printerSystemName;
          }
        }

        this._saveNow(); // Immediate save after recovery (not debounced)
      }
    } catch (error) {
      this.jobs = [];
    }
  }

  /**
   * Save jobs to disk (debounced to avoid I/O bottleneck)
   * Multiple rapid calls are batched into a single write.
   */
  save() {
    if (this._saveTimer) return; // Already scheduled

    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._saveNow();
    }, this._saveDelay);
  }

  /**
   * Immediate save — atomic write (tmp + rename) to prevent corruption
   * @private
   */
  _saveNow() {
    try {
      const dir = path.dirname(this.storePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmpPath = this.storePath + '.tmp';
      const data = JSON.stringify({
        jobs: this.jobs,
        metrics: this.metrics,
        savedAt: Date.now()
      }, null, 2);
      fs.writeFileSync(tmpPath, data, 'utf-8');
      fs.renameSync(tmpPath, this.storePath);
    } catch (error) {
      this.emit('error', new Error(`Failed to save job queue: ${error.message}`));
    }
  }

  /**
   * Destroy the queue (stop timers)
   */
  destroy() {
    this.stopRetryTimer();
    // Flush any pending debounced save immediately
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this._saveNow();
  }
}

JobQueue.PRIORITY = PRIORITY;
module.exports = JobQueue;
