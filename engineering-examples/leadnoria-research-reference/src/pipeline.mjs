/**
 * Independent LeadNoria-inspired B2B research workflow reference.
 * Not LeadNoria production source code; no network fetching or email sending.
 */
import { domainToASCII } from 'node:url';
import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';

export const FINDING_TO_SERVICE = Object.freeze({
  missing_meta_description: Object.freeze({
    id: 'technical_seo',
    title: 'Technical SEO review',
    rationale: 'An absent meta description merits a review of search snippet presentation.',
  }),
  missing_canonical: Object.freeze({
    id: 'technical_seo',
    title: 'Technical SEO review',
    rationale: 'A missing canonical calls for a review of indexing and duplicate URL handling.',
  }),
  broken_internal_link: Object.freeze({
    id: 'website_maintenance',
    title: 'Website maintenance review',
    rationale: 'An observed broken internal link merits a navigation and link health check.',
  }),
  missing_contact_page: Object.freeze({
    id: 'conversion_ux',
    title: 'Contact UX review',
    rationale: 'A missing contact path may prevent customers from reaching the business.',
  }),
  insecure_http: Object.freeze({
    id: 'security_configuration',
    title: 'HTTPS configuration review',
    rationale: 'An observed HTTP-only path merits verification of HTTPS and redirects.',
  }),
});

const findingTypes = Object.keys(FINDING_TO_SERVICE);
const clone = value => structuredClone(value);

export class ResearchError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ResearchError';
    this.code = code;
  }
}

function textField(value, field, limit = 160) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > limit) {
    throw new ResearchError('INVALID_INPUT', `${field} must contain 1-${limit} characters`);
  }
  return value.trim();
}

function actor(value) {
  const s = textField(value, 'actor', 80);
  if (!/^[A-Za-z0-9_-]+$/.test(s)) {
    throw new ResearchError('INVALID_INPUT', 'Actor ID contains unsupported characters');
  }
  return s;
}

/** URL is used as an evidence pointer only. No URL is fetched. */
function publicUrl(value, field = 'url') {
  const raw = textField(value, field, 2048);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ResearchError('INVALID_URL', `${field} must be a fully qualified URL`);
  }
  if (!['https:', 'http:'].includes(url.protocol) ||
      url.username || url.password ||
      !url.hostname || url.port) {
    throw new ResearchError('INVALID_URL', `${field} must be a public HTTP(S) URL`);
  }
  const host = domainToASCII(url.hostname).toLowerCase().replace(/\.$/, '');
  if (!host || isIP(host) ||
      host === 'localhost' || host.endsWith('.localhost') ||
      !host.includes('.') || host.length > 253 ||
      !/^[a-z0-9.-]+$/.test(host) ||
      host.split('.').some(x => !x || x.length > 63 || x.startsWith('-') || x.endsWith('-'))) {
    throw new ResearchError('INVALID_URL', `${field} must use a valid DNS hostname`);
  }
  return { url: url.href, hostname: host };
}

function normalizedWebsite(value) {
  const { url, hostname } = publicUrl(value, 'website');
  const parsed = new URL(url);
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new ResearchError('INVALID_URL', 'website must be a homepage origin, not an internal page');
  }
  const domain = hostname.replace(/^www\./, '');
  return { domain, website: `${parsed.protocol}//${hostname}/` };
}

export class ResearchWorkspace {
  #records = new Map();
  #domainIndex = new Map();

  constructor({ now = () => new Date().toISOString(), newId = randomUUID } = {}) {
    this.now = now;
    this.newId = newId;
  }

  discover({ ownerId, name, industry, website, sourceUrl }) {
    const owner = actor(ownerId);
    const cleanName = textField(name, 'business name');
    const cleanIndustry = textField(industry, 'industry');
    const cleaned = normalizedWebsite(website);
    const source = publicUrl(sourceUrl, 'sourceUrl').url;
    const key = JSON.stringify([owner, cleaned.domain]);
    let record = this.#records.get(this.#domainIndex.get(key));
    if (record) {
      if (!record.sources.some(item => item.url === source)) {
        record.sources.push({ url: source, collectedAt: this.now() });
        this.#log(record, 'source_added');
      }
      return { created: false, business: clone(record) };
    }
    const date = this.now();
    record = {
      id: this.newId(), ownerId: owner, name: cleanName, industry: cleanIndustry,
      domain: cleaned.domain, website: cleaned.website, stage: 'discovered',
      sources: [{ url: source, collectedAt: date }], findings: [], matches: [],
      contactRoutes: [], review: null,
      outreachPermission: 'not_assessed',
      createdAt: date, updatedAt: date,
      history: [{ action: 'discovered', at: date }],
    };
    this.#records.set(record.id, record);
    this.#domainIndex.set(key, record.id);
    return { created: true, business: clone(record) };
  }

  recordFinding({ ownerId, businessId, type, evidenceUrl, note, observedAt }) {
    const record = this.#owned(ownerId, businessId);
    if (!findingTypes.includes(type)) {
      throw new ResearchError('INVALID_FINDING', 'Only known finding categories are supported');
    }
    const evidence = publicUrl(evidenceUrl, 'evidenceUrl').url;
    const description = textField(note, 'note', 500);
    const timestamp = textField(observedAt, 'observedAt', 30);
    if (Number.isNaN(Date.parse(timestamp))) {
      throw new ResearchError('INVALID_INPUT', 'observedAt must be a parseable timestamp');
    }
    const found = record.findings.find(item => item.type === type && item.evidenceUrl === evidence);
    if (found) return clone(found);
    const finding = {
      id: this.newId(), type, evidenceUrl: evidence, note: description,
      observedAt: timestamp, verification: 'pending', reviewerId: null,
      reviewedAt: null,
    };
    record.findings.push(finding);
    record.matches = []; // Recompute recommendations after review.
    record.review = null;
    record.stage = 'audit_pending_review';
    this.#log(record, 'finding_recorded');
    return clone(finding);
  }

  verifyFinding({ ownerId, businessId, findingId, decision, reviewerId }) {
    const record = this.#owned(ownerId, businessId);
    const reviewer = actor(reviewerId);
    if (!['verified', 'dismissed'].includes(decision)) {
      throw new ResearchError('INVALID_INPUT', 'decision must be verified or dismissed');
    }
    const finding = record.findings.find(f => f.id === findingId);
    if (!finding) throw new ResearchError('NOT_FOUND', 'Finding not found');
    if (finding.verification !== 'pending') {
      throw new ResearchError('INVALID_TRANSITION', 'Finding already reviewed');
    }
    finding.verification = decision;
    finding.reviewerId = reviewer;
    finding.reviewedAt = this.now();
    record.matches = [];
    record.review = null;
    record.stage = 'audit_reviewed';
    this.#log(record, `finding_${decision}`);
    return clone(finding);
  }

  matchServices({ ownerId, businessId }) {
    const record = this.#owned(ownerId, businessId);
    const groups = new Map();
    for (const finding of record.findings.filter(f => f.verification === 'verified')) {
      const service = FINDING_TO_SERVICE[finding.type];
      if (!groups.has(service.id)) {
        groups.set(service.id, { serviceId: service.id, title: service.title,
          evidenceFindingIds: [], rationales: [] });
      }
      const match = groups.get(service.id);
      match.evidenceFindingIds.push(finding.id);
      if (!match.rationales.includes(service.rationale)) match.rationales.push(service.rationale);
    }
    record.matches = [...groups.values()].sort((a, b) =>
      a.serviceId.localeCompare(b.serviceId));
    record.review = null;
    record.stage = 'service_matched';
    this.#log(record, 'service_matches_recomputed');
    return clone(record.matches);
  }

  addContactForm({ ownerId, businessId, url, sourceUrl }) {
    const record = this.#owned(ownerId, businessId);
    const contact = publicUrl(url, 'contact form URL').url;
    const evidence = publicUrl(sourceUrl, 'sourceUrl').url;
    const found = record.contactRoutes.find(route => route.url === contact);
    if (found) return clone(found);
    const route = {
      id: this.newId(), type: 'public_contact_form', url: contact,
      sourceUrl: evidence, verifiedForOutreach: false, collectedAt: this.now(),
    };
    record.contactRoutes.push(route);
    this.#log(record, 'contact_route_recorded');
    return clone(route);
  }

  reviewResearch({ ownerId, businessId, decision, reviewerId, note }) {
    const record = this.#owned(ownerId, businessId);
    const reviewer = actor(reviewerId);
    if (!['research_accepted', 'needs_more_evidence'].includes(decision)) {
      throw new ResearchError('INVALID_INPUT', 'Unsupported research decision');
    }
    if (decision === 'research_accepted' &&
        (!record.findings.some(f => f.verification === 'verified') || !record.matches.length)) {
      throw new ResearchError('REVIEW_BLOCKED',
        'Research acceptance requires verified findings and at least one evidence-linked match');
    }
    record.review = {
      status: decision, reviewerId: reviewer, note: textField(note, 'note', 500),
      reviewedAt: this.now(),
    };
    record.stage = decision;
    this.#log(record, 'human_research_review');
    // Intentionally NEVER changes outreachPermission or sends messages.
    return clone(record);
  }

  get({ ownerId, businessId }) {
    return clone(this.#owned(ownerId, businessId));
  }

  list({ ownerId }) {
    const owner = actor(ownerId);
    return clone([...this.#records.values()].filter(r => r.ownerId === owner));
  }

  #owned(ownerId, businessId) {
    const owner = actor(ownerId);
    const record = this.#records.get(businessId);
    if (!record || record.ownerId !== owner) {
      throw new ResearchError('NOT_FOUND', 'Business not found');
    }
    return record;
  }

  #log(record, action) {
    record.updatedAt = this.now();
    record.history.push({ action, at: record.updatedAt });
  }
}
