/**
 * Pure, deterministic core for the 5-minute mini Rush run.
 *
 * Every function takes a plain serializable RushSnapshot and returns a new
 * one — no React, no timers, no browser APIs. This keeps the rules unit
 * testable, makes autosave trivial (the state IS the save), and lets a server
 * replay a journal from the seed to recompute an authoritative score.
 */

import {
  BLANK_LETTER,
  createSeededRandom,
  initializeTileBag,
  initializeMiniTileBag,
  shuffleArray,
} from "../shared/bag";
import {
  BOARD_SIZE,
  createEmptyBoard,
  createClassicPremiumSquares,
  createMiniPremiumSquares,
  MINI_BOARD_SIZE,
} from "../shared/premiumSquares";
import {
  buildRushScoreBreakdown,
  CONSISTENCY_BONUS_STEP,
  CONSISTENCY_THRESHOLD,
  TIME_BONUS_PROFILE_CLASSIC,
  TIME_BONUS_PROFILE_MINI,
} from "../shared/scoring";
import { validateSubmitTurn, getPlacedCells } from "../shared/validation";
import {
  buildResolvedSubmitPayload,
  sortRackTilesById,
} from "../shared/turnResolution";
import type {
  BagTile,
  DictionaryLike,
  JournalPlacement,
  RushBoardMode,
  RushScoreBreakdown,
  RushSnapshot,
  Tile,
  ValidationError,
} from "../shared/types";

export const RUSH_SCHEMA_VERSION = 1;
export const RUSH_DURATION_SECONDS = 300;
export const RUSH_DURATION_MS = RUSH_DURATION_SECONDS * 1000;
export const CLASSIC_RUSH_DURATION_SECONDS = 600;
export const CLASSIC_RUSH_DURATION_MS = CLASSIC_RUSH_DURATION_SECONDS * 1000;
export const RUSH_SUBMIT_GRACE_MS = 60 * 1000;
export const RACK_SIZE = 7;

export interface RushRunConfig {
  mode: RushBoardMode;
  durationSeconds: 300 | 600;
}

export const MINI_RUSH_CONFIG: RushRunConfig = {
  mode: "mini",
  durationSeconds: 300,
};

export const CLASSIC_RUSH_CONFIG: RushRunConfig = {
  mode: "classic",
  durationSeconds: 600,
};

export const getRushRunConfig = (
  config?: Partial<RushRunConfig> | null
): RushRunConfig =>
  config?.durationSeconds === CLASSIC_RUSH_DURATION_SECONDS ||
  config?.mode === "classic"
    ? CLASSIC_RUSH_CONFIG
    : MINI_RUSH_CONFIG;

/** Narrow untrusted/persisted duration values to the supported run lengths. */
export const normalizeRushDurationSeconds = (
  durationSeconds: number
): 300 | 600 =>
  durationSeconds === CLASSIC_RUSH_DURATION_SECONDS ? 600 : 300;

export const getRushDurationMs = (stateOrConfig: {
  durationSeconds: number;
}): number => stateOrConfig.durationSeconds * 1000;

export const getRushBonusMode = (state: { boardSize: number }): RushBoardMode =>
  state.boardSize === BOARD_SIZE ? "classic" : "mini";

export type EngineResult<T = undefined> =
  | ({ ok: true; state: RushSnapshot } & (T extends undefined
      ? { detail?: undefined }
      : { detail: T }))
  | { ok: false; error: ValidationError };

const err = (title: string, text: string): { ok: false; error: ValidationError } => ({
  ok: false,
  error: { title, text },
});

const isBlankRackTile = (tile: Tile): boolean =>
  tile.value === 0 && (tile.letter === BLANK_LETTER || tile.letter === "");

const inBounds = (state: RushSnapshot, row: number, col: number): boolean =>
  Number.isInteger(row) &&
  Number.isInteger(col) &&
  row >= 0 &&
  col >= 0 &&
  row < state.boardSize &&
  col < state.boardSize;

/** Rack indices currently occupied by unsubmitted draft tiles on the board. */
export const getUsedRackIndices = (state: RushSnapshot): Set<number> => {
  const used = new Set<number>();
  getPlacedCells(state.board, state.boardSize).forEach(({ row, col }) => {
    const tile = state.board[row][col];
    if (tile && tile.rackIndex !== undefined) {
      used.add(tile.rackIndex);
    }
  });
  return used;
};

export const createRushRun = (
  seed: string,
  startedAtWallMs: number = Date.now(),
  config?: Partial<RushRunConfig> | null
): RushSnapshot => {
  const runConfig = getRushRunConfig(config);
  const random = createSeededRandom(seed);
  const initialBag =
    runConfig.mode === "classic"
      ? initializeTileBag()
      : initializeMiniTileBag(seed);
  const bag = shuffleArray(initialBag, random.next);
  const boardSize = runConfig.mode === "classic" ? BOARD_SIZE : MINI_BOARD_SIZE;

  const rack: Tile[] = [];
  let nextTileId = 0;
  for (let i = 0; i < RACK_SIZE && bag.length > 0; i += 1) {
    const tile = bag.pop()!;
    rack.push({ ...tile, id: nextTileId, rackIndex: i });
    nextTileId += 1;
  }

  return {
    schemaVersion: RUSH_SCHEMA_VERSION,
    seed,
    status: "active",
    boardSize,
    durationSeconds: runConfig.durationSeconds,
    board: createEmptyBoard(boardSize),
    boardAtTurnStart: null,
    premiumSquares:
      runConfig.mode === "classic"
        ? createClassicPremiumSquares()
        : createMiniPremiumSquares(),
    rack,
    bag,
    nextTileId,
    randomState: random.getState(),
    turnCount: 0,
    swapCount: 0,
    wordCount: 0,
    isFirstTurn: true,
    wordPointsTotal: 0,
    swapPenaltyTotal: 0,
    scrabbleBonusTotal: 0,
    consistencyStreak: 0,
    consistencyBonusTotal: 0,
    wordHistory: [],
    journal: [],
    elapsedMs: 0,
    startedAtWallMs,
    eligibility: "local_only",
    runId: null,
    finalBreakdown: null,
  };
};

/** Place a rack tile on an empty cell as a draft (unsubmitted) placement. */
export const placeTile = (
  state: RushSnapshot,
  rackIndex: number,
  row: number,
  col: number,
  chosenLetter: string | null = null
): EngineResult => {
  if (state.status !== "active") return err("Game Over", "The run has ended.");
  if (rackIndex < 0 || rackIndex >= state.rack.length) {
    return err("Invalid Tile", "That rack tile does not exist.");
  }
  if (!inBounds(state, row, col)) {
    return err("Out Of Bounds", "That cell is not on the board.");
  }
  if (state.board[row][col] !== null) {
    return err("Occupied", "That cell already has a tile.");
  }
  if (getUsedRackIndices(state).has(rackIndex)) {
    return err("Tile Already Used", "This tile has already been placed this turn.");
  }

  const tile = state.rack[rackIndex];
  const board = state.board.map((r) => [...r]);

  if (isBlankRackTile(tile)) {
    if (
      !chosenLetter ||
      typeof chosenLetter !== "string" ||
      chosenLetter.length !== 1
    ) {
      return err("Choose A Letter", "Pick a letter for the blank tile.");
    }
    const letter = chosenLetter.toUpperCase();
    if (letter < "A" || letter > "Z") {
      return err("Choose A Letter", "Blank tiles must become a letter A-Z.");
    }
    board[row][col] = {
      letter,
      value: 0,
      isBlank: true,
      rackIndex,
      isFromRack: true,
    };
  } else {
    board[row][col] = {
      ...tile,
      rackIndex,
      isFromRack: true,
    };
  }

  return { ok: true, state: { ...state, board } };
};

/** Move an unsubmitted draft tile to another empty cell. */
export const moveBoardTile = (
  state: RushSnapshot,
  fromRow: number,
  fromCol: number,
  toRow: number,
  toCol: number
): EngineResult => {
  if (state.status !== "active") return err("Game Over", "The run has ended.");
  if (!inBounds(state, fromRow, fromCol) || !inBounds(state, toRow, toCol)) {
    return err("Out Of Bounds", "That cell is not on the board.");
  }
  if (fromRow === toRow && fromCol === toCol) {
    return err("No Move", "The tile is already there.");
  }

  const tile = state.board[fromRow][fromCol];
  if (!tile || !tile.isFromRack || tile.scored) {
    return err("Locked Tile", "Only tiles placed this turn can be moved.");
  }
  if (state.board[toRow][toCol] !== null) {
    return err("Occupied", "That cell already has a tile.");
  }

  const board = state.board.map((r) => [...r]);
  board[fromRow][fromCol] = null;
  board[toRow][toCol] = tile;
  return { ok: true, state: { ...state, board } };
};

/** Return an unsubmitted draft tile from the board to the rack. */
export const removeBoardTile = (
  state: RushSnapshot,
  row: number,
  col: number
): EngineResult => {
  if (!inBounds(state, row, col)) {
    return err("Out Of Bounds", "That cell is not on the board.");
  }
  const tile = state.board[row][col];
  if (!tile) return err("Empty Cell", "There is no tile there.");
  if (tile.scored) return err("Locked Tile", "Scored tiles cannot be removed.");

  const board = state.board.map((r) => [...r]);
  board[row][col] = null;
  return { ok: true, state: { ...state, board } };
};

/** Return every unsubmitted draft tile to the rack. */
export const returnAllDraftTiles = (state: RushSnapshot): RushSnapshot => {
  const placed = getPlacedCells(state.board, state.boardSize);
  if (placed.length === 0) return state;
  const board = state.board.map((r) => [...r]);
  placed.forEach(({ row, col }) => {
    board[row][col] = null;
  });
  return { ...state, board };
};

/**
 * Reorder the rack. Indices are *visible* positions (tiles currently placed on
 * the board as drafts are hidden from the rack), matching the mobile app.
 */
export const reorderRack = (
  state: RushSnapshot,
  fromIndex: number,
  toIndex: number,
  releasedIndex: number | null = null
): RushSnapshot => {
  const usedIndices = getUsedRackIndices(state);
  if (releasedIndex != null) {
    usedIndices.delete(releasedIndex);
  }

  const prev = state.rack;
  const visibleIndices = prev
    .map((_, index) => index)
    .filter((index) => !usedIndices.has(index));
  const fromVisibleIndex = visibleIndices.indexOf(fromIndex);
  const clampedToIndex = Math.max(
    0,
    Math.min(toIndex, visibleIndices.length - 1)
  );
  if (fromVisibleIndex === -1 || fromVisibleIndex === clampedToIndex) {
    return state;
  }

  const reorderedVisibleTiles = visibleIndices.map((index) => prev[index]);
  const [removed] = reorderedVisibleTiles.splice(fromVisibleIndex, 1);
  reorderedVisibleTiles.splice(clampedToIndex, 0, removed);

  const next = [...prev];
  visibleIndices.forEach((index, visibleIndex) => {
    next[index] = reorderedVisibleTiles[visibleIndex];
  });

  // Board draft tiles reference rack tiles by index; remap them so each draft
  // still points at the same tile after the reorder.
  const indexRemap = new Map<number, number>();
  prev.forEach((tile, oldIndex) => {
    const newIndex = next.indexOf(tile);
    indexRemap.set(oldIndex, newIndex);
  });
  const board = state.board.map((r) =>
    r.map((cell) => {
      if (cell && cell.isFromRack && !cell.scored && cell.rackIndex !== undefined) {
        const remapped = indexRemap.get(cell.rackIndex);
        if (remapped !== undefined && remapped !== cell.rackIndex) {
          return { ...cell, rackIndex: remapped };
        }
      }
      return cell;
    })
  );

  return { ...state, rack: next, board };
};

/**
 * Shuffle visible rack tiles without spending a turn or changing score.
 *
 * Purely cosmetic, so it deliberately does NOT touch the seeded RNG:
 * shuffles are not journaled, and burning deterministic RNG state here would
 * desync every subsequent swap draw during server replay (replay_rejected
 * for honest players). Journal placements resolve by tile identity, so rack
 * order itself never matters to validation.
 */
export const shuffleRack = (state: RushSnapshot): RushSnapshot => {
  if (state.status !== "active") return state;
  if (getUsedRackIndices(state).size > 0) return state;
  if (state.rack.length < 2) return state;

  const rack = shuffleArray(state.rack, Math.random).map((tile, rackIndex) => ({
    ...tile,
    rackIndex,
  }));

  return { ...state, rack };
};

export interface SubmitDetail {
  turnScore: number;
  baseWordScore: number;
  scrabbleBonus: number;
  scrabbleBonusType: "classic" | "lite";
  earnedScrabbleBonus: boolean;
  consistencyBonus: number;
  words: string[];
  completedAllTiles: boolean;
}

/** Validate and commit the current draft placements as a turn. */
export const submitTurn = (
  state: RushSnapshot,
  dictionary: DictionaryLike,
  atElapsedMs: number = state.elapsedMs
): EngineResult<SubmitDetail> => {
  if (state.status !== "active") return err("Game Over", "The run has ended.");

  const validation = validateSubmitTurn({
    board: state.board,
    isFirstTurn: state.isFirstTurn,
    boardAtTurnStart: state.boardAtTurnStart,
    dictionary,
    boardSize: state.boardSize,
  });
  if (!validation.ok) return validation;

  const { placedCells, words, newWords } = validation;

  // Record journal placements before the board is resolved. Placements carry
  // the TILE IDENTITY (rack letter + value), not just the rack index: players
  // reorder and shuffle their racks freely and those actions are not
  // journaled, so indices alone cannot survive an honest replay.
  const placements: JournalPlacement[] = placedCells.map(({ row, col }) => {
    const tile = state.board[row][col]!;
    const rackTile =
      tile.rackIndex !== undefined ? state.rack[tile.rackIndex] : undefined;
    const placement: JournalPlacement = {
      row,
      col,
      rackIndex: tile.rackIndex ?? -1,
      // Board tiles keep the stable id from placement; prefer it over rack lookup
      // in case rackIndex and rack order have diverged (shuffle/reorder).
      id: tile.id ?? rackTile?.id,
      letter: tile.isBlank
        ? rackTile?.letter ?? BLANK_LETTER
        : tile.letter ?? rackTile?.letter,
      value: tile.value ?? rackTile?.value,
    };
    if (tile.isBlank) placement.blankLetter = tile.letter;
    return placement;
  });

  const payload = buildResolvedSubmitPayload({
    board: state.board,
    tileRack: state.rack,
    tileBag: state.bag,
    nextTileId: state.nextTileId,
    premiumSquares: state.premiumSquares,
    turnCount: state.turnCount,
    placedCells,
    words,
    newWords,
    bonusMode: getRushBonusMode(state),
  });

  let consistencyStreak = state.consistencyStreak;
  let consistencyBonusTotal = state.consistencyBonusTotal;
  let consistencyBonus = 0;
  if (payload.turnScore >= CONSISTENCY_THRESHOLD) {
    consistencyStreak += 1;
    if (consistencyStreak >= 3) {
      consistencyBonus = CONSISTENCY_BONUS_STEP * (consistencyStreak - 2);
      consistencyBonusTotal += consistencyBonus;
    }
  } else {
    consistencyStreak = 0;
  }

  const nextState: RushSnapshot = {
    ...state,
    board: payload.resolvedBoard,
    boardAtTurnStart: payload.nextBoardAtTurnStart,
    premiumSquares: payload.newPremiumSquares,
    rack: payload.resultingRack,
    bag: payload.nextBag,
    nextTileId: payload.nextTileId,
    turnCount: state.turnCount + 1,
    wordCount: state.wordCount + payload.newWords.length,
    isFirstTurn: false,
    wordPointsTotal: state.wordPointsTotal + payload.baseWordScore,
    scrabbleBonusTotal: state.scrabbleBonusTotal + payload.scrabbleBonus,
    consistencyStreak,
    consistencyBonusTotal,
    wordHistory: [...state.wordHistory, ...payload.newHistory],
    elapsedMs: atElapsedMs,
    journal: [
      ...state.journal,
      {
        type: "submit",
        turn: state.turnCount + 1,
        placements,
        words: payload.newWords.map((w) => w.word.toUpperCase()),
        turnScore: payload.turnScore,
        atElapsedMs,
      },
    ],
  };

  const completedAllTiles =
    payload.nextTilesRemaining === 0 && payload.resultingRack.length === 0;

  const finalState = completedAllTiles
    ? finishRun(nextState, atElapsedMs)
    : nextState;

  return {
    ok: true,
    state: finalState,
    detail: {
      turnScore: payload.turnScore,
      baseWordScore: payload.baseWordScore,
      scrabbleBonus: payload.scrabbleBonus,
      scrabbleBonusType: payload.scrabbleBonusType,
      earnedScrabbleBonus: payload.earnedScrabbleBonus,
      consistencyBonus,
      words: payload.newWords.map((w) => w.word.toUpperCase()),
      completedAllTiles,
    },
  };
};

export interface SwapDetail {
  penalty: number;
  swappedCount: number;
}

/**
 * Swap rack tiles (by rack index) for new tiles from the bag. Draft tiles are
 * returned to the rack first. Penalty = swapped tile values x (swapCount + 1).
 */
export const swapTiles = (
  state: RushSnapshot,
  rackIndices: number[],
  atElapsedMs: number = state.elapsedMs
): EngineResult<SwapDetail> => {
  if (state.status !== "active") return err("Game Over", "The run has ended.");

  const cleared = returnAllDraftTiles(state);
  const bagLen = cleared.bag.length;

  if (rackIndices.length === 0) {
    return err("Swap Tiles", "Select at least one tile to swap.");
  }
  if (bagLen === 0) {
    return err("Swap Tiles", "The bag is empty.");
  }

  const validIndices = [...new Set(rackIndices)]
    .filter((i) => i >= 0 && i < cleared.rack.length)
    .sort((a, b) => a - b);
  if (validIndices.length === 0) {
    return err("Swap Tiles", "Select at least one tile to swap.");
  }

  const swapTileCount = Math.min(validIndices.length, bagLen);
  const indicesToRemove = validIndices.slice(0, swapTileCount);
  const removedTiles = indicesToRemove.map((rackIndex) => cleared.rack[rackIndex]);
  const returnedTiles: BagTile[] = removedTiles.map((tile) => ({
    letter: tile.letter,
    value: tile.value,
  }));

  const random = createSeededRandom(cleared.seed, cleared.randomState);
  const nextBag = shuffleArray([...cleared.bag, ...returnedTiles], random.next);

  const drawnTiles: Tile[] = [];
  let nextTileId = cleared.nextTileId;
  for (let i = 0; i < swapTileCount; i += 1) {
    const tile = nextBag.pop();
    if (!tile) break;
    drawnTiles.push({ ...tile, id: nextTileId });
    nextTileId += 1;
  }

  const remainingRack = sortRackTilesById(
    cleared.rack.filter((tile) => !removedTiles.some((removed) => removed.id === tile.id))
  );
  const resultingRack = [...remainingRack, ...drawnTiles].map(
    (tile, rackIndex) => ({ ...tile, rackIndex })
  );

  const multiplier = cleared.swapCount + 1;
  const baseScorePenalty = removedTiles.reduce(
    (sum, tile) => sum + (tile?.value ?? 0),
    0
  );
  const scorePenalty = baseScorePenalty * multiplier;

  const nextState: RushSnapshot = {
    ...cleared,
    rack: resultingRack,
    bag: nextBag,
    nextTileId,
    randomState: random.getState(),
    swapCount: cleared.swapCount + 1,
    turnCount: cleared.turnCount + 1,
    swapPenaltyTotal: cleared.swapPenaltyTotal + scorePenalty,
    consistencyStreak: 0,
    elapsedMs: atElapsedMs,
    journal: [
      ...cleared.journal,
      {
        type: "swap",
        turn: cleared.turnCount + 1,
        rackIndices: indicesToRemove,
        // Identities survive rack reorders/shuffles; replay prefers these.
        tiles: removedTiles.map((tile) => ({
          id: tile.id,
          letter: tile.letter,
          value: tile.value,
        })),
        penalty: scorePenalty,
        atElapsedMs,
      },
    ],
  };

  return {
    ok: true,
    state: nextState,
    detail: { penalty: scorePenalty, swappedCount: swapTileCount },
  };
};

export const buildCurrentBreakdown = (
  state: RushSnapshot,
  durationMs: number | null = null
): RushScoreBreakdown =>
  buildRushScoreBreakdown({
    wordPointsTotal: state.wordPointsTotal,
    swapPenaltyTotal: state.swapPenaltyTotal,
    scrabbleBonusTotal: state.scrabbleBonusTotal,
    turnCount: state.turnCount,
    rackTiles: state.rack,
    durationMs,
    wordHistory: state.wordHistory,
    comboBonusTotal: state.consistencyBonusTotal,
    timeBonusProfile:
      getRushBonusMode(state) === "classic"
        ? TIME_BONUS_PROFILE_CLASSIC
        : TIME_BONUS_PROFILE_MINI,
  });

/** Current running score shown in the HUD (before end-of-run breakdown). */
export const getRunningScore = (state: RushSnapshot): number =>
  state.wordPointsTotal + state.scrabbleBonusTotal - state.swapPenaltyTotal;

/** Finish the run: return drafts, compute the final breakdown, mark expired. */
export const finishRun = (
  state: RushSnapshot,
  atElapsedMs: number = state.elapsedMs
): RushSnapshot => {
  if (state.status !== "active") return state;
  const cleared = returnAllDraftTiles(state);
  const elapsedMs = Math.min(atElapsedMs, getRushDurationMs(state));
  const breakdown = buildCurrentBreakdown(cleared, elapsedMs);
  return {
    ...cleared,
    status: "expired",
    elapsedMs,
    finalBreakdown: breakdown,
  };
};

/** Timer hit 0:00. */
export const expireRun = (state: RushSnapshot): RushSnapshot =>
  finishRun(state, getRushDurationMs(state));

export interface ReplayResult {
  ok: boolean;
  state: RushSnapshot | null;
  error: string | null;
}

/**
 * Rebuild a run from its seed and journal. Used to validate autosaves and, in
 * the future, by the server to recompute an authoritative score.
 */
/** Does this rack tile match a journaled tile identity? */
const matchesIdentity = (
  tile: Tile,
  letter: string,
  value: number
): boolean => {
  if (value === 0 && tile.value === 0) {
    // Blanks: the rack letter may be " " or "" depending on source.
    const identBlank = letter === BLANK_LETTER || letter === "";
    if (identBlank && isBlankRackTile(tile)) return true;
  }
  return tile.letter === letter && tile.value === value;
};

/**
 * Resolve a journaled tile to a current rack index. Prefers stable tile id,
 * then letter + value (ambiguous when duplicates are in the rack), then the
 * recorded index for journals written before identities were recorded.
 */
export const resolveRackIndex = (
  state: RushSnapshot,
  ident: {
    id?: string | number;
    letter?: string;
    value?: number;
    rackIndex?: number;
  },
  used: Set<number>
): number => {
  if (ident.id !== undefined) {
    for (let i = 0; i < state.rack.length; i += 1) {
      if (!used.has(i) && state.rack[i].id === ident.id) {
        return i;
      }
    }
    return -1;
  }
  if (ident.letter !== undefined && ident.value !== undefined) {
    for (let i = 0; i < state.rack.length; i += 1) {
      if (!used.has(i) && matchesIdentity(state.rack[i], ident.letter, ident.value)) {
        return i;
      }
    }
    return -1;
  }
  return ident.rackIndex ?? -1;
};

export const replayJournal = (
  seed: string,
  journal: RushSnapshot["journal"],
  dictionary: DictionaryLike,
  startedAtWallMs?: number,
  config?: Partial<RushRunConfig> | null
): ReplayResult => {
  let state = createRushRun(seed, startedAtWallMs ?? Date.now(), config);

  for (const entry of journal) {
    if (entry.type === "submit") {
      for (const placement of entry.placements) {
        const rackIndex = resolveRackIndex(
          state,
          placement,
          getUsedRackIndices(state)
        );
        if (rackIndex < 0) {
          return {
            ok: false,
            state: null,
            error: `Replay placement failed on turn ${entry.turn}: no matching rack tile`,
          };
        }
        const placed = placeTile(
          state,
          rackIndex,
          placement.row,
          placement.col,
          placement.blankLetter ?? null
        );
        if (!placed.ok) {
          return {
            ok: false,
            state: null,
            error: `Replay placement failed on turn ${entry.turn}: ${placed.error.text}`,
          };
        }
        state = placed.state;
      }
      const submitted = submitTurn(state, dictionary, entry.atElapsedMs);
      if (!submitted.ok) {
        return {
          ok: false,
          state: null,
          error: `Replay submit failed on turn ${entry.turn}: ${submitted.error.text}`,
        };
      }
      if (submitted.detail.turnScore !== entry.turnScore) {
        return {
          ok: false,
          state: null,
          error: `Replay score mismatch on turn ${entry.turn}: expected ${entry.turnScore}, got ${submitted.detail.turnScore}`,
        };
      }
      state = submitted.state;
    } else if (entry.type === "swap") {
      // Resolve swapped tiles by identity (order-independent); fall back to
      // the raw indices for journals written before identities were recorded.
      let swapIndices = entry.rackIndices;
      if (Array.isArray(entry.tiles) && entry.tiles.length > 0) {
        const used = new Set<number>();
        const resolved: number[] = [];
        for (const ident of entry.tiles) {
          const index = resolveRackIndex(state, ident, used);
          if (index < 0) {
            return {
              ok: false,
              state: null,
              error: `Replay swap failed on turn ${entry.turn}: no matching rack tile`,
            };
          }
          used.add(index);
          resolved.push(index);
        }
        swapIndices = resolved;
      }
      const swapped = swapTiles(state, swapIndices, entry.atElapsedMs);
      if (!swapped.ok) {
        return {
          ok: false,
          state: null,
          error: `Replay swap failed on turn ${entry.turn}: ${swapped.error.text}`,
        };
      }
      if (swapped.detail.penalty !== entry.penalty) {
        return {
          ok: false,
          state: null,
          error: `Replay swap penalty mismatch on turn ${entry.turn}`,
        };
      }
      state = swapped.state;
    }
  }

  return { ok: true, state, error: null };
};

/**
 * Rebuild rack/bag/RNG from the journal so resumed autosaves cannot carry a
 * corrupted randomState from pre-fix cosmetic shuffles.
 */
export const reconcileSnapshotFromJournal = (
  snapshot: RushSnapshot,
  dictionary: DictionaryLike
): RushSnapshot | null => {
  if (snapshot.journal.length === 0) return snapshot;
  const replay = replayJournal(
    snapshot.seed,
    snapshot.journal,
    dictionary,
    snapshot.startedAtWallMs,
    { durationSeconds: normalizeRushDurationSeconds(snapshot.durationSeconds) }
  );
  if (!replay.ok || !replay.state) return null;
  return {
    ...replay.state,
    runId: snapshot.runId,
    eligibility: snapshot.eligibility,
    elapsedMs: snapshot.elapsedMs,
    startedAtWallMs: snapshot.startedAtWallMs,
    status: snapshot.status,
    finalBreakdown: snapshot.finalBreakdown,
  };
};
