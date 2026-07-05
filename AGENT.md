# FWWweb Agent Guide

## Mission

Build `FWWweb` as a web-first TypeScript port of Friends With Words.

The web app is intentionally scoped to one playable mode:

- 5-minute Rush
- 11x11 mini board
- React UI
- CSS/CSS Modules styling
- Browser-native pointer interactions
- Autosave and offline resume
- Hardened Supabase leaderboard submission before public scores count

Do not port the full mobile app. Do not add classic mode, sprint mode, multiplayer, layout lab, native push notifications, or the React Native shell unless explicitly requested.

## Repository Shape

Use these areas as follows:

- `src/game/shared/`
  Portable game logic copied from the mobile app. Port these modules to TypeScript carefully and keep behavior equivalent.
- `src/data/`
  Dictionary and word data. Preserve content and loading behavior unless optimizing intentionally.
- `src/utils/`
  Web-safe utility modules. Replace React Native storage/platform assumptions with browser APIs.
- `src/services/`
  Web service clients and Supabase-facing code. Do not directly trust client score submissions.
- `public/`
  Static assets such as audio.
- `reference/react-native/`
  Read-only reference material from the mobile app. Use it to understand behavior and feel, but do not import from it in production web code.
- `reference/supabase/`
  Current backend/schema reference. Use it when designing migrations, functions, and security changes.
- `PLAN.md`
  Product and technical plan. Keep implementation aligned with it.

## Tech Stack

Use:

- TypeScript
- React
- Vite
- Plain CSS or CSS Modules
- Vitest for unit tests
- Playwright for browser interaction tests
- Supabase JS for backend calls

Avoid:

- React Native dependencies
- Generic drag-and-drop libraries for core tile movement
- UI component frameworks unless explicitly requested
- Tailwind unless explicitly requested
- Direct production imports from `reference/`

## Porting Rules

Prefer porting in this order:

1. Establish TypeScript project scaffolding.
2. Type the shared game domain:
   - `Tile`
   - `BoardCell`
   - `MiniBoard`
   - `RushSnapshot`
   - `RushTurnEntry`
   - `RushScoreBreakdown`
   - `RushRunStatus`
3. Port shared engine modules:
   - bag
   - premium squares
   - scoring
   - validation
   - turn resolution
   - dictionary
4. Build a new `useRushGame` hook.
5. Build web-native board/rack components.
6. Add autosave/offline resume.
7. Add hardened leaderboard integration.

Do not copy `reference/react-native/hooks/useGame.js` directly into production. Use it as a behavior reference and write a smaller web hook dedicated to 5-minute mini Rush.

## Game Scope

The web game must be fixed to:

- `durationSeconds = 300`
- board mode `mini`
- board size `11`
- mini premium square layout
- Rush scoring via `buildRushScoreBreakdown`
- local play first, leaderboard submission after validation

Supported gameplay actions:

- Start new Rush run
- Place rack tile on board
- Move tile already placed this turn
- Remove unsubmitted board tile back to rack
- Submit valid word
- Swap tiles if Rush keeps mobile parity
- Expire game at timer end
- Resume autosaved game
- Save final local result
- Submit eligible public score through hardened server path

## App-Like Interaction Feel

The tile/board feel is a core product requirement.

Use React for committed game state. Keep live drag movement outside React render loops.

Use:

- `PointerEvent`
- `setPointerCapture`
- `requestAnimationFrame`
- cached `getBoundingClientRect()` values
- `transform: translate3d(...) scale(...)`
- CSS custom properties for board/rack sizing
- `ResizeObserver`
- `touch-action: none` on interactive board/rack surfaces

Target behavior:

- Tile pickup responds immediately.
- Drag follows the pointer without React state churn.
- Drop/snap feels intentional and quick.
- Invalid drops return cleanly.
- Rack reorders with FLIP-style movement.
- Board and rack never resize or shift during hover/drag/score preview.
- Mobile Safari touch behavior is explicitly tested.

Animation defaults:

- Pickup lift: 60-80ms
- Drop settle: 120-180ms
- Invalid return: 160-220ms
- Rack reorder: 120-180ms
- Score count-up: fast and readable
- Timer warnings at 2:00, 0:30, and 0:10

Use CSS transitions or Web Animations API first. Add an animation library only if testing proves CSS/WAAPI cannot meet the feel requirement.

## Autosave And Offline Resume

Implement browser autosave under:

- `fwwweb.rush.autosave.v1`

Autosave must include:

- Stable snapshot after every committed submit/swap
- Draft snapshot for placed-but-unsubmitted tiles
- Replayable turn journal
- Save timestamp
- Schema version
- Run eligibility state

Use `localStorage` for v1 unless payload size becomes a real issue.

On load:

- Validate schema version.
- Validate board size, seed, rack, bag, timer, and journal shape.
- Restore valid draft placements.
- Fall back to the last stable snapshot if the draft is invalid.
- Never crash on corrupt autosave.

Connection loss behavior:

- Continue local play without blocking.
- Queue final submission if the run ends offline.
- Mark runs as `local_only` when leaderboard eligibility expires.
- Show sync state subtly.

Leaderboard eligibility:

- Public-score runs must start online and receive a server `runId`.
- Eligible submission deadline is `started_at + 300s + 60s grace`.
- Late runs remain resumable and locally saved, but cannot post to the public leaderboard.

## Supabase And Leaderboard Security

Do not ship public web leaderboard submission using direct client writes to `rush_scores`.

Current known risks:

- `rush_scores` accepts authenticated client insert/update for self.
- Client supplies final score, breakdown, seed, display name, and completion time.
- Better-score logic currently lives client-side.
- Browser clients are easy to inspect, script, and tamper with.

Required hardened path:

- Add server-created `web_rush_runs`.
- Add `createRushRun` server endpoint/function.
- Add `submitRushRun` server endpoint/function.
- Server validates the replay journal from seed.
- Server computes authoritative score.
- Server enforces run owner, one final submission, duration, deadline, and best-score replacement.
- Service role stays server-side only.
- Public leaderboard read should use a view/RPC that omits unnecessary raw identifiers.

Until this exists, web scores may be saved locally but must not count as public official leaderboard entries.

## Testing Requirements

Before considering a feature complete, add or update tests at the right layer.

Unit tests:

- bag determinism
- mini board premium layout
- scoring
- validation
- turn resolution
- Rush hook submit/swap/expire/resume
- autosave load/save/corrupt recovery

Browser tests:

- mouse drag rack tile to board
- touch drag rack tile to board
- invalid drop return
- board tile move/remove
- rack reorder
- refresh mid-turn and resume
- offline completion and queued submission
- expired leaderboard grace becomes local-only

Security tests:

- direct `rush_scores` writes fail after hardening
- malformed submission rejected
- replay mismatch rejected
- expired run rejected
- public leaderboard does not expose unnecessary identifiers

## Coding Standards

- Keep modules small and web-native.
- Avoid importing from `reference/` in production code.
- Prefer pure helpers for game rules.
- Keep animation loops out of React state.
- Use explicit TypeScript types for game state and persisted payloads.
- Keep CSS responsive without viewport-scaled font sizes.
- Preserve deterministic game behavior from the mobile app.
- Treat local storage as untrusted input.
- Treat every browser-supplied score as untrusted.

## Definition Of Done For Web V1

Web v1 is complete when:

- A player can open the site and play a full 5-minute mini Rush run.
- Tile movement feels natural on desktop and mobile browsers.
- Refreshing or losing connection does not lose the run.
- Local results persist.
- Public leaderboard submissions use server validation.
- Unit and browser tests cover the core flow.
- No production code depends on React Native modules or files under `reference/`.
