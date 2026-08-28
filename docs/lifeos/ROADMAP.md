# Life OS 2.0 — Canonical Roadmap

*Layer 1 canonical truth. Handoff `.md` files may reference this file
but never supersede it. Update via ADR or via a Council SYNTHESIS.md
that names the change and gets promoted here.*

**Last updated:** 2026-08-28
**Repository state at last update:** `main == origin/main == 92f7751`
(commit `92f77510c940f8da44429537d5551d8af2e06c9e`).

---

## Completed phases

| Phase | Status | Tip commit | Notes |
|---|---|---|---|
| Phase A — Logbook canonical mirror | Landed | `521fe70` | `state.logbook.schemaVersion=1`, `authority='legacy-mirror'`. Tracker + Builder legacy keys remain authoritative. |
| B0 — Global Store durability | Landed | `5398b28` | Schema-13 wrapper, revision + CAS, Web Locks coordinator, storage-event rebase, conflict queue, coordinated import, snapshot durability, exact-once recovery. |
| B1 — Secure persisted-content boundary | Landed | `92f7751` | Six confirmed P0 sinks rewritten with contextual DOM APIs; CSV formula neutralization; R7 malformed-record safety; Apartments UI-targeting rule. ADR-011 pins R1–R8. |

---

## Active parallel stream — Workflow Foundation (WF-GATE)

Not a formal blocking phase. Ships in parallel with B1.5 implementation.

The minimum items that must exist before B1.5 merges to `main`:

- GitHub Actions CI on push and PR (Playwright + `node --check` + `git diff --check`).
- Protected `main` branch ruleset requiring the CI status check.
- Risk-tier PR contract (ADR-012).
- Never-autonomous policy (ADR-013).
- Council V1 folder convention (`council/README.md`).
- Release tag / anchor for B1 (`v0.B1` pointing at `92f7751`).
- Scoped documentation drift correction.

Items that ripen as later phases need them (see `council/README.md`):

- Backup rotation implementation — mandatory before B2c merge, not before B1.5.
- `lifeos release-check` CLI — mandatory before B2c merge, not before B1.5.
- Synthetic fixture corpus — lands inside B1.5 implementation.
- GitHub MCP (read-only, min scopes) — triggered when `gh` CLI ceremony becomes friction.
- Codex worktree setup / Actions buttons / narrow hooks — triggered after CI stable.
- Project-specific Codex skills — after merging existing `chore/codex-skills` branch.

---

## Current active phase — B1.5 preflight

**Status:** design revised; implementation not yet started. Awaits
WF-GATE minimum + Codex independent review approval.

**Purpose.** Determine whether the current real Tracker + Builder data
can be moved from legacy authority to canonical authority without
making any row inaccessible or unrecoverable.

**Scope.**
- Pure preflight analyzer (uses `core.js` helpers, no mutation).
- Consistent snapshot capture (torn-read protocol with bounded retry).
- Hidden `#logbook-preflight` diagnostic panel.
- Hidden `#health` panel (Store schema/revision, envelope authority,
  crossTabSafe, backup age, storage bytes by key).
- Synthetic fixture corpus under `tests/fixtures/logbook/`.
- New `tests/logbook-preflight.spec.js` with 14 P0 rows.

**Non-goals.**
Zero writers. Zero authority state changes. Zero schema-v2 code.
Zero rollback mechanism. Zero automatic repair. Zero automatic dedupe.
No feature flags.

**Exit criteria — implementation complete.**
- 14 P0 tests + full Playwright regression green in CI.
- Isolated round-trip via real `processImport` passes stable-serialization equality.
- Codex independent review approves the analyzer.

**Exit criteria — data certified.**
Distinct from implementation completeness. The analyzer may be
correct while the real data is not safe to cut over.
- Preflight report on real profile: zero BLOCKER-3 (nonCanonicalizable),
  zero BLOCKER-4 (semantic field loss), zero divergence.

---

## Queued phases

### B2-pre (or B2a.1) — two-source legacy derivation fix

Small MEDIUM-tier PR. Closes the latent bug where
`deriveStateFromLegacy` at `core.js:510` reads only Tracker legacy
and `normalizeLogbookDomain` at `core.js:922` normalizes the
array-fallback branch as Tracker-only. Both must be fixed before
canonical authority can flip.

### B2a — canonical contract and lifecycle readiness (authority remains `legacy-mirror`)

- Envelope schema v1 → v2 (adds `canonicalizableCounts`,
  `nonCanonicalizable` side-channel, `authorityHistory`).
- Legal `authority` values: `'legacy-mirror'` | `'canonical'`.
- `migrateUp` v1 → v2 tested against every fixture case.
- `validate()` accepts v2.
- `processImport` becomes authority-aware (accepts both v1 and v2;
  refuses canonical backup into legacy-only build).
- Snapshot records envelope authority; restore is authority-aware.
- Reset lands on `'legacy-mirror'` and runs reconcile before UI reads.
- Cold-boot rule: missing/corrupt canonical state does NOT authorize
  silent legacy derivation when the envelope declares
  `authority === 'canonical'`; fail closed.
- Portable backup metadata (`backupFormatVersion`, `minimumAppProtocol`,
  `createdAt`, `sourceStoreRevision`, `logbookSchemaVersion`,
  `logbookAuthority`, `journalSettled`, `contentChecksum`,
  `includedKeyManifest`).

### B2b — crash-safe protocol and shadow exercise (authority remains `legacy-mirror`)

- Durable transient operation journal (e.g. `dune_logbook_op_v1`).
- Canonical commit witness inside the wrapper (`lastCommittedOpId`
  or equivalent).
- One coordinator covers the journal, both legacy keys, and the
  wrapper commit; no nested conflicting Web Locks.
- 16-step protocol (see synthesis §8) with fault-injection tests
  at every boundary.
- Shadow exercise: normal legacy-authority writes routed through
  the protocol while `authority = 'legacy-mirror'`. Observed under
  add / delete / reuse / reload / cross-tab / import exclusion /
  snapshot exclusion / injected failures.

### B2c — canonical authority cutover

First point at which `state.logbook.authority = 'canonical'` may be
persisted. Hard blockers:

- C0 immutable pre-cutover external recovery package + C1 latest
  known-good full generation + C2 previous known-good full generation,
  each verified via a restore test.
- Backup rotation implementation shipped and drilled in CI.
- Every crash-window row of the two-commit protocol tested via
  failure injection.
- Cross-tab race + rollback-during-write tests pass.
- Reader parity 100% between legacy and canonical paths on real
  profile.
- Legacy mirror-back byte-equal to pre-B2 writer output.
- `authorityFlip` (legacy-mirror → canonical) and rollback
  (canonical → legacy-mirror) both tested; rollback requires
  stable-serialization parity verification.
- Independent HIGH-risk review (Codex) + explicit user approval.

### B2.5 — stabilization and legacy retirement gate

Absorbs B3.

Definition of Done:
- 14 clean days of canonical authority in real daily use;
- zero divergence events;
- rollback drill at day 7 (parity + recover);
- export/import equality maintained;
- `#health` panel shows no degradation;
- retirement decision ADR recorded (retire / keep as passive
  mirrors indefinitely / partial retirement).

### Post-B2.5 additions (parallel)

- Manifest + icons + installability (NO service worker). Additive,
  no cache hazard.
- Reviews / Decisions rendering extension (extend ADR-011 R2 to those
  surfaces).
- P3 quarterly sweep (Apartments top-choice bar first).

### M2 — active-domain modernization (independent PRs, not a phase)

- M2.1 Apartments preflight + cutover (first generic collection canary
  proves the per-domain pattern).
- M2.2 Goals reassessment (decide: migrate or leave).
- M2.3 Money preflight only (learn the data; no cutover).
- M2.4 Money cutover decision — may legitimately be "never."
- Deadlines / Ideas / Claims: leave legacy indefinitely unless
  triggered.
- BHT / Reviews / Decisions: already Gen-2 or effectively stable;
  no migration.

### Aviation OS growth (parallel with B2)

- A0 Quick Aviation Work / ATA Log — new Aviation-namespaced domain,
  Gen-2 native (no new Gen-1 debt). Ships in parallel with B2a. No
  proprietary / OEM / company-confidential content. R1–R8 render
  safety applied.
- A1 search / filters / provenance / export (after A0).
- A2 CFM56-5B / CFM56-7B study + competence.
- A3 training / certification progress + evidence.
- A4 file-first technical knowledge links.
- Offline hangar workflow (triggered by measured need).

Aviation OS and Life OS remain distinct product domains even when
sharing low-level durability primitives.

---

## Triggered branches (none scheduled)

| Branch | Trigger conditions |
|---|---|
| Supabase pilot (S-pilot → S-adopt → S-scale) | Repeated cross-device conflict / OAuth secret proxy need / server job need / real multi-device concurrent editing / measured localStorage quota limit / real relational query need. |
| Full PWA (service worker + IndexedDB + offline writes + sync queue + conflict resolution) | Post-B2.5 stability + written cache-busting / update-strategy ADR + measured connectivity gaps. |
| Knowledge layer (Obsidian + link metadata) | User starts long-form study notes AND asks for cross-linking with Life OS records. |
| Aviation A2+ (CFM56 study, cert tracking, hangar) | Per-slice user need after A0 / A1. |
| Review Center UI + Action Model | ≥2 real producers exist, at least one server-authoritative. |
| AI Personal Intelligence Stage AI-1+ | Repeated same-summary asks; then AI-2 gated on Review Center existing. |
| Cloudflare Pages migration | CSP header requirement OR repeated preview environment bottleneck OR GitHub Pages incident cluster. See ADR-016 (hosting-trigger note) when written. |
| Hosted telemetry (Sentry etc.) | Rejected by default. Requires: written data-classification inventory, redaction regression tests, retention limits, explicit user consent flow. |
| CodeRabbit or a second AI reviewer | Reviewer experiment result (per ADR-015 when written) shows material distinct findings on ≥2 of the next 4 HIGH-risk PRs. |
| Hermes / any AI-platform orchestrator | Measured trigger: >10 routed jobs per week OR cross-model automation GitHub Actions can't do OR >2 provider outages per month. |

---

## AI Council V1 workflow infrastructure

The Council convention (`council/README.md`) is workflow
infrastructure, NOT a Life OS product phase. It exists to remove
manual copy/paste between AI workers, freeze base commits per task,
and preserve independent reviews.

Council V1 explicitly does NOT include: Hermes, Qwen automation,
Gemini automation, custom model router, custom VS Code extension,
memory database, or a multi-agent platform.

Additions to Council V1 are triggered by measured, repeated friction
— not by tool availability.

---

## Explicitly removed from the visible roadmap

- Formal Workflow Foundation phase (replaced by the parallel stream above).
- Formal Platform Contracts phase (contracts derived incrementally via ADRs).
- Formal B3 phase (folded into B2.5 DoD).
- Formal R1 System Health phase (ships as `#health` panel inside B1.5).
- M1 EASA canonicalization canary (too trivial to prove Logbook-specific problems).
- Persisted feature-flag authority (envelope authority is sole truth).
- Spec-first sync protocol (evidence-first pilot when triggered).
- Generic plugin framework.
- Microservices, event bus, enterprise RBAC, generic workflow engine, heavy observability, distributed tracing.
- Framework / bundler rewrite (ADR-002).
- Generic design system.
- Multiple simultaneous AI reviewers by default.
- Sentry / hosted telemetry by default.
- Service worker or offline data architecture during B2.
- Migration of every legacy domain for architectural purity.

---

## Related Layer 1 documents

- [`PROJECT.md`](PROJECT.md) — what Life OS is, scope, principles.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — current technical state.
- [`STORAGE_MAP.md`](STORAGE_MAP.md) — per-domain authority.
- [`DECISIONS.md`](DECISIONS.md) — ADR log (append-only; supersede via later ADR).

## How to update this file

Only the following changes go directly into this file:

- Marking a phase completed (with tip commit).
- Adding a new phase after it lands on the roadmap via a Council
  SYNTHESIS.md accepted by the user.
- Updating a trigger condition based on an ADR change.

Every material update names the SYNTHESIS.md commit or the ADR
number that authorized it, in the git commit message of the update.
