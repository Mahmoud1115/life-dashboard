---
task: 2026-08-28-ai-council-v1
base_commit: 92f77510c940f8da44429537d5551d8af2e06c9e
review_commit: c8a1179c5160ddf5333b7301ceb2a3c58d6932d5
model: codex
role: reviewer
created_at: 2026-08-28T00:00:00Z
working_tree: clean
inputs:
  - council/README.md at review_commit
  - council/tasks/2026-08-28-ai-council-v1/task.md at review_commit
  - council/tasks/2026-08-28-ai-council-v1/reports/claude.md at review_commit
    (formerly council/tasks/2026-08-28-ai-council-v1/CLAUDE.md pre-rename)
  - council/tasks/2026-08-28-ai-council-v1/SYNTHESIS.md at review_commit
  - CLAUDE.md at review_commit
  - AGENTS.md at review_commit
  - docs/lifeos/PROJECT.md at review_commit
  - docs/lifeos/ARCHITECTURE.md at review_commit
  - docs/lifeos/STORAGE_MAP.md at review_commit
  - docs/lifeos/DECISIONS.md at review_commit (ADR-001..ADR-013)
  - docs/lifeos/ROADMAP.md at review_commit
  - .github/workflows/ci.yml at review_commit
  - .github/dependabot.yml at review_commit
  - .claude/agents/project-reviewer.md at review_commit
evidence:
  - github-actions:33173693944/deterministic evidence  (push run, PASS)
  - github-actions:33173736254/deterministic evidence  (PR run, PASS)
  - github-actions:33174044335/deterministic evidence  (status-update push, PASS)
  - github-actions:33174049251/deterministic evidence  (status-update PR, PASS)
---

# Codex Round 1 audit — AI Council V1

**Provenance note.** This file records Codex's Round 1 audit as
delivered via the P1 remediation handoff document authorized by the
user on 2026-08-28. It is the substantive record of Codex's
findings on `review_commit c8a1179` and drove the remediation on
this branch. When Codex re-reviews the remediation head, its
targeted re-review report will land as `reports/codex-re-review.md`
in this same folder with a new `review_commit` frontmatter field.

## Overall verdict

```
Overall verdict:       APPROVE WITH CHANGES
Merge recommendation:  FIX THEN MERGE
P0:  0
P1:  8
P2:  8
P3:  2
```

The AI Council V1 architecture itself is approved. The eight P1
items below are fixes to boundaries — filenames, provenance,
policy precedence, doc drift — not architectural redesigns. P2 and
P3 items are recorded for later attention and are not merge
blockers.

## P0 findings

None.

## P1 findings

### P1-1 — CI required-check ambiguity

The `deterministic evidence` job in `.github/workflows/ci.yml` runs
on both `push` (to `main` and every agent branch prefix) and
`pull_request` events. Because the required status check on the
main-protection ruleset references the check name `deterministic
evidence` without qualifying which run produced it, a `push` run
on an agent branch can satisfy the same required context that a
PR run should satisfy. The `push`-run's `git diff --check` step
uses the fallback `git diff --check` (no ref range), which is a
working-tree-only check after checkout — effectively a no-op
because the checkout is clean. A future PR that lands weaker diff
coverage could therefore see the required context pass on the
push run rather than the PR run.

**Required fix.** Narrow the workflow's `push` trigger to `main`
only. Preserve the `pull_request` trigger on `main`. For the
`push` event on `main`, make `git diff --check` compare the pushed
commit range `github.event.before...github.sha` with an all-zero
SHA guard for branch-creation and branch-delete edges. Preserve
the check name `deterministic evidence` so the existing required
status check on the ruleset continues to bind.

### P1-2 — Nested `CLAUDE.md` report collision

A file named exactly `CLAUDE.md` at ANY depth in the repository
can be interpreted by Claude Code as instruction memory rather
than a neutral historical evidence file. The Council task at
`council/tasks/2026-08-28-ai-council-v1/CLAUDE.md` collides with
that convention. Root-level `CLAUDE.md` and `AGENTS.md` are the
only files reserved for actual agent instructions; nested
report files must not share that filename shape.

**Required fix.** Reshape the task-folder convention:
`council/tasks/<slug>/reports/claude.md`,
`council/tasks/<slug>/reports/codex.md`,
`council/tasks/<slug>/reports/chatgpt.md`, with lowercase
filenames. Update the current task folder in place via `git mv`
(preserves history). Update every reference in `council/README.md`,
`council/tasks/<slug>/task.md`, `council/tasks/<slug>/SYNTHESIS.md`
and any Layer 2 file that mentions the old shape. Do not use a
local exclusion workaround — the repository convention itself
must be safe.

### P1-3 — Reviewed-implementation provenance incomplete

The Council V1 provenance schema in `council/README.md` requires
`base_commit` but not `review_commit`. `base_commit` identifies
the commit the TASK was opened against, not the exact
implementation head the reviewer approved. Without a
`review_commit` binding, an implementation review's approval can
silently drift to a later commit.

Related: the current task's SYNTHESIS.md is marked "ACCEPTED for
Step 1" before an independent implementation-review report has
landed. That conflates author handoff, blind peer review,
implementation review, and final synthesis into one lifecycle
value.

**Required fix.** Add `review_commit`, `working_tree`, and
`evidence` (github-actions run/check refs) as mandatory frontmatter
fields for implementation-review reports. Update the task's
lifecycle so a synthesis MUST NOT precede the independent
implementation report it claims to synthesize. Distinguish four
review stages in `council/README.md`: author handoff, blind peer
review, implementation review, final synthesis. Set the current
task's `status:` to `pending-independent-review` (or an equivalent
non-final state) until Codex's re-review clears. Make the
stale-context rule deterministic against `review_commit`: any
implementation change on the branch after `review_commit`
invalidates the approval until targeted re-review.

External inputs that materially affect the decision should either
be committed as sanitized copies or recorded with a SHA-256 digest
and source description. Do not require per-file blob hashes for
committed files — the commit already binds repository content.

### P1-4 — Stale facts in `.claude/agents/project-reviewer.md`

The active `.claude/agents/project-reviewer.md` reviewer
instruction contains obsolete architecture facts that contradict
current repository truth:

- Reports "schema v11" for `dune_state_v4`; the current wrapper is
  schema 13 per B0.
- Reports "BHT AI provider key ... rides along with backup"; the
  BHT cloud-key handling was disabled by ADR-005 (commit
  `03383cd`), and the key no longer flows through the backup path.
- Reports "restore path is not actually atomic despite its own
  comment at app.js:1494"; B0's coordinated import
  (`beginFullStateTransaction` / `commitFullStateWrapper` /
  `endFullStateTransaction`) made the restore atomic per ADR-010.
- Reports "no test infrastructure yet"; the repository has 157
  Playwright tests across eight spec files with GitHub Actions CI.

**Required fix.** Rewrite `.claude/agents/project-reviewer.md` so
that stale architecture facts are replaced with pointers to
canonical Layer 1 docs. The file retains only reviewer-specific
material: role, scope, read-only expectations, output contract,
severity framing. Add a drift-audit note stating that
`.claude/agents/**` and any future skills / rules / hook files are
part of the instruction-surface drift audit convention. Do not
create a generic scanner in this remediation.

### P1-5 — Conflicting risk classifications

ADR-012 defines LOW / MEDIUM / HIGH tiers via examples, but its
examples permit a reading under which a HIGH-invariant-touching
change could be declared MEDIUM if the change looks small or
scoped. `B2a.1` — which touches `deriveStateFromLegacy` at
[core.js:510](core.js:510) and `normalizeLogbookDomain` at
[core.js:922](core.js:922), both recovery-derivation surfaces — is
described as "small MEDIUM-tier PR" in `docs/lifeos/ROADMAP.md`,
directly contradicting the tier intent.

**Required fix.** Add an explicit precedence rule to ADR-012: if a
change touches any HIGH-risk invariant (`BACKUP_KEYS`, persisted
Store schema, migration paths, import / export scope, snapshot /
reset, recovery derivation, two-source Logbook reconstruction,
canonical authority values or transitions), the entire change-set
is HIGH regardless of file count or narrow scope. Reclassify
`B2a.1` as HIGH in `docs/lifeos/ROADMAP.md`. Narrow the MEDIUM
Gen-2-product-slice example so it does NOT cover changes that
touch persisted schema, migration, import, export, snapshot,
reset, recovery, or authority semantics.

### P1-6 — ROADMAP contradicts ADR-001 and ADR-006

`docs/lifeos/ROADMAP.md` says Supabase is trigger-only, Money may
remain legacy indefinitely, and inactive legacy domains may remain
indefinitely / retire. ADR-001 ("Supabase as the future structured
backend") and ADR-006 ("Gen-1 → Gen-2 → Supabase, one domain per
commit") frame Supabase adoption as inevitable and imply universal
Gen-1 → Gen-2 consolidation. This creates contradictory Layer 1
truth: ADR wins by governance (append-only, supersede via a later
ADR), yet ROADMAP's language reads as if it can silently override
an ADR.

**Required fix.** Do not edit ADR-001 or ADR-006 in place. Append
a superseding ADR using the next verified number (ADR-014). The
new ADR:

1. Replaces inevitable-Supabase adoption with measurable value
   triggers and provider evaluation.
2. Preserves "never Gen-1 directly to backend" from ADR-006.
3. Limits mandatory Gen-1 → Gen-2 consolidation to active,
   retained, or explicitly migration-relevant domains.
4. Defines an explicit end-state per domain: `active-migrated` /
   `retained-legacy` / `retired`.
5. States governance: accepted ADRs govern architecture until
   explicitly superseded; ROADMAP schedules and reflects ADR
   decisions but does not silently override them.

Update `docs/lifeos/ROADMAP.md` to reference ADR-014 in the
Supabase and M2 sections.

### P1-7 — Personal-data egress not canonical

Privacy limits on personal data leaving the browser are documented
in Layer 2 files (`CLAUDE.md`, `AGENTS.md`) and in `council/README.md`,
but ADR-013 (never-autonomous operations) does not fully prohibit
external-model egress of raw / private user data. That leaves the
egress rule as guidance rather than canonical Layer 1 truth.

**Required fix.** Amend ADR-013 (via an addendum, per the
append-only DECISIONS.md convention). Add canonical language that
raw / private user data must not be automatically sent to external
AI providers, hosted MCP services, third-party SaaS, or remote
telemetry / debugging services without explicit per-instance human
approval. Enumerate the covered data classes (Money, health,
journal, contacts, raw Logbook, real backups, real exports,
credentials, unredacted diagnostics). Clarify: a cloud-model CLI
running locally still transmits data to an external provider —
"local" is process location, not data path. Enumerate allowed
default categories (source code, architecture docs, synthetic
fixtures, redacted diagnostics, redacted CI logs) subject to
repository confidentiality rules.

Clarify GitHub Pages deployment approval semantics: explicit
approval to merge a PR to `main` counts as approval for that
PR's known automatic GitHub Pages deployment, so a second
redundant approval click for the same deterministic consequence
is not required — unless the deploy itself is separately HIGH-risk
(authority cutover, previously-private data broadcast, outbound
network footprint change), in which case the deploy requires its
own approval distinct from the merge approval. No autonomous
merge remains allowed.

### P1-8 — Loose required-status-checks policy on `main-protection`

The `main-protection` ruleset (id `21733377`) currently has
`strict_required_status_checks_policy: false`. Under that policy,
a PR's required check can pass against an outdated base, and the
PR can then merge without re-running against current `main`. For a
HIGH-risk branch such as the AI Council V1 foundation, this leaves
a real window in which `main` moves between check and merge and
the merged code is never tested against the current base.

**Required fix.** Update the ruleset so
`strict_required_status_checks_policy: true`. This forces a PR to
be tested against current `main` before merge. Preserve everything
else: required approving review count `0` (single-user repo),
bypass actors `[]`, force-push and deletion blocks, allowed merge
methods, required check `deterministic evidence`. Do not add
artificial GitHub reviewer-count requirements.

Because this is a remote mutation, it requires explicit per-instance
human approval per ADR-013.

## P2 findings (recorded, not merge-blocking)

- **P2** worktree launch hardening — the current on-demand
  worktree convention is documented, but the specific safety
  contract (which worktree gets write authority per task) could be
  encoded in a lightweight per-task field.
- **P2** A0 (Aviation Quick ATA Log) persistence serialization —
  when A0 lands, it must use the Gen-2 durability path from day
  one (already stated in ROADMAP.md and the Aviation section of
  the Council review, but not yet ADR-pinned).
- **P2** "known-good backup" terminology refinement — the
  vocabulary "known-good full generation" (C1 / C2) is used
  informally; a small terminology ADR could pin it.
- **P2** Residual-risk override record for the risk-tier
  precedence rule — when a reviewer overrides the HIGH-precedence
  rule (they should not, but defensive design suggests a record
  format).
- **P2** Merge-method / provenance refinement beyond what P1-3
  requires — per-merge provenance capture beyond the
  `review_commit` binding.
- **P2** Deployment wording beyond the P1-7 clarification —
  additional documentation for the specific case where a deploy
  is separately HIGH-risk.
- **P2** CodeQL as a required merge gate — Codex notes this as a
  future consideration, not required for V1. CodeQL is currently
  advisory.
- **P2** Task-status field enumeration — a small canonical enum
  in `council/README.md` for the lifecycle values.

## P3 findings (recorded, not merge-blocking)

- **P3** Timestamp / header cleanup — the `created_at` values used
  in the current task's frontmatter default to midnight UTC
  because exact per-file authoring times were not recorded; a
  future convention could require actual per-file timestamps.
- **P3** Task-ID collision scheme — the `<YYYY-MM-DD>-<slug>`
  scheme is not collision-safe if two tasks with the same slug
  are opened on the same day. Low probability at current scale;
  the P3 record proposes a resolution scheme for when it matters.

## Not flagged — deliberately

Codex did not raise the following as findings, even though prior
reviewers might have:

- The absence of Hermes / Qwen / Gemini in V1 (approved).
- The Council folder convention itself (approved).
- The one-implementer / one-independent-HIGH-reviewer rule
  (approved).
- The bounded 2-revisit review loop (approved).
- Envelope-only durable authority (approved; consistent with
  ADR-013's approach to authority state).
- The CI content, minus P1-1 (approved).
- The Dependabot config (approved).
- The main-protection ruleset content, minus P1-8 (approved).

## Merge recommendation

**FIX THEN MERGE.** All eight P1 items must land as a remediation
commit set on the same branch, with a new implementation-review
report from Codex pinning the new `review_commit`. Do not merge on
the current head `c8a1179`. Do not merge before the targeted
re-review.
