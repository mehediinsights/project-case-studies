import { WorkflowEngine } from '../src/workflow.mjs';

const engine = new WorkflowEngine();
const job = engine.submit({
  ownerId: 'example_user', inputId: 'sample_video',
  platforms: ['youtube_shorts', 'tiktok'], idempotencyKey: 'upload_001',
});
console.log('Submitted:', job.status);
console.log('Before moderation, worker claims:', engine.claim());
engine.moderate(job.id, 'approve');
const lease = engine.claim();
console.log('Worker attempt:', lease.attempt);
const completed = engine.complete(job.id, lease.leaseToken, {
  qcPassed: true,
  outputs: { youtube_shorts: 'render_yt', tiktok: 'render_tt' },
});
console.log('After QC:', completed.status, completed.outputs);
