/**
 * Shared domain types for the FWWweb 5-minute mini Rush game.
 *
 * These mirror the data shapes used by the React Native engine so ported
 * modules stay behavior-equivalent. All shapes are plain JSON-serializable
 * data so they can be persisted (autosave) and replayed (server validation).
 */

/** A tile still in the bag: no identity yet, just letter + value. */
export interface BagTile {
  letter: string;
  value: number;
}

/** A tile that has been drawn and given a stable identity. */
export interface Tile extends BagTile {
  id: string | number;
  /** Position within the rack array; assigned when racks are rebuilt. */
  rackIndex?: number;
}

/** A tile occupying a board cell. */
export interface BoardTile {
  id?: string | number;
  letter: string;
  value: number;
  /** True when this tile was a blank and `letter` is the chosen letter. */
  isBlank?: boolean;
  /** True when placed from the rack (as opposed to a resolved historical tile). */
  isFromRack?: boolean;
  /** True once the tile has been scored by a committed submit. */
  scored?: boolean;
  /** The rack index the tile came from, while it is an unsubmitted draft. */
  rackIndex?: number;
}

export type BoardCell = BoardTile | null;

/** An 11x11 (mini) board. Row-major: board[row][col]. */
export type MiniBoard = BoardCell[][];

export type PremiumSquareType = "tw" | "dw" | "tl" | "dl" | "center";

/** Keyed by "row,col". Premium squares are consumed once used. */
export type PremiumSquares = Record<string, PremiumSquareType>;

export interface CellCoord {
  row: number;
  col: number;
}

export interface WordOnBoard {
  word: string;
  cells: CellCoord[];
  direction: "horizontal" | "vertical";
}

export interface WordHistoryEntry {
  word: string;
  score: number;
  turn: number;
}

export interface ValidationError {
  title: string;
  text: string;
}

export type SubmitValidationResult =
  | { ok: false; error: ValidationError }
  | {
      ok: true;
      placedCells: CellCoord[];
      words: WordOnBoard[];
      newWords: WordOnBoard[];
    };

/** Minimal dictionary interface the validators depend on. */
export interface DictionaryLike {
  isValid(word: string): boolean;
}

/** Result of buildRushScoreBreakdown / buildFinalScoreBreakdown. */
export interface RushScoreBreakdown {
  pointsEarned: number;
  swapPenalties: number;
  turnPenalties: number;
  rackPenalty: number;
  scrabbleBonus: number;
  timeBonus: number;
  consistencyBonusTotal: number;
  durationSeconds: number | null;
  skillBonusTotal: number;
  finalScore: number;
}

/** One draft tile placement, as recorded in the replay journal. */
export interface JournalPlacement {
  row: number;
  col: number;
  rackIndex: number;
  /** Only present for blank tiles: the letter the player assigned. */
  blankLetter?: string;
}

/**
 * Replayable journal entry. Given the run seed and the ordered journal, the
 * entire run (bag draws, swaps, scores) can be reconstructed deterministically.
 */
export type RushTurnEntry =
  | {
      type: "submit";
      turn: number;
      placements: JournalPlacement[];
      words: string[];
      turnScore: number;
      atElapsedMs: number;
    }
  | {
      type: "swap";
      turn: number;
      rackIndices: number[];
      penalty: number;
      atElapsedMs: number;
    };

export type RushRunStatus = "active" | "expired";

/** Public-leaderboard eligibility for a run. */
export type RushRunEligibility = "pending_server" | "eligible" | "local_only";

/**
 * Complete serializable state of a Rush run after the last committed event.
 * Draft (unsubmitted) placements live on the board separately and are not part
 * of the stable snapshot.
 */
export interface RushSnapshot {
  schemaVersion: number;
  seed: string;
  status: RushRunStatus;
  boardSize: number;
  durationSeconds: number;
  board: MiniBoard;
  boardAtTurnStart: boolean[][] | null;
  premiumSquares: PremiumSquares;
  rack: Tile[];
  bag: BagTile[];
  nextTileId: number;
  randomState: number;
  turnCount: number;
  swapCount: number;
  wordCount: number;
  isFirstTurn: boolean;
  wordPointsTotal: number;
  swapPenaltyTotal: number;
  scrabbleBonusTotal: number;
  consistencyStreak: number;
  consistencyBonusTotal: number;
  wordHistory: WordHistoryEntry[];
  journal: RushTurnEntry[];
  /** Active play time consumed so far, in ms (clock pauses while page closed). */
  elapsedMs: number;
  /** Wall-clock ms when the run was created (leaderboard deadline anchor). */
  startedAtWallMs: number;
  eligibility: RushRunEligibility;
  /** Server-issued run id once the hardened path exists; null for local runs. */
  runId: string | null;
  finalBreakdown: RushScoreBreakdown | null;
}
