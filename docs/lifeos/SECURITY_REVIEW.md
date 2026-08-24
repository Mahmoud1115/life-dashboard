# Life OS security review — shared standard

The project-specific security checklist and reporting standard for the Dune Life OS repository. Usable by any reviewer — Claude, Codex, or a human maintainer. Not AI-specific.

**Scope**: every code change to this repository — commit, PR, branch, or file set — that touches secrets, storage, authentication, RLS, external calls, migrations, or Review Center flow. Also usable as a periodic audit of the working tree.

**Non-goals**: architectural review, style review, performance review, feature-level design review. Security concerns only.

## Prerequisites

Before running the checklist, know the current state of:

1. `PROJECT.md` — scope, principles, single-user local-first stance
2. `ARCHITECTURE.md` — runtime, two storage generations, sync, BHT subsystem
3. `STORAGE_MAP.md` — per-domain canonical write source
4. `DECISIONS.md` — active ADRs

Do not duplicate content from those docs into a review. Cite by pointer (e.g., "violates ADR-008").

## Locating code

**Do not trust line numbers from any Life OS document, including this one — always verify current locations.** File structure changes; `app.js` in particular is large and frequently edited. When citing a location:

- Grep for the symbol or comment marker (e.g., `grep -n "BACKUP_KEYS" app.js`)
- Cite the line number you find *now*, not one written elsewhere
- If a documented reference is stale, note that in the report so the doc can be updated

## Establishing scope

Confirm what is being reviewed before running the checklist:

- A specific file or file set
- Current working-tree diff (`git diff`, `git diff --staged`)
- A branch vs main (`git diff main..HEAD`, `git diff origin/main..HEAD`)
- A PR by number or URL
- Broad audit of the current tree

If the scope is unclear, resolve it before running the checklist. Guessing scope invalidates the review.

## Checklist

For each category, actively grep, read, or diff-inspect against the current tree. If a category has no changes in scope, record a PASS explicitly — do not silently skip.

### 1. Secrets and credentials in the diff

- Literal API keys with distinctive prefixes: `ghp_`, `github_pat_`, `sk-`, `sk-ant-`, `sk-or-`. Any hit is high-confidence.
- New commits of `.env`, `.env.local`, `credentials.json`, `secrets.yml`, `service_account*.json`, `*.pem`, `*.p12`.
- Hardcoded tokens/passwords in URLs, request headers, object literals.
- Comments containing live-looking credentials.
- High-entropy strings ≥30 chars: **candidates for investigation, not automatic findings.** Common false positives: hashes, base64-encoded config, git object IDs, UUIDs. Verify context or match against the prefix set before flagging.

### 2. GitHub PAT handling

- Locate `BACKUP_KEYS` in `app.js` (grep). Verify `dune_github_token_v1` is still excluded. Any change adding it is CRITICAL.
- New code paths reading the PAT that send it anywhere except `api.github.com`.
- New code writing the PAT to a second storage key, logging it, or embedding it in a URL parameter or displayed error message.

### 3. Browser-side secret storage

- New writes to `localStorage`, `sessionStorage`, or `IndexedDB` containing credential-shaped material.
- Any diff touching `state.bht.ai.apiKey`. Per ADR-005 the direct-browser AI call is disabled; re-enabling it or relocating the key inside the browser requires explicit justification.

### 4. Export / Gist / snapshot leakage

- New entries in `BACKUP_KEYS` — any containing secrets, cross-account identifiers, or personal data the user should be able to redact?
- Changes to `getAllBackupData()` scope — does it now include something previously excluded?
- Changes to `processImport()` — does it loosen the allowlist, skip validation, or remove/shrink the pre-restore backup (`dune_pre_import_backup_v1`)?
- Rolling snapshots (`dune_snapshots_v1`) — does the change increase what's captured?

### 5. Supabase credentials in frontend code

- Any occurrence of `service_role`, `service-role`, `SUPABASE_SERVICE_ROLE_KEY`, or a Postgres connection string (`postgres://`, `postgresql://`) in client-side code, HTML, committed config, or CI. Any hit is CRITICAL — per ADR-001, only the publishable/anon key + project URL may reach the browser.
- Raw SQL constructed in browser code and sent to the database. Must go through the Supabase JS client using parameterized queries only.

### 6. Unsafe external API calls from the browser

- New `fetch()` / `XMLHttpRequest` / `WebSocket` calls to any origin not already documented in `ARCHITECTURE.md`.
- Any call sending user data to a third party (analytics, telemetry, error reporting) — flag even if the third party is reputable.

### 7. Authentication and Row Level Security

- New Supabase tables without `enable row level security`.
- RLS policies that scope access via a field the client can supply directly on insert or update, rather than deriving authority from `auth.uid()` on the server side. Ownership must be established by authenticated server-side identity — never trusted from a client parameter without a policy that constrains it to match `auth.uid()`.
- Ownership columns not backed by `references auth.users(id)`, or populated from a client-provided value without a `WITH CHECK` clause forcing equality with `auth.uid()`.
- Policies missing `WITH CHECK` where inserts or updates are permitted (`USING` alone filters visibility but does not constrain new/modified row values).
- Audit-actor fields (e.g., `audit_events.actor_kind`) — must be assigned server-side (Edge Function or Postgres function), never accepted from a client parameter.
- Postgres functions marked `SECURITY DEFINER` — verify `search_path` is explicitly set and the function body cannot escalate beyond its intended scope.

### 8. Personal data in public repository

- The repo is public. Any file in the diff embedding real user data — real financial numbers, real BHT entries, real names, real dates from the user's actual life dashboard state.
- Test fixtures — synthetic (BHT `seedSyntheticData()` output shape) rather than a real backup. Violation is CRITICAL per ADR-008.
- Screenshots or images embedded in commits that show private data.

### 9. XSS and unsafe DOM injection

- New `innerHTML =` or `insertAdjacentHTML()` where input can contain user-controlled data.
- Any `eval()`, `new Function()`, `setTimeout(string)`, `setInterval(string)`, `document.write()`.
- User-generated content (Ideas, Reviews, Decisions, BHT notes) inserted without text-escaping.

### 10. Unsafe SQL and database changes

- Raw SQL string concatenation with user input.
- Destructive migrations (`DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `ALTER TABLE ... DROP`) without a documented recovery strategy. See category 12.
- Migrations removing RLS from an existing table.
- Migrations altering the type of a column holding user data without a preservation strategy.
- Note: `state_snapshots` (application-state artifact — client-produced JSON payloads written by the browser and stored server-side for later restore of user-authored content) is **not** a substitute for database-level backup or point-in-time recovery. "We have snapshots" does not satisfy this category for schema or DB changes; those require database-level protection.

### 11. Overly broad permissions

- Additions to `.claude/settings.json` — narrowly scoped, or do they admit arbitrary command execution? (`Bash(python3 -c:*)` was removed for exactly this reason; `Bash(find . *)` was removed because `-exec` and `-delete` are not filterable via prefix.)
- Changes to any agent's `tools:` field — does it add write-capable tools (`Bash`, `Edit`, `Write`, `NotebookEdit`) where read-only (`Read`, `Grep`, `Glob`) would suffice?
- Changes to `.claude/agents/project-reviewer.md`'s `tools:` list — must stay `Read, Grep, Glob` only.

### 12. Missing rollback or recovery strategy

- Destructive change to storage schema (client `localStorage` or Postgres) without a documented recovery path.
- Change to `processImport()` — is the pre-restore backup preserved or improved? Never silently removed.
- New destructive Supabase schema or data migration — is the recovery strategy explicit and appropriate to the change?

Examples of strategies that *could* satisfy this requirement — each is only valid if it is actually available on the current Supabase plan and has been tested:

- Supabase point-in-time recovery, **if the current plan tier includes it** and the change lands within its retention window — capture the specific timestamp immediately before the migration.
- External `pg_dump` taken and verified restorable immediately before the migration.
- A reversal SQL script tested against a clone of the current state.
- An inherently reversible migration (e.g., additive-only schema changes).

Assumed capability is not a plan. Verify the chosen recovery path is actually available and tested before the destructive step runs, not merely documented as an intention.

**Distinction**: application-state snapshots (`dune_state_v4`, `dune_snapshots_v1`, and later a `state_snapshots` Supabase table) protect user-authored content within a domain. Database-level recovery (`pg_dump`, PITR) protects schema and cross-domain/cross-user data. They are not interchangeable, and neither substitutes for the other.

### 13. Review Center bypasses

- Code paths writing to a domain record on behalf of AI without creating a corresponding `review_items` row.
- Auto-approval logic that skips the human decision step.
- Edge Functions assigning `actor_kind = 'ai'` in an audit event without a matching `review_items` row that a user acted on.
- Any change that treats an AI-proposed record as authoritative without user acknowledgement.

## Severity

- **CRITICAL** — unauthorized exposure of personal user data, secret material reaching an external service or public location, complete authentication bypass, RLS misconfiguration allowing cross-user access, destructive migration without a recovery strategy. **Always blocks merge.**
- **HIGH** — credential written to a location it does not need to be (even if not immediately exposed), XSS vector via unsanitized input, unsafe SQL, Review Center bypass, missing rollback for a destructive change, RLS policy trusting client-supplied ownership. **Usually blocks merge unless mitigated in the same PR.**
- **MEDIUM** — overly broad permissions where narrower would work, missing input validation on a non-critical path, opaque error handling hiding a real failure mode. **Merge OK if a tracked follow-up exists.**
- **LOW** — nit-level hardening opportunities that do not change the security posture. **Does not block merge.**
- **PASS** — category was checked, no issues found in scope.

## Reporting format

Rank findings in exact order: CRITICAL → HIGH → MEDIUM → LOW → PASS. Do not reorder.

For each finding:

```
[SEVERITY] — [short title]
1. What is wrong:      one-sentence statement of the defect
2. Where:              current file:line, verified now via grep — or specific commit hash + hunk for diff-wide findings
3. Realistic impact:   the concrete failure scenario — who is harmed, what they see, what they lose
4. Safest minimal fix: the smallest change that closes the finding without introducing new risk
5. Blocks merge:       YES / NO, with one-line justification
```

For PASS entries: one line each, `PASS — [category name] — no issues found in scope`.

Close the report with a footer stating whether external independent review (Codex / ChatGPT / human maintainer) is still required before merge, per `CLAUDE.md` and `AGENTS.md`. Any change touching storage migration, authentication, RLS, secrets, backup/restore, database migrations, or Review Center transactions requires that additional pass.

## Rules of engagement

- Every finding grounded in concrete evidence: verified file:line, specific grep result, specific diff hunk. No hand-wavy claims.
- Cite ADR numbers when a rule is already codified there.
- State any unverified assumption explicitly ("assuming this endpoint is public-facing…").
- An empty report — everything PASS — is a valid outcome. Never manufacture findings.
- Security-only. Do not fold in architectural, style, or performance concerns; those belong in separate reviews.
