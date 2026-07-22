# Nova
### An AI-Powered Project & Client Collaboration Platform for Freelance Agencies

## The Problem
Freelance and small dev/design agencies typically manage multiple client projects using a patchwork of disconnected tools — Asana for tasks, Slack for communication, and a spreadsheet for invoicing. This fragmentation creates two concrete pains: there's no single system tying a client's billing status to their team's project access, and clients themselves are left completely outside these tools — chased for approvals over email, with no visibility into whether a project is on track or whether their own payment is even current.

## The Solution
Nova unifies project management, role-based team collaboration, subscription billing, AI-driven project intelligence, and — its core differentiator — a dedicated client portal, into one multi-tenant SaaS dashboard.

**Team structure & access control.** Organizations sign up and invite members under an Owner/Admin/Member role hierarchy at the organization level, with per-project role overrides for finer-grained control — for example, a Member can be elevated to Manager on a specific project without changing their org-wide role.

**The client portal — what sets Nova apart.** Most PM tools are internal-only; clients are left out entirely. Nova adds a third role tier, **Client**, with a fundamentally different, external-facing permission set: a read-only view into project progress, a deliverable approval flow, and live visibility into their own invoice and billing status. This directly closes the gap named above — clients are no longer chasing status over email or left wondering whether their payment reflects their access — and it's the single design choice that makes Nova more than "yet another PM tool."

**Real-time collaboration.** Live comments, presence indicators ("who's online"), and instant notifications (via Socket.io) keep distributed teams in sync without needing a separate chat tool.

**AI project intelligence, tied directly to the differentiator.** AI does real work inside the platform rather than sitting on top as a gimmick:
- **AI Client-Facing Progress Summaries** — clients see a plain-English digest of project progress in their own portal, generated from task activity and comments, instead of having to ask a manager for a status update.
- **AI Task Breakdown** — a manager describes a deliverable in plain language (e.g. "launch client's website by Friday") and Nova returns a structured list of subtasks with suggested priority, cutting project setup from an hour to minutes.
- **Smart Assignment** — tasks are algorithmically assigned based on team member role and current workload (deliberately rules-based, not AI, for reliability and explainability).
- **Risk Flagging** — tasks that are overdue, unassigned for 48+ hours, or stalled surface automatically, catching bottlenecks before they become missed deadlines (also deliberately rules-based, for the same reason).

**Analytics.** Task completion rate, team velocity, and an activity heatmap give managers instant visibility into progress without manual reporting.

**Billing.** Subscriptions are handled through Stripe across three tiers (Free / Pro / Business), gating seats, project limits, analytics, and AI features. Because access is tied directly to subscription status, a lapsed payment automatically restricts the team's ability to keep working — and updates what the client sees in their own portal — closing the billing/access/visibility gap end to end.

## In short
Nova replaces fragmented tooling with a single secure, real-time, AI-assisted platform purpose-built for how freelance agencies actually manage client work — and it's the only one of the three that gives the client themselves a seat at the table, tying their visibility and access directly to their billing status.

---

## About this project
Nova is a full-stack learning project built to deeply master the MERN stack (MongoDB, Express, React/Next.js, Node.js) plus real-time systems, payments, caching, testing, and CI/CD — with a scoped AI layer added to reflect current industry direction. Every major concept implemented is documented in `/docs/concepts/` as a standalone explainer (what it is, why it was needed, how it was built), making this repository both a demoable portfolio piece with a genuine differentiator and a personal interview-preparation reference.

**Stack:** React, Next.js, GSAP, Tailwind CSS, Radix UI, Node.js, Express, MongoDB, Socket.io, Stripe, Redis, a free-tier LLM API (Gemini/Groq) for AI features

**Timeline:** 8 weeks, built concept-by-concept with an emphasis on understanding over speed.
