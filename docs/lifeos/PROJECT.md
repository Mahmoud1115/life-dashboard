# Dune Life OS — Project Overview

**Repo**: [Mahmoud1115/life-dashboard](https://github.com/Mahmoud1115/life-dashboard) (public)
**Live**: https://mahmoud1115.github.io/life-dashboard/
**Owner / sole user**: Mahmoud ("Dune"), aviation maintenance engineer, Moscow
**Restore point tag**: `life-os-v1`

## What Life OS is

A single-user, local-first personal life-management dashboard. Covers Career, Finance, Goals, EASA Part-66 study tracking, Logbook drafting, Deadlines, Behavior (habit/urge tracking), and personal narrative content.

Vanilla HTML/CSS/JS. No framework, no build step, no server. Data lives in the user's browser `localStorage`; the only external touch is optional GitHub Gist sync for backup.

## Scope

**In scope**
- Personal daily/weekly/monthly self-tracking
- Aviation career progression (EASA modules, logbook entries, license milestones)
- Financial goal tracking (55k/mo savings target, expense model)
- Habit/urge self-monitoring (BHT — behavior intelligence tracker)
- Structured reflection (weekly review, decision journal)

**Explicitly out of scope**
- Multi-user collaboration
- Aviation maintenance authority — this system is a learning and organization tool, **never** a replacement for approved maintenance data, company procedures, OEM documentation, or regulatory requirements
- Any handling of proprietary/company aviation data uploaded to external AI

## Core principles

1. **Preserve the working system.** The site running today is authoritative. No big-bang rewrites.
2. **Incremental change only.** Every meaningful modification is reversible via git.
3. **User owns the data.** Personal content lives in the browser and in exports the user controls, never in the public repo.
4. **AI is a worker, not memory.** AI (Claude, ChatGPT, Codex, Gemini) can propose, review, and draft — but never silently modify important records.
5. **AI interpretation ≠ truth.** AI proposals are inputs to a human decision, not facts.
6. **Complexity must earn its existence.** No infrastructure added without a concrete demonstrated need.
7. **Company/OEM confidentiality overrides convenience.** No proprietary aviation data goes to any external service.
8. **Public-repo hygiene.** Never commit personal user data, credentials, or backup content to this repo.

## Current phase

Living on GitHub Pages with browser `localStorage` as the source of truth. Working toward **Life OS 2.0** — a Supabase-backed structured backend added *behind* the existing site, not a replacement for it. See the audit and `DECISIONS.md` for the approved roadmap.

## Related docs

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — current technical architecture
- [`STORAGE_MAP.md`](STORAGE_MAP.md) — canonical per-domain storage source (Gen-1 vs Gen-2)
- [`DECISIONS.md`](DECISIONS.md) — architectural decisions log (ADRs)
- Life OS 1.0 Audit — external artifact, four review rounds (initial → Codex → ChatGPT → Codex)
