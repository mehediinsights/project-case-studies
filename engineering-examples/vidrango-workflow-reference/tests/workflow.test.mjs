import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkflowEngine, WorkflowError } from '../src/workflow.mjs';

function fixture(settings = {}) {
  let time = 10000, counter = 0;
  const engine = new WorkflowEngine({
    now: () => time, newId: () => `ref_${++counter}`,
    leaseMs: 100, retryBaseMs: 50, maxAttempts: 2, ...settings,
  });
  const submit = (extra = {}) => engine.submit({
    ownerId: 'userA', inputId: 'asset1', platforms: ['youtube', 'tiktok'],
    idempotencyKey: 'request1', ...extra,
  });
  return { engine, submit, advance: delta => { time += delta; } };
}

function expectCode(fn, code) {
  assert.throws(fn, e => e instanceof WorkflowError && e.code === code);
}

test('moderation gate prevents unapproved processing', () => {
  const { engine, submit } = fixture();
  const job = submit();
  assert.equal(job.status, 'pending_moderation');
  assert.equal(engine.claim(), null);
  engine.moderate(job.id, 'reject');
  assert.equal(engine.claim(), null);
  expectCode(() => engine.moderate(job.id, 'approve'), 'INVALID_TRANSITION');
});

test('approved job only becomes ready with complete QC outputs', () => {
  const { engine, submit } = fixture();
  const job = submit();
  engine.moderate(job.id, 'approve');
  const claimed = engine.claim();
  expectCode(() => engine.complete(job.id, claimed.leaseToken, {
    qcPassed: true, outputs: { youtube: 'out1' },
  }), 'INVALID_OUTPUTS');
  assert.equal(engine.get('userA', job.id).status, 'processing');
  const ready = engine.complete(job.id, claimed.leaseToken, {
    qcPassed: true, outputs: { youtube: 'out1', tiktok: 'out2' },
  });
  assert.equal(ready.status, 'ready');
  assert.deepEqual(ready.outputs, { tiktok: 'out2', youtube: 'out1' });
  expectCode(() => engine.fail(job.id, claimed.leaseToken), 'INVALID_TRANSITION');
});

test('quality gate fails closed without deliverables', () => {
  const { engine, submit } = fixture();
  const job = submit(); engine.moderate(job.id, 'approve');
  const lease = engine.claim();
  const result = engine.complete(job.id, lease.leaseToken, { qcPassed: false });
  assert.equal(result.status, 'qc_failed');
  assert.equal(result.outputs, null);
  assert.equal(engine.claim(), null);
});

test('scoped idempotency repeats safe request, rejects payload reuse', () => {
  const { engine, submit } = fixture();
  const first = submit();
  assert.deepEqual(first, submit({ platforms: ['tiktok', 'youtube'] }));
  expectCode(() => submit({ inputId: 'asset2' }), 'IDEMPOTENCY_CONFLICT');
  const otherOwner = submit({ ownerId: 'userB' });
  assert.notEqual(otherOwner.id, first.id);
});

test('owner cannot retrieve another owner job', () => {
  const { engine, submit } = fixture();
  const job = submit();
  expectCode(() => engine.get('userB', job.id), 'NOT_FOUND');
  assert.equal(engine.get('userA', job.id).id, job.id);
});

test('worker failure retries with backoff and stops after attempt limit', () => {
  const { engine, submit, advance } = fixture();
  const job = submit(); engine.moderate(job.id, 'approve');
  const first = engine.claim();
  const delayed = engine.fail(job.id, first.leaseToken);
  assert.equal(delayed.status, 'retry_wait');
  assert.equal(engine.claim(), null);
  advance(50);
  const second = engine.claim();
  assert.equal(second.attempt, 2);
  assert.equal(engine.fail(job.id, second.leaseToken).status, 'failed');
  assert.equal(engine.claim(), null);
});

test('expired worker cannot deliver; next worker receives fresh lease', () => {
  const { engine, submit, advance } = fixture();
  const job = submit(); engine.moderate(job.id, 'approve');
  const first = engine.claim();
  advance(101);
  expectCode(() => engine.complete(job.id, first.leaseToken, { qcPassed: false }), 'LEASE_INVALID');
  assert.equal(engine.claim(), null); // expired claim scheduled retry
  advance(50);
  const second = engine.claim();
  assert.notEqual(first.leaseToken, second.leaseToken);
  expectCode(() => engine.complete(job.id, first.leaseToken, { qcPassed: false }), 'LEASE_INVALID');
});

test('invalid platform, duplicate platform, and empty selection rejected', () => {
  const { submit } = fixture();
  for (const platforms of [[], ['unknown'], ['tiktok', 'tiktok']]) {
    expectCode(() => submit({ platforms }), 'INVALID_INPUT');
  }
});

test('returned job is a defensive copy', () => {
  const { engine, submit } = fixture();
  const job = submit();
  job.platforms.push('evil'); job.history.length = 0;
  assert.deepEqual(engine.get('userA', job.id).platforms, ['tiktok', 'youtube']);
  assert.equal(engine.get('userA', job.id).history.length, 1);
});


test('owner-facing job snapshots and idempotent reads never reveal worker lease tokens', () => {
  const { engine, submit } = fixture();
  const job = submit();
  engine.moderate(job.id, 'approve');
  const claimed = engine.claim();
  assert.ok(claimed.leaseToken);
  const snapshot = engine.get('userA', job.id);
  assert.equal(snapshot.status, 'processing');
  assert.equal(Object.hasOwn(snapshot, 'leaseToken'), false);
  const repeated = submit();
  assert.equal(Object.hasOwn(repeated, 'leaseToken'), false);
  expectCode(() => engine.complete(job.id, 'guessed_token', {
    qcPassed: true, outputs: { youtube: 'a1', tiktok: 'a2' },
  }), 'LEASE_INVALID');
});
