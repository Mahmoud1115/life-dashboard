# Life OS 2.0 — Agent instructions (vendor-neutral)

*This file is Layer 2 (vendor-neutral agent operating ergonomics),
the counterpart of `CLAUDE.md` for any non-Claude agent that reads
the `AGENTS.md` convention (Codex CLI, future harnesses). It links
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

## Codex / non-Claude agent normal role

For HIGH-risk work, a non-Claude agent (typically Codex CLI) is the
**independent reviewer**. The reviewer:

- receives the same frozen `base_commit` and canonical inputs the
  implementer used;
- does not read another reviewer's Round 1 report before writing its
  own;
- writes findings by severity;
- does not produce a second implementation unless explicitly
  reassigned.

When Codex is asked to implement, the independent reviewer for the
resulting HIGH-risk change is Claude Code or a human maintainer —
not another Codex session.

## Operational rules (agent-specific ergonomics)

- One implementer per PR / change-set at a time.
- Never work directly on `main`. Use a dedicated branch (e.g.
  `codex/<slug>`) and a dedicated worktree where isolation matters.
- Deterministic tests + CI (per ADR-012) are the merge gate. AI
  review is not a required status check.
- HIGH-risk work requires independent review (per ADR-012). No agent
  self-approves HIGH.
- Real personal data (Money values, Journal / decision text, real
  Logbook entries, contact info, credentials) must not be copied
  into automated or external review artifacts. Use the local
  redacted diagnostic path (`#health` panel) rather than raw values.
- Never-autonomous operations are pinned in ADR-013. Consult that
  ADR before scripting anything that would perform one.

## Bounded review loop

Per `council/README.md`: maximum two revisit rounds per task. After
that, the user decides. Do not escalate a review into an unbounded
consensus loop.

## Privacy / provider boundary

Real user personal data does not automatically flow to any AI
provider. When redacted context is needed for reasoning, use the
`#health` diagnostic path per the roadmap. Cross-provider automation
must always have per-instance human approval for operations that
touch real personal data.

## Legacy wording — superseded by ADR-012 + ADR-013

Previous wording said "High-risk changes require independent review
before merge." That statement is still true but now lives in
[ADR-012](docs/lifeos/DECISIONS.md). Never-autonomous operations
are pinned in ADR-013. Branch-hygiene guidance that referenced
`feature/motion-polish` / `feature/supabase-foundation` (from
ADR-007) reflects an earlier layout and is not the current default;
use per-agent `<agent>/<slug>` branches per the current Council
convention.

## What NOT to duplicate here

Do not copy `PROJECT.md`, `ARCHITECTURE.md`, `STORAGE_MAP.md`,
`ROADMAP.md`, or any ADR content into this file. When Layer 1
changes, this file does not need to be updated — the link is
enough. Duplication guarantees drift.

## Related files

- [`CLAUDE.md`](CLAUDE.md) — the Claude Code counterpart to this file.
- [`council/README.md`](council/README.md) — the cross-model task
  protocol.
- [`.github/workflows/`](.github/workflows/) — deterministic CI.
