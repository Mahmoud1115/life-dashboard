# Dune Life OS — Codex context

Before proposing or implementing a change in this repository, read:

1. `docs/lifeos/PROJECT.md`      — what Life OS is, scope, principles
2. `docs/lifeos/ARCHITECTURE.md` — current technical architecture
3. `docs/lifeos/STORAGE_MAP.md`  — per-domain canonical storage source
4. `docs/lifeos/DECISIONS.md`    — architectural decisions log (ADRs)

## Hard rules

- **Never commit personal user data.** The repo is public. See ADR-008.
- **Never introduce a build step, framework, or bundler.** See ADR-002.
- **Never delete `dune_state_v4.qatarVisit`** — `core.js` `validate()` requires it. See ADR-003.
- **Storage changes: Gen-1 → Gen-2 → Supabase, one domain per commit.** See ADR-006.
- **Motion changes stay on `feature/motion-polish`. Foundation stays on `feature/supabase-foundation`.** See ADR-007.
- **High-risk changes require independent review before merge.** Applies to any change touching storage, authentication, Row Level Security, secrets, backup/restore, database migrations, or Review Center transactions. When Codex is the author, the independent reviewer is Claude Code or a human maintainer — not another Codex session.

## Review flow

Meaningful changes get a second review before merge. Codex-authored diffs should be handed to Claude Code (or a human maintainer) before merging into `main`. See `docs/lifeos/DECISIONS.md` for the branch-hygiene rules governing which changes may share a branch.

---

*This file (`AGENTS.md`) is Codex's instruction mechanism, the counterpart to `CLAUDE.md` for Claude Code. Both point back to `docs/lifeos/*` as the shared project truth; neither duplicates it.*
