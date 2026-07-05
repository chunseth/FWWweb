/**
 * Hand-built pointer drag controller for tiles.
 *
 * Live drag movement stays entirely outside React: on pickup we clone the
 * tile into a fixed-position ghost, cache all geometry once, and drive the
 * ghost with `transform: translate3d(...)` from a requestAnimationFrame loop.
 * React state only changes at commit time (drop/tap/cancel).
 */

import { useCallback, useEffect, useRef } from "react";
import { MINI_BOARD_SIZE } from "../shared/premiumSquares";

export type DragSource =
  | { type: "rack"; rackIndex: number }
  | { type: "board"; row: number; col: number };

export interface DropTargets {
  /** Board cell drop. Return false to bounce the tile back. */
  onDropOnBoard: (source: DragSource, row: number, col: number) => boolean;
  /** Rack drop (visible slot index). Return false to bounce back. */
  onDropOnRack: (source: DragSource, visibleIndex: number) => boolean;
  /** Pointer down+up without movement. */
  onTap: (source: DragSource) => void;
  canDropOnCell: (row: number, col: number) => boolean;
}

export interface TileDragApi {
  /** Attach to a tile's onPointerDown. */
  startDrag: (event: React.PointerEvent<HTMLElement>, source: DragSource) => void;
  boardRef: React.RefObject<HTMLDivElement>;
  rackRef: React.RefObject<HTMLDivElement>;
}

const TAP_DISTANCE_PX = 6;
const PICKUP_MS = 70; // 60-80ms lift
const SETTLE_MS = 150; // 120-180ms drop settle
const RETURN_MS = 190; // 160-220ms invalid return

interface ActiveDrag {
  pointerId: number;
  source: DragSource;
  sourceEl: HTMLElement;
  ghost: HTMLElement;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  originRect: DOMRect;
  boardRect: DOMRect | null;
  rackRect: DOMRect | null;
  cellSize: number;
  rackSlotWidth: number;
  rackVisibleCount: number;
  moved: boolean;
  rafId: number | null;
  indicator: HTMLElement | null;
  settled: boolean;
}

export const useTileDrag = (targets: DropTargets): TileDragApi => {
  const boardRef = useRef<HTMLDivElement>(null);
  const rackRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<ActiveDrag | null>(null);
  const targetsRef = useRef(targets);
  targetsRef.current = targets;

  const cleanup = useCallback((drag: ActiveDrag) => {
    if (drag.rafId != null) cancelAnimationFrame(drag.rafId);
    drag.ghost.remove();
    drag.indicator?.remove();
    drag.sourceEl.classList.remove("tile--drag-hidden");
    activeRef.current = null;
  }, []);

  useEffect(
    () => () => {
      if (activeRef.current) cleanup(activeRef.current);
    },
    [cleanup]
  );

  const hitTestBoard = (
    drag: ActiveDrag,
    x: number,
    y: number
  ): { row: number; col: number } | null => {
    const rect = drag.boardRect;
    if (!rect || drag.cellSize <= 0) return null;
    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
      return null;
    }
    const col = Math.floor((x - rect.left) / drag.cellSize);
    const row = Math.floor((y - rect.top) / drag.cellSize);
    if (row < 0 || col < 0 || row >= MINI_BOARD_SIZE || col >= MINI_BOARD_SIZE) {
      return null;
    }
    return { row, col };
  };

  const hitTestRack = (drag: ActiveDrag, x: number, y: number): number | null => {
    const rect = drag.rackRect;
    if (!rect) return null;
    const pad = 30; // generous catch area around the rack
    if (
      x < rect.left - pad ||
      x > rect.right + pad ||
      y < rect.top - pad ||
      y > rect.bottom + pad
    ) {
      return null;
    }
    if (drag.rackSlotWidth <= 0 || drag.rackVisibleCount === 0) return 0;
    const index = Math.floor((x - rect.left) / drag.rackSlotWidth);
    return Math.max(0, Math.min(index, drag.rackVisibleCount - 1));
  };

  const updateIndicator = (drag: ActiveDrag) => {
    const cell = hitTestBoard(drag, drag.lastX, drag.lastY);
    const indicator = drag.indicator;
    if (!indicator || !drag.boardRect) return;
    if (cell && targetsRef.current.canDropOnCell(cell.row, cell.col)) {
      indicator.style.opacity = "1";
      indicator.style.transform = `translate3d(${
        cell.col * drag.cellSize
      }px, ${cell.row * drag.cellSize}px, 0)`;
    } else {
      indicator.style.opacity = "0";
    }
  };

  const animateGhostTo = (
    drag: ActiveDrag,
    toX: number,
    toY: number,
    durationMs: number,
    onDone: () => void
  ) => {
    drag.settled = true;
    const { ghost, originRect } = drag;
    const current = `translate3d(${drag.lastX - drag.startX}px, ${
      drag.lastY - drag.startY
    }px, 0) scale(1.06)`;
    const target = `translate3d(${toX - originRect.left}px, ${
      toY - originRect.top
    }px, 0) scale(1)`;
    const animation = ghost.animate(
      [{ transform: current }, { transform: target }],
      { duration: durationMs, easing: "cubic-bezier(0.2, 0.9, 0.3, 1)", fill: "forwards" }
    );
    animation.onfinish = onDone;
    animation.oncancel = onDone;
  };

  const finishDrag = (drag: ActiveDrag, x: number, y: number) => {
    const targetsApi = targetsRef.current;

    // Tap: no meaningful movement.
    if (!drag.moved) {
      cleanup(drag);
      targetsApi.onTap(drag.source);
      return;
    }

    const cell = hitTestBoard(drag, x, y);
    if (cell && targetsApi.canDropOnCell(cell.row, cell.col) && drag.boardRect) {
      const toX = drag.boardRect.left + cell.col * drag.cellSize;
      const toY = drag.boardRect.top + cell.row * drag.cellSize;
      animateGhostTo(drag, toX, toY, SETTLE_MS, () => {
        cleanup(drag);
        targetsApi.onDropOnBoard(drag.source, cell.row, cell.col);
      });
      return;
    }

    const rackIndex = hitTestRack(drag, x, y);
    if (rackIndex != null && drag.rackRect) {
      const toX = drag.rackRect.left + rackIndex * drag.rackSlotWidth;
      const toY = drag.rackRect.top;
      animateGhostTo(drag, toX, toY, SETTLE_MS, () => {
        cleanup(drag);
        targetsApi.onDropOnRack(drag.source, rackIndex);
      });
      return;
    }

    // Invalid drop: return to origin.
    animateGhostTo(drag, drag.originRect.left, drag.originRect.top, RETURN_MS, () =>
      cleanup(drag)
    );
  };

  const startDrag = useCallback(
    (event: React.PointerEvent<HTMLElement>, source: DragSource) => {
      if (activeRef.current) return;
      if (event.button !== 0 && event.pointerType === "mouse") return;

      const sourceEl = event.currentTarget;
      const originRect = sourceEl.getBoundingClientRect();
      const boardEl = boardRef.current;
      const rackEl = rackRef.current;
      const boardRect = boardEl?.getBoundingClientRect() ?? null;
      const rackRect = rackEl?.getBoundingClientRect() ?? null;
      const cellSize = boardRect ? boardRect.width / MINI_BOARD_SIZE : 0;
      const rackVisibleCount = rackEl
        ? rackEl.querySelectorAll("[data-rack-tile]").length
        : 0;
      const rackSlotWidth =
        rackRect && rackVisibleCount > 0
          ? rackRect.width / rackVisibleCount
          : rackRect?.width ?? 0;

      // Ghost: visual clone driven imperatively, never through React.
      const ghost = sourceEl.cloneNode(true) as HTMLElement;
      ghost.classList.add("tile--ghost");
      ghost.style.position = "fixed";
      ghost.style.left = `${originRect.left}px`;
      ghost.style.top = `${originRect.top}px`;
      ghost.style.width = `${originRect.width}px`;
      ghost.style.height = `${originRect.height}px`;
      ghost.style.margin = "0";
      ghost.style.zIndex = "1000";
      ghost.style.pointerEvents = "none";
      ghost.style.willChange = "transform";
      document.body.appendChild(ghost);

      // Pickup lift (60-80ms).
      ghost.animate(
        [
          { transform: "translate3d(0,0,0) scale(1)" },
          { transform: "translate3d(0,0,0) scale(1.06)" },
        ],
        { duration: PICKUP_MS, easing: "ease-out", fill: "forwards" }
      );

      // Drop indicator inside the board.
      let indicator: HTMLElement | null = null;
      if (boardEl && boardRect) {
        indicator = document.createElement("div");
        indicator.className = "board__drop-indicator";
        indicator.style.width = `${cellSize}px`;
        indicator.style.height = `${cellSize}px`;
        boardEl.appendChild(indicator);
      }

      const drag: ActiveDrag = {
        pointerId: event.pointerId,
        source,
        sourceEl,
        ghost,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        originRect,
        boardRect,
        rackRect,
        cellSize,
        rackSlotWidth,
        rackVisibleCount,
        moved: false,
        rafId: null,
        indicator,
        settled: false,
      };
      activeRef.current = drag;

      sourceEl.setPointerCapture(event.pointerId);

      const render = () => {
        if (activeRef.current !== drag || drag.settled) return;
        const dx = drag.lastX - drag.startX;
        const dy = drag.lastY - drag.startY;
        ghost.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(1.06)`;
        updateIndicator(drag);
        drag.rafId = null;
      };

      const onMove = (e: PointerEvent) => {
        if (e.pointerId !== drag.pointerId || drag.settled) return;
        drag.lastX = e.clientX;
        drag.lastY = e.clientY;
        if (
          !drag.moved &&
          Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) >
            TAP_DISTANCE_PX
        ) {
          drag.moved = true;
          drag.sourceEl.classList.add("tile--drag-hidden");
        }
        if (drag.rafId == null) {
          drag.rafId = requestAnimationFrame(render);
        }
      };

      const teardownListeners = () => {
        sourceEl.removeEventListener("pointermove", onMove);
        sourceEl.removeEventListener("pointerup", onUp);
        sourceEl.removeEventListener("pointercancel", onCancel);
      };

      const onUp = (e: PointerEvent) => {
        if (e.pointerId !== drag.pointerId || drag.settled) return;
        teardownListeners();
        finishDrag(drag, e.clientX, e.clientY);
      };

      const onCancel = (e: PointerEvent) => {
        if (e.pointerId !== drag.pointerId || drag.settled) return;
        teardownListeners();
        animateGhostTo(
          drag,
          drag.originRect.left,
          drag.originRect.top,
          RETURN_MS,
          () => cleanup(drag)
        );
      };

      sourceEl.addEventListener("pointermove", onMove);
      sourceEl.addEventListener("pointerup", onUp);
      sourceEl.addEventListener("pointercancel", onCancel);
    },
    [cleanup]
  );

  return { startDrag, boardRef, rackRef };
};
