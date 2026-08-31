# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Never Commit Without a Go-Ahead (project rule)

**Do not run `git commit` until the user says so for that specific commit.** This is not a
style preference — silent commits take the decision of "this work is done and it goes into
history" away from the user, and undoing them is more expensive than waiting.

When you believe a change is ready:

1. Say what you would commit — **the file list and the commit message**.
2. Stop and wait.

A dirty working tree is the correct resting state. Do not "tidy up" by committing.

- **The go-ahead is per commit.** "Commit this" authorizes *that* commit, not the next one.
  Approving a *proposal* (§7) is permission to write code, **never** permission to commit it.
- Same for anything else that publishes: `git push`, merging into another branch, opening a PR,
  creating a tag. Ask first, every time.
- **Batch instructions carry through.** If the user says "commit and merge" or "commit as you
  go", follow that until the task they described is finished — then go back to asking.
- If you have already committed and then realize it was not authorized, **say so plainly in
  your next message.** Do not quietly rewrite history to hide it.

> Section 6 below applies **within** a commit (what has to be in it). This section governs
> **whether** to make one at all.

## 6. Keep PROGRESS.md in Sync (project rule)

**Every commit must be accompanied by a `PROGRESS.md` update.** As part of each commit (same change set), update `PROGRESS.md`:

- tick the relevant Plan checklist items,
- add a dated **Completed** entry (test counts / verified results / branch),
- refresh **Current Status** and **Blockers**.

A behavior-changing commit without a matching `PROGRESS.md` change is incomplete. Stage both together.

**New design decisions go in `docs/decisions.md`, not `PROGRESS.md`.** `PROGRESS.md` is the work log (what happened when); `docs/` holds the current design and the rationale. Start at [docs/README.md](docs/README.md). If a change makes a `docs/` page wrong, update that page in the same commit.

**Keep `PROGRESS.md` short — it is read from the top every session.** Detailed **Completed** entries stay only for the ~5 most recent; when an entry falls past that, move it verbatim to the top of the Completed list in `docs/history.md` and leave a **one-line row** in the digest table in `PROGRESS.md`. If an entry wants to be long, the detail almost always belongs somewhere in `docs/` instead.

The **Plan** checklist in `PROGRESS.md` is **phase-level only**. Task-level tracking lives in `docs/changes/<slug>/tasks.md` — do not keep two backlogs.

## 7. Changes Go Through Specs (project rule)

**The manual is [docs/sdd-workflow.md](docs/sdd-workflow.md).** Read it when in doubt. Add new process rules there, not here.

Before touching anything, classify: **does this change make a written requirement false, or require a new one?**

| | Judgement | What to do |
|:--:|---|---|
| **A** | Adds / changes / removes a requirement | Draft `docs/changes/<slug>/proposal.md` and **get the user's approval before writing code** |
| **B** | Requirement is right, implementation doesn't meet it (a bug) | `docs/changes/<slug>/tasks.md` only — no proposal |
| **C** | Doesn't touch any requirement | Just fix it. One line in `PROGRESS.md` |

**C covers** typos, comments, formatting, behavior-preserving refactors, dependency bumps, log/error wording, purely visual tweaks, and test hardening. **C should be the majority of day-to-day work** — if everything is turning into A, the criteria are wrong and `docs/sdd-workflow.md` needs fixing.

**Absolute rule: never change a requirement silently.** If implementation reveals the spec is wrong, stop and raise an A-class delta. Editing `tasks.md` to paper over the gap is forbidden.

**Spec-on-touch.** If the area has no spec in `docs/specs/`, write one page describing it *as it is today*, have the user confirm it, then write the delta. Never back-fill specs for areas you aren't touching.

Undecided questions and deliberate temporary compromises go in [docs/open-questions.md](docs/open-questions.md) — not buried in prose.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
