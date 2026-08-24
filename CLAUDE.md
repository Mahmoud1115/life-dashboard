# Dune Life OS — AI context

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
- **High-risk changes require independent Codex/ChatGPT review before merge.** Applies to any change touching storage migration, authentication, Row Level Security, secrets, backup/restore, Review Center transactions, or database migrations.

## Review flow

Meaningful changes get a second review before merge. Use the
`project-reviewer` subagent for local reviews, or export the diff for
Codex/ChatGPT. See `.claude/agents/project-reviewer.md`.

---

*This file is Claude Code's instruction mechanism. When other coding
agents (Codex, etc.) start being used in-repo, they'll get their own
`AGENTS.md`. Both should point back to `docs/lifeos/*` as the shared
project truth, not duplicate it.*
