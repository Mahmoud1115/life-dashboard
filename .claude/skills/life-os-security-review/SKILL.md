---
name: life-os-security-review
description: Project-specific security review for the Dune Life OS dashboard. Runs the shared checklist in docs/lifeos/SECURITY_REVIEW.md against a diff, branch, PR, or file set. Use before merging changes to secrets, storage, authentication, RLS, backup/restore, database migrations, or the Review Center — or when the user asks for a security review.
---

# Life OS security review — Claude wrapper

Runs the shared Life OS security standard against a code change. The standard itself lives in `docs/lifeos/SECURITY_REVIEW.md` so Codex and human reviewers use the same checklist.

## Step 1 — Load context

Read in order, do not skip:

1. `docs/lifeos/PROJECT.md`
2. `docs/lifeos/ARCHITECTURE.md`
3. `docs/lifeos/STORAGE_MAP.md`
4. `docs/lifeos/DECISIONS.md`
5. `docs/lifeos/SECURITY_REVIEW.md` — the checklist, severity model, and reporting format this review must follow

## Step 2 — Establish scope

Confirm what is being reviewed before touching any code:

- A specific file or file set
- Current diff (`git diff`, `git diff --staged`)
- A branch vs main (`git diff main..HEAD`, `git diff origin/main..HEAD`)
- A PR by number or URL
- Broad audit of the current tree

If the scope is unclear, ask before proceeding. Do not guess.

## Step 3 — Gather evidence

For each checklist category in `SECURITY_REVIEW.md`:

- Grep, read, or diff-inspect against the actual current tree
- **Never cite line numbers copied from any doc.** Always verify current locations via `grep -n` and cite what you find *now*
- If a category has no changes in scope, record a PASS for it — do not silently skip

## Step 4 — Report

Output must follow `SECURITY_REVIEW.md` exactly:

- Severity ordering: CRITICAL → HIGH → MEDIUM → LOW → PASS
- Per-finding fields: What is wrong / Where / Realistic impact / Safest minimal fix / Blocks merge
- Close with the footer stating whether external independent review is still required

## Boundaries

- Read-only. Do not modify code, commit, push, or merge.
- Security-only. For architectural, style, or performance review, use a different tool.
- If any high-risk category has findings, note in the report footer that external Codex/ChatGPT/human review is still required before merge, per `CLAUDE.md` and `AGENTS.md`.
