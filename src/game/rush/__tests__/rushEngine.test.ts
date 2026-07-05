import { describe, expect, it } from "vitest";
import {
  createRushRun,
  expireRun,
  getRunningScore,
  getUsedRackIndices,
  moveBoardTile,
  placeTile,
  removeBoardTile,
  reorderRack,
  replayJournal,
  returnAllDraftTiles,
  shuffleRack,
  submitTurn,
  swapTiles,
  RUSH_DURATION_MS,
} from "../rushEngine";
import type { DictionaryLike, RushSnapshot } from "../../shared/types";

const acceptAll: DictionaryLike = { isValid: () => true };

/** Places the rack tile at `rackIndex` with a letter fallback for blanks. */
const place = (
  state: RushSnapshot,
  rackIndex: number,
  row: number,
  col: number
): RushSnapshot => {
  const result = placeTile(state, rackIndex, row, col, "Z");
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.text);
  return result.state;
};

const submit = (state: RushSnapshot) => {
  const result = submitTurn(state, acceptAll);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.text);
  return result;
};

describe("createRushRun", () => {
  it("creates a deterministic 11x11 run with a 7-tile rack", () => {
    const a = createRushRun("seed-1", 1000);
    const b = createRushRun("seed-1", 1000);

    expect(a.boardSize).toBe(11);
    expect(a.durationSeconds).toBe(300);
    expect(a.rack).toHaveLength(7);
    expect(a.bag).toHaveLength(48 - 7);
    expect(a.rack.map((t) => t.letter)).toEqual(b.rack.map((t) => t.letter));
    expect(a.bag).toEqual(b.bag);
    expect(a.premiumSquares["5,5"]).toBe("center");
    expect(a.status).toBe("active");
    expect(a.eligibility).toBe("local_only");
  });

  it("creates a 10-minute classic run with a 15x15 board and normal bag", () => {
    const state = createRushRun("classic-seed", 1000, {
      durationSeconds: 600,
    });

    expect(state.boardSize).toBe(15);
    expect(state.durationSeconds).toBe(600);
    expect(state.rack).toHaveLength(7);
    expect(state.bag).toHaveLength(100 - 7);
    expect(state.premiumSquares["7,7"]).toBe("center");
    expect(state.premiumSquares["5,5"]).toBe("tl");
  });

  it("produces different racks for different seeds", () => {
    const a = createRushRun("seed-1", 1000);
    const b = createRushRun("seed-2", 1000);
    // Extremely unlikely to collide across the full bag order.
    expect(
      a.bag.map((t) => t.letter).join("") + a.rack.map((t) => t.letter).join("")
    ).not.toEqual(
      b.bag.map((t) => t.letter).join("") + b.rack.map((t) => t.letter).join("")
    );
  });
});

describe("draft placement", () => {
  it("places, moves, and removes draft tiles", () => {
    let state = createRushRun("seed-3", 1000);
    state = place(state, 0, 5, 5);
    expect(state.board[5][5]).not.toBeNull();
    expect(getUsedRackIndices(state).has(0)).toBe(true);

    const moved = moveBoardTile(state, 5, 5, 5, 6);
    expect(moved.ok).toBe(true);
    if (moved.ok) state = moved.state;
    expect(state.board[5][5]).toBeNull();
    expect(state.board[5][6]).not.toBeNull();

    const removed = removeBoardTile(state, 5, 6);
    expect(removed.ok).toBe(true);
    if (removed.ok) state = removed.state;
    expect(state.board[5][6]).toBeNull();
    expect(getUsedRackIndices(state).size).toBe(0);
  });

  it("rejects placing the same rack tile twice", () => {
    let state = createRushRun("seed-3", 1000);
    state = place(state, 0, 5, 5);
    const second = placeTile(state, 0, 5, 6, "Z");
    expect(second.ok).toBe(false);
  });

  it("rejects placement on an occupied cell", () => {
    let state = createRushRun("seed-3", 1000);
    state = place(state, 0, 5, 5);
    const second = placeTile(state, 1, 5, 5, "Z");
    expect(second.ok).toBe(false);
  });

  it("returns all draft tiles to the rack", () => {
    let state = createRushRun("seed-3", 1000);
    state = place(state, 0, 5, 5);
    state = place(state, 1, 5, 6);
    state = returnAllDraftTiles(state);
    expect(getUsedRackIndices(state).size).toBe(0);
    expect(state.board[5][5]).toBeNull();
    expect(state.board[5][6]).toBeNull();
  });
});

describe("submitTurn", () => {
  it("requires the first word to cover the center square", () => {
    let state = createRushRun("seed-4", 1000);
    state = place(state, 0, 0, 0);
    state = place(state, 1, 0, 1);
    const result = submitTurn(state, acceptAll);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.title).toBe("First Word");
  });

  it("commits a valid first turn: scores, draws, journals", () => {
    let state = createRushRun("seed-4", 1000);
    state = place(state, 0, 5, 5);
    state = place(state, 1, 5, 6);

    const result = submit(state);
    const next = result.state;

    expect(next.turnCount).toBe(1);
    expect(next.isFirstTurn).toBe(false);
    expect(next.rack).toHaveLength(7); // refilled
    expect(next.bag.length).toBe(48 - 7 - 2);
    expect(next.board[5][5]?.scored).toBe(true);
    expect(next.board[5][6]?.scored).toBe(true);
    expect(next.journal).toHaveLength(1);
    const entry = next.journal[0];
    expect(entry.type).toBe("submit");
    if (entry.type === "submit") {
      expect(entry.placements).toHaveLength(2);
      expect(entry.turnScore).toBe(result.detail.turnScore);
    }
    expect(next.wordPointsTotal).toBeGreaterThan(0);
    // Center square doubles the first word.
    expect(getRunningScore(next)).toBe(next.wordPointsTotal);
    // Premium under the played word is consumed.
    expect(next.premiumSquares["5,5"]).toBeUndefined();
  });

  it("rejects a word rejected by the dictionary", () => {
    let state = createRushRun("seed-4", 1000);
    state = place(state, 0, 5, 5);
    state = place(state, 1, 5, 6);
    const result = submitTurn(state, { isValid: () => false });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.title).toBe("Not Accepted");
      expect(result.error.text).toMatch(/^Not accepted: /);
    }
  });

  it("requires later turns to connect to existing words", () => {
    let state = createRushRun("seed-4", 1000);
    state = place(state, 0, 5, 5);
    state = place(state, 1, 5, 6);
    state = submit(state).state;

    state = place(state, 0, 0, 0);
    state = place(state, 1, 0, 1);
    const result = submitTurn(state, acceptAll);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.title).toBe("Invalid Placement");
  });
});

describe("swapTiles", () => {
  it("swaps tiles with an escalating penalty and journals the swap", () => {
    const state = createRushRun("seed-5", 1000);
    const tileValues =
      (state.rack[0]?.value ?? 0) + (state.rack[1]?.value ?? 0);

    const first = swapTiles(state, [0, 1]);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.detail.penalty).toBe(tileValues * 1);
    expect(first.state.swapCount).toBe(1);
    expect(first.state.turnCount).toBe(1);
    expect(first.state.rack).toHaveLength(7);
    expect(first.state.journal).toHaveLength(1);

    const secondValues =
      (first.state.rack[2]?.value ?? 0) + (first.state.rack[3]?.value ?? 0);
    const second = swapTiles(first.state, [2, 3]);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // Second swap doubles the base penalty.
    expect(second.detail.penalty).toBe(secondValues * 2);
    expect(second.state.swapPenaltyTotal).toBe(
      first.detail.penalty + second.detail.penalty
    );
  });

  it("is deterministic given the same state", () => {
    const state = createRushRun("seed-5", 1000);
    const a = swapTiles(state, [0]);
    const b = swapTiles(state, [0]);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.state.rack).toEqual(b.state.rack);
      expect(a.state.bag).toEqual(b.state.bag);
    }
  });
});

describe("reorderRack", () => {
  it("moves a tile to a new visible position", () => {
    const state = createRushRun("seed-6", 1000);
    const letters = state.rack.map((t) => t.letter);
    const next = reorderRack(state, 0, 3);
    const expected = [...letters];
    const [moved] = expected.splice(0, 1);
    expected.splice(3, 0, moved);
    expect(next.rack.map((t) => t.letter)).toEqual(expected);
  });

  it("skips board-placed tiles when computing visible positions", () => {
    let state = createRushRun("seed-6", 1000);
    state = place(state, 1, 5, 5); // hide rack index 1 from the rack
    const before = state.rack.map((t) => t.letter);
    const next = reorderRack(state, 0, 1);
    // Visible order: [0,2,3,4,5,6]; moving 0 to visible pos 1 puts it at raw 2.
    expect(next.rack[1].letter).toBe(before[1]); // hidden tile untouched
    expect(next.rack.map((t) => t.letter)).not.toEqual(before);
    // Board draft still resolves to the same tile.
    const used = getUsedRackIndices(next);
    expect(used.size).toBe(1);
  });
});

describe("shuffleRack", () => {
  it("reorders rack tiles without spending a turn", () => {
    const state = createRushRun("seed-shuffle", 1000);
    const next = shuffleRack(state);

    expect(next.turnCount).toBe(0);
    expect(next.elapsedMs).toBe(0);
    expect(next.journal).toHaveLength(0);
    expect(next.rack).toHaveLength(state.rack.length);
    expect(next.rack.map((tile) => tile.id).sort()).toEqual(
      state.rack.map((tile) => tile.id).sort()
    );
    expect(next.randomState).toBe(state.randomState);
  });
});

describe("expireRun and scoring", () => {
  it("builds a rush breakdown with turn penalties but no rack penalty or time bonus", () => {
    let state = createRushRun("seed-7", 1000);
    state = place(state, 0, 5, 5);
    state = place(state, 1, 5, 6);
    state = submit(state).state;

    const expired = expireRun(state);
    expect(expired.status).toBe("expired");
    expect(expired.elapsedMs).toBe(RUSH_DURATION_MS);
    expect(expired.finalBreakdown).not.toBeNull();
    const breakdown = expired.finalBreakdown!;
    expect(breakdown.turnPenalties).toBe(expired.turnCount * 2);
    expect(breakdown.rackPenalty).toBe(0);
    expect(breakdown.timeBonus).toBe(0);
    expect(breakdown.finalScore).toBe(
      breakdown.pointsEarned -
        breakdown.swapPenalties -
        breakdown.turnPenalties +
        breakdown.scrabbleBonus +
        breakdown.consistencyBonusTotal
    );
  });

  it("returns draft tiles before finishing", () => {
    let state = createRushRun("seed-7", 1000);
    state = place(state, 0, 5, 5);
    const expired = expireRun(state);
    expect(expired.board[5][5]).toBeNull();
  });

  it("ignores actions after expiry", () => {
    const expired = expireRun(createRushRun("seed-7", 1000));
    expect(placeTile(expired, 0, 5, 5, "Z").ok).toBe(false);
    expect(swapTiles(expired, [0]).ok).toBe(false);
    expect(submitTurn(expired, acceptAll).ok).toBe(false);
  });
});

describe("bag exhaustion", () => {
  it("ends the run immediately when the last bag+rack tiles are submitted", () => {
    // Craft a nearly-finished run: empty bag, two tiles left in the rack.
    const base = createRushRun("endgame-seed", 1000);
    const twoTiles = base.rack.slice(0, 2).map((tile, rackIndex) => ({
      ...tile,
      letter: tile.value === 0 ? "A" : tile.letter, // avoid blank handling
      value: tile.value === 0 ? 1 : tile.value,
      rackIndex,
    }));
    let state: RushSnapshot = { ...base, bag: [], rack: twoTiles };

    state = place(state, 0, 5, 5);
    state = place(state, 1, 5, 6);
    const result = submitTurn(state, acceptAll);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.detail.completedAllTiles).toBe(true);
    expect(result.state.status).toBe("expired");
    expect(result.state.finalBreakdown).not.toBeNull();
    expect(result.state.rack).toHaveLength(0);
    expect(result.state.bag).toHaveLength(0);
  });

  it("keeps the run alive when the bag empties but rack tiles remain", () => {
    const base = createRushRun("endgame-seed", 1000);
    const threeTiles = base.rack.slice(0, 3).map((tile, rackIndex) => ({
      ...tile,
      letter: tile.value === 0 ? "A" : tile.letter,
      value: tile.value === 0 ? 1 : tile.value,
      rackIndex,
    }));
    let state: RushSnapshot = { ...base, bag: [], rack: threeTiles };

    state = place(state, 0, 5, 5);
    state = place(state, 1, 5, 6);
    const result = submitTurn(state, acceptAll);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // One tile still in hand: the player can keep playing it.
    expect(result.detail.completedAllTiles).toBe(false);
    expect(result.state.status).toBe("active");
    expect(result.state.rack).toHaveLength(1);
  });
});

describe("replayJournal", () => {
  it("replays a 10-minute classic run and rejects it under the mini config", () => {
    const config = { durationSeconds: 600 as const };
    let state = createRushRun("classic-replay-seed", 1000, config);
    expect(state.boardSize).toBe(15);

    // Classic center is (7,7).
    state = place(state, 0, 7, 7);
    state = place(state, 1, 7, 8);
    const submitted = submitTurn(state, acceptAll, 450_000);
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    state = submitted.state;

    // Same duration/mode: exact reconstruction.
    const replay = replayJournal(
      "classic-replay-seed",
      state.journal,
      acceptAll,
      1000,
      config
    );
    expect(replay.ok).toBe(true);
    expect(replay.state?.wordPointsTotal).toBe(state.wordPointsTotal);
    expect(replay.state?.boardSize).toBe(15);

    // Wrong mode mapping (mini): different board/bag — must not validate.
    const crossMode = replayJournal(
      "classic-replay-seed",
      state.journal,
      acceptAll,
      1000,
      { durationSeconds: 300 }
    );
    expect(crossMode.ok).toBe(false);
  });

  it("reconstructs a run after rack shuffle (including duplicate letters)", () => {
    const seed = "dup-test-2";
    let state = createRushRun(seed, 1000);
    state = shuffleRack(state);

    const target = state.rack.find((tile) => tile.id === 4);
    expect(target?.letter).toBe("N");
    const targetIdx = state.rack.indexOf(target!);
    const partnerIdx = state.rack.findIndex(
      (tile, index) => index !== targetIdx && tile.letter === "T"
    );
    expect(partnerIdx).toBeGreaterThanOrEqual(0);

    state = place(state, targetIdx, 5, 5);
    state = place(state, partnerIdx, 5, 6);
    state = submit(state).state;

    const replay = replayJournal(seed, state.journal, acceptAll, 1000);
    expect(replay.ok).toBe(true);
    expect(replay.state?.rack).toEqual(state.rack);
    expect(replay.state?.wordPointsTotal).toBe(state.wordPointsTotal);
  });

  it("reconstructs a multi-turn run (submits + swap) exactly", () => {
    let state = createRushRun("seed-8", 1000);
    state = place(state, 0, 5, 5);
    state = place(state, 1, 5, 6);
    state = submit(state).state;

    const swap = swapTiles(state, [0, 2]);
    expect(swap.ok).toBe(true);
    if (!swap.ok) return;
    state = swap.state;

    state = place(state, 0, 6, 5);
    state = place(state, 1, 7, 5);
    state = submit(state).state;

    const replay = replayJournal("seed-8", state.journal, acceptAll, 1000);
    expect(replay.ok).toBe(true);
    expect(replay.state).not.toBeNull();
    const replayed = replay.state!;
    expect(replayed.wordPointsTotal).toBe(state.wordPointsTotal);
    expect(replayed.swapPenaltyTotal).toBe(state.swapPenaltyTotal);
    expect(replayed.turnCount).toBe(state.turnCount);
    expect(replayed.rack).toEqual(state.rack);
    expect(replayed.bag).toEqual(state.bag);
    expect(replayed.board).toEqual(state.board);
  });

  it("rejects a journal with a tampered score", () => {
    let state = createRushRun("seed-8", 1000);
    state = place(state, 0, 5, 5);
    state = place(state, 1, 5, 6);
    state = submit(state).state;

    const tampered = state.journal.map((entry) =>
      entry.type === "submit" ? { ...entry, turnScore: entry.turnScore + 999 } : entry
    );
    const replay = replayJournal("seed-8", tampered, acceptAll, 1000);
    expect(replay.ok).toBe(false);
    expect(replay.error).toMatch(/score mismatch/i);
  });

  it("rejects a journal with an impossible placement", () => {
    let state = createRushRun("seed-8", 1000);
    state = place(state, 0, 5, 5);
    state = place(state, 1, 5, 6);
    state = submit(state).state;

    const tampered = state.journal.map((entry) =>
      entry.type === "submit"
        ? {
            ...entry,
            placements: entry.placements.map((p) => ({
              ...p,
              rackIndex: 99,
              id: 9999,
              letter: "Q",
              value: 10,
            })),
          }
        : entry
    );
    const replay = replayJournal("seed-8", tampered, acceptAll, 1000);
    expect(replay.ok).toBe(false);
  });
});
