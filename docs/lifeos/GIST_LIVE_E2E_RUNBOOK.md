# Gist Sync — live end-to-end test runbook (value-free)

Status: **procedure + inert helper only.** Nothing here runs by itself. This is the safest known way to prove that the owner's *existing* Gist backup round-trips the
owner's real Life OS state without anyone (human or AI) reading a personal value or the GitHub PAT. It follows ADR-013 (restore of production data and credential changes
are never autonomous) and ADR-013 addendum #1 (no personal data to an AI provider): every artifact below is a hash prefix, count, size or fixed status word.

## What is tested
1. **Save** — the current, unchanged production state is saved to the already connected Gist using the app's own guarded Save (`GistSync.saveConnected`). It refuses on
   `conflict`, `remote-only` or `no-base`, is a no-op when already `synced`, and verifies the remote by re-reading it (hash equal, revision advanced) before it records a base.
2. **Restore into an isolated fresh profile** — the Gist is restored with the app's own confirmation-gated *Load Remote* into a brand-new browser profile that has no Life OS data.
   Production state is never restored over.
3. **Compare** — semantic hash prefix and per-collection type/count of production vs the restored isolated profile must match.

## Never do (stop and report instead)
- No new Gist, no permission/scope change, no PAT creation/rotation/revocation, no removal of the browser token, no deletion of any backup or recovery generation.
- No *Load* / *Restore* / *Keep Local* / *Load Remote* in the production profile. No push, merge or deploy.
- Nobody pastes the PAT anywhere except into the app's own token field, **typed by the owner** in the profile where it is needed. Agents never read, print, copy or type it.
- If Save reports anything other than `saved` / `noop` / `revision-refresh` / `converged`, or the isolated restore does not end in `pass: true`, **stop**; do not choose a conflict resolver to force a result.

## Roles
| Step | Who | Where |
|---|---|---|
| A. Pre-flight evidence | owner (or an agent that can drive the owner's browser) | production profile, Life OS tab |
| B. Save | owner clicks **Save to Gist** (or runs `__gistProbe.save()`) | production profile |
| C. Restore | owner enters the PAT in the isolated profile's token field and uses **Load Remote** | fresh isolated profile |
| D. Compare | anyone (inputs are value-free JSON) | any tab with the helper loaded |

## Procedure
Load the helper in a Life OS tab: paste the contents of `tools/gist-live-probe.js` into the DevTools console (it defines `window.__gistProbe`; it makes no request and stores nothing).

**A. Production, before** — `await __gistProbe.local()` and `await __gistProbe.syncBase()`. Save both JSON outputs as `before.json` / `base-before.json`.
(If `syncBase().present` is false the app will refuse Save with *no-base*; stop and report.)

**B. Production, Save** — `await __gistProbe.save()`.
Expected: `{ ok: true, kind: 'saved' | 'noop' | 'revision-refresh' | 'converged', baseMatchesLocal: true, localAfter.semanticHash === before.semanticHash }`.
`kind: 'saved'` means one PATCH to the connected Gist, then a verified re-read. Any `ok: false` (e.g. `conflict`, `remote-only`) means stop.

**C. Isolated fresh profile** — use a brand-new browser profile or private window that has never opened Life OS (verify: `await __gistProbe.local()` shows the default empty/seed shape and
`syncBase().present === false`). Open the same Life OS URL, enter the PAT in the token field yourself, connect to the existing Gist with the app's **Connect/Reconnect**, then use **Load Remote**
and confirm. Record `await __gistProbe.local()` as `after.json`.

**D. Compare** — in either tab: `__gistProbe.compare(before, after)` must return `{ pass: true, problems: [] }`.

## Evidence to record (all value-free)
`before.semanticHash`, `after.semanticHash`, collection count, `save().kind`, `baseMatchesLocal`, `compare().pass`, timestamps. Do **not** record the Gist id, revision id, any record text, or the token.

## Residual limits (state them in the report)
- The restore proves the Gist content imports into a fresh profile and hashes equal; it does not prove device-to-device sync or any later edit.
- GitHub's Gist update has no documented atomic precondition; the app re-reads and verifies after writing (see ARCHITECTURE "Sync (Gist)").
- The semantic hash excludes Store transaction metadata by design (see ARCHITECTURE), so equal hashes mean equal backup data, not byte-equal storage.
- The PAT remains plaintext in browser `localStorage` (known, tracked separately); this test neither changes nor exercises that.
