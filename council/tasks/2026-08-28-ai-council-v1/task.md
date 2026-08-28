---
task: 2026-08-28-ai-council-v1
status: pending-independent-review
risk: HIGH
base_commit: 92f77510c940f8da44429537d5551d8af2e06c9e
branch: claude/ai-council-v1-foundation
created_at: 2026-08-28T00:00:00Z
canonical_inputs:
  - docs/lifeos/PROJECT.md
  - docs/lifeos/ARCHITECTURE.md
  - docs/lifeos/DECISIONS.md
  - docs/lifeos/ROADMAP.md
evidence:
  - none-required (workflow-only task; no production behavior changes)
write_authority: claude-code
---

# Task: adopt AI Council V1 as project-owned collaboration protocol

## Question

Given a growing multi-model workflow (Claude Code CLI as primary
implementer, Codex CLI as independent HIGH-risk reviewer, ChatGPT as
orchestrator / synthesizer, potentially Qwen / Gemini / Hermes in
future), what is the minimum project-owned collaboration protocol that:

- removes manual copy/paste between model conversations;
- ties every model output to a known repository state (frozen commit);
- preserves independent review for HIGH-risk work;
- retains accepted decisions in project-owned files;
- avoids vendor / model memory becoming canonical truth;
- avoids turning Life OS development into an AI-platform product?

## Background

The AI Council Platform Architecture Review (delivered 2026-08-28)
compared a proposed maximal architecture (VS Code + Hermes + Qwen +
Gemini + Council files + per-model worktrees + per-model instruction
files) against a minimal architecture and concluded that most of the
maximal proposal is either premature (Hermes, per-model worktrees,
per-model instruction files, `CURRENT_TASK.md` ceremony) or a
bikeshed (VS Code vs Cursor, since the actual AI cockpit is the
terminal, not either editor).

## Risk classification

Marked HIGH because the collaboration protocol is workflow
infrastructure that shapes every future Life OS phase. Getting it
wrong (either overbuilt or underbuilt) has multi-quarter downstream
cost. HIGH tier per the risk-tier ADR being introduced by this same
task.

## Scope of the change

- Introduce `council/` folder + `council/README.md` protocol.
- Introduce `docs/lifeos/ROADMAP.md` as Layer 1 canonical roadmap.
- Introduce ADR-012 (risk-tier policy) and ADR-013 (never-autonomous
  operations policy).
- Rewrite `CLAUDE.md` and `AGENTS.md` as Layer 2 pointers to Layer 1
  (no rule restatement).
- Introduce `.github/workflows/ci.yml` as deterministic CI gate.
- Create this example task folder to establish the Council convention.

## Non-goals

- Do NOT install Hermes, Qwen, Gemini, or any AI-platform orchestrator.
- Do NOT create per-model instruction files for models not currently
  in rotation.
- Do NOT ship Council automation (`scripts/council.sh` etc.).
- Do NOT change application code (`app.js`, `core.js`, `bht.js`,
  `index.html`, `styles.css`, domain modules).
- Do NOT change production storage or backup behavior.
- Do NOT push, merge, or configure remote GitHub settings; Step 1 is
  local repository only.

## Inputs consumed

- The AI Council Platform Architecture Review (independent evaluation,
  Claude, 2026-08-28) — `reports/claude.md` in this task folder.
- The three-way synthesis draft from ChatGPT (2026-08-28), preserved
  in the user's local review workflow.
- Layer 1 canonical documents at the frozen base commit above.

## Success criteria

- `council/README.md` documents the full protocol.
- Layer 2 files (`CLAUDE.md`, `AGENTS.md`) reference Layer 1 without
  restating rules.
- ADR-012 and ADR-013 land in `docs/lifeos/DECISIONS.md` with correct
  numbering.
- `docs/lifeos/ROADMAP.md` becomes the single canonical roadmap.
- `.github/workflows/ci.yml` runs Playwright + syntax + `git diff --check`
  and uploads failure artifacts only.
- This example task folder demonstrates the convention end-to-end.
- Existing 157-test Playwright suite still passes on the resulting branch.
- No changes to `app.js`, `core.js`, `bht.js`, `index.html`, `styles.css`.
