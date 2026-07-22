# Nova — Architecture

## Top-Level Structure
```
nova/
├── frontend/     → Next.js app (React, GSAP, Tailwind, Radix UI)
├── backend/      → Express API server (auth, RBAC, projects, tasks, billing, real-time, analytics)
├── ai/           → AI logic module — imported directly by backend, not a separate running service
└── docs/         → Project documentation (architecture, decisions, concepts, API reference, etc.)
```

## Why three top-level folders (frontend / backend / ai)
Each folder name should tell a stranger or an AI agent exactly what lives inside it without needing to open a single file. `frontend` and `backend` are self-explanatory. `ai` is pulled out to its own top-level folder — rather than being buried inside `backend/services/` — purely for visibility: it's a genuine differentiator-adjacent feature (client-facing AI summaries, AI task breakdown) and deserves to be immediately discoverable in the repo, not hidden inside generic backend service code.

## How `ai/` relates to `backend/`
**Decision: `ai/` is an internal module imported directly by `backend/`, not a separate running microservice.**

Reasoning:
- Every AI feature in Nova (task breakdown, client-facing progress summaries) is fundamentally "a backend route handler calls an LLM API and returns structured output" — a function call, not a distinct service with its own lifecycle, database, or scaling concerns. Splitting it into its own server would add deployment complexity without teaching a new concept.
- Nova is built to run entirely on free-tier infrastructure. A second deployed service means a second cold-start, a second free-tier limit to track, and a second thing that can go down mid-demo — cost/reliability we don't need to pay.
- The genuine microservices story in this project already lives in Week 8, where the notification/email worker is split into its own process communicating via a queue. That's the concept doc that covers monolith-vs-microservices tradeoffs — duplicating that pattern for `ai/` would be redundant, not additive.
- Pulling `ai/` into its own top-level folder (rather than nesting it inside `backend/services/ai/`) still gives it the visual and organizational separation that reflects its importance, without the operational overhead of a separate service.

### Structure inside `ai/`
```
ai/
├── llmClient.js        → wraps the LLM API call (Gemini/Groq), handles retries/errors
├── taskBreakdown.js     → plain-language goal → structured subtask list
├── clientSummary.js     → task activity/comments → client-facing progress digest
└── promptTemplates/     → prompt definitions, kept separate from calling logic
```
`backend/` route handlers import functions from `ai/` directly (e.g. `import { generateTaskBreakdown } from '../ai/taskBreakdown.js'`) — same repo, same deployment, same process.

## Related docs
- See `DECISIONS.md` for the full log of "why this over the alternative" calls, including this one.
- See `docs/concepts/ai-integration.md` (Week 7) for the deep-dive on LLM API integration, prompt design, and when to use AI vs deterministic logic.
