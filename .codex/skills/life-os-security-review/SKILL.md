---
name: life-os-security-review
description: Independently review Dune Life OS changes for security defects using docs/lifeos/SECURITY_REVIEW.md. Use for changes involving secrets, storage, auth/RLS, external calls, backups, database migrations, permissions, or Review Center logic.
---

# Life OS security review — Codex wrapper

Independent, adversarial security review for a Dune Life OS change. Purpose is to catch what the original author missed — not to defer to their reasoning.

## Step 1 — Load context

Read in order, do not skip:

1. `AGENTS.md` — Codex's project instructions and hard rules
2. `docs/lifeos/PROJECT.md`
3. `docs/lifeos/ARCHITECTURE.md`
4. `docs/lifeos/STORAGE_MAP.md`
5. `docs/lifeos/DECISIONS.md`
6. `docs/lifeos/SECURITY_REVIEW.md` — the authoritative checklist, severity model, and reporting format this review must follow

## Stance — adversarial by default

Assume the author may have:

- Overlooked a secret path (env, config, header, comment, log, URL parameter)
- Assumed a security property holds without verifying it
- Routed data through a browser-side call where a server-side path would have gated it
- Trusted a client-supplied field for authority that server-side identity should derive
- Added something to `BACKUP_KEYS` or `getAllBackupData()` scope without noticing it now ships secrets or new personal data
- Documented a rollback plan that was never actually tested

Do not accept "the author checked" — verify each claim yourself against the current tree.

## Step 2 — Establish scope

Confirm what is being reviewed:

- A diff (`git diff`, `git diff --staged`, `git diff main..HEAD`)?
- A PR by number or URL?
- A specific commit range or file set?
- A broad audit of the current tree?

If scope is unclear, resolve it before running the checklist. Guessing scope invalidates the review.

## Step 3 — Actively hunt

Run every category in `docs/lifeos/SECURITY_REVIEW.md`. For each, grep the tree (or diff) for the failure patterns the checklist describes — do more than a spot-check. Areas where Codex/Claude-authored changes historically miss things:

- **Secret exposure** — distinctive prefixes (`ghp_`, `github_pat_`, `sk-*`), new `.env*`/`credentials*` files, hardcoded tokens in URLs/headers/comments. Grep every file in the diff.
- **Authentication and RLS** — verify ownership derives from server-side `auth.uid()`, not a client-supplied field. Verify every policy has both `USING` and `WITH CHECK` where inserts/updates are permitted. Verify audit-actor fields (`audit_events.actor_kind`) cannot be set client-side.
- **Unsafe client-side trust** — verify no browser code is granted authority that RLS or a server-side function should hold. Verify only the Supabase publishable/anon key + project URL appear in client-shipped code — never a service-role key or DB connection string.
- **Backup/export leakage** — verify what's actually in `BACKUP_KEYS` right now (grep the constant). Verify any new field added to it doesn't ship a secret or new personal data. Verify `processImport()`'s pre-restore backup is preserved or improved.
- **XSS and DOM injection** — grep for `innerHTML`, `insertAdjacentHTML`, `eval`, `new Function`, `document.write`. Verify user-generated content flows through text-escape.
- **Unsafe SQL** — verify **user-controlled input is never interpolated into SQL**. Database access must go through a safe mechanism: parameterized APIs, prepared statements, an approved RPC / Postgres function, an Edge Function, or equivalent. Grep for raw string concatenation into SQL and for any code path that formats user input into a query.
- **Permission overreach** — verify changes to `.claude/settings.json` or agent `tools:` lists don't admit arbitrary command execution.
- **Review Center bypass** — verify any code path that would write to a domain record on behalf of AI goes through `review_items` first.

Every finding requires **concrete evidence**: a specific grep result, a specific file:line reference verified now, a specific diff hunk. Speculation without evidence is not a finding.

## Step 4 — Report

Output must follow `docs/lifeos/SECURITY_REVIEW.md` exactly:

- Severity ordering: CRITICAL → HIGH → MEDIUM → LOW → PASS
- Per-finding fields: What is wrong / Where (current file:line, verified now via grep) / Realistic impact / Safest minimal fix / Blocks merge
- All-PASS is a valid outcome. Do not manufacture findings.

## Step 5 — Independent-review footer

Close every report with an explicit statement of whether this Codex review satisfies the "independent review" requirement in `CLAUDE.md` / `AGENTS.md`:

- Claude-authored change → this Codex review can serve as independent review.
- **Codex-authored change → this Codex review does NOT count as independent review.** Another Codex session is still Codex; the merge requires Claude Code review or a human maintainer.
- Human-authored change → both Claude and Codex reviews are equally independent.

State the author-attribution assumption used.

## Boundaries

- Read-only. Do not modify code, commit, push, or merge.
- Security-only. Architectural, style, and performance review are out of scope; use a different tool for those.
- Do not spawn a second Codex session to "double-check" a Codex-authored change and treat the result as independent — see the footer rule above.
- Cite `docs/lifeos/SECURITY_REVIEW.md` and any ADRs (`docs/lifeos/DECISIONS.md`) by pointer; do not restate the standard in the review output.
