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

### Flat `docs/concepts/` folder, not week-numbered subfolders
**Chosen:** Keep all concept docs in one flat folder, with `CONCEPTS_MAP.md` providing both a by-category and a by-week index into the same files.
**Alternative considered:** `docs/concepts/week1/`, `week2/`, etc., grouping files by when they were built.
**Why:** Interview review happens by topic ("let me review Auth"), not by week — a week-based folder structure would mismatch the category-based index and force an extra translation step every time the repo is navigated. Weeks also don't map 1:1 to categories (e.g. Week 7 alone spans AI, Analytics, and Caching), so week-folders would force unrelated concepts together anyway. A flat folder with a dual-view index gives both navigation paths without duplicating structure.

### TypeScript over JavaScript for the backend
**Chosen:** Backend written in TypeScript (compiled via `tsc`, run in dev via `ts-node`), not plain JavaScript.
**Alternative considered:** Plain JavaScript with JSDoc comments for lightweight typing, or no typing at all.
**Why:** Given the multi-tenancy scoping guarantees we're relying on (e.g., every tenant-scoped query needing `organizationId`), static types catch a whole class of mistakes at compile time — a missing or mistyped field on a Mongoose document, a controller returning the wrong shape — before they ever reach runtime. It's also a stronger, more current interview signal: most real-world Node backends at companies with any scale are TypeScript today, and being fluent in it (types, interfaces, generics with Express/Mongoose) is itself an interview-relevant skill this project should demonstrate.

### tsx over ts-node + nodemon for running TypeScript in dev
**Chosen:** `tsx watch server.ts` as the single dev-run tool.
**Alternative considered:** `nodemon --exec ts-node --esm server.ts` (the original setup).
**Why:** `ts-node`'s `--esm` flag does not reliably register Node's ESM loader on recent Node versions, causing `ERR_UNKNOWN_FILE_EXTENSION` errors when running `.ts` files directly under `"type": "module"`. `tsx` handles TypeScript + ESM natively, with built-in file watching, removing the need for `nodemon` as a separate dependency entirely. Fewer moving parts, and it's the more common modern choice in real-world TypeScript/Node projects today.

### Standard (non-SRV) MongoDB connection string over mongodb+srv://
**Chosen:** Connect using the standard multi-host format (`mongodb://host1:port,host2:port,host3:port/...`) instead of the SRV format (`mongodb+srv://cluster-address/...`).
**Alternative considered:** The default SRV connection string Atlas provides out of the box.
**Why:** Node's DNS resolver (`dns.resolveSrv`) failed with `ECONNREFUSED` on the dev machine regardless of network (tested on both home wifi and mobile hotspot), while plain DNS lookups (`dns.lookup`) and direct TCP connections to the same hosts on port 27017 both succeeded — isolating the failure specifically to SRV record resolution, a known class of issue with Node's DNS resolver on some Windows configurations. Rather than depend on SRV lookups working in every environment this project might run in (including whoever might clone this repo), the standard format sidesteps the issue entirely by listing server addresses directly. Also required relaxing the `MONGODB_URI` zod validation from `z.string().url()` to a regex checking the `mongodb://`/`mongodb+srv://` prefix, since the strict URL parser doesn't accept the comma-separated multi-host syntax. The `replicaSet` parameter was deliberately omitted rather than guessed — an incorrect replica set name causes the driver to silently exclude all servers as "not matching," producing a misleading server-selection-timeout error even when every host is reachable; omitting it lets the driver auto-discover topology from the servers directly.

### Deferring some backend concepts to a post-Week-8 "Further Implementation" phase, rather than expanding the core 8 weeks
**Chosen:** A full audit of backend concept coverage surfaced gaps — some concepts touched shallowly (indexing depth, observability, job queue patterns), some not touched at all (transactions, GraphQL, security hardening beyond auth, API versioning, search, horizontal scaling). Rather than extend the 8-week roadmap to cover all of them, they're logged in `FURTHER_IMPLEMENTATION.md` as explicit, optional, stretch-scope work that begins only after the core 8 weeks are done.
**Alternative considered:** Extend the core roadmap to include all of these now.
**Why:** The project's primary goal is genuine depth on a focused set of concepts, not shallow breadth across everything backend engineering could touch — extending the timeline to cram in every possible topic would work directly against that stated priority. Keeping the core roadmap honest about its actual scope (and being explicit about what's deliberately deferred, with reasoning, rather than silently absent) is itself a better interview answer than pretending the project is exhaustive. One substitution was made for cost reasons: MongoDB Atlas Search replaces Elasticsearch for the search-infrastructure item, since Elasticsearch hosting isn't reliably free long-term while Atlas Search runs on the existing free-tier cluster.

<!-- Add new decisions above this line as they come up. -->