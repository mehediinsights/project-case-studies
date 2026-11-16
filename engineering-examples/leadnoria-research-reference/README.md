# LeadNoria — Evidence-First B2B Research (Independent Engineering Example)

[Live product overview](https://mehedihasan.work/leadnoria/) · [Mehedi Hasan portfolio](https://mehedihasan.work/) · [Case studies](https://github.com/mehediinsights/project-case-studies)

**An original, dependency-free Node.js reference implementation** of a narrow part of an evidence-first B2B research workflow: discover a business, deduplicate it, record technical observations with source links, require human evidence verification, suggest matching services, and record an explicit *internal research* decision.

> **Important:** This demonstration is not the LeadNoria production code, deployment, private database, automation stack, or evidence that the deployed system uses identical architecture. Its tests prove only the behavior of this standalone example.

## Core engineering features

| Feature | Evidence in this repository |
| --- | --- |
| Owner-scoped research records | `ResearchWorkspace` and cross-owner tests |
| Domain-based deduplication | `discover()` normalizes `www` / apex and keeps provenance |
| Source-traceable observations | `recordFinding()` retains evidence URL, note and timestamp |
| Human verification gate | Unreviewed or dismissed findings never produce service matches |
| Explainable service matching | `matchServices()` links exact verified finding IDs to rationales |
| Research-vs-outreach separation | `reviewResearch()` never grants contact permission; **no sending code exists** |
| Defensive, repeatable behavior | Copy-on-read snapshots, idempotent discovery/finding, deterministic tests |

## Run locally

Node.js 20+ required. No account, API keys, packages or external services needed.

```bash
npm test
npm run check
npm run demo
```

Sample (fictional) CLI output:

```json
{
  "domain": "example.org",
  "stage": "research_accepted",
  "matches": ["technical_seo"],
  "outreachPermission": "not_assessed",
  "emailSent": false
}
```

## Architecture and safety

[Architecture, state transitions and production gaps](docs/architecture.md) · [Source module](src/pipeline.mjs) · [Automated tests](test/pipeline.test.mjs)

This demo deliberately **does not** scrape sites, crawl pages, call LLM APIs, validate email addresses, send email, manage SMTP, import contact lists, or act on third-party systems. The supplied observations are synthetic test data; a reviewer marking an example as verified illustrates a *manual decision*, not an independently verified real-world finding.

For an actual product, durable storage, authentication, authorization, rate limiting, provider permissions, documented consent basis, audit logging and safe network access would need separate engineering and review. The in-memory map is for instruction only; never deploy this as a public service.

All example businesses, IDs and URLs are fictitious or reserved documentation domains; no personal information or proprietary source code is included.
