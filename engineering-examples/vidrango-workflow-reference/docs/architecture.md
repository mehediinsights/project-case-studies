# Architecture and threat boundaries

This is an **original illustrative implementation** of selected workflow patterns discussed in [VidRango's public case study](https://mehedihasan.work/projects/vidrango/). It is **not** extracted from VidRango servers, not the deployed product, and not a claim of exact production architecture.

```text
submit + idempotency key
          |
   pending_moderation -- reject --> rejected
          |
        approve
          v
        queued
          |
        claim (time-bounded lease / token)
          v
       processing -- fail/lease expiry --> retry_wait --> claim
          |                                           |
          |                                      max attempts
          |                                           v
          |                                         failed
          v
     QC decision -- failure --> qc_failed (no outputs)
          |
         pass (full platform set)
          v
         ready
```

## Design properties demonstrated

- **Fail-closed moderation:** no queued work until trusted moderation approval; rejected work never runs.
- **Idempotent creation:** request key scoped to owner, with payload comparison; conflicting reuse is rejected.
- **Tenant-scoped reads:** inaccessible records return `NOT_FOUND` rather than leaking existence.
- **Worker fencing:** a token and expiry prevent old workers from submitting late results.
- **Worker-token secrecy in public views:** owner-scoped status responses omit the active worker lease token; only a trusted worker claim receives it.
- **Bounded retries:** exponential backoff and terminal failure after `maxAttempts`.
- **Fail-closed QC:** a success claim requires exactly one safe output identifier for every requested platform; QC failure exposes no outputs.
- **Dependency-free automated tests:** deterministic clock/ID injection allows edge-case tests.

## Deliberate omissions / production requirements

This example uses an **in-memory `Map`**. It is safe for demonstrating logic in one Node.js process, **not** durable or distributed: state disappears at restart, multiple instances may claim the same job, and Map operations are not a substitute for database transactions. Do not expose the sample as a public API or use it to process real customer data.

A real system requires durable transactional storage (e.g. PostgreSQL with row-level claims and constraints), actual authentication/authorization for moderator and worker actions, safe upload handling, content scanning, moderation enforcement, encrypted object storage, a durable message queue/outbox, monitoring, idempotent render side-effects, job cancellation, resource quotas, worker heartbeats/lease renewal, audit retention policies and real QC rules. These are **not implemented** here. No payment, crypto, copyright or user-consent logic is included.

No actual video files, production credentials, internal endpoints or client data are published.
