/**
 * Versioned localStorage autosave for the Rush run.
 *
 * Layout under `fwwweb.rush.autosave.v1`:
 * - `stable`: the full RushSnapshot after the last committed submit/swap
 * - `draft`: placed-but-unsubmitted tile placements (replayed on restore)
 * - `savedAtMs` + `schemaVersion` for validation
 *
 * All loading is defensive: local storage is untrusted input. A corrupt draft
 * falls back to the stable snapshot; a corrupt stable snapshot is discarded.
 */

import { placeTile, RUSH_SCHEMA_VERSION } from "./rushEngine";
import type {
  JournalPlacement,
  RushSnapshot,
} from "../shared/types";

export const AUTOSAVE_KEY = "fwwweb.rush.autosave.v1";

export interface AutosavePayload {
  schemaVersion: number;
  savedAtMs: number;
  stable: RushSnapshot;
  draft: JournalPlacement[] | null;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const defaultStorage = (): StorageLike | null => {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* storage disabled */
  }
  return null;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isCellArray = (board: unknown, size: number): boolean =>
  Array.isArray(board) &&
  board.length === size &&
  board.every(
    (row) =>
      Array.isArray(row) &&
      row.length === size &&
      row.every(
        (cell) =>
          cell === null ||
          (typeof cell === "object" &&
            cell !== null &&
            typeof (cell as { letter?: unknown }).letter === "string" &&
            isFiniteNumber((cell as { value?: unknown }).value))
      )
  );

const isTileArray = (tiles: unknown): boolean =>
  Array.isArray(tiles) &&
  tiles.every(
    (tile) =>
      typeof tile === "object" &&
      tile !== null &&
      typeof (tile as { letter?: unknown }).letter === "string" &&
      isFiniteNumber((tile as { value?: unknown }).value)
  );

const isJournalShape = (journal: unknown): boolean =>
  Array.isArray(journal) &&
  journal.every((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const e = entry as Record<string, unknown>;
    if (e.type === "submit") {
      return Array.isArray(e.placements) && isFiniteNumber(e.turnScore);
    }
    if (e.type === "swap") {
      return Array.isArray(e.rackIndices) && isFiniteNumber(e.penalty);
    }
    return false;
  });

/** Structural validation of a persisted snapshot. Never throws. */
export const isValidSnapshot = (value: unknown): value is RushSnapshot => {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  const boardSize = s.durationSeconds === 600 ? 15 : 11;
  const durationSeconds = s.boardSize === 15 ? 600 : 300;

  return (
    s.schemaVersion === RUSH_SCHEMA_VERSION &&
    typeof s.seed === "string" &&
    s.seed.length > 0 &&
    (s.status === "active" || s.status === "expired") &&
    s.boardSize === boardSize &&
    s.durationSeconds === durationSeconds &&
    isCellArray(s.board, boardSize) &&
    (s.boardAtTurnStart === null || Array.isArray(s.boardAtTurnStart)) &&
    typeof s.premiumSquares === "object" &&
    s.premiumSquares !== null &&
    isTileArray(s.rack) &&
    (s.rack as unknown[]).length <= 7 &&
    isTileArray(s.bag) &&
    isFiniteNumber(s.nextTileId) &&
    isFiniteNumber(s.randomState) &&
    isFiniteNumber(s.turnCount) &&
    isFiniteNumber(s.swapCount) &&
    typeof s.isFirstTurn === "boolean" &&
    isFiniteNumber(s.wordPointsTotal) &&
    isFiniteNumber(s.swapPenaltyTotal) &&
    isFiniteNumber(s.scrabbleBonusTotal) &&
    isFiniteNumber(s.consistencyStreak) &&
    isFiniteNumber(s.consistencyBonusTotal) &&
    Array.isArray(s.wordHistory) &&
    isJournalShape(s.journal) &&
    isFiniteNumber(s.elapsedMs) &&
    s.elapsedMs >= 0 &&
    s.elapsedMs <= durationSeconds * 1000 &&
    isFiniteNumber(s.startedAtWallMs)
  );
};

/** Extract the current draft placements from a live state vs its stable base. */
export const extractDraftPlacements = (
  state: RushSnapshot
): JournalPlacement[] => {
  const placements: JournalPlacement[] = [];
  for (let row = 0; row < state.boardSize; row += 1) {
    for (let col = 0; col < state.boardSize; col += 1) {
      const tile = state.board[row][col];
      if (tile && tile.isFromRack && !tile.scored && tile.rackIndex !== undefined) {
        const placement: JournalPlacement = { row, col, rackIndex: tile.rackIndex };
        if (tile.isBlank) placement.blankLetter = tile.letter;
        placements.push(placement);
      }
    }
  }
  return placements;
};

/** Stable snapshot = live state minus draft placements. */
export const toStableSnapshot = (state: RushSnapshot): RushSnapshot => {
  const board = state.board.map((row) =>
    row.map((cell) => (cell && cell.isFromRack && !cell.scored ? null : cell))
  );
  return { ...state, board };
};

export const saveAutosave = (
  state: RushSnapshot,
  storage: StorageLike | null = defaultStorage()
): boolean => {
  if (!storage) return false;
  try {
    const payload: AutosavePayload = {
      schemaVersion: RUSH_SCHEMA_VERSION,
      savedAtMs: Date.now(),
      stable: toStableSnapshot(state),
      draft: extractDraftPlacements(state),
    };
    storage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
};

export interface RestoredAutosave {
  state: RushSnapshot;
  savedAtMs: number;
  draftRestored: boolean;
  draftDiscarded: boolean;
}

/**
 * Load and validate the autosave. Returns null when missing or unusable.
 * Restores valid draft placements; falls back to the stable snapshot when the
 * draft is invalid. Never throws on corrupt input.
 */
export const loadAutosave = (
  storage: StorageLike | null = defaultStorage()
): RestoredAutosave | null => {
  if (!storage) return null;

  let raw: string | null = null;
  try {
    raw = storage.getItem(AUTOSAVE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const payload = JSON.parse(raw) as Partial<AutosavePayload>;
    if (payload.schemaVersion !== RUSH_SCHEMA_VERSION) return null;
    if (!isValidSnapshot(payload.stable)) return null;

    const stable = payload.stable;
    const savedAtMs = isFiniteNumber(payload.savedAtMs)
      ? payload.savedAtMs
      : Date.now();

    let state = stable;
    let draftRestored = false;
    let draftDiscarded = false;

    if (Array.isArray(payload.draft) && payload.draft.length > 0) {
      let draftState = stable;
      let draftOk = true;
      for (const placement of payload.draft) {
        if (
          typeof placement !== "object" ||
          placement === null ||
          !isFiniteNumber(placement.row) ||
          !isFiniteNumber(placement.col) ||
          !isFiniteNumber(placement.rackIndex)
        ) {
          draftOk = false;
          break;
        }
        const placed = placeTile(
          draftState,
          placement.rackIndex,
          placement.row,
          placement.col,
          placement.blankLetter ?? null
        );
        if (!placed.ok) {
          draftOk = false;
          break;
        }
        draftState = placed.state;
      }
      if (draftOk) {
        state = draftState;
        draftRestored = true;
      } else {
        draftDiscarded = true;
      }
    }

    return { state, savedAtMs, draftRestored, draftDiscarded };
  } catch {
    return null;
  }
};

export const clearAutosave = (
  storage: StorageLike | null = defaultStorage()
): void => {
  try {
    storage?.removeItem(AUTOSAVE_KEY);
  } catch {
    /* ignore */
  }
};
