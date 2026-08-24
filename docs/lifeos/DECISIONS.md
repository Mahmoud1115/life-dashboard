# Architectural Decisions — ADR log

Each entry records **one** decision, why it was made, what was rejected, and when. Append only. Never rewrite history — supersede via a later ADR if a decision changes.

Format per ADR: **decision**, **status**, **context**, **decision made**, **rejected alternatives**, **date**, **supersedes / superseded by** (optional).

---

## ADR-001 — Supabase as the future structured backend for Life OS 2.0

- **Status**: Accepted
- **Context**: Life OS 1.0 stores everything in browser `localStorage`. This is fine for one device but has no server-side backup, no cross-device sync (Gist is a workaround, not sync), no multi-user model, and no ability to structure/query data server-side. Life OS 2.0 wants relational structure for domains like sources, review items, and audit history.
- **Decision**: Use **Supabase (Postgres + Auth + RLS)** as the future structured backend, added *behind* the existing GitHub Pages frontend, not as a replacement for it. Only the publishable/anon key and project URL ever reach the browser. Row Level Security scopes every table to the authenticated user.
- **Rejected alternatives**:
  - Firebase — Google lock-in, less SQL-friendly, RLS-equivalent (security rules) is a separate language.
  - Own Postgres + auth server — real infrastructure to operate, not justified for one user.
  - Cloudflare D1 / KV — less mature auth story, unfamiliar territory.
  - Keep everything in `localStorage` + Gist forever — doesn't support the Review Center / AI review architecture at all.
- **Date**: 2026-08-22 (approved after three review rounds — audit + Codex + ChatGPT + Codex)

---

## ADR-002 — Keep vanilla JS + GitHub Pages during the 2.0 transition

- **Status**: Accepted
- **Context**: Life OS 1.0 has no framework, no build step, no bundler. Every temptation to modernize the frontend adds risk and slows migration.
- **Decision**: Life OS 2.0 does **not** rewrite the frontend. The existing HTML/CSS/JS keeps running on GitHub Pages. Supabase integration lands as a small "bridge" layer, not as a frontend framework migration.
- **Rejected alternatives**:
  - React / Vue / Svelte SPA rewrite — high effort, no user-visible payoff for a one-user site.
  - Next.js on Vercel — introduces build step, deployment complexity, node runtime.
  - SvelteKit or Astro — same objection.
- **Date**: 2026-08-22

---

## ADR-003 — Qatar visit goal section removed from UI, state slice retained

- **Status**: Accepted
- **Context**: User no longer wanted the "Visit Mom in Qatar" savings goal as a first-class section. All UI, nav entries, quick-add buttons, calendar events, and derivations were removed.
- **Decision**: Delete the UI end-to-end. **Do not delete** `core.js`'s `qatarVisit` state slice or `derive.qatar*` functions — `validate()` at `core.js:254` requires `qatarVisit` to exist, and removing it would wipe the entire Store to defaults on the next load.
- **Rejected alternatives**:
  - Delete the state slice as well — would break `validate()` and cause catastrophic state loss.
  - Bump `SCHEMA_VERSION` and remove via a migration — possible but higher-risk for a UI change; deferred.
- **Date**: 2026-08-23

---

## ADR-004 — Review Center is informational-only in Phase 1; transactional approval deferred

- **Status**: Accepted
- **Context**: The original 2.0 audit proposed transactional AI-review approval — a Postgres function checks the target record's version, applies the change atomically, and writes the audit event in one transaction. Codex's second review round caught the flaw: **Postgres cannot atomically update a browser's `localStorage`.** In Phase 1, domain records still live in `localStorage`, not Postgres.
- **Decision**: Phase 1's Review Center is **informational only** — AI or system proposes a review item, user reads it, decides approve/edit/defer/dismiss, and if approved, **manually applies the change** in the existing UI. The audit event records the approval, not an automatic write. Transactional approval turns on **per domain**, only after that domain has actually been migrated into Postgres with a real per-record `target_version` column.
- **Rejected alternatives**:
  - Ship transactional approval with client-side "atomic" writes — false claim, race-prone, would violate the "never silently modify important records" principle.
  - Delay the entire Review Center until at least one domain is in Postgres — loses the value of having the review inbox exist for other flag types (inconsistencies, missing info, stale sources).
- **Date**: 2026-08-22 (Rev. 4 of the audit)
- **Supersedes**: informal Section H of Rev. 1-3 of the audit

---

## ADR-005 — BHT AI coach: cloud-key handling disabled outright

- **Status**: Accepted
- **Context**: The BHT subsystem includes an optional AI "coach" that can call Anthropic or OpenRouter directly from the browser using a user-supplied API key stored in `state.bht.ai.apiKey` — which lives inside `dune_state_v4` and therefore rides along with every Gist backup. User has confirmed the feature has **never** been configured.
- **Decision**: Rather than "move the key to a different `localStorage` bucket," disable the direct-from-browser cloud provider call entirely. Local Ollama (which never leaves the machine) can stay reachable. If the feature is ever wanted, rebuild it behind a Supabase Edge Function proxy so the provider key stays server-side.
- **Rejected alternatives**:
  - Move the key to a separate `localStorage` key excluded from `BACKUP_KEYS` — doesn't fix the underlying problem (still XSS-readable, still a plaintext credential in the browser).
  - Encrypt the key in `localStorage` with a user passphrase — added UX friction for a feature never used.
  - Do nothing — leaves a plaintext credential in the backup Gist payload for a feature that isn't even used.
- **Date**: 2026-08-22

---

## ADR-006 — Storage migration direction: Gen-1 → Gen-2 → Supabase, never Gen-1 → Supabase directly

- **Status**: Accepted
- **Context**: The app has two coexisting `localStorage` generations (flat legacy keys and the `dune_state_v4` Store). See `STORAGE_MAP.md`. Migrating two storage systems into Supabase in parallel doubles the migration surface, doubles the failure modes, and produces two irreconcilable sources of truth in Postgres.
- **Decision**: Consolidate Gen-1 into Gen-2 **first**, one domain at a time, each with its own commit. Only then migrate a Gen-2 Store slice into Supabase. Never migrate Gen-1 directly to Supabase.
- **Rejected alternatives**:
  - Migrate Gen-1 keys directly to Supabase — doubles the migration surface and leaves Gen-2 as a stale second source of truth.
  - Leave Gen-1 as permanent legacy — accumulates fragility every time a new feature touches those domains.
- **Date**: 2026-08-24 (ChatGPT / Codex review consensus)

---

## ADR-007 — Motion polish and Life OS 2.0 foundation on separate feature branches

- **Status**: Accepted
- **Context**: Storage and security changes are the highest-risk work in the project. Mixing them into a diff that also contains cosmetic CSS changes makes debugging and rollback harder.
- **Decision**: All cosmetic motion / animation work lives on `feature/motion-polish`. All Life OS 2.0 foundation work (BHT key removal, storage reconciliation, export/restore hardening, docs, later Supabase integration) lives on `feature/supabase-foundation`. Each meaningful change on the foundation branch gets its own commit so a single revert can undo a single concern.
- **Rejected alternatives**:
  - Single working branch — cheaper to type, expensive to debug or roll back.
- **Date**: 2026-08-24

---

## ADR-008 — Public-repo hygiene: no personal user data in commits

- **Status**: Accepted
- **Context**: The repo is public. The user's real dashboard state contains personal financial numbers, mental-health-adjacent behavior tracking data, and other private content.
- **Decision**: Nothing that would appear in a real backup export ever gets committed. Test fixtures use synthetic data (BHT has a `seedSyntheticData()` for exactly this). AI agents (Claude, Codex, subagents) do not write personal content into any repo file. When a review or test requires real data, it's loaded from an out-of-repo file (Downloads, scratchpad) never committed.
- **Rejected alternatives**:
  - `.gitignore` a "backups" folder inside the repo — one accidental commit outside that folder still leaks; better to establish the principle that personal data never enters the repo at all.
  - Make the repo private — user explicitly wants the code public; only the data must stay private.
- **Date**: 2026-08-24

---

## ADR-009 — Dev tooling (npm + Playwright) allowed; runtime remains no-build vanilla JS

- **Status**: Accepted
- **Context**: ADR-002 keeps Life OS on vanilla HTML/CSS/JS served by GitHub Pages — no framework, no bundler, no build step. That decision is about what ships to the browser. It leaves an ambiguity around dev-only tooling: could a test runner ever be added, or does "no build step" forbid `package.json` outright? Regression coverage needs an answer.
- **Decision**: Dev-only tooling (an `npm`-installed `devDependencies` set, currently just `@playwright/test`) is allowed. It is not shipped to the browser, not required to build or run the site, and does not become a deployment prerequisite. GitHub Pages continues to serve the repo root as-is. The site can still be opened locally by pointing any static server at the repo root without ever running `npm install`.
- **Concrete boundary**:
  - Allowed: `package.json` with `devDependencies` only; a committed `package-lock.json` for reproducibility; `.gitignore` entries for `node_modules/` and tool caches; `playwright.config.js`; a `tests/` directory.
  - Not allowed under this ADR: any runtime `dependencies`; any `import`/`require` from `index.html` or the app JS pointing at `node_modules`; any bundler, transpiler, or build script that rewrites shipped assets; any CI step that mutates repo files before Pages deploys them.
- **Rejected alternatives**:
  - Playwright MCP driven manually per session — no CI-runnable regression, no reproducibility, no version pinning.
  - A separate testing repo — duplicates the surface it's testing and drifts.
  - Reading ADR-002 as forbidding `package.json` entirely — over-reads it; the intent was to keep the runtime unchanged, not to ban tooling.
- **Date**: 2026-08-24
- **Relates to**: ADR-002 (does not supersede — narrows the interpretation of its scope to *runtime*)
