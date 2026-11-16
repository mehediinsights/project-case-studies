/**
 * Illustrative, single-process workflow engine. NOT VidRango production code.
 * No auth, billing, persistence, moderation model or actual media rendering.
 */
import { randomUUID } from 'node:crypto';

export const PLATFORMS = Object.freeze([
  'youtube', 'youtube_shorts', 'facebook_reels', 'instagram_reels', 'tiktok',
]);

export class WorkflowError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WorkflowError';
    this.code = code;
  }
}

const requireText = (value, field) => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) {
    throw new WorkflowError('INVALID_INPUT', `${field} must be 1-100 alphanumeric, _ or - characters`);
  }
  return value;
};

const copy = value => structuredClone(value);

export class WorkflowEngine {
  constructor({ now = Date.now, newId = randomUUID, maxAttempts = 3, leaseMs = 30_000, retryBaseMs = 1_000 } = {}) {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10 ||
        !Number.isFinite(leaseMs) || leaseMs <= 0 ||
        !Number.isFinite(retryBaseMs) || retryBaseMs <= 0) {
      throw new WorkflowError('INVALID_CONFIG', 'Invalid retry or lease configuration');
    }
    this.now = now;
    this.newId = newId;
    this.maxAttempts = maxAttempts;
    this.leaseMs = leaseMs;
    this.retryBaseMs = retryBaseMs;
    this.jobs = new Map();
    this.idempotency = new Map();
  }

  submit({ ownerId, inputId, platforms, idempotencyKey }) {
    requireText(ownerId, 'ownerId');
    requireText(inputId, 'inputId');
    requireText(idempotencyKey, 'idempotencyKey');
    if (!Array.isArray(platforms) || platforms.length === 0 ||
        platforms.some(p => !PLATFORMS.includes(p)) ||
        new Set(platforms).size !== platforms.length) {
      throw new WorkflowError('INVALID_INPUT', 'Provide unique, supported platforms');
    }
    const ordered = [...platforms].sort();
    const fingerprint = JSON.stringify([inputId, ordered]);
    const key = JSON.stringify([ownerId, idempotencyKey]);
    const previous = this.idempotency.get(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        throw new WorkflowError('IDEMPOTENCY_CONFLICT', 'Key previously used with different input');
      }
      return this.get(ownerId, previous.jobId);
    }
    const timestamp = this.now();
    const job = {
      id: this.newId(), ownerId, inputId, platforms: ordered,
      status: 'pending_moderation', attempts: 0, nextAttemptAt: null,
      leaseToken: null, leaseUntil: null, outputs: null,
      createdAt: timestamp, updatedAt: timestamp,
      history: [{ action: 'submitted', at: timestamp }],
    };
    this.jobs.set(job.id, job);
    this.idempotency.set(key, { jobId: job.id, fingerprint });
    return this.get(ownerId, job.id);
  }

  get(ownerId, jobId) {
    requireText(ownerId, 'ownerId');
    const job = this.jobs.get(jobId);
    if (!job || job.ownerId !== ownerId) {
      throw new WorkflowError('NOT_FOUND', 'Job not found');
    }
    return copy(job);
  }

  /** Trusted moderator action; authentication/authorization belongs to the host application. */
  moderate(jobId, decision) {
    if (!['approve', 'reject'].includes(decision)) {
      throw new WorkflowError('INVALID_INPUT', 'Decision must be approve or reject');
    }
    const job = this.#requireJob(jobId);
    this.#requireStatus(job, 'pending_moderation');
    this.#transition(job, decision === 'approve' ? 'queued' : 'rejected', `moderation_${decision}`);
    return copy(job);
  }

  /** Claim one due job, with a fencing token. Single-process only: not a distributed lock. */
  claim() {
    const at = this.now();
    for (const job of this.jobs.values()) {
      if (job.status === 'processing' && job.leaseUntil <= at) {
        this.#scheduleRetry(job, 'lease_expired');
      }
    }
    for (const job of this.jobs.values()) {
      if (job.status === 'queued' ||
          (job.status === 'retry_wait' && job.nextAttemptAt <= at)) {
        job.attempts += 1;
        job.leaseToken = this.newId();
        job.leaseUntil = at + this.leaseMs;
        job.nextAttemptAt = null;
        this.#transition(job, 'processing', 'worker_claimed');
        return { jobId: job.id, leaseToken: job.leaseToken, inputId: job.inputId,
          platforms: [...job.platforms], attempt: job.attempts };
      }
    }
    return null;
  }

  complete(jobId, leaseToken, { qcPassed, outputs = null }) {
    const job = this.#validateLease(jobId, leaseToken);
    if (qcPassed !== true && qcPassed !== false) {
      throw new WorkflowError('INVALID_INPUT', 'qcPassed must be boolean');
    }
    if (!qcPassed) {
      job.outputs = null;
      this.#releaseLease(job);
      this.#transition(job, 'qc_failed', 'quality_gate_failed');
      return copy(job);
    }
    if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs) ||
        Object.keys(outputs).length !== job.platforms.length ||
        job.platforms.some(platform => !Object.hasOwn(outputs, platform) ||
          typeof outputs[platform] !== 'string' ||
          !/^[a-zA-Z0-9_-]{1,100}$/.test(outputs[platform]))) {
      throw new WorkflowError('INVALID_OUTPUTS', 'One safe output identifier per selected platform required');
    }
    job.outputs = Object.fromEntries(job.platforms.map(p => [p, outputs[p]]));
    this.#releaseLease(job);
    this.#transition(job, 'ready', 'delivery_ready');
    return copy(job);
  }

  fail(jobId, leaseToken) {
    const job = this.#validateLease(jobId, leaseToken);
    this.#scheduleRetry(job, 'worker_failed');
    return copy(job);
  }

  #requireJob(id) {
    const job = this.jobs.get(id);
    if (!job) throw new WorkflowError('NOT_FOUND', 'Job not found');
    return job;
  }

  #requireStatus(job, status) {
    if (job.status !== status) {
      throw new WorkflowError('INVALID_TRANSITION', `Expected ${status}, found ${job.status}`);
    }
  }

  #validateLease(id, token) {
    const job = this.#requireJob(id);
    this.#requireStatus(job, 'processing');
    if (!token || token !== job.leaseToken || this.now() >= job.leaseUntil) {
      throw new WorkflowError('LEASE_INVALID', 'Worker lease is expired or stale');
    }
    return job;
  }

  #releaseLease(job) {
    job.leaseToken = null;
    job.leaseUntil = null;
  }

  #scheduleRetry(job, action) {
    this.#releaseLease(job);
    job.outputs = null;
    if (job.attempts >= this.maxAttempts) {
      job.nextAttemptAt = null;
      this.#transition(job, 'failed', action);
    } else {
      job.nextAttemptAt = this.now() + Math.min(this.retryBaseMs * 2 ** (job.attempts - 1), 3_600_000);
      this.#transition(job, 'retry_wait', action);
    }
  }

  #transition(job, status, action) {
    job.status = status;
    job.updatedAt = this.now();
    job.history.push({ action, at: job.updatedAt });
  }
}
