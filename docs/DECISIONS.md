# Nova — Decisions Log

Every entry here answers: "why this, over the realistic alternative?" ARCHITECTURE.md says what was built; this file says why. Add a new entry any time a real fork-in-the-road choice is made — not for trivial choices, only ones a reviewer or interviewer would reasonably ask "why not X instead?"

---

### Client Portal as the product differentiator
**Chosen:** Add a third, external role — Client — with read-only project visibility, deliverable approval, and billing status view.
**Alternative considered:** Ship as a standard internal PM tool (Owner/Admin/Member only), differentiate on UI polish or AI features alone.
**Why:** Most PM tools are internal-only. The client portal directly closes the gap named in our own problem statement (no link between billing and client visibility) and gives the project a defensible reason to exist beyond "another Asana clone."

### AI (`ai/`) as an internal module, not a separate microservice
**Chosen:** `ai/` is a top-level folder for visibility, but backend imports it directly — same process, same deployment.
**Alternative considered:** A standalone AI microservice with its own server/endpoint.
**Why:** Every AI feature here is a single LLM API call with structured output — a function, not a service with its own lifecycle. A separate service adds deployment complexity, a second cold-start, and a second free-tier limit, without teaching a new concept. The genuine microservices story already lives in the Week 8 notification/email worker split.

### Free-tier LLM (Gemini or Groq) instead of paid OpenAI/Claude API
**Chosen:** Gemini or Groq free tier for all AI features.
**Alternative considered:** OpenAI/Claude API (better quality, but paid per token).
**Why:** Hard requirement — entire project must run at $0. Free tiers are sufficient for demo-level task breakdown and summaries; the tradeoff (rate limits, slightly lower quality) is acceptable for a portfolio project, not a production system.

### Rules-based logic for Smart Assignment and Risk Flagging (not AI)
**Chosen:** Plain algorithmic logic — assign by fewest open tasks + matching role; flag risk by overdue/unassigned/stalled thresholds.
**Alternative considered:** Route these through the LLM too, for a more "AI-powered" pitch.
**Why:** These need to be reliable and explainable in a live demo — a wrong AI call here undermines trust more than a boring-but-correct rule would. It's also a stronger interview answer: knowing *when not* to reach for AI is a real engineering signal.

### Backend-first, fully tested via Postman, before frontend
**Chosen:** Build and test the entire API surface (weeks 1–5) before writing any frontend code (weeks 6–7).
**Alternative considered:** Build frontend and backend in parallel, feature by feature.
**Why:** Forces correct API design without a frontend to "patch around" mistakes. Keeps debugging isolated to one layer at a time. Matches the project's primary goal — deep, defensible understanding of each layer — better than parallel development, which tends to blur which layer a bug or decision belongs to.

### Documentation-first workflow (see WORKFLOW.md)
**Chosen:** Understand a concept (discussion + concept doc) before writing any code for it.
**Alternative considered:** Code first, document after the fact.
**Why:** The project's primary goal is interview-prep through genuine understanding, not just a working app. Documenting after the fact tends to produce a description of what the code does, not why it was designed that way — the "why" is what interviewers actually probe.

<!-- Add new decisions above this line as they come up. -->
