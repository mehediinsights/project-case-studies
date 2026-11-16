import { ResearchWorkspace } from '../src/pipeline.mjs';

// All names and URLs are invented illustrative data; no website requests occur.
const workspace = new ResearchWorkspace();
const { business } = workspace.discover({
  ownerId: 'demo_owner',
  name: 'Example Design Studio',
  industry: 'Professional services',
  website: 'https://www.example.org/',
  sourceUrl: 'https://directory.example.com/listing/demo',
});
const finding = workspace.recordFinding({
  ownerId: 'demo_owner', businessId: business.id,
  type: 'missing_canonical',
  evidenceUrl: 'https://www.example.org/',
  note: 'Illustrative observation; hypothetical human review required',
  observedAt: '2026-11-16T00:00:00Z',
});
workspace.verifyFinding({
  ownerId: 'demo_owner', businessId: business.id,
  findingId: finding.id, decision: 'verified', reviewerId: 'demo_reviewer',
});
const matches = workspace.matchServices({ownerId:'demo_owner', businessId:business.id});
const reviewed = workspace.reviewResearch({
  ownerId: 'demo_owner', businessId: business.id, decision: 'research_accepted',
  reviewerId: 'demo_reviewer', note: 'Approved for internal research review, not outreach',
});
console.log(JSON.stringify({
  domain: reviewed.domain, stage: reviewed.stage,
  matches: matches.map(m => m.serviceId),
  outreachPermission: reviewed.outreachPermission,
  emailSent: false,
}, null, 2));
