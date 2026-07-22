# Nova — Project Roadmap
### An AI-Powered SaaS Team & Client Collaboration Platform, built as a full-stack MERN reference project

**What it is:** A multi-tenant SaaS dashboard for freelance/dev agencies — organizations sign up, invite team members with scoped roles, manage projects/tasks, get AI-assisted planning and status updates, see live analytics, get billed on a subscription, collaborate in real time — **and give their own clients a live, read-only portal into project progress and billing status.**

**The differentiator:** most PM tools (Asana, Trello, etc.) are internal-only — clients are left out, chased for approvals over email, and have no visibility into whether their payment is even current. Nova adds a third role tier, **Client**, with a fundamentally different (external, read-only + approval-only) permission set: project view, deliverable approval, and invoice/billing status. This directly closes the exact gap named in Nova's own problem statement — no link between billing and client visibility — and becomes the headline of the pitch instead of "yet another PM tool."

**Why this project exists (two goals, in priority order — unchanged):**
1. **Primary — Interview prep & MERN mastery.** Every concept implemented gets a companion doc explaining what it is, why it was needed, and how it was built. This project *is* the revision material. Nothing gets cut from the concept list for the sake of a leaner demo.
2. **Secondary — Portfolio piece.** A presentable, demoable SaaS product with a genuine differentiator (client portal) and real AI integration, showing market-awareness on top of solid fundamentals.

**Rule of thumb for every scope decision:** if a choice trades depth in fundamentals for polish, fundamentals win. The client-portal differentiator and AI tie-in are framing/narrative decisions — they don't remove any concept from the roadmap (per-project role overrides, presence, and Redis caching all stay in).

**Timeline:** 8 weeks. Not rushed — time is budgeted for understanding each concept properly, not just shipping code.

---

## How we'll work
For every concept: we build it → you understand the *why* → I write `/docs/concepts/<concept>.md` covering:
- What the concept is
- The problem it solves (what breaks without it)
- What we implemented, with actual code references
- Common interview questions on this exact concept

All notes live in `/docs/concepts/` inside the repo — that folder is your interview prep by the end.

---

## Week 1 — Foundations & Backend Core
Monorepo setup, environment config (.env + zod validation), MVC vs feature-based architecture, Git workflow, CI pipeline running lint+test+build from day one (not bolted on later). Express middleware pipeline & async error handling, Mongoose schema design (embedding vs referencing), multi-tenancy data model (Organization → Users → Projects → Tasks), REST API conventions, pagination/filtering/sorting, input validation.
**Docs:** project architecture, env management, 12-factor app basics, middleware pipeline, schema design tradeoffs, REST conventions, pagination strategies, indexing & query performance

## Week 2 — Auth & Authorization (incl. the Client role)
JWT access + refresh token flow, httpOnly cookies vs localStorage, bcrypt password hashing, login rate limiting. RBAC: Owner/Admin/Member at the org level, **plus per-project role overrides**, **plus the external Client role** (read-only project view, deliverable approval, invoice/billing status — a genuinely different permission-resolution path from internal roles). Email verification & password reset.
**Docs:** JWT deep dive, session vs token auth, RBAC design (internal roles + per-project overrides + external client role compared), secure cookie handling, OWASP auth basics

## Week 3 — Core PM (Projects & Tasks)
Projects, tasks, task states, CRUD — the boring-but-load-bearing layer everything else depends on. Next.js App Router (server vs client components), data fetching strategy (React Query/SWR), state management, forms (React Hook Form + zod), Tailwind + Radix UI component library.
**Docs:** SSR vs CSR vs ISR, server/client boundary, state management decision tree, accessible component patterns

## Week 4 — Client Portal (the differentiator — spend real time here)
Scoped read-only queries for the Client role, deliverable approval flow, client-facing billing/invoice status view. This is what makes Nova not a clone of an existing PM tool — document the design reasoning thoroughly.
**Docs:** designing a scoped external-facing permission layer, why a client portal over other differentiators, approval-flow state machines

## Week 5 — Billing & Payments
Stripe subscriptions (Free/Pro/Business tiers gating seats, project limits, analytics, AI features), checkout sessions, webhook security & idempotency, syncing subscription state to the DB. Explicitly wire "lapsed payment → restricted access," including the client portal's own view of billing status. Test mode. Dedicated tests for the gating logic specifically — highest-value place for tests in the app.
**Docs:** webhook reliability patterns, idempotency, subscription lifecycle modeling, testing money/access-critical logic

## Week 6 — Real-Time Layer
Socket.io + Express integration, auth over sockets, live comments, presence indicators, real-time notifications, reconnect handling, org-scoped rooms.
**Docs:** WebSockets vs polling vs SSE, socket auth, scaling sockets (Redis adapter intro)

## Week 7 — AI Layer (tied to the differentiator) + Analytics + Caching
Scoped narrow, tied to what makes Nova distinct:
- **AI Client-Facing Progress Summaries** — one LLM API call generates a plain-English project digest that clients see in their portal, instead of a generic internal-only summary. Ties the AI feature directly to the unique angle rather than being a bolted-on gimmick.
- **AI Task Breakdown** — manager describes a goal in plain language → structured subtask list with priority.
- **Smart Assignment** — rules-based (fewest open tasks + matching project role), deliberately framed as algorithmic, not AI.
- **Risk Flagging** — rules-based (overdue / unassigned >48h / untouched >X days), deliberately not AI, for demo reliability.

MongoDB aggregation pipeline for dashboard charts (task completion, team velocity, activity heatmap), background rollup jobs (node-cron/BullMQ). Redis caching for expensive analytics queries + invalidation strategy, N+1 query problems in Mongoose.
**Docs:** LLM API integration & prompt design, structured output parsing, when to use AI vs deterministic logic, cost/latency tradeoffs, aggregation pipeline patterns, job queues, cache invalidation strategies, N+1 problem

## Week 8 — Testing, Polish, Docs & Demo (this is what separates 7/10 from 9/10 — do not let earlier weeks eat into it)
- Backend unit tests (Jest), integration tests (Supertest), frontend component tests (React Testing Library).
- **Seam cases as explicit test cases, not manual checks:** subscription lapses mid-task-assignment, a Manager removed from org while still assigned tasks, a Client role attempting to hit an internal-only route.
- Finish `/docs/concepts/` for every non-trivial decision, especially "why rules-based over AI here," "why this RBAC model," "why client portal over other options."
- Deployment: Vercel (client) + Render/Railway (server + worker), Docker for client/server/worker, GitHub Actions CI/CD, basic logging/monitoring. Splitting the notification/email worker into its own process communicating via a queue — enough to explain microservices tradeoffs without full distributed-systems complexity.
- A short architecture diagram + a 90-second demo video/gif, front-loading the client portal in the first 10 seconds — reviewers skim.
**Docs:** testing pyramid, mocking strategies, monolith vs microservices tradeoffs, containerization basics, CI/CD pipeline design, observability basics

---

## Deliverable at the end
- A working, deployed AI-assisted SaaS dashboard with a genuine differentiator (client portal)
- `/docs/concepts/` — 30+ MD files, each a self-contained interview-ready explainer
- A root `NOTES-INDEX.md` linking every concept, organized by category (Backend / Frontend / Auth / Real-time / Billing / AI / Client Portal / Infra)
- `PITCH.md` — the product pitch, for portfolio/instructor presentation
- Architecture diagram + 90-second demo video

## Next step
Say the word and we start Week 1 — repo scaffolding + the first concept doc (architecture decisions).
