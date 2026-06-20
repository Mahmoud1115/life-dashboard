# Product

## Register

product

## Users

One user: Mahmoud (Dune), 26, Egyptian aviation maintenance engineer working in Moscow at АэроТраст (CFM56-5B engine overhaul, Sheremetyevo). Opens this dashboard daily — on desktop mostly, occasionally mobile — while executing a focused self-development plan: master the engine, save 55,000 ₽ of a 130,000 ₽ net salary every month, pass EASA Part-66 modules, collect certificates, keep documents (Egyptian passport, ВНЖ, MAI enrollment) clean. High information density is appropriate; Dune is not a casual user, he is the author of the plan.

## Product Purpose

A personal life operating system for a single user in build mode. Tracks the three pillars: career at АэроТраст (English logbook, ФАВТ Cat A, certificates), money (the 55k/month system, emergency fund, settlement fund, EASA fund), and self-development (15 EASA modules, MAI Master's). Plus the legal layer: Egyptian passport renewal before the age-28 wall, ВНЖ renewal, military settlement program. Success means Dune can open the dashboard and immediately know: what is urgent today, whether the 55k left on payday, what module he's on, and what the next action is.

Removed by design (June 2026 refresh): all relationship content, Gulf/UAE relocation, Australia/Canada/USA immigration pathways, interview prep, and the 10-year multi-country roadmap. The plan is Moscow, the engine, the modules, the savings.

## Brand Personality

Elegant. Minimal. Refined. The original Dune identity: warm cream/paper background, muted gold accents, dark ink text, Cormorant Garamond for emotional headings, DM Mono for labels and numbers. Feels like a beautifully typeset personal document — not an app, not a tool. The gold-and-paper palette is non-negotiable; it is the soul of this project.

## Anti-references

- **Notion / Linear clone** — generic grey/white productivity aesthetic with no warmth or identity
- **Crypto / fintech dashboard** — dark mode, neon, aggressive number-everywhere density
- **Corporate SaaS blue** — Salesforce/HubSpot enterprise palette, impersonal
- **Flashy sci-fi cockpit** — over-animated, glowing, trying too hard
- **Generic dashboard template** — any layout that could belong to any product

The original Dune identity must survive every design decision. Warm, editorial, personal.

## Design Principles

1. **The document over the app** — this reads like a beautifully designed personal document. Sections feel like chapters, not screens.
2. **Content is the design** — Dune's own writing and strategy is the premium element. Chrome (borders, shadows, badges) exists only to support it.
3. **Apple polish on a Cormorant soul** — use Apple-style spacing, hierarchy, and micro-interactions, but never lose the warm serif identity underneath.
4. **Urgency is earned** — red and amber appear only when something is genuinely at risk. Not decorative.
5. **One person, total clarity** — every widget, section, and number should answer "what does Dune need to know or do right now?" If it doesn't, it doesn't belong.

## Accessibility & Inclusion

WCAG AA minimum. High-contrast mode support: ensure all text meets ≥4.5:1 against its background, including muted gold labels and secondary brown text. No motion for users with `prefers-reduced-motion`. Tap targets ≥44px on mobile.

## Behavior Pillar (added 2026-06-14)

A fourth, supportive pillar runs alongside career, money, and legal: **Behavior** — a quiet self-awareness layer for the patterns that quietly cost the plan (procrastination on study days, doomscrolling on off-days, late-night snacking before early shifts). Not a punitive habit tracker, not a streak game. It exists because the 55k system and the EASA pipeline both depend on Dune's daily state, and daily state is made of behaviors he can notice, name, and adjust.

**What it does:** one-tap logging of slips and urges with optional CBT-style reflection (trigger → automatic thought → rational challenge → recovery action). Weekly snapshots roll up trends, risk score, and one or two recommendations. Heavy analytics run in a background worker; the UI stays as light as the rest of the document.

**What it is not:** not a generic habit app, not gamified, not dark-mode. Same cream paper, same muted gold, same Cormorant headings — a chapter, not a screen. The contribution heatmap is rendered in the gold-on-paper palette, not green/red neon. Compassionate framing always wins over streak loss.

**Storage & sync:** lives inside the existing `dune_state_v4` store, ships with the same JSON export and GitHub Gist sync as the rest of the OS. No new database, no new build step, no new dependencies. Local-first by design; any AI coaching is provider-pluggable (local Ollama, BYOK Anthropic/OpenRouter, or a deterministic JS fallback that needs no network at all).

**Why it belongs:** the existing pillars answer *what to do*. Behavior answers *whether Dune is in shape to do it.* Sleep before a shift, stress before a study block, urge intensity on a Thursday night — these are the inputs the other three pillars silently depend on. Without them, the plan is a strategy without a person.

## Ideas Section (added 2026-06-15)

A parking lot for what's next. Things on Dune's mind that aren't decisions yet get parked here — title, body, tag (finance/health/career/legal/other), status (parked/exploring/active/shelved), pin/edit/delete — so the active pillars stay focused. Editable, persistent, ships with Gist sync. Items get promoted into the real plan (Money targets, Career goals, Today focus, custom expense rows) when the time comes; the rest sit quietly until you decide.

The five originally seeded items came from a real planning conversation: stretch $1,000/mo savings target, side job on the two days off, gym, engine certifications stack, archery as a third movement anchor. Voice input misread "archery" as "Arseny" on first capture; a one-shot fixup corrected the card and the seed for everyone.

## Money — Customs & Dynamic Target (added 2026-06-15)

The Money panel grew two reactive layers without changing the core 55k machine:

**Custom income & expense rows.** Free-form rows for things that don't fit the eight default expense categories — gym, archery, certifications, side income. Name + amount + delete. Folded into the headline net savings, the breakdown, the USD conversion, the target percentage, and the emergency-fund months. Stored in `dune_finance_v1.russia.customIncome[] / customExpenses[]` — same Gist sync path as the rest of the Money state.

**Dynamic save target.** A new `Save Target (₽/month)` input lets the 55k baseline move. The headline "55k target" label, the "Saved per year at 55k" row, and the plan-health pill at the top of every page all follow the value live. 55k is now the floor, not the ceiling — the stretch goal is $1,000/mo (~70–100k ₽).

**Thousands separators on every input.** Display only — storage stays integer-clean. parseFloat stops at the first comma otherwise, so the input handlers were patched to strip commas before parsing.

## Mobile Access (added 2026-06-15)

On screens ≤640px, `styles.css` hides the desktop top nav's utility buttons (Private / Backup). They were unreachable on phones until two small frosted-paper pill buttons were added to the top-right of the mobile viewport, fixed position. They proxy to the existing `togglePrivacy()` and `openBackupPanel()` handlers and mirror the privacy state + backup pill colour. Desktop is untouched.

The BHT module also runs as a separate pillar with its own nav button (◐ Behavior), section, FAB, and Ctrl/Cmd+Shift+B hotkey — see the Behavior Pillar block above. On mobile, the BHT FAB is scoped to the Behavior section only so it doesn't overlap the backup banner on other pages.
