/**
 * Job Queue - Persistent job queue with retry support
 *
 * Stores print jobs in a JSON file so they survive app restarts.
 * Failed jobs are automatically retried with exponential backoff.
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

class JobQueue extends EventEmitter {
  constructor(options = {}) {
    super();

    this.storePath = options.storePath || path.join(require('os').tmpdir(), 'repairmind-print', 'job-queue.json');
    this.maxRetries = options.maxRetries || 3;
    this.retryDelays = options.retryDelays || [5000, 15000, 60000]; // 5s, 15s, 1min
    this.maxCompletedJobs = options.maxCompletedJobs || 50;

    this.jobs = [];
    this.processing = false;
    this.retryTimer = null;
    this.executeCallback = null; // set by PrintClientCore

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
   * Add a job to the queue
   * @param {Object} job - Print job from backend
   */
  enqueue(job) {
    const entry = {
      id: job.id,
      job,
      status: 'queued',
      retries: 0,
      maxRetries: this.maxRetries,
      nextRetry: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      error: null
    };

    this.jobs.push(entry);
    this.save();
    this.emit('job-queued', entry);
    this.processNext();
  }

  /**
   * Process the next queued job
   */
  async processNext() {
    if (this.processing) return;
    if (!this.executeCallback) return;

    // Find next job ready to process
    const entry = this.jobs.find(j =>
      j.status === 'queued' && (j.nextRetry === null || j.nextRetry <= Date.now())
    );

    if (!entry) return;

    this.processing = true;
    entry.status = 'processing';
    entry.updatedAt = Date.now();
    this.save();
    this.emit('job-processing', entry);

    try {
      await this.executeCallback(entry.job);

      entry.status = 'completed';
      entry.updatedAt = Date.now();
      entry.error = null;
      this.save();
      this.emit('job-completed', entry);

    } catch (error) {
      entry.error = error.message;
      entry.updatedAt = Date.now();

      if (entry.retries < entry.maxRetries) {
        // Schedule retry
        entry.retries++;
        const delay = this.retryDelays[Math.min(entry.retries - 1, this.retryDelays.length - 1)];
        entry.nextRetry = Date.now() + delay;
        entry.status = 'queued';
        this.save();
        this.emit('job-retrying', { ...entry, delay });
      } else {
        // Max retries reached — permanently failed
        entry.status = 'failed';
        this.save();
        this.emit('job-failed', entry);
      }
    }

    this.processing = false;

    // Trim old completed/failed jobs
    this.trimHistory();

    // Process next in queue
    this.processNext();
  }

  /**
   * Start the retry timer
   */
  startRetryTimer() {
    if (this.retryTimer) return;
    this.retryTimer = setInterval(() => {
      this.processNext();
    }, 5000);
  }

  /**
   * Stop the retry timer
   */
  stopRetryTimer() {
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /**
   * Get queue statistics
   */
  getStats() {
    const stats = { queued: 0, processing: 0, completed: 0, failed: 0, total: this.jobs.length };
    for (const job of this.jobs) {
      if (stats[job.status] !== undefined) stats[job.status]++;
    }
    return stats;
  }

  /**
   * Get recent jobs for UI display
   * @param {number} limit
   */
  getRecentJobs(limit = 20) {
    return [...this.jobs]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
      .map(entry => ({
        id: entry.id,
        job: entry.job,
        status: entry.status,
        retries: entry.retries,
        maxRetries: entry.maxRetries,
        error: entry.error,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt
      }));
  }

  /**
   * Remove old completed/failed jobs to prevent unbounded growth
   */
  trimHistory() {
    const terminal = this.jobs.filter(j => j.status === 'completed' || j.status === 'failed');
    if (terminal.length > this.maxCompletedJobs) {
      // Sort by updatedAt ascending, remove oldest
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
      // Ensure directory exists
      const dir = path.dirname(this.storePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (fs.existsSync(this.storePath)) {
        const data = JSON.parse(fs.readFileSync(this.storePath, 'utf-8'));
        this.jobs = data.jobs || [];

        // Reset any jobs that were processing when app crashed → re-queue them
        for (const job of this.jobs) {
          if (job.status === 'processing') {
            job.status = 'queued';
            job.nextRetry = null;
            job.updatedAt = Date.now();
          }
        }
      }
    } catch (error) {
      // Corrupted file — start fresh
      this.jobs = [];
    }
  }

  /**
   * Save jobs to disk
   */
  save() {
    try {
      const dir = path.dirname(this.storePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.storePath, JSON.stringify({ jobs: this.jobs }, null, 2), 'utf-8');
    } catch (error) {
      this.emit('error', new Error(`Failed to save job queue: ${error.message}`));
    }
  }

  /**
   * Destroy the queue (stop timers)
   */
  destroy() {
    this.stopRetryTimer();
    this.save();
  }
}

module.exports = JobQueue;
