# Supabase — hardened web Rush leaderboard

The web client never writes scores directly. All public-leaderboard
submissions flow through two Edge Functions that replay the game journal
server-side with the same TS engine the browser runs.

## Pieces

| Piece | Purpose |
| --- | --- |
| `migrations/20260704090000_web_rush_hardening.sql` | `web_rush_runs` (server-created, owner-read-only) + `get_rush_leaderboard()` RPC (no `player_id` exposure) |
| `migrations/20260704090001_rush_scores_lockdown.sql` | Stage 2, opt-in: removes client insert/update on `rush_scores`. Apply only after mobile also uses the server path |
| `functions/create-rush-run` | Issues server seed + run row with `deadline_at = started_at + 300s + 60s` |
| `functions/submit-rush-run` | Ownership/deadline/one-shot checks → journal replay → authoritative score → better-score-wins → writes `rush_scores` (service role) |
| `functions/_shared/engine.mjs` | Generated bundle of the shared engine + dictionary. Rebuild with `npm run build:functions` |

## Deploy

```sh
# 1. Bundle the engine (required whenever src/game or the dictionary changes)
npm run build:functions

# 2. Apply migrations
supabase db push

# 3. Deploy functions (JWT verification stays ON — anonymous sessions pass)
supabase functions deploy create-rush-run
supabase functions deploy submit-rush-run
```

Requirements:

- **Anonymous sign-ins enabled** (Auth → Providers → Anonymous) — the web
  client uses `signInAnonymously()` like the mobile app.
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are injected into functions
  automatically by Supabase. The service role key must never appear in any
  `VITE_*` variable.

## Security properties

- Seed, start time, and deadline are server-issued; the client cannot mint
  eligible runs, pick friendly bags, or stretch the clock.
- The journal replay recomputes every draw, placement, word, premium, swap
  penalty, and the final breakdown. Claimed turn scores must match exactly;
  any mismatch marks the run `invalid` (422) and it can't be resubmitted.
- One final submission per run (409 on repeat), owner-only (403), hard
  deadline (410), duration pinned to 300s, journal bounded (≤150 entries,
  ≤256 KB body), run creation rate-limited (30/hour/player).
- "Better score wins" is decided server-side from stored rows.
- Public reads go through `get_rush_leaderboard()`: best score per player,
  `display_name`/score/date only — no player ids.

## Stage 2 lockdown

`rush_scores` still accepts direct authenticated writes so the current mobile
app keeps working. Once mobile submits through these functions too, run the
stage-2 migration body (it is guarded by
`app.enable_rush_scores_lockdown = 'on'` so it is an explicit opt-in), then
verify:

- direct `insert into rush_scores` as an authenticated user → RLS error
- direct `update rush_scores` as an authenticated user → RLS error
- `select * from rush_scores` as anon → no rows (use the RPC instead)
