import { validateSubmitTurn } from "../validation";

const makeBoard = (size = 15) =>
  Array.from({ length: size }, () => Array.from({ length: size }, () => null));

const dictionary = {
  isValid: jest.fn(() => true),
};

describe("validateSubmitTurn", () => {
  beforeEach(() => {
    dictionary.isValid.mockClear();
    dictionary.isValid.mockReturnValue(true);
  });

  it("rejects placed tiles in one line when they do not form a single connected word group", () => {
    const board = makeBoard();
    const boardAtTurnStart = makeBoard().map((row) => row.map(() => false));

    board[7][6] = { id: "l", letter: "L", scored: true };
    board[7][7] = { id: "i", letter: "I", isFromRack: true, scored: false };
    board[10][6] = { id: "s", letter: "S", scored: true };
    board[10][7] = { id: "u", letter: "U", isFromRack: true, scored: false };
    board[11][6] = { id: "t", letter: "T", scored: true };

    const validation = validateSubmitTurn({
      board,
      isFirstTurn: false,
      boardAtTurnStart,
      dictionary,
    });

    expect(validation.ok).toBe(false);
    expect(validation.error).toEqual({
      title: "Invalid Placement",
      text: "Placed tiles must form one connected word group.",
    });
  });

  it("accepts placed tiles in one line when existing tiles bridge them into one connected group", () => {
    const board = makeBoard();
    const boardAtTurnStart = makeBoard().map((row) => row.map(() => false));

    board[7][6] = { id: "l", letter: "L", scored: true };
    board[7][7] = { id: "i", letter: "I", isFromRack: true, scored: false };
    board[8][7] = { id: "n", letter: "N", scored: true };
    board[9][7] = { id: "u", letter: "U", isFromRack: true, scored: false };
    board[9][8] = { id: "s", letter: "S", scored: true };

    const validation = validateSubmitTurn({
      board,
      isFirstTurn: false,
      boardAtTurnStart,
      dictionary,
    });

    expect(validation.ok).toBe(true);
    expect(validation.placedCells).toEqual([
      { row: 7, col: 7 },
      { row: 9, col: 7 },
    ]);
  });

  it("accepts first turn when a tile is placed on the 11x11 center square", () => {
    const board = makeBoard(11);
    board[5][5] = { id: "a", letter: "A", isFromRack: true, scored: false };
    board[5][6] = { id: "t", letter: "T", isFromRack: true, scored: false };

    const validation = validateSubmitTurn({
      board,
      isFirstTurn: true,
      boardAtTurnStart: null,
      dictionary,
      boardSize: 11,
    });

    expect(validation.ok).toBe(true);
  });
});
