# Nova — How To Use These Docs

If you're a stranger, a recruiter, an instructor, or an AI agent opening this repo for the first time: start here.

## If you want to understand what Nova is and why it exists
Read **PITCH.md**. That's the whole pitch — problem, solution, differentiator — no other context needed.

## If you're an AI agent resuming work on this project
Read, in order: **AI_MEMORY.md** (standing context/decisions) → **CURRENT_TASK.md** (exactly where we left off) → **WORKFLOW.md** (the rule: understand before you code). Then proceed.

## If you want the technical picture
Read, in order: **ARCHITECTURE.md** (how it's built) → **FILE_TREE.md** (where things are) → **DATABASE_SCHEMA.md** / **API_REFERENCE.md** (the details).

## If you want to know *why* something was built a certain way
Read **DECISIONS.md** — every real fork-in-the-road choice, with the alternative that was considered and why it lost.

## If you want the interview-prep material
Read **CONCEPTS_MAP.md** first — it indexes every file in `docs/concepts/` by category (Backend, Auth, Frontend, Real-time, Billing, Client Portal, AI, Infra, Testing, Further Implementation). Each concept file is self-contained: what it is, why it was needed, what we built, common interview questions.

## If you want to know what's planned after the core 8 weeks
Read **FURTHER_IMPLEMENTATION.md** — covers concepts deliberately touched shallowly or not at all in the core roadmap (DB transactions, GraphQL, security hardening, indexing depth, observability, and more), why they were deferred, and how they'd be added.

## If you're setting this project up locally
Read **ENV_AND_CONFIG.md** for every environment variable and where to get it — the whole project is designed to run at $0 on free-tier services.

## If you're writing frontend or backend code for this project
Read **FRONTEND_PRACTICES.md** or **BACKEND_PRACTICES.md** first — these are the standing conventions, not suggestions.

## Legend — what each of the 15 master_md_files does
| File | Purpose |
|---|---|
| PITCH.md | The problem, solution, and client-portal differentiator — why Nova exists |
| roadmap.md (PHASES.md) | Week-by-week execution plan and progress tracking |
| ARCHITECTURE.md | System design, folder structure, how frontend/backend/ai fit together |
| DECISIONS.md | Every "why this over the alternative" call, with reasoning |
| DATABASE_SCHEMA.md | Mongoose models, relationships, indexing decisions |
| API_REFERENCE.md | Every endpoint: method, route, auth, request/response shape |
| CONCEPTS_MAP.md | Index linking every file in docs/concepts/ by category |
| ENV_AND_CONFIG.md | Every env variable, what it's for, where to get it |
| FILE_TREE.md | Annotated project structure for 30-second orientation |
| CURRENT_TASK.md | What's actively being worked on right now, kept live |
| AI_MEMORY.md | Running log of key context/decisions across sessions |
| HOW_TO_USE_DOCS.md | This file — navigation guide and legend |
| FRONTEND_PRACTICES.md | Component/reusability/styling conventions |
| BACKEND_PRACTICES.md | Layered structure, single-responsibility, error-handling conventions |
| WORKFLOW.md | The standing rule: understand a concept before coding it |