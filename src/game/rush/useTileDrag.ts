/**
 * Hand-built pointer drag controller for tiles.
 *
 * Live drag movement stays entirely outside React: on pickup we clone the
 * tile into a fixed-position ghost — the player "carries" the actual tile —
 * and drive it with `transform: translate3d(...)` from a requestAnimationFrame
 * loop. React state only changes at commit time (drop/tap/cancel).
 *
 * There is intentionally no drop-location highlight: the carried tile itself
 * is the cue, matching the mobile app.
 *
 * Geometry is re-measured at drop time (not only at pickup) so the settle
 * animation always travels from the release point to the tile's real final
 * cell, even if the viewport shifted mid-drag.
 */

import { useCallback, useEffect, useRef } from "react";

export type DragSource =
  | { type: "rack"; rackIndex: number }
  | { type: "board"; row: number; col: number };

export interface DropTargets {
  /** Board cell drop. Return false to bounce the tile back. */
  onDropOnBoard: (source: DragSource, row: number, col: number) => boolean;
  /** Rack drop (visible slot index). Return false to bounce back. */
  onDropOnRack: (source: DragSource, visibleIndex: number) => boolean;
  /** Live rack insertion preview while dragging a rack tile. */
  onRackPreview: (
    preview: { rackIndex: number; visibleIndex: number } | null
  ) => void;
  /** Pointer down+up without movement. */
  onTap: (source: DragSource) => void;
  canDropOnCell: (row: number, col: number) => boolean;
  boardSize: number;
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
  rackHitSlots: RackSlot[] | null;
  pickupTimerId: number | null;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  originRect: DOMRect;
  moved: boolean;
  rafId: number | null;
  settled: boolean;
  previewRackIndex: number | null;
}

interface RackSlot {
  rect: DOMRect;
  rackIndex: number | null;
  visibleIndex: number;
}

interface DropGeometry {
  boardRect: DOMRect | null;
  rackRect: DOMRect | null;
  rackSlots: RackSlot[];
  cellSize: number;
  rackVisibleCount: number;
}

export const useTileDrag = (targets: DropTargets): TileDragApi => {
  const boardRef = useRef<HTMLDivElement>(null);
  const rackRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<ActiveDrag | null>(null);
  const targetsRef = useRef(targets);
  targetsRef.current = targets;

  const setBoardDragLocked = useCallback((locked: boolean) => {
    boardRef.current
      ?.closest(".board-viewport")
      ?.dispatchEvent(new CustomEvent("boarddrag:lock", { detail: locked }));
  }, []);

  const cleanup = useCallback((drag: ActiveDrag, revealSource = true) => {
    if (drag.rafId != null) cancelAnimationFrame(drag.rafId);
    if (drag.pickupTimerId != null) window.clearTimeout(drag.pickupTimerId);
    drag.ghost.remove();
    if (revealSource) {
      drag.sourceEl.classList.remove("tile--drag-hidden");
    } else {
      const sourceEl = drag.sourceEl;
      window.setTimeout(() => {
        if (sourceEl.isConnected) {
          sourceEl.classList.remove("tile--drag-hidden");
        }
      }, SETTLE_MS);
    }
    if (drag.sourceEl.hasPointerCapture(drag.pointerId)) {
      drag.sourceEl.releasePointerCapture(drag.pointerId);
    }
    if (drag.previewRackIndex != null) {
      targetsRef.current.onRackPreview(null);
    }
    setBoardDragLocked(false);
    activeRef.current = null;
  }, [setBoardDragLocked]);

  useEffect(
    () => () => {
      if (activeRef.current) cleanup(activeRef.current);
    },
    [cleanup]
  );

  /** Fresh geometry, measured at drop time. */
  const measure = (): DropGeometry => {
    const boardEl = boardRef.current;
    const rackEl = rackRef.current;
    const boardRect = boardEl?.getBoundingClientRect() ?? null;
    const rackRect = rackEl?.getBoundingClientRect() ?? null;
    const boardSize = targetsRef.current.boardSize;
    const cellSize = boardRect ? boardRect.width / boardSize : 0;
    const rackSlots = rackEl
      ? Array.from(rackEl.querySelectorAll<HTMLElement>("[data-rack-tile]")).map(
          (el, visibleIndex) => ({
            rect: el.getBoundingClientRect(),
            rackIndex:
              el.dataset.rackIndex == null ? null : Number(el.dataset.rackIndex),
            visibleIndex,
          })
        )
      : [];
    return {
      boardRect,
      rackRect,
      rackSlots,
      cellSize,
      rackVisibleCount: rackSlots.length,
    };
  };

  const hitTestBoard = (
    geometry: DropGeometry,
    x: number,
    y: number
  ): { row: number; col: number } | null => {
    const rect = geometry.boardRect;
    if (!rect || geometry.cellSize <= 0) return null;
    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
      return null;
    }
    // When the board is zoomed, parts of it are clipped away by the viewport.
    // The drop point must actually land on the visible board (the ghost has
    // pointer-events: none, so elementFromPoint sees through it).
    const boardEl = boardRef.current;
    if (boardEl) {
      const under = document.elementFromPoint(x, y);
      if (!under || !boardEl.contains(under)) return null;
    }
    const col = Math.floor((x - rect.left) / geometry.cellSize);
    const row = Math.floor((y - rect.top) / geometry.cellSize);
    if (row < 0 || col < 0 || row >= targetsRef.current.boardSize || col >= targetsRef.current.boardSize) {
      return null;
    }
    return { row, col };
  };

  const hitTestRack = (
    geometry: DropGeometry,
    x: number,
    y: number,
    excludeRackIndex: number | null = null,
    rackSlots: RackSlot[] = geometry.rackSlots
  ): number | null => {
    const rect = geometry.rackRect;
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
    const slots =
      excludeRackIndex == null
        ? rackSlots
        : rackSlots.filter((slot) => slot.rackIndex !== excludeRackIndex);
    if (slots.length === 0) return 0;
    const coveredSlot = slots.find(
      (slot) =>
        x >= slot.rect.left &&
        x <= slot.rect.right &&
        y >= slot.rect.top &&
        y <= slot.rect.bottom
    );
    if (coveredSlot) return coveredSlot.visibleIndex;

    const centers = slots.map((slot) => slot.rect.left + slot.rect.width / 2);
    const insertionIndex = centers.findIndex((center) => x < center);
    return insertionIndex === -1 ? slots.length : insertionIndex;
  };

  const rackSlotTarget = (
    geometry: DropGeometry,
    visibleIndex: number
  ): { left: number; top: number } | null => {
    const slots = geometry.rackSlots;
    if (slots.length === 0) return null;
    const slot = slots[Math.max(0, Math.min(visibleIndex, slots.length - 1))];
    return { left: slot.rect.left, top: slot.rect.top };
  };

  const rackSourceTarget = (drag: ActiveDrag): { left: number; top: number } => {
    if (typeof drag.sourceEl.getAnimations === "function") {
      drag.sourceEl.getAnimations().forEach((animation) => animation.finish());
    }
    const rect = drag.sourceEl.getBoundingClientRect();
    return { left: rect.left, top: rect.top };
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
      {
        duration: durationMs,
        easing: "cubic-bezier(0.2, 0.9, 0.3, 1)",
        fill: "forwards",
      }
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

    // The release point is where the settle animation starts from.
    drag.lastX = x;
    drag.lastY = y;

    const geometry = measure();

    const cell = hitTestBoard(geometry, x, y);
    if (
      cell &&
      targetsApi.canDropOnCell(cell.row, cell.col) &&
      geometry.boardRect
    ) {
      const toX = geometry.boardRect.left + cell.col * geometry.cellSize;
      const toY = geometry.boardRect.top + cell.row * geometry.cellSize;
      animateGhostTo(drag, toX, toY, SETTLE_MS, () => {
        const dropped = targetsApi.onDropOnBoard(drag.source, cell.row, cell.col);
        cleanup(drag, !dropped);
      });
      return;
    }

    const hitRackIndex = hitTestRack(
      geometry,
      x,
      y,
      drag.source.type === "rack" ? drag.source.rackIndex : null,
      drag.rackHitSlots ?? geometry.rackSlots
    );
    const rackIndex =
      drag.source.type === "rack" && hitRackIndex != null
        ? (drag.previewRackIndex ?? hitRackIndex)
        : hitRackIndex;
    const rackTarget =
      rackIndex == null
        ? null
        : drag.source.type === "rack"
          ? rackSourceTarget(drag)
          : rackSlotTarget(geometry, rackIndex);
    if (rackIndex != null && rackTarget) {
      animateGhostTo(drag, rackTarget.left, rackTarget.top, SETTLE_MS, () => {
        const dropped = targetsApi.onDropOnRack(drag.source, rackIndex);
        cleanup(drag, !dropped || drag.source.type === "rack");
      });
      return;
    }

    // Anywhere else: the tile goes home to the rack.
    if (drag.source.type === "board" && geometry.rackRect) {
      // Off-board drop of a board tile: return it to the rack's end slot.
      const appendIndex = geometry.rackVisibleCount;
      const rackTarget = rackSlotTarget(geometry, appendIndex);
      if (!rackTarget) {
        animateGhostTo(
          drag,
          drag.originRect.left,
          drag.originRect.top,
          RETURN_MS,
          () => cleanup(drag)
        );
        return;
      }
      const source = drag.source;
      animateGhostTo(drag, rackTarget.left, rackTarget.top, RETURN_MS, () => {
        const dropped = targetsApi.onDropOnRack(source, appendIndex);
        cleanup(drag, !dropped);
      });
      return;
    }

    // Rack tile released off-board: glide back to its rack slot.
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

      // Ghost: the actual tile face, carried under the pointer.
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
      ghost.style.transform = "translate3d(0, 0, 0) scale(1)";
      ghost.style.transition = `transform ${PICKUP_MS}ms ease-out`;
      document.body.appendChild(ghost);

      requestAnimationFrame(() => {
        if (activeRef.current?.ghost === ghost) {
          ghost.style.transform = "translate3d(0, 0, 0) scale(1.06)";
        }
      });

      const drag: ActiveDrag = {
        pointerId: event.pointerId,
        source,
        sourceEl,
        ghost,
        rackHitSlots: source.type === "rack" ? measure().rackSlots : null,
        pickupTimerId: window.setTimeout(() => {
          drag.pickupTimerId = null;
          ghost.style.transition = "";
        }, PICKUP_MS),
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        originRect,
        moved: false,
        rafId: null,
        settled: false,
        previewRackIndex: null,
      };
      activeRef.current = drag;
      setBoardDragLocked(true);

      event.preventDefault();
      sourceEl.setPointerCapture(event.pointerId);

      const render = () => {
        if (activeRef.current !== drag || drag.settled) return;
        const dx = drag.lastX - drag.startX;
        const dy = drag.lastY - drag.startY;
        ghost.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(1.06)`;
        drag.rafId = null;
      };

      const onMove = (e: PointerEvent) => {
        if (e.pointerId !== drag.pointerId || drag.settled) return;
        e.preventDefault();
        drag.lastX = e.clientX;
        drag.lastY = e.clientY;
        if (drag.pickupTimerId != null) {
          window.clearTimeout(drag.pickupTimerId);
          drag.pickupTimerId = null;
          ghost.style.transition = "";
        }
        if (
          !drag.moved &&
          Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) >
            TAP_DISTANCE_PX
        ) {
          drag.moved = true;
          drag.sourceEl.classList.add("tile--drag-hidden");
        }
        if (drag.source.type === "rack" && drag.moved) {
          const rackIndex = hitTestRack(
            measure(),
            e.clientX,
            e.clientY,
            drag.source.rackIndex,
            drag.rackHitSlots ?? undefined
          );
          if (rackIndex !== drag.previewRackIndex) {
            drag.previewRackIndex = rackIndex;
            targetsRef.current.onRackPreview(
              rackIndex == null
                ? null
                : { rackIndex: drag.source.rackIndex, visibleIndex: rackIndex }
            );
          }
        }
        if (drag.rafId == null) {
          drag.rafId = requestAnimationFrame(render);
        }
      };

      const teardownListeners = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
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

      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    },
    [cleanup]
  );

  return { startDrag, boardRef, rackRef };
};
