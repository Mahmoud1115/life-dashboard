---
task: 2026-08-28-ai-council-v1
base_commit: 92f77510c940f8da44429537d5551d8af2e06c9e
model: claude-code
role: reviewer
created_at: 2026-08-28T00:00:00Z
inputs:
  - docs/lifeos/PROJECT.md
  - docs/lifeos/ARCHITECTURE.md
  - docs/lifeos/DECISIONS.md
  - AGENTS.md (pre-task snapshot)
  - CLAUDE.md (pre-task snapshot)
  - AI Council Platform Architecture Review prompt (2026-08-28)
evidence:
  - Full Playwright suite (157/157) on main == origin/main == 92f7751
    at task open (recorded in prior session).
---

# Claude Round 1 — AI Council V1 architecture review

## Verdict

**RECOMMEND WITH ADJUSTMENTS — substantial simplification of the
proposal.** The named bottleneck (copy-paste round-tripping between
models) is real. About 60% of the proposed maximal architecture is
defensible; the remaining 40% is either premature or a bikeshed.

The load-bearing insight the proposal contains — *"repository is the
durable memory; vendor/model memory is convenience only"* — is
correct and must be preserved. The rest is scope.

## Key challenges

1. **The AI cockpit is not the editor; it is the terminal.** Claude
   Code CLI + Codex CLI + `gh` + `git` in a terminal is what actually
   ran every B0 and B1 iteration on this repository. VS Code is a
   passive editor. Cursor's AI ergonomics don't apply because Claude
   Code CLI already provides them at the CLI layer. Debating editors
   is a distraction.

2. **Do not adopt Hermes now.** Its proposed role (route Qwen jobs,
   run cheap scans, persistent auxiliary memory, provider fallback,
   scheduled tasks) solves problems that don't exist at current scale.
   The actual bottleneck is copy-paste — Hermes doesn't reduce
   copy-paste; it reduces routing overhead, which is not the
   bottleneck. Persistent memory via Hermes is strictly worse than
   persistent memory via git (portable, versionable, revertable,
   human-readable). Adding Hermes turns Life OS development into an
   AI-platform project. Trigger for reconsideration: >10 routed jobs
   per week OR cross-model automation GitHub Actions can't do OR >2
   provider outages per month.

3. **Layer 2 collapses to two files** — `CLAUDE.md` + `AGENTS.md`.
   Do NOT create `HERMES.md` / `QWEN.md` / `GEMINI.md` before those
   models are actually in rotation. Speculative per-model instruction
   files drift when they don't reflect reality.

4. **On-demand worktrees, not pre-created per-model worktrees.**
   Claude Code CLI and Codex CLI already create their own worktrees
   per session on demand. Pre-created `worktree/claude` /
   `worktree/codex` is ceremony.

5. **The Council folder in the repo IS the copy-paste solution.**
   Each model writes to `council/tasks/<YYYY-MM-DD>-<slug>/CLAUDE.md`,
   `CODEX.md`, `CHATGPT.md`, `SYNTHESIS.md`. Response-file header
   (YAML frontmatter with commit hash + timestamp + input files read)
   prevents stale-context reviews.

6. **Bounded review loops.** Maximum two revisit rounds per task
   (not per reviewer). After that, the user decides. B1 had five
   review rounds; the last two mostly produced diminishing returns.
   Hard bound forces the user to make the call.

7. **Qwen and Gemini are OPTIONAL and TRIGGERED, not scheduled.**
   Neither has proven material savings on this project yet. Adding
   them by default expands cost + provider surface + review
   complexity. Try Qwen once on a large-diff pre-compression task and
   measure.

## Retractions vs Claude's earlier 100× research

- Retract **Sentry / hosted telemetry by default**. Privacy risk on
  journal / financial data. Local redacted `#health` diagnostic
  bundle substitutes.
- Retract **ship PWA this week**. Service worker + mid-flight
  canonical storage flip is a corruption hazard. Split: manifest +
  installability post-B2.5 (additive, safe); full offline data
  triggered separately.
- Retract **Context7 MCP always-on**. Fails the "current need +
  least privilege" filter. Use WebSearch on-demand instead.
- Retract **CodeRabbit on every PR**. Under ADR-012 risk tiers,
  LOW/MEDIUM PRs need no AI review at all; HIGH gets Codex only.
- Retract **write the full Cloudflare-vs-Pages ADR now**. Replaced
  with a hosting-trigger note (ADR-016 draft, to be written when
  needed) that names the triggers and defers the full comparison.

## What I explicitly do NOT push back on (proposal is right)

- Repository as durable memory. Right.
- One implementer per PR / one HIGH-risk independent reviewer. Right.
- Deterministic CI outranks model consensus. Right.
- Layer 1 canonical truth in `docs/lifeos/*`. Right.
- Round 1 blind + Round 2 synthesis + bounded Round 3. Right.
- Real personal data never automatically routed to external providers.
  Right.

## V1 that solves the bottleneck (all currently available or trivial)

- LIFE repository as durable memory (already true).
- Claude Code CLI as primary implementer (already true).
- Codex CLI as HIGH-risk independent reviewer (already true).
- ChatGPT as orchestrator / synthesizer (already true).
- Playwright deterministic tests (already true).
- GitHub secret scanning + push protection (already enabled).
- **Add now:** GitHub Actions CI, protected `main` ruleset,
  release-tag auto-workflow, ADR-012 (risk tiers), ADR-013 (never
  autonomous), `council/` folder convention, `docs/lifeos/ROADMAP.md`
  as canonical, Layer 2 files rewritten as pointers.
- **Do NOT add:** Hermes, Qwen automation, Gemini automation, VS Code
  AI extensions, Cursor migration, custom model router, custom VS Code
  extension, memory database, plugin framework.

## Immediate next step

Local implementation of the V1 items above on branch
`claude/ai-council-v1-foundation`. No push, no merge, no remote
GitHub configuration in Step 1. Await user + ChatGPT review of the
Step 1 evidence before enabling remote settings in Step 2.

## Full report

The full 19-section adversarial architecture review (sections A–S)
is preserved externally in the user's local review workflow and was
delivered separately as `CLAUDE_AI_COUNCIL_ARCHITECTURE_REVIEW.md`.
This file records the accepted essence for the Council record.
