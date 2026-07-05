import { BOARD_SIZE } from "./premiumSquares";

export const getPlacedCells = (board, boardSize = BOARD_SIZE) => {
  const placedCells = [];

  for (let row = 0; row < boardSize; row += 1) {
    for (let col = 0; col < boardSize; col += 1) {
      const tile = board[row][col];
      if (tile && tile.isFromRack && !tile.scored) {
        placedCells.push({ row, col });
      }
    }
  }

  return placedCells;
};

export const getWordsOnBoard = (board, boardSize = BOARD_SIZE) => {
  const words = [];
  const visited = new Set();

  for (let row = 0; row < boardSize; row += 1) {
    let word = [];
    let cells = [];
    for (let col = 0; col < boardSize; col += 1) {
      if (board[row][col]) {
        word.push(board[row][col].letter);
        cells.push({ row, col });
      } else {
        if (word.length >= 2) {
          const wordStr = word.join("");
          const key = `h-${row}-${cells[0].col}-${cells[cells.length - 1].col}`;
          if (!visited.has(key)) {
            words.push({
              word: wordStr,
              cells: [...cells],
              direction: "horizontal",
            });
            cells.forEach((cell) => visited.add(`${cell.row},${cell.col}`));
          }
        }
        word = [];
        cells = [];
      }
    }

    if (word.length >= 2) {
      const wordStr = word.join("");
      const key = `h-${row}-${cells[0].col}-${cells[cells.length - 1].col}`;
      if (!visited.has(key)) {
        words.push({
          word: wordStr,
          cells: [...cells],
          direction: "horizontal",
        });
      }
    }
  }

  for (let col = 0; col < boardSize; col += 1) {
    let word = [];
    let cells = [];
    for (let row = 0; row < boardSize; row += 1) {
      if (board[row][col]) {
        word.push(board[row][col].letter);
        cells.push({ row, col });
      } else {
        if (word.length >= 2) {
          const wordStr = word.join("");
          const key = `v-${col}-${cells[0].row}-${cells[cells.length - 1].row}`;
          if (!visited.has(key)) {
            words.push({
              word: wordStr,
              cells: [...cells],
              direction: "vertical",
            });
            cells.forEach((cell) => visited.add(`${cell.row},${cell.col}`));
          }
        }
        word = [];
        cells = [];
      }
    }

    if (word.length >= 2) {
      const wordStr = word.join("");
      const key = `v-${col}-${cells[0].row}-${cells[cells.length - 1].row}`;
      if (!visited.has(key)) {
        words.push({
          word: wordStr,
          cells: [...cells],
          direction: "vertical",
        });
      }
    }
  }

  return words;
};

export const hasNewTiles = (wordData, boardAtTurnStart) => {
  if (!boardAtTurnStart) return true;

  return wordData.cells.some(({ row, col }) => boardAtTurnStart[row][col] === false);
};

const arePlacedTilesConnectedInLine = (board, placedCells) => {
  if (placedCells.length <= 1) return true;

  const sameRow = placedCells.every(({ row }) => row === placedCells[0].row);
  if (sameRow) {
    const row = placedCells[0].row;
    const minCol = Math.min(...placedCells.map(({ col }) => col));
    const maxCol = Math.max(...placedCells.map(({ col }) => col));

    for (let col = minCol; col <= maxCol; col += 1) {
      if (board[row][col] == null) {
        return false;
      }
    }

    return true;
  }

  const col = placedCells[0].col;
  const minRow = Math.min(...placedCells.map(({ row }) => row));
  const maxRow = Math.max(...placedCells.map(({ row }) => row));

  for (let row = minRow; row <= maxRow; row += 1) {
    if (board[row][col] == null) {
      return false;
    }
  }

  return true;
};

export const validateSubmitTurn = ({
  board,
  isFirstTurn,
  boardAtTurnStart,
  dictionary,
  boardSize = BOARD_SIZE,
}) => {
  const placementValidation = validateSubmitPlacement({
    board,
    isFirstTurn,
    boardAtTurnStart,
    boardSize,
  });

  if (!placementValidation.ok) {
    return placementValidation;
  }

  const { words } = placementValidation;
  const invalidWords = words
    .filter((wordData) => !dictionary.isValid(wordData.word))
    .map((wordData) => wordData.word.toUpperCase());

  if (invalidWords.length > 0) {
    return {
      ok: false,
      error: {
        title: "Invalid Word",
        text: `Invalid words: ${invalidWords.join(", ")}`,
      },
    };
  }

  return placementValidation;
};

export const validateSubmitPlacement = ({
  board,
  isFirstTurn,
  boardAtTurnStart,
  boardSize = BOARD_SIZE,
}) => {
  const placedCells = getPlacedCells(board, boardSize);

  if (placedCells.length === 0) {
    return {
      ok: false,
      error: {
        title: "No Word",
        text: "Please place tiles on the board first.",
      },
    };
  }

  const sameRow = placedCells.every(({ row }) => row === placedCells[0].row);
  const sameCol = placedCells.every(({ col }) => col === placedCells[0].col);
  if (!sameRow && !sameCol) {
    return {
      ok: false,
      error: {
        title: "Invalid Placement",
        text: "Tiles must be placed in a single row or a single column.",
      },
    };
  }

  if (!arePlacedTilesConnectedInLine(board, placedCells)) {
    return {
      ok: false,
      error: {
        title: "Invalid Placement",
        text: "Placed tiles must form one connected word group.",
      },
    };
  }

  if (isFirstTurn) {
    const centerIndex = Math.floor(boardSize / 2);
    const hasCenter = placedCells.some(
      ({ row, col }) => row === centerIndex && col === centerIndex
    );
    if (!hasCenter) {
      return {
        ok: false,
        error: {
          title: "First Word",
          text: "The first word must be placed on the center square (★).",
        },
      };
    }
  } else {
    const hasConnection = placedCells.some(({ row, col }) => {
      const adjacent = [
        { r: row - 1, c: col },
        { r: row + 1, c: col },
        { r: row, c: col - 1 },
        { r: row, c: col + 1 },
      ];

      return adjacent.some(({ r, c }) => {
        if (r < 0 || r >= boardSize || c < 0 || c >= boardSize) return false;
        return (
          board[r][c] !== null &&
          !placedCells.some((selectedCell) => selectedCell.row === r && selectedCell.col === c)
        );
      });
    });

    if (!hasConnection) {
      return {
        ok: false,
        error: {
          title: "Invalid Placement",
          text: "New words must connect to existing words.",
        },
      };
    }
  }

  const words = getWordsOnBoard(board, boardSize);
  if (words.length === 0) {
    return {
      ok: false,
      error: {
        title: "Invalid Word",
        text: "No valid words found on the board.",
      },
    };
  }

  const newWords = words.filter((wordData) => hasNewTiles(wordData, boardAtTurnStart));
  if (newWords.length === 0) {
    return {
      ok: false,
      error: {
        title: "No New Words",
        text: "You must place at least one new tile.",
      },
    };
  }

  return {
    ok: true,
    placedCells,
    words,
    newWords,
  };
};
