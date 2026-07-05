import { SCRABBLE_BONUS } from "./premiumSquares";
import type {
  BoardCell,
  CellCoord,
  PremiumSquares,
  RushScoreBreakdown,
  WordHistoryEntry,
  WordOnBoard,
} from "./types";

const SCRABBLE_LITE_BONUS = 20;
const TIME_BONUS_UNDER_40_MIN = 15;
const TIME_BONUS_UNDER_60_MIN = 10;
const TIME_BONUS_UNDER_90_MIN = 5;
const TIME_BONUS_UNDER_10_MIN = 15;
const TIME_BONUS_UNDER_20_MIN = 10;
const TIME_BONUS_UNDER_30_MIN = 5;
export const CONSISTENCY_THRESHOLD = 20;
export const CONSISTENCY_BONUS_STEP = 2;

export const TIME_BONUS_PROFILE_CLASSIC = "classic";
export const TIME_BONUS_PROFILE_MINI = "mini";

export type TimeBonusProfile =
  | typeof TIME_BONUS_PROFILE_CLASSIC
  | typeof TIME_BONUS_PROFILE_MINI;

export type BonusMode = "classic" | "mini";

export const calculateWordScore = ({
  board,
  wordData,
  premiumSquares,
}: {
  board: BoardCell[][];
  wordData: WordOnBoard;
  premiumSquares: PremiumSquares;
}): number => {
  let score = 0;
  let wordMultiplier = 1;

  wordData.cells.forEach(({ row, col }) => {
    const tile = board[row][col];
    if (!tile) return;

    const premium = premiumSquares[`${row},${col}`];

    if (premium === "dw" || premium === "center") {
      wordMultiplier *= 2;
    } else if (premium === "tw") {
      wordMultiplier *= 3;
    }

    if (tile.isBlank) {
      score += 0;
      return;
    }

    let tileMultiplier = 1;
    if (premium === "dl") tileMultiplier = 2;
    else if (premium === "tl") tileMultiplier = 3;
    score += tile.value * tileMultiplier;
  });

  return score * wordMultiplier;
};

export interface SubmittedWordsScore {
  baseWordScore: number;
  turnScore: number;
  earnedScrabbleBonus: boolean;
  scrabbleBonus: number;
  scrabbleBonusLabel: string;
  scrabbleBonusType: "classic" | "lite";
  newHistory: WordHistoryEntry[];
}

export const scoreSubmittedWords = ({
  board,
  newWords,
  premiumSquares,
  turnCount,
  placedCells,
  bonusMode = "classic",
}: {
  board: BoardCell[][];
  newWords: WordOnBoard[];
  premiumSquares: PremiumSquares;
  turnCount: number;
  placedCells: CellCoord[];
  bonusMode?: BonusMode;
}): SubmittedWordsScore => {
  let baseWordScore = 0;
  const newHistory: WordHistoryEntry[] = newWords.map((wordData) => {
    const score = calculateWordScore({ board, wordData, premiumSquares });
    baseWordScore += score;
    return {
      word: wordData.word.toUpperCase(),
      score,
      turn: turnCount + 1,
    };
  });

  const isMiniBonusMode = bonusMode === "mini";
  const placedTileCount = placedCells.length;
  let scrabbleBonus = 0;
  let scrabbleBonusLabel = "SCRABBLE BONUS";
  let scrabbleBonusType: "classic" | "lite" = "classic";

  if (isMiniBonusMode) {
    if (placedTileCount >= 7) {
      scrabbleBonus = SCRABBLE_BONUS;
      scrabbleBonusLabel = "SCRABBLE BONUS";
      scrabbleBonusType = "classic";
    } else if (placedTileCount === 6) {
      scrabbleBonus = SCRABBLE_LITE_BONUS;
      scrabbleBonusLabel = "SCRABBLE MINI BONUS";
      scrabbleBonusType = "lite";
    }
  } else if (placedTileCount >= 7) {
    scrabbleBonus = SCRABBLE_BONUS;
    scrabbleBonusLabel = "SCRABBLE BONUS";
    scrabbleBonusType = "classic";
  }

  const earnedScrabbleBonus = scrabbleBonus > 0;

  if (earnedScrabbleBonus) {
    newHistory.push({
      word: scrabbleBonusLabel,
      score: scrabbleBonus,
      turn: turnCount + 1,
    });
  }

  return {
    baseWordScore,
    turnScore: baseWordScore + scrabbleBonus,
    earnedScrabbleBonus,
    scrabbleBonus,
    scrabbleBonusLabel,
    scrabbleBonusType,
    newHistory,
  };
};

export const calculateTimeBonus = (
  durationMs: number | null | undefined,
  profile: TimeBonusProfile = TIME_BONUS_PROFILE_CLASSIC
): number => {
  if (typeof durationMs !== "number" || durationMs < 0) {
    return 0;
  }

  const elapsedMinutes = durationMs / (60 * 1000);
  if (profile === TIME_BONUS_PROFILE_MINI) {
    if (elapsedMinutes < 10) return TIME_BONUS_UNDER_10_MIN;
    if (elapsedMinutes < 20) return TIME_BONUS_UNDER_20_MIN;
    if (elapsedMinutes < 30) return TIME_BONUS_UNDER_30_MIN;
    return 0;
  }

  if (elapsedMinutes < 40) return TIME_BONUS_UNDER_40_MIN;
  if (elapsedMinutes < 60) return TIME_BONUS_UNDER_60_MIN;
  if (elapsedMinutes < 90) return TIME_BONUS_UNDER_90_MIN;
  return 0;
};

export const calculateConsistencyBonusTotal = ({
  wordHistory = [],
  turnCount = 0,
}: {
  wordHistory?: WordHistoryEntry[];
  turnCount?: number;
}): number => {
  if (!Array.isArray(wordHistory) || turnCount <= 0) {
    return 0;
  }

  const turnScores = new Map<number, number>();
  wordHistory.forEach((entry) => {
    const turn = entry?.turn;
    const score = entry?.score ?? 0;
    if (typeof turn !== "number" || !Number.isFinite(turn)) return;
    turnScores.set(turn, (turnScores.get(turn) ?? 0) + score);
  });

  let streak = 0;
  let bonusTotal = 0;

  for (let turn = 1; turn <= turnCount; turn += 1) {
    const turnScore = turnScores.get(turn) ?? 0;
    if (turnScore < CONSISTENCY_THRESHOLD) {
      streak = 0;
      continue;
    }

    streak += 1;
    if (streak >= 3) {
      bonusTotal += CONSISTENCY_BONUS_STEP * (streak - 2);
    }
  }

  return bonusTotal;
};

export interface FinalScoreBreakdownOptions {
  wordPointsTotal: number;
  swapPenaltyTotal: number;
  scrabbleBonusTotal: number;
  turnCount: number;
  rackTiles: Array<{ value?: number } | null | undefined>;
  durationMs?: number | null;
  wordHistory?: WordHistoryEntry[];
  comboBonusTotal?: number | null;
  timeBonusProfile?: TimeBonusProfile;
  includeTurnPenalty?: boolean;
  includeRackPenalty?: boolean;
  includeTimeBonus?: boolean;
}

export const buildFinalScoreBreakdown = ({
  wordPointsTotal,
  swapPenaltyTotal,
  scrabbleBonusTotal,
  turnCount,
  rackTiles,
  durationMs = null,
  wordHistory = [],
  comboBonusTotal = null,
  timeBonusProfile = TIME_BONUS_PROFILE_CLASSIC,
  includeTurnPenalty = true,
  includeRackPenalty = true,
  includeTimeBonus = true,
}: FinalScoreBreakdownOptions): RushScoreBreakdown => {
  const turnPenalties = includeTurnPenalty ? turnCount * 2 : 0;
  const rackPenalty = includeRackPenalty
    ? rackTiles.reduce((sum, tile) => sum + (tile?.value ?? 0), 0)
    : 0;
  const timeBonus = includeTimeBonus
    ? calculateTimeBonus(durationMs, timeBonusProfile)
    : 0;
  const consistencyBonusTotal =
    typeof comboBonusTotal === "number"
      ? comboBonusTotal
      : calculateConsistencyBonusTotal({ wordHistory, turnCount });
  const skillBonusTotal =
    scrabbleBonusTotal + timeBonus + consistencyBonusTotal;
  const finalScore =
    wordPointsTotal -
    swapPenaltyTotal -
    turnPenalties -
    rackPenalty +
    scrabbleBonusTotal +
    timeBonus +
    consistencyBonusTotal;

  return {
    pointsEarned: wordPointsTotal,
    swapPenalties: swapPenaltyTotal,
    turnPenalties,
    rackPenalty,
    scrabbleBonus: scrabbleBonusTotal,
    timeBonus,
    consistencyBonusTotal,
    durationSeconds:
      typeof durationMs === "number" && durationMs >= 0
        ? Math.floor(durationMs / 1000)
        : null,
    skillBonusTotal,
    finalScore,
  };
};

export const SPRINT_TARGET_SCORE = 200;

export const buildSprintScoreBreakdown = (
  options: FinalScoreBreakdownOptions
): RushScoreBreakdown =>
  buildFinalScoreBreakdown({
    ...options,
    includeTurnPenalty: false,
    includeRackPenalty: false,
    includeTimeBonus: false,
  });

export const buildRushScoreBreakdown = (
  options: FinalScoreBreakdownOptions
): RushScoreBreakdown =>
  buildFinalScoreBreakdown({
    ...options,
    includeTurnPenalty: true,
    includeRackPenalty: false,
    includeTimeBonus: false,
  });

interface SprintResultLike {
  turnCount?: number;
  turn_count?: number;
  durationSeconds?: number;
  duration_seconds?: number;
}

interface RushResultLike {
  finalScore?: number;
  final_score?: number;
}

export const compareSprintResults = (
  left: SprintResultLike | null | undefined,
  right: SprintResultLike | null | undefined
): number => {
  const leftTurns = left?.turnCount ?? left?.turn_count;
  const rightTurns = right?.turnCount ?? right?.turn_count;
  if (leftTurns !== rightTurns) {
    return (leftTurns ?? Infinity) < (rightTurns ?? Infinity) ? -1 : 1;
  }

  const leftDuration = left?.durationSeconds ?? left?.duration_seconds;
  const rightDuration = right?.durationSeconds ?? right?.duration_seconds;
  if (leftDuration !== rightDuration) {
    return (leftDuration ?? Infinity) < (rightDuration ?? Infinity) ? -1 : 1;
  }

  return 0;
};

export const isBetterSprintResult = (
  candidate: SprintResultLike,
  existing: SprintResultLike | null | undefined
): boolean => {
  if (!existing) return true;
  return compareSprintResults(candidate, existing) < 0;
};

export const isBetterRushResult = (
  candidate: RushResultLike | null | undefined,
  existing: RushResultLike | null | undefined
): boolean => {
  if (!existing) return true;
  return (
    (candidate?.finalScore ?? candidate?.final_score ?? -Infinity) >
    (existing?.finalScore ?? existing?.final_score ?? -Infinity)
  );
};
