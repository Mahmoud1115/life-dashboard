# Life OS 2.0 — Claude Code agent instructions

*This file is Layer 2 (agent-specific operating ergonomics). It links
to Layer 1 canonical truth; it does not restate rules. When a rule
here appears to conflict with Layer 1, Layer 1 wins.*

## Read Layer 1 first

Before proposing or implementing a change in this repository, read:

1. [`docs/lifeos/PROJECT.md`](docs/lifeos/PROJECT.md) — what Life OS is, scope, principles.
2. [`docs/lifeos/ARCHITECTURE.md`](docs/lifeos/ARCHITECTURE.md) — current technical state.
3. [`docs/lifeos/STORAGE_MAP.md`](docs/lifeos/STORAGE_MAP.md) — per-domain authority.
4. [`docs/lifeos/DECISIONS.md`](docs/lifeos/DECISIONS.md) — ADR log (append-only).
5. [`docs/lifeos/ROADMAP.md`](docs/lifeos/ROADMAP.md) — canonical current-phase roadmap.

## Read the Council convention

Cross-model tasks (architecture, HIGH-risk review, roadmap synthesis)
follow the Council protocol documented in
[`council/README.md`](council/README.md). Read it before opening or
responding to a task folder under `council/tasks/`.

## Claude's normal role

When assigned to a task, Claude Code is normally the **primary
implementer**. Independent review for HIGH-risk work comes from
Codex CLI or another explicitly designated reviewer — not from
another Claude Code session.

## Operational rules (agent-specific ergonomics)

- One implementer per PR / change-set at a time. Other models are
  reviewers unless explicitly reassigned.
- Never work directly on `main`. Use a dedicated branch (project
  convention: `claude/<slug>`) and, where isolation matters, a
  dedicated worktree.
- Deterministic tests + CI (per ADR-012) are the merge gate. AI
  review is not a required status check.
- HIGH-risk work requires independent review (per ADR-012). Claude
  does not self-approve HIGH.
- Real personal data (Money values, Journal / decision text, real
  Logbook entries, contact info, credentials) must not be copied
  into automated or external review artifacts. When analysis of real
  data is needed, use the local redacted diagnostic path (per the
  ROADMAP.md `#health` panel), not raw values.
- Never-autonomous operations are pinned in ADR-013. Consult that
  ADR before scripting anything that would perform one.

## Legacy line — replaced by ADR-012 + ADR-013

Older wording in this file said "High-risk changes require
independent Codex/ChatGPT review before merge." That statement is
still true but now lives in [ADR-012](docs/lifeos/DECISIONS.md).
Consult the ADR for the current tier definitions.

Branch-hygiene wording that referenced `feature/motion-polish` /
`feature/supabase-foundation` (ADR-007) reflects an earlier layout
and is not the current default; use `claude/<slug>` branches per
the current Council convention.

## What NOT to duplicate here

Do not copy `PROJECT.md`, `ARCHITECTURE.md`, `STORAGE_MAP.md`,
`ROADMAP.md`, or any ADR content into this file. When Layer 1
changes, this file does not need to be updated — the link is enough.
Duplication guarantees drift.

## Related files

- [`AGENTS.md`](AGENTS.md) — the vendor-neutral counterpart for
  Codex CLI and any other agent that reads the standard.
- [`council/README.md`](council/README.md) — the cross-model task
  protocol.
- [`.github/workflows/`](.github/workflows/) — deterministic CI.
