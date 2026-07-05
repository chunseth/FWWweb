import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { TileFace } from "./TileFace";
import { BLANK_LETTER } from "../game/shared/bag";
import type { Tile } from "../game/shared/types";
import type { DragSource } from "../game/rush/useTileDrag";

const FLIP_MS = 150; // rack reorder: 120-180ms, only affected tiles move

/** A tile currently animating out during a swap, with its floating label. */
export interface SwapFloat {
  rackIndex: number;
  label: string;
}

export interface RackPreview {
  rackIndex: number;
  visibleIndex: number;
}

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
  /** Tiles mid-swap-animation: hidden in place (rack does NOT compact). */
  swapFloats?: SwapFloat[];
  rackPreview?: RackPreview | null;
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
    swapFloats = [],
    rackPreview = null,
  }: TileRackProps) => {
    const positionsRef = useRef(new Map<string, number>());

    const visible = useMemo(
      () => {
        const next = rack
          .map((tile, rackIndex) => ({ tile, rackIndex }))
          .filter(({ rackIndex }) => !usedRackIndices.has(rackIndex));
        if (!rackPreview) return next;

        const fromIndex = next.findIndex(
          ({ rackIndex }) => rackIndex === rackPreview.rackIndex
        );
        if (fromIndex === -1) return next;

        const reordered = [...next];
        const [moved] = reordered.splice(fromIndex, 1);
        const toIndex = Math.max(
          0,
          Math.min(rackPreview.visibleIndex, reordered.length)
        );
        reordered.splice(toIndex, 0, moved);
        return reordered;
      },
      [rack, usedRackIndices, rackPreview]
    );

    // FLIP runs ONLY when the visible order actually changes. Measuring on
    // every render reads rects mid-animation and compounds new animations on
    // top of running ones (tiles "going crazy"). Before measuring, jump any
    // in-flight FLIP to its end state so rects reflect the true layout.
    const orderSignature = visible.map(({ tile }) => String(tile.id)).join("|");

    useLayoutEffect(() => {
      const container = rackRef.current;
      if (!container) return;
      const previous = positionsRef.current;
      const next = new Map<string, number>();

      const tiles = Array.from(
        container.querySelectorAll<HTMLElement>("[data-rack-tile]")
      );

      // Settle any in-flight reorder animations before measuring.
      // (Feature-guarded: jsdom has no Web Animations API.)
      tiles.forEach((el) => {
        if (typeof el.getAnimations === "function") {
          el.getAnimations().forEach((animation) => animation.finish());
        }
      });

      tiles.forEach((el) => {
        const id = el.dataset.tileId;
        if (!id) return;
        const left = el.getBoundingClientRect().left;
        next.set(id, left);
        const old = previous.get(id);
        if (
          old !== undefined &&
          Math.abs(old - left) > 1 &&
          typeof el.animate === "function"
        ) {
          el.animate(
            [
              { transform: `translateX(${old - left}px)` },
              { transform: "translateX(0)" },
            ],
            { duration: FLIP_MS, easing: "cubic-bezier(0.2, 0.9, 0.3, 1)" }
          );
        }
      });
      positionsRef.current = next;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orderSignature]);

    const floatByIndex = new Map(swapFloats.map((f) => [f.rackIndex, f]));

    return (
      <div className="rack" ref={rackRef}>
        {visible.map(({ tile, rackIndex }) => {
          const isBlank =
            tile.value === 0 &&
            (tile.letter === BLANK_LETTER || tile.letter === "");
          const float = floatByIndex.get(rackIndex);
          return (
            <div
              key={String(tile.id)}
              className={`rack__slot${float ? " rack__slot--swapping" : ""}`}
              data-rack-tile
              data-tile-id={String(tile.id)}
              data-rack-index={rackIndex}
              onPointerDown={
                !interactive || float
                  ? undefined
                  : swapMode
                    ? (event) => {
                        event.stopPropagation();
                        onToggleSelect(rackIndex);
                      }
                    : (event) => {
                        event.stopPropagation();
                        onTilePointerDown(event, { type: "rack", rackIndex });
                      }
              }
            >
              <TileFace
                letter={tile.letter}
                value={tile.value}
                isBlank={isBlank}
                isSelected={swapMode && selectedIndices.has(rackIndex)}
              />
              {float ? (
                <span className="rack__swap-float">{float.label}</span>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }
);

TileRack.displayName = "TileRack";
