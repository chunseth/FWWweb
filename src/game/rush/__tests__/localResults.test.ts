import { beforeEach, describe, expect, it } from "vitest";
import {
  getBestLocalResult,
  LOCAL_RESULTS_KEY,
  saveLocalResult,
  type LocalRushResult,
} from "../localResults";
import type { StorageLike } from "../autosave";
import type { RushScoreBreakdown } from "../../shared/types";

const breakdown = (finalScore: number, elapsedSeconds: number): RushScoreBreakdown => ({
  pointsEarned: finalScore,
  swapPenalties: 0,
  turnPenalties: 0,
  rackPenalty: 0,
  scrabbleBonus: 0,
  timeBonus: 0,
  consistencyBonusTotal: 0,
  durationSeconds: elapsedSeconds,
  skillBonusTotal: 0,
  finalScore,
});

const storage = (): StorageLike => {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
};

describe("getBestLocalResult", () => {
  let mem: StorageLike;

  beforeEach(() => {
    mem = storage();
  });

  it("returns separate bests for mini and classic runs", () => {
    const mini: LocalRushResult = {
      seed: "mini",
      completedAtMs: 1,
      eligibility: "local_only",
      breakdown: breakdown(120, 280),
      wordCount: 5,
      turnCount: 5,
      runDurationSeconds: 300,
    };
    const classic: LocalRushResult = {
      seed: "classic",
      completedAtMs: 2,
      eligibility: "local_only",
      breakdown: breakdown(240, 590),
      wordCount: 10,
      turnCount: 10,
      runDurationSeconds: 600,
    };
    saveLocalResult(mini, mem);
    saveLocalResult(classic, mem);

    expect(getBestLocalResult(mem, 300)?.breakdown.finalScore).toBe(120);
    expect(getBestLocalResult(mem, 600)?.breakdown.finalScore).toBe(240);
    expect(getBestLocalResult(mem)?.breakdown.finalScore).toBe(240);
  });

  it("clears stored results between tests via fresh storage", () => {
    expect(mem.getItem(LOCAL_RESULTS_KEY)).toBeNull();
  });
});
