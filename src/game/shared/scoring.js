import { SCRABBLE_BONUS } from "./premiumSquares";

const SCRABBLE_LITE_BONUS = 20;
const TIME_BONUS_UNDER_40_MIN = 15;
const TIME_BONUS_UNDER_60_MIN = 10;
const TIME_BONUS_UNDER_90_MIN = 5;
const TIME_BONUS_UNDER_10_MIN = 15;
const TIME_BONUS_UNDER_20_MIN = 10;
const TIME_BONUS_UNDER_30_MIN = 5;
const CONSISTENCY_THRESHOLD = 20;
const CONSISTENCY_BONUS_STEP = 2;

export const TIME_BONUS_PROFILE_CLASSIC = "classic";
export const TIME_BONUS_PROFILE_MINI = "mini";

export const calculateWordScore = ({ board, wordData, premiumSquares }) => {
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

export const scoreSubmittedWords = ({
  board,
  newWords,
  premiumSquares,
  turnCount,
  placedCells,
  bonusMode = "classic",
}) => {
  let baseWordScore = 0;
  const newHistory = newWords.map((wordData) => {
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
  let scrabbleBonusType = "classic";

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
  durationMs,
  profile = TIME_BONUS_PROFILE_CLASSIC
) => {
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
}) => {
  if (!Array.isArray(wordHistory) || turnCount <= 0) {
    return 0;
  }

  const turnScores = new Map();
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
}) => {
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

export const buildSprintScoreBreakdown = (options) =>
  buildFinalScoreBreakdown({
    ...options,
    includeTurnPenalty: false,
    includeRackPenalty: false,
    includeTimeBonus: false,
  });

export const buildRushScoreBreakdown = (options) =>
  buildFinalScoreBreakdown({
    ...options,
    includeTurnPenalty: true,
    includeRackPenalty: false,
    includeTimeBonus: false,
  });

export const compareSprintResults = (left, right) => {
  const leftTurns = left?.turnCount ?? left?.turn_count;
  const rightTurns = right?.turnCount ?? right?.turn_count;
  if (leftTurns !== rightTurns) {
    return leftTurns < rightTurns ? -1 : 1;
  }

  const leftDuration = left?.durationSeconds ?? left?.duration_seconds;
  const rightDuration = right?.durationSeconds ?? right?.duration_seconds;
  if (leftDuration !== rightDuration) {
    return leftDuration < rightDuration ? -1 : 1;
  }

  return 0;
};

export const isBetterSprintResult = (candidate, existing) => {
  if (!existing) return true;
  return compareSprintResults(candidate, existing) < 0;
};

export const isBetterRushResult = (candidate, existing) => {
  if (!existing) return true;
  return (candidate?.finalScore ?? candidate?.final_score ?? -Infinity) >
    (existing?.finalScore ?? existing?.final_score ?? -Infinity);
};
