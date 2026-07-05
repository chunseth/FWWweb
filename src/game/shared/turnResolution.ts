import { drawTilesFromBag } from "./bag";
import { scoreSubmittedWords } from "./scoring";
import type { BonusMode, SubmittedWordsScore } from "./scoring";
import type {
  BagTile,
  BoardCell,
  CellCoord,
  PremiumSquares,
  Tile,
  WordOnBoard,
} from "./types";

export const buildBoardOccupancySnapshot = (
  board: BoardCell[][]
): boolean[][] => board.map((row) => row.map((cell) => cell !== null));

export const consumePremiumSquares = (
  premiumSquares: PremiumSquares,
  words: WordOnBoard[]
): PremiumSquares => {
  const nextPremiumSquares = { ...premiumSquares };
  words.forEach((wordData) => {
    wordData.cells.forEach(({ row, col }) => {
      delete nextPremiumSquares[`${row},${col}`];
    });
  });
  return nextPremiumSquares;
};

export interface ResolvedSubmitPayload extends SubmittedWordsScore {
  resolvedBoard: BoardCell[][];
  placedCells: CellCoord[];
  words: WordOnBoard[];
  newWords: WordOnBoard[];
  remainingRack: Tile[];
  drawnTiles: Tile[];
  resultingRack: Tile[];
  nextBag: BagTile[];
  nextTileId: number;
  nextTilesRemaining: number;
  newPremiumSquares: PremiumSquares;
  nextBoardAtTurnStart: boolean[][];
}

export const buildResolvedSubmitPayload = ({
  board,
  tileRack,
  tileBag,
  nextTileId,
  premiumSquares,
  turnCount,
  placedCells,
  words,
  newWords,
  drawOwnerId = null,
  bonusMode = "classic",
}: {
  board: BoardCell[][];
  tileRack: Tile[];
  tileBag: BagTile[];
  nextTileId: number;
  premiumSquares: PremiumSquares;
  turnCount: number;
  placedCells: CellCoord[];
  words: WordOnBoard[];
  newWords: WordOnBoard[];
  drawOwnerId?: string | null;
  bonusMode?: BonusMode;
}): ResolvedSubmitPayload => {
  const scoring = scoreSubmittedWords({
    board,
    newWords,
    premiumSquares,
    turnCount,
    placedCells,
    bonusMode,
  });

  const usedIndices = new Set<number>();
  placedCells.forEach(({ row, col }) => {
    const tile = board[row][col];
    if (tile && tile.isFromRack && tile.rackIndex !== undefined) {
      usedIndices.add(tile.rackIndex);
    }
  });

  const remainingRack = tileRack.filter((_, index) => !usedIndices.has(index));
  const drawResult = drawTilesFromBag(
    tileBag,
    usedIndices.size,
    nextTileId,
    drawOwnerId
  );
  const resultingRack = [...remainingRack, ...drawResult.drawnTiles].map(
    (tile, rackIndex) => ({
      ...tile,
      rackIndex,
    })
  );
  const resolvedBoard = board.map((row) => [...row]);
  placedCells.forEach(({ row, col }) => {
    const tile = resolvedBoard[row][col];
    if (tile) {
      resolvedBoard[row][col] = { ...tile, scored: true };
    }
  });

  return {
    ...scoring,
    resolvedBoard,
    placedCells,
    words,
    newWords,
    remainingRack: remainingRack.map((tile, rackIndex) => ({
      ...tile,
      rackIndex,
    })),
    drawnTiles: drawResult.drawnTiles,
    resultingRack,
    nextBag: drawResult.nextBag,
    nextTileId: drawResult.nextTileId,
    nextTilesRemaining: drawResult.nextBag.length,
    newPremiumSquares: consumePremiumSquares(premiumSquares, words),
    nextBoardAtTurnStart: buildBoardOccupancySnapshot(board),
  };
};
