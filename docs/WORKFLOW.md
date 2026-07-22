# Nova — Workflow

This is the standing methodology for how this project gets built. It doesn't change week to week — if you're an AI agent or a human picking this project up with no other context, this is the one rule that governs everything else.

## The rule
**Understand before you code.** For every feature or concept:

1. **Understand first.** Before writing any code for a feature, the concept behind it must be genuinely understood — through discussion, or by reading the relevant file in `docs/concepts/` if it already exists.
2. **Then code it.** Only once the "why" is clear does implementation happen.
3. **Document it.** Write (or update) the corresponding `docs/concepts/<concept>.md` file — what it is, the problem it solves, what was actually built, and likely interview questions on it.
4. **Commit it.** The commit message ties back to the concept, not just "added feature X" — so the git history itself becomes part of the learning record.

## Why this rule exists
This project has two goals, in order: (1) genuine MERN + AI understanding for interview prep, (2) a presentable portfolio piece. Coding first and documenting after tends to produce a description of *what* the code does, not *why* it was built that way — and "why" is what actually gets probed in interviews. This rule protects the primary goal from being quietly skipped under time pressure.

## What this means in practice
- Never say "just write the code for X" without first confirming the concept behind X is understood.
- Never let a concept doc lag more than one feature behind the code — if the doc isn't written yet, the feature isn't considered done.
- If a shortcut is ever taken (understanding skipped to save time), it must be flagged explicitly, not silently absorbed into "we'll document it later."

---
_This file should never go stale — it describes process, not project state. CURRENT_TASK.md and AI_MEMORY.md track state; this file tracks method._
