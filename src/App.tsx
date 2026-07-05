import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GameHud } from "./components/GameHud";
import { MiniBoard } from "./components/MiniBoard";
import { TileRack } from "./components/TileRack";
import { BlankLetterPicker } from "./components/BlankLetterPicker";
import { GameOverPanel } from "./components/GameOverPanel";
import { useRushGame } from "./game/rush/useRushGame";
import { useTileDrag } from "./game/rush/useTileDrag";
import type { DragSource } from "./game/rush/useTileDrag";
import { getBestLocalResult } from "./game/rush/localResults";
import { BLANK_LETTER } from "./game/shared/bag";
import { MINI_BOARD_SIZE } from "./game/shared/premiumSquares";
import { getPlacedCells } from "./game/shared/validation";

const TOAST_MS = 2400;

interface PendingBlank {
  rackIndex: number;
  row: number;
  col: number;
}

export const App = () => {
  const game = useRushGame();
  const {
    state,
    remainingMs,
    runningScore,
    usedRackIndices,
    message,
    dictionaryReady,
    savedRunAvailable,
  } = game;

  const [swapMode, setSwapMode] = useState(false);
  const [swapSelection, setSwapSelection] = useState<Set<number>>(new Set());
  const [pendingBlank, setPendingBlank] = useState<PendingBlank | null>(null);

  const boardWrapRef = useRef<HTMLDivElement>(null);

  // ResizeObserver keeps --cell-size (px) in sync with the board width so
  // tiles and type scale together without viewport-based font sizes.
  useEffect(() => {
    const el = boardWrapRef.current;
    if (!el) return;
    const apply = (width: number) => {
      document.documentElement.style.setProperty(
        "--cell-size",
        `${width / MINI_BOARD_SIZE}px`
      );
    };
    apply(el.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        apply(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [state != null]);

  // Toast auto-dismiss.
  useEffect(() => {
    if (!message) return;
    const id = window.setTimeout(game.dismissMessage, TOAST_MS);
    return () => window.clearTimeout(id);
  }, [message, game.dismissMessage]);

  const isActive = state?.status === "active";

  const canDropOnCell = useCallback(
    (row: number, col: number): boolean =>
      Boolean(
        state &&
          state.status === "active" &&
          state.board[row] &&
          state.board[row][col] === null
      ),
    [state]
  );

  const onDropOnBoard = useCallback(
    (source: DragSource, row: number, col: number): boolean => {
      if (!state || state.status !== "active") return false;
      if (source.type === "board") {
        return game.moveBoardTile(source.row, source.col, row, col);
      }
      const tile = state.rack[source.rackIndex];
      if (!tile) return false;
      const isBlank =
        tile.value === 0 &&
        (tile.letter === BLANK_LETTER || tile.letter === "");
      if (isBlank) {
        setPendingBlank({ rackIndex: source.rackIndex, row, col });
        return true;
      }
      return game.placeRackTile(source.rackIndex, row, col);
    },
    [state, game]
  );

  const onDropOnRack = useCallback(
    (source: DragSource, visibleIndex: number): boolean => {
      if (source.type === "board") {
        return game.returnTileToRack(source.row, source.col, visibleIndex);
      }
      game.reorderRack(source.rackIndex, visibleIndex);
      return true;
    },
    [game]
  );

  const onTap = useCallback(
    (source: DragSource) => {
      if (source.type === "board") {
        game.removeBoardTile(source.row, source.col);
      }
    },
    [game]
  );

  const drag = useTileDrag({
    canDropOnCell,
    onDropOnBoard,
    onDropOnRack,
    onTap,
  });

  const placedCount = useMemo(
    () => (state ? getPlacedCells(state.board, state.boardSize).length : 0),
    [state]
  );

  const best = useMemo(
    () => getBestLocalResult(),
    // Recompute whenever a run ends.
    [state?.status]
  );

  const startSwap = () => {
    game.returnAllDrafts();
    setSwapSelection(new Set());
    setSwapMode(true);
  };

  const cancelSwap = () => {
    setSwapMode(false);
    setSwapSelection(new Set());
  };

  const confirmSwap = () => {
    if (swapSelection.size > 0) {
      game.swapTiles([...swapSelection]);
    }
    cancelSwap();
  };

  const toggleSwapSelection = (rackIndex: number) => {
    setSwapSelection((prev) => {
      const next = new Set(prev);
      if (next.has(rackIndex)) {
        next.delete(rackIndex);
      } else if (state && next.size < Math.min(7, state.bag.length)) {
        next.add(rackIndex);
      }
      return next;
    });
  };

  const handlePlayAgain = () => {
    cancelSwap();
    setPendingBlank(null);
    game.startNewRun();
  };

  // ---------- menu screens ----------

  if (!state) {
    return (
      <div className="screen screen--menu">
        <h1 className="menu__title">Words With Real Friends</h1>
        <p className="menu__subtitle">5-Minute Rush · 11×11 board</p>
        {best ? (
          <p className="menu__best">Best score: {best.breakdown.finalScore}</p>
        ) : null}
        {savedRunAvailable ? (
          <>
            <button className="btn btn--primary" onClick={game.resumeSavedRun}>
              Resume Run
            </button>
            <button
              className="btn btn--danger"
              onClick={game.discardSavedRun}
            >
              Discard Saved Run
            </button>
          </>
        ) : (
          <button
            className="btn btn--primary"
            onClick={game.startNewRun}
            disabled={!dictionaryReady}
          >
            {dictionaryReady ? "Start Rush" : "Loading words…"}
          </button>
        )}
      </div>
    );
  }

  // ---------- game screen ----------

  const swapPenaltyMultiplier = state.swapCount + 1;

  return (
    <div className="screen">
      <GameHud
        remainingMs={remainingMs}
        score={runningScore}
        tilesRemaining={state.bag.length}
      />

      <div className="board-wrap" ref={boardWrapRef}>
        <MiniBoard
          board={state.board}
          premiumSquares={state.premiumSquares}
          boardRef={drag.boardRef}
          onTilePointerDown={drag.startDrag}
          interactive={isActive && !swapMode}
        />
      </div>

      <div className="rack-area">
        <TileRack
          rack={state.rack}
          usedRackIndices={usedRackIndices}
          rackRef={drag.rackRef}
          onTilePointerDown={drag.startDrag}
          interactive={isActive}
          swapMode={swapMode}
          selectedIndices={swapSelection}
          onToggleSelect={toggleSwapSelection}
        />

        {swapMode ? (
          <>
            <p className="swap-hint">
              Select tiles to swap · penalty ×{swapPenaltyMultiplier}
            </p>
            <div className="controls">
              <button className="btn btn--ghost" onClick={cancelSwap}>
                Cancel
              </button>
              <button
                className="btn btn--primary"
                onClick={confirmSwap}
                disabled={swapSelection.size === 0}
              >
                Swap {swapSelection.size || ""}
              </button>
            </div>
          </>
        ) : (
          <div className="controls">
            <button
              className="btn"
              onClick={game.returnAllDrafts}
              disabled={!isActive || placedCount === 0}
            >
              Recall
            </button>
            <button
              className="btn"
              onClick={startSwap}
              disabled={!isActive || state.bag.length === 0}
            >
              Swap
            </button>
            <button
              className="btn btn--primary"
              onClick={game.submitWord}
              disabled={!isActive || placedCount === 0 || !dictionaryReady}
            >
              Submit
            </button>
          </div>
        )}
      </div>

      {message ? (
        <div
          className={`toast${message.kind === "error" ? " toast--error" : ""}`}
          onClick={game.dismissMessage}
        >
          <p className="toast__title">
            {message.title}
            {message.turnPoints != null ? (
              <span className="toast__points"> +{message.turnPoints}</span>
            ) : null}
          </p>
          <p className="toast__text">
            {message.text}
            {message.scrabbleBonusMessage
              ? ` · ${message.scrabbleBonusMessage}`
              : ""}
            {message.consistencyBonus
              ? ` · Combo +${message.consistencyBonus}`
              : ""}
          </p>
        </div>
      ) : null}

      {pendingBlank ? (
        <BlankLetterPicker
          onPick={(letter) => {
            game.placeRackTile(
              pendingBlank.rackIndex,
              pendingBlank.row,
              pendingBlank.col,
              letter
            );
            setPendingBlank(null);
          }}
          onCancel={() => setPendingBlank(null)}
        />
      ) : null}

      {state.status === "expired" && state.finalBreakdown ? (
        <GameOverPanel
          breakdown={state.finalBreakdown}
          wordCount={state.wordCount}
          best={best}
          onPlayAgain={handlePlayAgain}
        />
      ) : null}
    </div>
  );
};
