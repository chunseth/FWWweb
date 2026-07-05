import { memo, useLayoutEffect, useRef } from "react";
import { TileFace } from "./TileFace";
import { BLANK_LETTER } from "../game/shared/bag";
import type { Tile } from "../game/shared/types";
import type { DragSource } from "../game/rush/useTileDrag";

const FLIP_MS = 150; // rack reorder: 120-180ms, only affected tiles move

interface TileRackProps {
  rack: Tile[];
  usedRackIndices: Set<number>;
  rackRef: React.RefObject<HTMLDivElement>;
  onTilePointerDown: (
    event: React.PointerEvent<HTMLElement>,
    source: DragSource
  ) => void;
  interactive: boolean;
  swapMode: boolean;
  selectedIndices: Set<number>;
  onToggleSelect: (rackIndex: number) => void;
}

export const TileRack = memo(
  ({
    rack,
    usedRackIndices,
    rackRef,
    onTilePointerDown,
    interactive,
    swapMode,
    selectedIndices,
    onToggleSelect,
  }: TileRackProps) => {
    const positionsRef = useRef(new Map<string, DOMRect>());

    // FLIP: when tiles change visible position, invert from their previous
    // rect and let the transform play back to identity.
    useLayoutEffect(() => {
      const container = rackRef.current;
      if (!container) return;
      const previous = positionsRef.current;
      const next = new Map<string, DOMRect>();
      container
        .querySelectorAll<HTMLElement>("[data-rack-tile]")
        .forEach((el) => {
          const id = el.dataset.tileId;
          if (!id) return;
          const rect = el.getBoundingClientRect();
          next.set(id, rect);
          const old = previous.get(id);
          if (old && Math.abs(old.left - rect.left) > 1) {
            el.animate(
              [
                { transform: `translateX(${old.left - rect.left}px)` },
                { transform: "translateX(0)" },
              ],
              { duration: FLIP_MS, easing: "cubic-bezier(0.2, 0.9, 0.3, 1)" }
            );
          }
        });
      positionsRef.current = next;
    });

    const visible = rack
      .map((tile, rackIndex) => ({ tile, rackIndex }))
      .filter(({ rackIndex }) => !usedRackIndices.has(rackIndex));

    return (
      <div className="rack" ref={rackRef}>
        {visible.map(({ tile, rackIndex }) => {
          const isBlank =
            tile.value === 0 &&
            (tile.letter === BLANK_LETTER || tile.letter === "");
          return (
            <div
              key={String(tile.id)}
              className="rack__slot"
              data-rack-tile
              data-tile-id={String(tile.id)}
              data-rack-index={rackIndex}
              onPointerDown={
                !interactive
                  ? undefined
                  : swapMode
                    ? () => onToggleSelect(rackIndex)
                    : (event) =>
                        onTilePointerDown(event, { type: "rack", rackIndex })
              }
            >
              <TileFace
                letter={tile.letter}
                value={tile.value}
                isBlank={isBlank}
                isSelected={swapMode && selectedIndices.has(rackIndex)}
              />
            </div>
          );
        })}
      </div>
    );
  }
);

TileRack.displayName = "TileRack";
