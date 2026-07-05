export const BOARD_SIZE = 15;
export const MINI_BOARD_SIZE = 11;
export const SCRABBLE_BONUS = 50;

export const createEmptyBoard = (boardSize = BOARD_SIZE) =>
  Array(boardSize)
    .fill(null)
    .map(() => Array(boardSize).fill(null));

export const createClassicPremiumSquares = () => {
  const premiumSquares = {};

  const twSquares = [
    [0, 0],
    [0, 7],
    [0, 14],
    [7, 0],
    [7, 14],
    [14, 0],
    [14, 7],
    [14, 14],
  ];
  twSquares.forEach(([r, c]) => (premiumSquares[`${r},${c}`] = "tw"));

  const dwSquares = [
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
    [1, 13],
    [2, 12],
    [3, 11],
    [4, 10],
    [13, 1],
    [12, 2],
    [11, 3],
    [10, 4],
    [13, 13],
    [12, 12],
    [11, 11],
    [10, 10],
  ];
  dwSquares.forEach(([r, c]) => (premiumSquares[`${r},${c}`] = "dw"));

  const tlSquares = [
    [1, 5],
    [1, 9],
    [5, 1],
    [5, 5],
    [5, 9],
    [5, 13],
    [9, 1],
    [9, 5],
    [9, 9],
    [9, 13],
    [13, 5],
    [13, 9],
    [2, 6],
    [2, 8],
    [6, 2],
    [6, 6],
    [6, 8],
    [6, 12],
    [8, 2],
    [8, 6],
    [8, 8],
    [8, 12],
    [12, 6],
    [12, 8],
  ];
  tlSquares.forEach(([r, c]) => (premiumSquares[`${r},${c}`] = "tl"));

  const dlSquares = [
    [0, 3],
    [0, 11],
    [3, 0],
    [3, 7],
    [3, 14],
    [7, 3],
    [7, 11],
    [11, 0],
    [11, 7],
    [11, 14],
    [14, 3],
    [14, 11],
    [2, 4],
    [2, 10],
    [4, 2],
    [4, 6],
    [4, 8],
    [4, 12],
    [6, 4],
    [6, 10],
    [8, 4],
    [8, 10],
    [10, 2],
    [10, 6],
    [10, 8],
    [10, 12],
    [12, 4],
    [12, 10],
  ];
  dlSquares.forEach(([r, c]) => (premiumSquares[`${r},${c}`] = "dl"));

  premiumSquares["7,7"] = "center";

  return premiumSquares;
};

export const createMiniPremiumSquares = () => {
  const premiumSquares = {};

  const twSquares = [
    [0, 0],
    [10, 0],
    [0, 10],
    [10, 10],
  ];
  twSquares.forEach(([r, c]) => (premiumSquares[`${r},${c}`] = "tw"));

  const dwSquares = [
    [1, 1],
    [2, 2],
    [1, 9],
    [2, 8],
    [9, 1],
    [8, 2],
    [8, 8],
    [9, 9],
  ];
  dwSquares.forEach(([r, c]) => (premiumSquares[`${r},${c}`] = "dw"));

  const dlSquares = [
    [0, 3],
    [0, 7],
    [1, 5],
    [3, 0],
    [7, 0],
    [5, 1],
    [3, 10],
    [7, 10],
    [5, 9],
    [10, 3],
    [10, 7],
    [9, 5],
  ];
  dlSquares.forEach(([r, c]) => (premiumSquares[`${r},${c}`] = "dl"));

  const tlSquares = [
    [3, 3],
    [4, 4],
    [3, 7],
    [4, 6],
    [6, 4],
    [7, 3],
    [6, 6],
    [7, 7],
  ];
  tlSquares.forEach(([r, c]) => (premiumSquares[`${r},${c}`] = "tl"));

  premiumSquares["5,5"] = "center";

  return premiumSquares;
};
