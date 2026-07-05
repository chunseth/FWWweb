/**
 * Server entry for the shared game engine.
 *
 * Bundled by `npm run build:functions` (scripts/build-functions.mjs) into
 * supabase/functions/_shared/engine.mjs — a single self-contained ESM file
 * (engine + full dictionary data) that the Edge Functions import.
 *
 * This is the exact same engine the browser runs, which is the point:
 * the server replays a submitted turn journal from the seed and recomputes
 * the authoritative score. Any client-side tampering shows up as a mismatch.
 */

import dictionaryWordsJson from "../data/dictionaryWords.json";
import { Dictionary } from "../utils/dictionary";
import type { DictionaryLike } from "../game/shared/types";

export {
  createRushRun,
  replayJournal,
  buildCurrentBreakdown,
  RUSH_DURATION_SECONDS,
  RUSH_DURATION_MS,
  RUSH_SUBMIT_GRACE_MS,
} from "../game/rush/rushEngine";

export type {
  RushSnapshot,
  RushTurnEntry,
  RushScoreBreakdown,
} from "../game/shared/types";

let cached: Dictionary | null = null;

/** Build (once) the full dictionary from statically bundled word data. */
export const getServerDictionary = async (): Promise<DictionaryLike> => {
  if (cached) return cached;
  const dict = new Dictionary();
  await dict.load(undefined, dictionaryWordsJson as string[]);
  cached = dict;
  return dict;
};

/**
 * Structural sanity checks on an untrusted journal payload BEFORE replay.
 * Replay itself is the real validator; this bounds the work we do on junk.
 */
export const isPlausibleJournal = (value: unknown): boolean => {
  if (!Array.isArray(value)) return false;
  if (value.length === 0 || value.length > 150) return false;

  let lastElapsed = 0;
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) return false;
    const e = entry as Record<string, unknown>;
    const atElapsedMs = e.atElapsedMs;
    if (
      typeof atElapsedMs !== "number" ||
      !Number.isFinite(atElapsedMs) ||
      atElapsedMs < 0 ||
      atElapsedMs > 300_000 ||
      atElapsedMs < lastElapsed
    ) {
      return false;
    }
    lastElapsed = atElapsedMs;

    if (e.type === "submit") {
      if (!Array.isArray(e.placements)) return false;
      if (e.placements.length === 0 || e.placements.length > 7) return false;
      if (typeof e.turnScore !== "number" || !Number.isFinite(e.turnScore)) {
        return false;
      }
    } else if (e.type === "swap") {
      if (!Array.isArray(e.rackIndices)) return false;
      if (e.rackIndices.length === 0 || e.rackIndices.length > 7) return false;
      if (typeof e.penalty !== "number" || !Number.isFinite(e.penalty)) {
        return false;
      }
    } else {
      return false;
    }
  }
  return true;
};
