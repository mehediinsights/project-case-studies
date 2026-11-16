# Media Job Workflow — Independent Engineering Reference

[![Demo tests](https://github.com/mehediinsights/project-case-studies/actions/workflows/vidrango-workflow-reference.yml/badge.svg)](https://github.com/mehediinsights/project-case-studies/actions/workflows/vidrango-workflow-reference.yml)

**Source inspiration:** [VidRango public portfolio case study](https://mehedihasan.work/projects/vidrango/) · [Mehedi Hasan portfolio](https://mehedihasan.work/)

An **original, minimal Node.js reference implementation** of a multi-platform video job lifecycle: submission → moderation → worker claim/retry → final quality gate → delivery-ready outputs.

> **Evidence boundary:** This code was created as a *separate public demonstration*; it is **not VidRango's proprietary or deployed source code**, nor evidence that the production product uses this exact architecture. Tests exercise this reference implementation only.

## What to inspect

| Engineering pattern | Where |
| --- | --- |
| Explicit state transitions & moderation gate | [`src/workflow.mjs`](src/workflow.mjs) |
| Per-user idempotency and conflict handling | `submit()` |
| Lease tokens, stale-worker rejection and bounded retries | `claim()`, `fail()`, `complete()` |
| Tenant-scoped reads and defensive copies | `get()` |
| Fail-closed quality gate for selected platforms | `complete()` |
| Deterministic automated edge-case tests | [`tests/workflow.test.mjs`](tests/workflow.test.mjs) |
| Constraints & production architecture gap | [`docs/architecture.md`](docs/architecture.md) |

## Run locally (Node.js 20+; no dependencies)

```bash
npm test
npm run demo
```

Example output:

```text
Submitted: pending_moderation
Before moderation, worker claims: null
Worker attempt: 1
After QC: ready { tiktok: 'render_tt', youtube_shorts: 'render_yt' }
```

The demo uses only artificial IDs; output identifiers are placeholders, not rendered media. It makes no network requests.

## What this does **not** demonstrate

Not a video converter, actual moderation model, production billing workflow, persistent queue, authorization system, or actual API deployment. The in-memory store is **not** multi-worker safe. See [architecture and security limitations](docs/architecture.md) before reusing ideas.

**Related portfolio:** [VidRango](https://mehedihasan.work/projects/vidrango/) · [All case studies](https://mehedihasan.work/projects/)
