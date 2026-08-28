---
task: 2026-08-28-ai-council-v1
base_commit: 92f77510c940f8da44429537d5551d8af2e06c9e
model: chatgpt
role: synthesizer
created_at: 2026-08-28T00:00:00Z
inputs:
  - council/tasks/2026-08-28-ai-council-v1/task.md
  - council/tasks/2026-08-28-ai-council-v1/reports/claude.md
  - council/tasks/2026-08-28-ai-council-v1/reports/codex.md
  - three-way synthesis draft (ChatGPT, 2026-08-28) — preserved in
    user's local review workflow
evidence:
  - none-required (workflow-only decision)
---

# Synthesis — AI Council V1 accepted decision

**Status:** REMEDIATION IN PROGRESS — awaits targeted Codex re-review
against the P1 remediation head.

Codex Round 1 audit landed as
`reports/codex.md` and returned:

```text
Overall verdict:  APPROVE WITH CHANGES
Merge recommendation:  FIX THEN MERGE
P0:  0
P1:  8
```

The V1 architecture itself is approved. Merge is BLOCKED until the
accepted P1 remediation is complete AND independently re-reviewed
against the new head. Do not mark the task `accepted` until the
targeted Codex re-review clears.

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
  (`task.md` + `reports/claude.md` + `reports/codex.md` +
  `SYNTHESIS.md`; reports live under `reports/` per the P1-2 remediation).
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

## Codex Round 1 audit — landed as `reports/codex.md`

Codex's Round 1 report is committed as `reports/codex.md` in this
task folder. It flags the following:

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
- Land the `v0.B1` tag on the pre-merge commit
  `92f77510c940f8da44429537d5551d8af2e06c9e`.
- Integrate this branch into `main` after Codex audit and CI green.
  PR review and CI are mandatory. The final integration method must
  preserve the intended commit history and must be chosen explicitly
  at merge time according to repository policy. The GitHub PR UI
  does not provide a generic "fast-forward merge" mode equivalent to
  a local `git merge --ff-only` workflow, so do not codify one as a
  required GitHub behavior; select the concrete integration method
  (rebase, squash, or merge commit) at merge time per policy.

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

## Remote validation (Step 2 result)

- PR: https://github.com/Mahmoud1115/life-dashboard/pull/4 —
  "workflow: add AI Council V1 foundation"
- CI: GREEN (`ci / deterministic evidence` — 157/157 Playwright,
  0 skipped, syntax PASS, `git diff --check` PASS, ~2m28s)
- main ruleset: ACTIVE (`main-protection`, id 21733377) —
  pull_request required, `deterministic evidence` required status
  check, non-fast-forward blocked, deletion blocked, no bypass actors
- CodeQL: ENABLED (default setup, JavaScript / TypeScript,
  `state: configured`, `query_suite: default`, first analysis run
  triggered)
- Dependabot alerts: ENABLED
- Dependabot security updates: ENABLED
- B1 tag: `v0.B1` pushed to origin, pointing at
  `92f77510c940f8da44429537d5551d8af2e06c9e`
- Codex audit: LANDED (APPROVE WITH CHANGES; 0 P0; 8 P1 — see `reports/codex.md`)
- Merge: BLOCKED until accepted P1 remediation completes AND is
  independently re-reviewed against the new head.

## P1 remediation status

Remediation applied on top of Step 2 head `c8a1179`:

- **P1-1** CI required-check ambiguity: FIXED. Push trigger narrowed
  to `main`; `git diff --check` on `main` push compares the pushed
  commit range with an all-zero-SHA guard for branch-creation
  events. `.github/workflows/ci.yml`.
- **P1-2** Nested `CLAUDE.md` report collision: FIXED. Report files
  moved under `reports/` with lowercase filenames; convention
  documented in `council/README.md` §Task folder shape.
- **P1-3** Reviewed-implementation provenance: FIXED. `council/README.md`
  requires `review_commit` + `working_tree` + `evidence` for
  implementation-review reports; lifecycle distinguishes author
  handoff, blind peer review, implementation review, and final
  synthesis; task-status `pending-independent-review` recorded on
  the current task.
- **P1-4** Stale `.claude/agents/project-reviewer.md`: FIXED. Stale
  architecture facts replaced with pointers to canonical Layer 1
  docs; the file retains only reviewer-specific role / scope /
  output contract material.
- **P1-5** Risk-tier precedence: FIXED. ADR-012 addendum #1 adds
  an explicit HIGH-precedence rule and reclassifies `B2a.1` as
  HIGH in the roadmap.
- **P1-6** ROADMAP vs ADR-001 / ADR-006 contradiction: FIXED. New
  ADR-014 supersedes ADR-001's inevitable-Supabase framing and
  narrows ADR-006's mandatory Gen-1 → Gen-2 consolidation to
  active / retained / migration-relevant domains. ROADMAP.md
  updated to reference ADR-014.
- **P1-7** Personal-data egress canonical policy: FIXED. ADR-013
  addendum #1 pins the egress rule at Layer 1 and clarifies the
  GitHub Pages auto-deploy approval semantics.
- **P1-8** Strict required-status-checks policy: LANDED — enabled
  on the `main-protection` ruleset (id `21733377`) after CI green
  on the new head. `strict_required_status_checks_policy: true`;
  every other rule preserved (deletion blocked, non-fast-forward
  blocked, pull_request required, `deterministic evidence` required
  status check, allowed merge methods `merge` / `squash` / `rebase`,
  0 required approving reviews, no bypass actors).

**Remediation HEAD SHA.** `b21cd8d91ed0f607bac9ce05db2905586cffbc8a`
(pushed to `origin/claude/ai-council-v1-foundation` at
`c8a1179..b21cd8d`). Three focused commits landed on top of `c8a1179`:

- `87ff7ce` — ci: harden required deterministic evidence gate (P1-1)
- `ace2e6d` — docs(council): fix report isolation and review provenance (P1-2, P1-3, P1-4)
- `b21cd8d` — docs(policy): resolve risk privacy and roadmap authority (P1-5, P1-6, P1-7)

Remote enforcement change (P1-8) is a GitHub ruleset mutation and
lives outside git history.

**Re-review contract.** `b21cd8d` is the exact implementation head
Codex must re-review. Codex's re-review report lands as
`reports/codex-re-review.md` with `review_commit: b21cd8d...`. Do
not reuse the earlier `c8a1179c5160ddf5333b7301ceb2a3c58d6932d5`
as the final approved implementation.

**Post-remediation CI evidence** (HEAD `b21cd8d`, PR #4):

- `deterministic evidence` — PASS (2m32s, pull_request run
  `33204334618`)
- `Analyze (javascript-typescript)` — PASS (CodeQL, 56s, run
  `33204331980`)
- No `push`-event CI run appeared for the branch head (P1-1
  narrowing verified in production).

## Non-blocking items (recorded, not implemented)

Per handoff §11, Codex's P2 and P3 findings are recorded here and
deliberately NOT implemented in this remediation:

- **P2** worktree launch hardening.
- **P2** A0 persistence serialization details.
- **P2** known-good backup terminology refinement.
- **P2** residual-risk override record for the risk-tier precedence
  ADR (fold-in only if a HIGH-invariant-touching change materially
  affects the current PR — none does).
- **P2** merge-method / provenance refinement beyond what P1-3
  requires.
- **P2** deployment wording beyond the P1-7 clarification.
- **P2** CodeQL as required merge gate (advisory per current
  security stack).
- **P3** timestamp / header cleanup.
- **P3** task-ID collision scheme.

Revisited only if a future task strictly requires them.
