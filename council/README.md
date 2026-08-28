# Council — cross-model collaboration protocol

## Purpose

The Council exists to:

- remove manual copy/paste between AI workers (Claude Code, Codex CLI, ChatGPT, and any future model);
- keep every model output tied to a known repository state (frozen commit);
- preserve independent reviews for HIGH-risk work;
- retain accepted decisions in project-owned files, not vendor memory;
- avoid vendor/model memory becoming canonical truth.

## Core principle

**The repository is truth. Models are workers.**

- Vendor/model memory is convenience only. It can be wrong or absent.
- Canonical project truth lives in `docs/lifeos/*`.
- Deterministic CI evidence outranks model consensus.

## Task folder shape

Every non-trivial cross-model task lives in its own folder with a
dedicated `reports/` subdirectory for model outputs:

```
council/tasks/<YYYY-MM-DD>-<short-slug>/
├── task.md
├── reports/
│   ├── claude.md
│   ├── codex.md
│   └── chatgpt.md
└── SYNTHESIS.md
```

Optional per-model report files (added only when that model
actually participated in the task):

```
reports/qwen.md
reports/gemini.md
```

**Filename convention rationale.** Report files live under
`reports/` with **lowercase** filenames so they cannot be
interpreted by Claude Code as agent-instruction memory. The root
`CLAUDE.md` and `AGENTS.md` files are the only files reserved for
actual agent instructions; nested `reports/*.md` files are
historical evidence, never instructions.

## Task lifecycle states

Distinguish four review stages — do not conflate them:

```
1. AUTHOR HANDOFF          the implementer or task author drafts
                           task.md + (optionally) an initial reports/claude.md
                           that names the intent and self-audit.
                           Not yet reviewed. Not final.

2. BLIND PEER REVIEW       applies ONLY when two or more peer reviewers
                           are actually assigned. Reviewers receive the
                           same frozen commit / same inputs / same
                           evidence; each writes its own reports/<model>.md
                           without reading the others' reports first.

3. IMPLEMENTATION REVIEW   an independent HIGH-risk reviewer (typically
                           Codex CLI, outside the authoring Claude Code
                           session) reviews the exact implementation head
                           and writes reports/codex.md. This stage is
                           distinct from stage 2: it targets a specific
                           implementation SHA, not just an architecture
                           proposal.

4. FINAL SYNTHESIS         ChatGPT (or the user) reads all reports/
                           and writes SYNTHESIS.md. A synthesis MUST NOT
                           precede the independent implementation
                           report(s) it claims to synthesize.
```

Lifecycle values recorded in `task.md`'s `status:` field:

```
open                       just created; base commit frozen
review                     stage 2 or 3 in progress; reports incomplete
pending-independent-review specific state: waiting on stage 3 reviewer
synthesis                  stage 4 in progress; reports complete
accepted                   SYNTHESIS.md accepted by the user; if canonical
                           architecture changed, promote to
                           docs/lifeos/DECISIONS.md as an ADR and/or
                           update docs/lifeos/ROADMAP.md
superseded                 a later task supersedes the accepted synthesis
```

This lifecycle is a written convention. **V1 does not automate it.** Do not build software to enforce lifecycle transitions unless manual ceremony becomes a measured, repeated bottleneck.

## Round 1 independence

For HIGH-risk architecture and review tasks:

- every reviewer receives the same frozen base commit;
- the same task;
- the same canonical inputs listed in `task.md`;
- the same deterministic CI evidence;
- reviewers **must not** read another reviewer's Round 1 report before committing their own.

Round 1 files are committed to git before any other reviewer sees them. This anti-anchoring rule is load-bearing.

## Synthesis

ChatGPT (or the user acting as synthesizer) writes to:

```
council/tasks/<slug>/SYNTHESIS.md
```

If the accepted synthesis changes canonical architecture, promote the durable decision to:

- `docs/lifeos/DECISIONS.md` (as a new ADR);
- `docs/lifeos/ROADMAP.md` (as a roadmap update);
- and reference the promoting SYNTHESIS.md commit hash in the ADR/roadmap change.

The Council folder is the working record; the Layer 1 docs are the durable truth.

## Bounded review loop

Maximum **two** targeted revisit rounds total per task (not per reviewer).

After the second revisit:
- risk tier remains unchanged;
- the user makes the decision and records it in `SYNTHESIS.md`;
- no endless pursuit of model consensus.

**Explicitly rejected:** any rule that automatically downgrades a HIGH-risk task to MEDIUM merely because review took a long time. Risk does not shrink because review is slow.

## One-implementer rule

One PR / change-set has **one** active implementer at a time. Other models are reviewers unless explicitly reassigned. Two models never write the same PR simultaneously.

## Write isolation

- implementation uses a dedicated branch and worktree;
- independent reviewers default to read-only;
- two models never share an editable worktree.

Claude Code CLI and Codex CLI create their own worktrees per session on demand. Pre-created per-model worktrees are not required.

## Task provenance

Every `task.md` and every model report begins with a YAML frontmatter block that ties the file to a specific repository state. Format defined below.

### `task.md` frontmatter

```yaml
---
task: <YYYY-MM-DD>-<short-slug>
status: open | round-1 | synthesis | accepted | superseded
risk: LOW | MEDIUM | HIGH
base_commit: <full git commit hash frozen at task open>
branch: <branch name or review target>
created_at: <ISO-8601 timestamp>
canonical_inputs:
  - docs/lifeos/PROJECT.md
  - docs/lifeos/ARCHITECTURE.md
  - docs/lifeos/STORAGE_MAP.md
  - docs/lifeos/DECISIONS.md
  - docs/lifeos/ROADMAP.md
evidence:
  - <test / report / CI-artifact path if applicable>
write_authority: <worker name | none>
---
```

`canonical_inputs` lists only the Layer 1 files that are actually required for the task; do not list every doc.

### Model report frontmatter

Common fields (all reports):

```yaml
---
task: <task slug>
base_commit: <full 40-char commit that the task was opened against>
model: <worker or model name — claude-code, codex-cli, chatgpt, qwen, gemini>
role: implementer | reviewer | scout | synthesizer
created_at: <ISO-8601 timestamp>
inputs:
  - <exact files or context files the model consumed>
evidence:
  - <exact deterministic evidence consumed, e.g. github-actions run/check refs>
---
```

**Implementation-review reports MUST additionally include:**

```yaml
review_commit: <full 40-char SHA of the exact implementation head reviewed>
working_tree: clean | dirty
evidence:
  - github-actions:<run-id>/<job-or-check-name>
  - (any other deterministic evidence identifier)
```

Rationale: `base_commit` alone identifies which commit the task was
opened against, not which commit the implementation was reviewed at.
An implementation review MUST bind to a specific implementation SHA
so approval cannot silently drift to a later commit.

Optional (include only when reliably available):

```yaml
model_version: <e.g. claude-opus-4-7>
tool_version: <e.g. claude-code-cli-1.x.y>
```

**Do not invent** model version strings, timestamps, or GitHub
Actions run IDs. If unknown, omit the optional field or state
`unknown` explicitly.

### External-input handling

For external inputs (a document the reviewer read but which is not
tracked in the repository) that materially affect the review
decision, choose one:

- commit a sanitized copy to the task folder and list the committed
  path in `inputs:`; OR
- record a SHA-256 digest + a source description in `inputs:` so a
  future reader can verify the exact bytes the reviewer consumed.

Do not require per-file blob hashes for committed files. The commit
already binds repository content.

### Stale-context rule

Implementation-review approvals bind to a specific `review_commit`.
Any implementation change **after** that SHA on the same branch
invalidates the approval until a targeted re-review lands against
the new head. Deterministic — do not litigate whether the change
was "material."

Other reports (author handoff, architecture review, scout,
synthesis) are stale and must be revalidated only if:

- their `base_commit` no longer matches the code under decision
  AND the change since is materially relevant to the task; OR
- a listed canonical input has materially changed after the report
  was written; OR
- deterministic evidence referenced by the report (test counts, CI
  artifact) no longer applies.

A non-implementation-review report is **not** invalidated merely
because an unrelated file changed.

## Files that do NOT exist in this Council V1

To avoid ceremony:

- `council/CURRENT_TASK.md` — the prompt IS the task; per-task folders are stateless and support parallel work.
- `council/CURRENT_CONTEXT.md` — same reason.
- `council/history/` — git is the history.
- Global model mailboxes.
- Placeholder `reports/hermes.md` / `reports/qwen.md` / `reports/gemini.md` model report files in every task folder. Create a `reports/<model>.md` file only for models that actually participated in that specific task.

## Files that do NOT exist as agent instructions in V1

Layer 2 agent instructions today are exactly two files:

- `CLAUDE.md` (Claude Code CLI reads this natively)
- `AGENTS.md` (Codex CLI and any future agent reads this)

Do not create `HERMES.md`, `QWEN.md`, or `GEMINI.md` until those tools are actually in rotation for real work. Speculative per-model instruction files drift when they don't reflect reality.

## What Council V1 explicitly does NOT include

- Council automation (no `scripts/council.sh`, no `lifeos council` command, no auto-run of models).
- Automatic task creation.
- Automatic synthesis.
- Automatic consensus engine.
- Any AI-platform orchestration layer.

Automation may be added later if manual ceremony becomes a measured, repeated friction. Until then, the manual convention proves itself.

## Related canonical documents

Layer 1 project truth (canonical):

- [`docs/lifeos/PROJECT.md`](../docs/lifeos/PROJECT.md)
- [`docs/lifeos/ARCHITECTURE.md`](../docs/lifeos/ARCHITECTURE.md)
- [`docs/lifeos/STORAGE_MAP.md`](../docs/lifeos/STORAGE_MAP.md)
- [`docs/lifeos/DECISIONS.md`](../docs/lifeos/DECISIONS.md)
- [`docs/lifeos/ROADMAP.md`](../docs/lifeos/ROADMAP.md)

Layer 2 agent instructions:

- [`../CLAUDE.md`](../CLAUDE.md)
- [`../AGENTS.md`](../AGENTS.md)

Risk-tier and never-autonomous policies live in ADRs inside `docs/lifeos/DECISIONS.md`.
