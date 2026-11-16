import test from 'node:test';
import assert from 'node:assert/strict';
import { ResearchWorkspace, ResearchError, FINDING_TO_SERVICE } from '../src/pipeline.mjs';

function setup() {
  let id = 0;
  const workspace = new ResearchWorkspace({
    now: () => '2026-11-16T00:00:00.000Z',
    newId: () => `ref_${++id}`,
  });
  const input = {
    ownerId: 'ownerA', name: 'Example Studio', industry: 'Design',
    website: 'https://www.example.org/', sourceUrl: 'https://directory.example.com/listing/123',
  };
  const business = workspace.discover(input).business;
  return { workspace, business, input };
}
function code(fn, expected) {
  assert.throws(fn, e => e instanceof ResearchError && e.code === expected);
}
function findingInput(businessId, overrides = {}) {
  return {
    ownerId: 'ownerA', businessId, type: 'missing_canonical',
    evidenceUrl: 'https://www.example.org/docs/audit',
    note: 'Canonical absent in captured page observation; confirm manually.',
    observedAt: '2026-11-15T10:30:00Z', ...overrides,
  };
}

test('deduplicates www and apex under the same owner', () => {
  const { workspace, business, input } = setup();
  const result = workspace.discover({ ...input, website: 'http://example.org/',
    sourceUrl: 'https://reports.example.com/finding' });
  assert.equal(result.created, false);
  assert.equal(result.business.id, business.id);
  assert.equal(result.business.sources.length, 2);
  assert.equal(result.business.domain, 'example.org');
});

test('repeated source is idempotent', () => {
  const { workspace, business, input } = setup();
  const next = workspace.discover(input);
  assert.equal(next.business.id, business.id);
  assert.equal(next.business.sources.length, 1);
});

test('owner boundary prevents cross-tenant reads and writes', () => {
  const { workspace, business } = setup();
  code(() => workspace.get({ ownerId: 'ownerB', businessId: business.id }), 'NOT_FOUND');
  code(() => workspace.recordFinding(findingInput(business.id, {ownerId: 'ownerB'})), 'NOT_FOUND');
  assert.equal(workspace.list({ ownerId: 'ownerB' }).length, 0);
});

test('same domain can exist in two isolated workspaces', () => {
  const { workspace, business, input } = setup();
  const second = workspace.discover({ ...input, ownerId: 'ownerB' });
  assert.notEqual(second.business.id, business.id);
  assert.equal(workspace.list({ ownerId: 'ownerB' }).length, 1);
});

test('rejects malformed, local, IP, embedded credentials, non-http, and deep URLs', () => {
  const { workspace, input } = setup();
  for (const website of ['http://localhost/', 'http://127.0.0.1/',
    'http://[::1]/', 'ftp://example.org/', 'https://admin:pw@example.org/',
    'https://example.org/shop', 'not-a-url', 'https://intranet/']) {
    code(() => workspace.discover({...input, website}), 'INVALID_URL');
  }
});

test('finding requires explicit type, traceable URL, and observed date', () => {
  const { workspace, business } = setup();
  for (const overrides of [{type: 'imaginary_ranking_gain'},
    {evidenceUrl: 'file:///etc/passwd'}, {observedAt: 'not-a-date'}]) {
    assert.throws(() => workspace.recordFinding(findingInput(business.id, overrides)), ResearchError);
  }
});

test('pending/unreviewed observations cannot create service matches', () => {
  const { workspace, business } = setup();
  workspace.recordFinding(findingInput(business.id));
  assert.deepEqual(workspace.matchServices({ownerId: 'ownerA', businessId: business.id}), []);
  code(() => workspace.reviewResearch({ ownerId: 'ownerA', businessId: business.id,
    decision: 'research_accepted', reviewerId: 'auditor1', note: 'Approved' }), 'REVIEW_BLOCKED');
});

test('verified evidence maps to service with finding IDs and rationales', () => {
  const { workspace, business } = setup();
  const observation = workspace.recordFinding(findingInput(business.id));
  workspace.verifyFinding({ ownerId: 'ownerA', businessId: business.id,
    findingId: observation.id, decision: 'verified', reviewerId: 'human1' });
  const matches = workspace.matchServices({ownerId: 'ownerA', businessId: business.id});
  assert.equal(matches.length, 1);
  assert.equal(matches[0].serviceId, FINDING_TO_SERVICE.missing_canonical.id);
  assert.deepEqual(matches[0].evidenceFindingIds, [observation.id]);
});

test('multiple verified findings for one service merge without duplicate recommendation', () => {
  const { workspace, business } = setup();
  for (const type of ['missing_canonical', 'missing_meta_description']) {
    const observation = workspace.recordFinding(findingInput(business.id, {type}));
    workspace.verifyFinding({ownerId: 'ownerA', businessId: business.id,
      findingId: observation.id, decision:'verified', reviewerId:'human1'});
  }
  const matches = workspace.matchServices({ownerId:'ownerA', businessId:business.id});
  assert.equal(matches.length, 1);
  assert.equal(matches[0].evidenceFindingIds.length, 2);
  assert.equal(matches[0].rationales.length, 2);
});

test('dismissed findings are never treated as evidence', () => {
  const { workspace, business } = setup();
  const item = workspace.recordFinding(findingInput(business.id));
  workspace.verifyFinding({ownerId:'ownerA', businessId:business.id,
    findingId:item.id, decision:'dismissed', reviewerId:'human1'});
  assert.deepEqual(workspace.matchServices({ownerId:'ownerA', businessId:business.id}), []);
  code(() => workspace.verifyFinding({ownerId:'ownerA', businessId:business.id,
    findingId:item.id, decision:'verified', reviewerId:'human2'}), 'INVALID_TRANSITION');
});

test('human research acceptance is separate from permission to contact', () => {
  const {workspace, business} = setup();
  const item = workspace.recordFinding(findingInput(business.id));
  workspace.verifyFinding({ownerId:'ownerA', businessId:business.id,
    findingId:item.id, decision:'verified', reviewerId:'human1'});
  workspace.matchServices({ownerId:'ownerA', businessId:business.id});
  const approved = workspace.reviewResearch({ownerId:'ownerA', businessId:business.id,
    decision:'research_accepted', reviewerId:'human2', note:'Relevant for internal team review'});
  assert.equal(approved.review.status, 'research_accepted');
  assert.equal(approved.outreachPermission, 'not_assessed');
  assert.equal('sendEmail' in workspace, false);
});

test('contact form observation never grants sending permission', () => {
  const {workspace, business} = setup();
  const route = workspace.addContactForm({ownerId:'ownerA', businessId:business.id,
    url:'https://example.org/contact', sourceUrl:'https://example.org/about'});
  assert.equal(route.verifiedForOutreach, false);
  assert.equal(workspace.get({ownerId:'ownerA', businessId:business.id}).outreachPermission, 'not_assessed');
});

test('finding duplicate is idempotent, owner snapshots are defensive', () => {
  const {workspace, business} = setup();
  const first = workspace.recordFinding(findingInput(business.id));
  const next = workspace.recordFinding(findingInput(business.id));
  assert.equal(next.id, first.id);
  const snapshot = workspace.get({ownerId:'ownerA', businessId:business.id});
  snapshot.findings[0].note = 'UNTRUSTED UPDATE';
  snapshot.sources.length = 0;
  const actual = workspace.get({ownerId:'ownerA', businessId:business.id});
  assert.notEqual(actual.findings[0].note, 'UNTRUSTED UPDATE');
  assert.equal(actual.sources.length, 1);
});

test('new evidence resets previously approved research and computed matches', () => {
  const {workspace, business} = setup();
  const item = workspace.recordFinding(findingInput(business.id));
  workspace.verifyFinding({ownerId:'ownerA', businessId:business.id,
    findingId:item.id, decision:'verified', reviewerId:'human1'});
  workspace.matchServices({ownerId:'ownerA', businessId:business.id});
  workspace.reviewResearch({ownerId:'ownerA', businessId:business.id,
    decision:'research_accepted', reviewerId:'human1', note:'Review'});
  workspace.recordFinding(findingInput(business.id, {
    type:'broken_internal_link', evidenceUrl:'https://example.org/broken'}));
  const after = workspace.get({ownerId:'ownerA', businessId:business.id});
  assert.equal(after.review, null);
  assert.equal(after.matches.length, 0);
});

test('invalid reviewer action fails before acceptance', () => {
  const {workspace, business} = setup();
  code(() => workspace.reviewResearch({ownerId:'ownerA', businessId:business.id,
    decision:'approve_to_send', reviewerId:'human1', note:'No'}), 'INVALID_INPUT');
});
