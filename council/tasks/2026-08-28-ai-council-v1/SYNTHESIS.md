---
task: 2026-08-28-ai-council-v1
base_commit: 92f77510c940f8da44429537d5551d8af2e06c9e
model: chatgpt
role: synthesizer
created_at: 2026-08-28T00:00:00Z
inputs:
  - council/tasks/2026-08-28-ai-council-v1/task.md
  - council/tasks/2026-08-28-ai-council-v1/CLAUDE.md
  - three-way synthesis draft (ChatGPT, 2026-08-28) — preserved in
    user's local review workflow
evidence:
  - none-required (workflow-only decision)
---

# Synthesis — AI Council V1 accepted decision

**Status:** ACCEPTED for Step 1 (local repository foundation).
Codex final audit pending — the user will send this task folder to
Codex when its rate limits reset, and Codex's Round 1 report will
land as `CODEX.md` in this same folder.

## Accepted V1 architecture

```
VS Code                = human read/browse editor (NOT the AI cockpit)
Terminal               = AI cockpit
  Claude Code CLI      = primary implementer
  Codex CLI            = independent HIGH-risk reviewer
  gh + git             = repo I/O
ChatGPT (browser)      = orchestrator / synthesis / roadmap
LIFE repository        = durable project truth (Layer 1 docs authoritative)
council/tasks/<slug>/  = task-specific cross-model collaboration record
Git + on-demand
worktrees              = write isolation
GitHub Actions CI      = objective deterministic evidence
```

## Accepted V1 rules

- **Repository is truth. Models are workers.** Vendor / model memory
  is convenience only.
- **One implementer per PR / change-set.** Others are reviewers.
- **HIGH-risk requires independent review** (per ADR-012).
- **Never-autonomous operations list** pinned in ADR-013.
- **Bounded review loops:** maximum two revisit rounds per task.
- **Round 1 blind:** reviewers do not read each other's reports
  before their own is committed.
- **Per-task Council folders** with YAML frontmatter for provenance.
- **Real personal data never automatically routed to external providers.**
- **CI-green is a required status check on `main`** (enforced by
  ruleset in Step 2).

## Accepted V1 exclusions

- **Hermes NOT in V1.** No AI-platform orchestrator. Trigger for
  reconsideration listed in `docs/lifeos/ROADMAP.md` triggered
  branches.
- **Qwen OPTIONAL experiment** (try once on large-diff
  pre-compression; measure).
- **Gemini TRIGGERED** (multimodal / tie-breaker only; not
  scheduled).
- **Cursor NOT used.** Competes with Claude Code CLI as implementer.
- **VS Code AI extensions NOT installed.** Same reason.
- **No Council automation in V1.** Manual convention proves itself
  first.
- **No per-model instruction files** for models not currently in
  rotation. Layer 2 = `CLAUDE.md` + `AGENTS.md` only.
- **No pre-created per-model worktrees.** On-demand via Claude Code
  CLI and Codex CLI native behavior.
- **No hosted telemetry by default.** Local redacted `#health`
  bundle substitutes.

## What Step 1 delivered locally on branch `claude/ai-council-v1-foundation`

- `council/README.md` — protocol documentation.
- `council/tasks/2026-08-28-ai-council-v1/` — this task folder
  (task.md + CLAUDE.md + SYNTHESIS.md).
- `docs/lifeos/ROADMAP.md` — Layer 1 canonical roadmap (new).
- `docs/lifeos/DECISIONS.md` — appended ADR-012 (risk-tier policy)
  and ADR-013 (never-autonomous operations).
- `CLAUDE.md` — rewritten as Layer 2 pointer to Layer 1 + Council +
  ADR-012 + ADR-013.
- `AGENTS.md` — rewritten as vendor-neutral Layer 2 counterpart.
- `.github/workflows/ci.yml` — deterministic CI gate (Playwright
  full suite + `node --check` + `git diff --check` + failure
  artifacts on failure only).

No application code changed. No production storage behavior changed.
No push, no merge, no remote GitHub configuration.

## Pending Codex audit

Codex has not yet reviewed this synthesis. When Codex's Round 1
report lands in `CODEX.md` (this same folder), Codex should flag:

- P0/P1 architecture flaws;
- unsafe assumptions;
- false blockers;
- unnecessary phase / process inflation;
- contradictions with current repository facts.

Codex should NOT redesign the whole V1 unless a concrete flaw
requires it. The current synthesis is intended to survive
adversarial review as a minimal foundation.

## Immediate next step

Step 2 will:

- Push the branch `claude/ai-council-v1-foundation` to `origin`.
- Enable protected `main` ruleset requiring the `ci / deterministic
  evidence` status check.
- Enable CodeQL default setup and Dependabot alerts in the GitHub UI.
- Land the `v0.B1` tag on the pre-merge commit `92f7751`.
- Merge this branch to `main` via a fast-forward PR after Codex
  audit.

Step 2 requires human approval per ADR-013 (remote GitHub setting
changes are on the never-autonomous list; the user performs each
one manually).

## Never-autonomous acknowledgement

Per ADR-013, no action below is authorized by this synthesis:

- push to origin;
- merge to main;
- change GitHub branch protection or ruleset;
- enable remote CodeQL / Dependabot;
- create or push a release tag;
- deploy anything.

Each of those actions is a Step 2 human act with per-instance
approval.
