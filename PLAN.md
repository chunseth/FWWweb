# FWWweb TypeScript Port Plan

## Summary

Build `FWWweb` as a Vite + React + TypeScript web app with plain CSS/CSS Modules, scoped to one playable mode: **5-minute Rush on the 11x11 mini board**. Copy the shared game engine, rewrite the UI/input shell for the browser, and harden Rush leaderboard submission before public web scores count.

## Core Implementation

- Create a new React TypeScript app with `strict` TS, Vitest, Playwright, and Supabase JS.

- Port and type the reusable game modules: bag, mini board/premium squares, scoring, validation, turn resolution, dictionary data.

- Build a new `useRushGame` hook instead of copying `useGame` directly:
  - Fixed `durationSeconds: 300`

  - Fixed board mode: `mini`

  - Supports start, place, move, remove, submit, swap, expire, resume, and final score breakdown

  - Emits a replayable turn journal for autosave and server validation

- Define shared domain types up front:
  - `Tile`, `BoardCell`, `MiniBoard`, `RushSnapshot`, `RushTurnEntry`, `RushScoreBreakdown`, `RushRunStatus`

- Use browser storage adapters instead of React Native storage/audio/platform APIs.

## App-Like Game Feel

- Use hand-built pointer input, not a generic drag-and-drop library.

- Use React for committed state, but keep live drag movement outside React:
  - `PointerEvent`

  - `setPointerCapture`

  - `requestAnimationFrame`

  - direct `transform: translate3d(...) scale(...)`

  - cached `getBoundingClientRect()` measurements

- Build `MiniBoard` and `TileRack` with stable CSS sizing:
  - `ResizeObserver` calculates `--cell-size`

  - board/rack dimensions never shift during hover, drag, score preview, or resize

  - `touch-action: none` on the board/rack interaction surface

- Animation model:
  - Tile pickup: 60-80ms scale/shadow lift

  - Drag: immediate pointer-follow via `translate3d`

  - Drop/snap: 120-180ms cubic-bezier settle

  - Invalid return: 160-220ms return-to-origin

  - Rack reorder: FLIP-style transforms, only affected tiles move

  - Score changes: fast count-up animation, matching current mini score feel

  - Timer warnings: restrained banner/flash at 2:00, 0:30, 0:10

- Use CSS transitions/Web Animations API for one-shot polish; avoid animation libraries unless browser testing shows CSS/WAAPI cannot hit the desired feel.

- Add lightweight audio cues only after user interaction, because browser autoplay rules block automatic playback.

## Autosave And Offline Resume

- Store a versioned local autosave under `fwwweb.rush.autosave.v1`.

- Save three layers:
  - Stable snapshot after every committed submit/swap

  - Draft snapshot for placed-but-unsubmitted tiles, debounced around 250ms

  - Turn journal for replay, score reconstruction, and leaderboard submission

- Save synchronously to `localStorage` for refresh resilience; keep the schema small enough that IndexedDB is not required for v1.

- On load:
  - Validate schema version, board size, seed, timer state, rack, bag, and journal

  - Restore draft placements if valid

  - Fall back to the last stable snapshot if draft state is invalid

- On connection loss:
  - Continue the Rush run locally with no gameplay interruption

  - Queue leaderboard submission locally if the game ends while offline

  - Show sync state subtly, without blocking play

- Official leaderboard eligibility:
  - A public-score run must start online and receive a server `runId`

  - If connection drops mid-run, the player can continue locally

  - Submission remains eligible only if received before `started_at + 300s + 60s grace`

  - Late/offline-only runs remain playable and locally saved, but are marked `local_only`

## Leaderboard Security Changes

Current risk to fix before web launch:

- `rush_scores` allows public reads with `using (true)`, exposing `player_id` and all selected score rows.

- Authenticated clients can directly insert/update their own `rush_scores`.

- The database trusts client-supplied `final_score`, breakdown fields, seed, `completed_at`, and display name.

- “Only keep better score” logic lives in client code, not in an authoritative server path.

- There is no server-issued run record, replay validation, or submission deadline tied to a real start time.

Required hardening:

- Add a server-created `web_rush_runs` table:
  - `id`, `player_id`, `seed`, `duration_seconds`, `started_at`, `deadline_at`, `status`, `submitted_at`

  - `duration_seconds` must be `300`

  - rows are readable only by their owner

- Replace direct client writes to `rush_scores` with a Supabase Edge Function:
  - `createRushRun()` issues the seed/run record

  - `submitRushRun()` accepts `runId`, final snapshot, and turn journal

  - Function uses service role internally; service role is never exposed to the browser

- Server validation must replay the turn journal from seed using the shared TS game engine:
  - Validate words, placements, mini board rules, bag/rack state, premiums, score breakdown, and final score

  - Reject mismatched scores, invalid journals, wrong duration, wrong user, expired grace window, duplicate final submissions, and suspicious payload shape

- Move “better score wins” into the server submission path.

- Keep public leaderboard reads, but expose them through a safe view or RPC that omits raw `player_id` unless truly needed.

- After mobile and web use the hardened path, remove authenticated insert/update policies from `rush_scores`.

## Test Plan

- Unit tests:
  - ported scoring, bag, validation, turn resolution, dictionary

  - `useRushGame` submit/swap/expire/resume behavior

  - autosave migration, corrupt save recovery, draft rollback

- Browser tests:
  - touch/mouse drag from rack to board

  - board tile move/remove

  - rack reorder

  - refresh mid-turn and resume

  - offline completion and queued submission

  - expired grace becomes local-only

- Security tests:
  - direct `rush_scores` insert/update fails for authenticated clients

  - malformed score submission is rejected

  - replay mismatch is rejected

  - expired run cannot post to public leaderboard

  - leaderboard public query does not expose unnecessary identifiers

## Assumptions

- Web v1 has only 5-minute Rush on the mini board.

- Public leaderboard launch waits for hardened server validation.

- Offline play is smooth locally, but official leaderboard eligibility requires a server-created run and submission within the 60-second grace window.

- Styling uses CSS/CSS Modules, not a component framework or Tailwind, unless later design work calls for one.
