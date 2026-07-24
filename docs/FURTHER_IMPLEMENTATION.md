# Nova — Further Implementation (Post-Week 8)

This is a standalone addendum, not part of the core 8-week roadmap or the 15 `master_md_files`. It exists because a full accounting of "how much of backend engineering does Nova actually cover" surfaced two honest gaps — some concepts touched shallowly, some not touched at all — and rather than inflate the core timeline to cover everything, these were deliberately deferred to after Week 8. See `DECISIONS.md` for the reasoning behind that call.

Everything listed here is additive — it extends the existing architecture without requiring rework of anything already built, and stays within the project's $0 hosting constraint (with one substitution noted below).

---

## Section A — Deepen (currently shallow, already touched during Weeks 1–8)

### A1. Database indexing — deep dive
**Currently:** referenced conceptually during multi-tenancy and query design discussions, no dedicated benchmarking.
**To add:** a concept + notes pair covering compound indexes, index selectivity, `.explain()` output interpretation, and a real before/after query performance benchmark on Nova's own collections (e.g., the tenant-scoped Task queries).
**Feasibility:** Easy — no new infrastructure, uses the existing MongoDB Atlas cluster and existing queries.

### A2. Observability & monitoring
**Currently:** "basics" only — console logging, no structured metrics.
**To add:** a metrics endpoint (e.g., request counts, error rates, response times) wired to a free-tier dashboard (Grafana Cloud free tier, or a simpler self-hosted approach), plus a concept doc on what "observability" means beyond logging (metrics, traces, structured logs).
**Feasibility:** Moderate — new but still $0; Grafana Cloud's free tier covers this scale easily.

### A3. Job queues — deeper patterns
**Currently:** BullMQ used for background rollup jobs (Week 8/Phase 8 analytics), but no deep-dive on queue design itself.
**To add:** a concept doc on retry strategies, dead-letter queues, backpressure, and job idempotency — using Nova's existing BullMQ setup as the worked example rather than standing up new infrastructure.
**Feasibility:** Easy-to-moderate — extends existing infrastructure, no new services.

---

## Section B — Add (not touched at all in the core 8 weeks)

### B1. Database transactions
**Gap:** MongoDB multi-document transactions were never used — a real interview-relevant gap.
**To add:** implement a genuine multi-document transaction for an operation that needs atomicity (e.g., reassigning a Project's owner — touching Project, Task, and Activity Log together), plus a concept doc on when transactions are needed vs. when eventual consistency is acceptable.
**Feasibility:** Easy — MongoDB Atlas already runs as a replica set, so transactions work without any infrastructure change.

### B2. GraphQL
**Gap:** REST-only; no hands-on GraphQL experience, only an informed opinion on REST vs. GraphQL tradeoffs.
**To add:** a small parallel GraphQL layer (Apollo Server) alongside the existing REST API — read-only queries against the same underlying services, to avoid duplicating business logic — plus a concept doc comparing the two approaches from direct experience rather than theory alone.
**Feasibility:** Moderate-to-high effort — a real new layer, but isolated; doesn't require touching existing REST code.

### B3. Security hardening beyond auth
**Gap:** no explicit CSRF/XSS protection, no `helmet.js`, no systematic input sanitization beyond zod validation.
**To add:** `helmet.js` middleware, explicit CSRF protection strategy (or a documented reason it's not needed given the auth approach used), sanitization middleware, and a concept doc walking through the OWASP Top 10 as it applies to Nova specifically.
**Feasibility:** Easy — middleware additions, no architecture change.

### B4. API versioning strategy
**Gap:** no versioning scheme in place.
**To add:** prefix routes with `/api/v1/`, document the strategy (URL versioning vs. header versioning tradeoffs) in a concept doc.
**Feasibility:** Easy — near-zero implementation effort, mostly a documentation + routing convention exercise.

### B5. Search infrastructure
**Gap:** no full-text/search capability.
**To add:** **MongoDB Atlas Search** (built into the existing Atlas cluster) instead of standing up Elasticsearch — Elasticsearch hosting isn't reliably free long-term, while Atlas Search runs on the same free-tier cluster already in use. Implement search across Projects/Tasks, plus a concept doc on search indexing fundamentals that transfer to Elasticsearch or any other search engine.
**Feasibility:** Easy-to-moderate — free, uses existing infrastructure, meaningful substitution for the "real" tool.

### B6. Horizontal scaling & load balancing
**Gap:** not part of the project's scope at all; free-tier hosting can't meaningfully demonstrate real horizontal scaling.
**To add:** **not implemented** — instead, a written concept doc covering the theory (stateless service design, session/state externalization, load balancer strategies, what would need to change in Nova's architecture to scale horizontally) without a live demo. Honest about being conceptual-only, since faking a scaling demo on free-tier infrastructure would misrepresent what was actually built.
**Feasibility:** N/A for implementation — documentation-only by design.

---

## How this gets folded into the docs once started
Each item above, once actually worked on, produces a `<concept>.md` + `<concept>-notes.md` pair in `docs/concepts/`, indexed under a new **"Further Implementation (Post-Week 8)"** category in `CONCEPTS_MAP.md` — same format and rigor as every other concept in the core roadmap, just added after the primary 8 weeks are complete.