# Nova — AI Memory

Running log of context an AI agent needs to pick this project up cold, without re-explaining anything from scratch. Append new entries as key decisions/context emerge — don't rewrite history, just add.

## Project identity
- Name: Nova — AI-powered SaaS project & team management platform for freelance agencies
- Built by: Naini, final-year Software Engineering student (NUST, BESE-29), AI/ML & GenAI focus
- Purpose (in priority order): (1) primary — deep MERN stack revision/interview-prep via hands-on building + documentation, (2) secondary — a presentable portfolio piece
- Differentiator: a third external "Client" role — read-only project view, deliverable approval, billing status — directly tied to the billing/visibility gap named in PITCH.md

## Standing rules that must not be violated
- Fundamentals depth always wins over AI/portfolio polish if the two ever trade off
- Entire project must run on $0 — free-tier services only (Vercel, Render/Railway, MongoDB Atlas free M0, Upstash Redis, Stripe test mode, Cloudinary free tier, GitHub Actions, Gemini/Groq free-tier LLM)
- No concept gets cut for scope reasons (per-project role overrides, live presence, and Redis caching all stay in, even though they were suggested as optional cuts elsewhere)
- Workflow: understand a concept first (discussion + concept doc), then code, then commit tied to that concept — see WORKFLOW.md
- Build order: backend fully built + tested via Postman first (Weeks 1-5), then frontend (Weeks 6-7), then AI layer folded into Week 7, then testing/polish (Week 8)
- `ai/` folder is an internal module imported by `backend/`, not a separate microservice — see DECISIONS.md for reasoning
- Smart Assignment and Risk Flagging are deliberately rules-based, not AI-driven — only Task Breakdown and Client Summary use the LLM

## Coding conventions to follow (full detail in FRONTEND_PRACTICES.md / BACKEND_PRACTICES.md)
- Frontend: highly reusable components, split into independent folders per sub-component, Tailwind (no inline styles), theme file with named color tokens, 100-line max before splitting, logic/layout separated
- Backend: layered structure (routes/controllers/services/models/middleware/lib/hooks/validators), one responsibility per file, thin controllers, testable services, centralized error handling and response shape

## Timeline
- 8 weeks total, resequenced to backend-first (see roadmap.md for the authoritative week-by-week plan)

---
_Last updated: repo scaffolding step, before any code written._
