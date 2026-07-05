import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * Pinch/double-tap zoom for the board ONLY. The transform lives on an inner
 * wrapper and is driven imperatively (never through React state per frame),
 * so surrounding HUD/buttons are untouched and drags stay smooth.
 *
 * Tile pointerdown handlers call stopPropagation, so any pointer that reaches
 * this container is a board-background gesture (pinch, pan, double-tap).
 */

const MIN_SCALE = 1;
const MAX_SCALE = 2.5;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_DIST = 40;
const DOUBLE_TAP_ZOOM = 1.9;

interface BoardViewportProps {
  children: ReactNode;
  overlay?: ReactNode;
  /** Outer wrapper; ResizeObserver target for --cell-size lives here. */
  wrapRef: React.RefObject<HTMLDivElement>;
}

export const BoardViewport = ({
  children,
  overlay = null,
  wrapRef,
}: BoardViewportProps) => {
  const innerRef = useRef<HTMLDivElement>(null);
  const [zoomed, setZoomed] = useState(false);

  const stateRef = useRef({
    scale: 1,
    tx: 0,
    ty: 0,
    pointers: new Map<number, { x: number; y: number }>(),
    pinch: null as null | {
      startDist: number;
      startScale: number;
      startMidX: number;
      startMidY: number;
      startTx: number;
      startTy: number;
    },
    panning: false,
    dragLocked: false,
    panLast: { x: 0, y: 0 },
    moved: false,
    lastTap: { time: 0, x: 0, y: 0 },
  });

  useEffect(() => {
    const outer = wrapRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const s = stateRef.current;

    const apply = () => {
      const size = outer.clientWidth;
      const minT = size - size * s.scale;
      s.tx = Math.min(0, Math.max(minT, s.tx));
      s.ty = Math.min(0, Math.max(minT, s.ty));
      inner.style.transform = `translate(${s.tx}px, ${s.ty}px) scale(${s.scale})`;
      setZoomed(s.scale > 1.02);
    };

    const zoomTo = (nextScale: number, clientX: number, clientY: number) => {
      const rect = outer.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
      // Keep the point under the gesture anchored.
      s.tx = px - ((px - s.tx) / s.scale) * clamped;
      s.ty = py - ((py - s.ty) / s.scale) * clamped;
      s.scale = clamped;
      apply();
    };

    const reset = () => {
      s.scale = 1;
      s.tx = 0;
      s.ty = 0;
      apply();
    };

    const onPointerDown = (e: PointerEvent) => {
      if (s.dragLocked) return;
      s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      s.moved = false;
      outer.setPointerCapture(e.pointerId);

      if (s.pointers.size === 2) {
        const [a, b] = [...s.pointers.values()];
        s.pinch = {
          startDist: Math.hypot(a.x - b.x, a.y - b.y),
          startScale: s.scale,
          startMidX: (a.x + b.x) / 2,
          startMidY: (a.y + b.y) / 2,
          startTx: s.tx,
          startTy: s.ty,
        };
        s.panning = false;
      } else if (s.pointers.size === 1 && s.scale > 1) {
        s.panning = true;
        s.panLast = { x: e.clientX, y: e.clientY };
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (s.dragLocked) return;
      const prev = s.pointers.get(e.pointerId);
      if (!prev) return;
      if (Math.hypot(e.clientX - prev.x, e.clientY - prev.y) > 4) {
        s.moved = true;
      }
      s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (s.pinch && s.pointers.size >= 2) {
        const [a, b] = [...s.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (s.pinch.startDist > 0) {
          const rect = outer.getBoundingClientRect();
          const ratio = dist / s.pinch.startDist;
          const nextScale = Math.min(
            MAX_SCALE,
            Math.max(MIN_SCALE, s.pinch.startScale * ratio)
          );
          const midX = (a.x + b.x) / 2 - rect.left;
          const midY = (a.y + b.y) / 2 - rect.top;
          const startMidX = s.pinch.startMidX - rect.left;
          const startMidY = s.pinch.startMidY - rect.top;
          const k = nextScale / s.pinch.startScale;
          s.tx = midX - (startMidX - s.pinch.startTx) * k;
          s.ty = midY - (startMidY - s.pinch.startTy) * k;
          s.scale = nextScale;
          apply();
        }
      } else if (s.panning) {
        s.tx += e.clientX - s.panLast.x;
        s.ty += e.clientY - s.panLast.y;
        s.panLast = { x: e.clientX, y: e.clientY };
        apply();
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      const wasPinching = s.pinch != null;
      s.pointers.delete(e.pointerId);
      if (s.pointers.size < 2) s.pinch = null;
      if (s.pointers.size === 0) s.panning = false;

      // Double-tap / double-click toggles zoom.
      if (!s.moved && !wasPinching) {
        const now = performance.now();
        const { lastTap } = s;
        if (
          now - lastTap.time < DOUBLE_TAP_MS &&
          Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) <
            DOUBLE_TAP_DIST
        ) {
          if (s.scale > 1.05) {
            reset();
          } else {
            zoomTo(DOUBLE_TAP_ZOOM, e.clientX, e.clientY);
          }
          s.lastTap = { time: 0, x: 0, y: 0 };
        } else {
          s.lastTap = { time: now, x: e.clientX, y: e.clientY };
        }
      }
    };

    const onPointerCancel = (e: PointerEvent) => {
      s.pointers.delete(e.pointerId);
      if (s.pointers.size < 2) s.pinch = null;
      if (s.pointers.size === 0) s.panning = false;
    };

    // Block browser pinch-zoom fallbacks inside the board.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return; // trackpad pinch arrives as ctrl+wheel
      e.preventDefault();
      zoomTo(s.scale * (e.deltaY < 0 ? 1.15 : 0.87), e.clientX, e.clientY);
    };

    const resetListener = () => reset();
    const dragLockListener = (event: Event) => {
      const locked = Boolean((event as CustomEvent<boolean>).detail);
      s.dragLocked = locked;
      if (locked) {
        s.pointers.clear();
        s.pinch = null;
        s.panning = false;
      }
    };

    outer.addEventListener("pointerdown", onPointerDown);
    outer.addEventListener("pointermove", onPointerMove);
    outer.addEventListener("pointerup", onPointerUp);
    outer.addEventListener("pointercancel", onPointerCancel);
    outer.addEventListener("wheel", onWheel, { passive: false });
    outer.addEventListener("boardzoom:reset", resetListener);
    outer.addEventListener("boarddrag:lock", dragLockListener);
    return () => {
      outer.removeEventListener("pointerdown", onPointerDown);
      outer.removeEventListener("pointermove", onPointerMove);
      outer.removeEventListener("pointerup", onPointerUp);
      outer.removeEventListener("pointercancel", onPointerCancel);
      outer.removeEventListener("wheel", onWheel);
      outer.removeEventListener("boardzoom:reset", resetListener);
      outer.removeEventListener("boarddrag:lock", dragLockListener);
    };
  }, [wrapRef]);

  return (
    <div className="board-viewport" ref={wrapRef}>
      <div className="board-viewport__inner" ref={innerRef}>
        {children}
      </div>
      {overlay}
      {zoomed ? (
        <button
          className="board-viewport__reset"
          onClick={() =>
            wrapRef.current?.dispatchEvent(new Event("boardzoom:reset"))
          }
        >
          1×
        </button>
      ) : null}
    </div>
  );
};
