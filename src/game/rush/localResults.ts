/**
 * Local (device-only) Rush results. Public leaderboard submission is
 * intentionally NOT implemented client-side: per PLAN.md, web scores may only
 * count publicly once the hardened server path (server-issued runId, journal
 * replay validation, authoritative scoring) exists. Until then every web run
 * is `local_only`.
 */

import { isBetterRushResult } from "../shared/scoring";
import type { RushRunEligibility, RushScoreBreakdown } from "../shared/types";
import type { StorageLike } from "./autosave";

export const LOCAL_RESULTS_KEY = "fwwweb.rush.results.v1";
const MAX_RESULTS = 50;

export interface LocalRushResult {
  seed: string;
  completedAtMs: number;
  eligibility: RushRunEligibility;
  breakdown: RushScoreBreakdown;
  wordCount: number;
  turnCount: number;
  /** Run length: 300 mini or 600 classic. Omitted on older saved results. */
  runDurationSeconds?: 300 | 600;
}

const defaultStorage = (): StorageLike | null => {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* storage disabled */
  }
  return null;
};

export const loadLocalResults = (
  storage: StorageLike | null = defaultStorage()
): LocalRushResult[] => {
  if (!storage) return [];
  try {
    const raw = storage.getItem(LOCAL_RESULTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is LocalRushResult =>
        typeof r === "object" &&
        r !== null &&
        typeof r.seed === "string" &&
        typeof r.completedAtMs === "number" &&
        typeof r.breakdown === "object" &&
        r.breakdown !== null &&
        typeof r.breakdown.finalScore === "number"
    );
  } catch {
    return [];
  }
};

export const saveLocalResult = (
  result: LocalRushResult,
  storage: StorageLike | null = defaultStorage()
): void => {
  if (!storage) return;
  try {
    const results = [result, ...loadLocalResults(storage)].slice(0, MAX_RESULTS);
    storage.setItem(LOCAL_RESULTS_KEY, JSON.stringify(results));
  } catch {
    /* ignore quota/serialization errors; play continues */
  }
};

const getRunDurationSeconds = (result: LocalRushResult): 300 | 600 => {
  if (result.runDurationSeconds === 600) return 600;
  if (result.runDurationSeconds === 300) return 300;
  // Legacy saves only stored elapsed seconds on the breakdown.
  return result.breakdown.durationSeconds === 600 ? 600 : 300;
};

export const getBestLocalResult = (
  storage: StorageLike | null = defaultStorage(),
  durationSeconds?: number
): LocalRushResult | null => {
  let best: LocalRushResult | null = null;
  for (const result of loadLocalResults(storage)) {
    if (
      typeof durationSeconds === "number" &&
      getRunDurationSeconds(result) !== durationSeconds
    ) {
      continue;
    }
    if (isBetterRushResult(result.breakdown, best?.breakdown ?? null)) {
      best = result;
    }
  }
  return best;
};
