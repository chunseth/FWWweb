import { memo } from "react";
import type { CSSProperties } from "react";
import { TileFace } from "./TileFace";
import type { MiniBoard as MiniBoardState, PremiumSquares } from "../game/shared/types";
import type { DragSource } from "../game/rush/useTileDrag";

const PREMIUM_LABELS: Record<string, string> = {
  tw: "TW",
  dw: "DW",
  tl: "TL",
  dl: "DL",
  center: "★",
};

interface MiniBoardProps {
  board: MiniBoardState;
  premiumSquares: PremiumSquares;
  boardRef: React.RefObject<HTMLDivElement>;
  onTilePointerDown: (
    event: React.PointerEvent<HTMLElement>,
    source: DragSource
  ) => void;
  interactive: boolean;
}

export const MiniBoard = memo(
  ({
    board,
    premiumSquares,
    boardRef,
    onTilePointerDown,
    interactive,
  }: MiniBoardProps) => {
    const boardSize = board.length;
    const cells = [];
    for (let row = 0; row < boardSize; row += 1) {
      for (let col = 0; col < boardSize; col += 1) {
        const tile = board[row][col];
        const premium = premiumSquares[`${row},${col}`];
        const isDraft = Boolean(tile && tile.isFromRack && !tile.scored);
        const cellClass = [
          "cell",
          !tile && premium ? `cell--${premium}` : "",
        ]
          .filter(Boolean)
          .join(" ");

        cells.push(
          <div key={`${row},${col}`} className={cellClass} data-row={row} data-col={col}>
            {tile ? (
              <div
                style={{ width: "100%", height: "100%" }}
                onPointerDown={
                  interactive && isDraft
                    ? (event) => {
                        // Keep tile drags out of the board's pinch/pan gestures.
                        event.stopPropagation();
                        onTilePointerDown(event, { type: "board", row, col });
                      }
                    : undefined
                }
              >
                <TileFace
                  letter={tile.letter}
                  value={tile.value}
                  isBlank={false}
                  isDraft={isDraft}
                />
              </div>
            ) : premium ? (
              <span className="cell__premium">{PREMIUM_LABELS[premium]}</span>
            ) : null}
          </div>
        );
      }
    }

    return (
      <div
        className="board"
        ref={boardRef}
        style={{ "--board-size": boardSize } as CSSProperties}
      >
        {cells}
      </div>
    );
  }
);

MiniBoard.displayName = "MiniBoard";
