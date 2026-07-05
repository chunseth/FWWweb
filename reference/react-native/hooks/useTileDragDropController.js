import { useCallback, useMemo, useRef, useState } from "react";
import { Animated, Easing, unstable_batchedUpdates } from "react-native";
import { SLOT_WIDTH as RACK_SLOT_WIDTH } from "../components/TileRack";

const DRAG_TILE_HALF_SIZE = 21;
const DRAG_RACK_SETTLE_DURATION = 30;
const DRAG_BOARD_SETTLE_DURATION = 140;
const DRAG_BOARD_INVALID_RETURN_DURATION = 170;
const DRAG_RACK_RETURN_DURATION = 170;
const DRAG_RACK_RELEASE_CATCHUP_DURATION = 40;
const DRAG_RACK_RELEASE_CATCHUP_MIN_DISTANCE_PX = 10;
const DRAG_BOARD_PICKUP_DURATION = 70;
const DRAG_RACK_PICKUP_DURATION = 70;
const BOARD_TILE_PICKUP_SLOP = 35;
const RACK_HOVER_STEP_DURATION = 18;
const RACK_HOVER_MAX_DURATION = 90;
const BOARD_SETTLE_CLEANUP_FALLBACK_MS = 48;
const RACK_REORDER_INTENT_THRESHOLD_PX = 12;
const MAX_RACK_POINTER_CORRECTION_PX = 220;
const DRAG_TILE_SIZE = DRAG_TILE_HALF_SIZE * 2;
const ENABLE_RACK_DRAG_LOGS =
  (typeof __DEV__ !== "undefined" ? __DEV__ : false) &&
  global.__RACK_DRAG_LOGS__ === true;

export const useTileDragDropController = ({
  containerRef,
  boardLayoutRef,
  rackTiles,
  isRackTileUsed,
  board,
  boardSize,
  rackDropExpansionTop = 270,
  rackDropExpansionBottom = 100,
  canInteract = true,
  isBoardTileDraggable,
  isBlankRackTile,
  getRackTileByIndex,
  getRackIndexByTileId,
  onPlaceRackTile,
  onMoveBoardTile,
  onRemoveBoardTile,
  onReorderRack,
  onBoardCellTap,
  onBlankPlacementRequested,
}) => {
  const rackLayoutRef = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const containerWindowRef = useRef({ x: 0, y: 0 });
  const dragTouchOffsetRef = useRef({
    x: DRAG_TILE_HALF_SIZE,
    y: DRAG_TILE_HALF_SIZE,
  });
  const rackPointerCorrectionRef = useRef({ x: 0, y: 0 });
  const dragTargetRef = useRef({ x: 0, y: 0 });
  const rackDragMetricsRef = useRef(null);
  const rackSettleActiveRef = useRef(null);
  const rackSettleIdRef = useRef(0);
  const dragAnimatingPickupRef = useRef(false);
  const dragPendingFinalizeRef = useRef(null);
  const dragReleasedDuringPickupRef = useRef(false);
  const hoverIndexRef = useRef(null);
  const boardHoverRackIndexRef = useRef(null);
  const boardDragPayloadRef = useRef(null);
  const pendingBoardDragPointRef = useRef(null);
  const boardDragUpdateFrameRef = useRef(null);
  const pendingDropTargetRackIndexRef = useRef(null);
  const dropTargetFrameRef = useRef(null);
  const rackSettleClearTimeoutRef = useRef(null);
  const boardReturnCommitTimeoutRef = useRef(null);
  const boardSettleCleanupTimeoutRef = useRef(null);
  const getNow = useCallback(
    () =>
      typeof globalThis?.performance?.now === "function"
        ? globalThis.performance.now()
        : Date.now(),
    []
  );
  const getWallClockNow = useCallback(() => Date.now(), []);
  const logRackDrag = useCallback((event, details = {}) => {
    if (!ENABLE_RACK_DRAG_LOGS) return;
    const wallClockMs = getWallClockNow();
    console.log(`[rack-drag] ${event}`, {
      wallClockMs,
      isoTime: new Date(wallClockMs).toISOString(),
      ...details,
    });
  }, [getWallClockNow]);

  const dragPosition = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const dragScale = useRef(new Animated.Value(1)).current;
  const settlePosition = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const settleScale = useRef(new Animated.Value(1)).current;
  const rackHoverIndexValue = useRef(new Animated.Value(-1)).current;
  const boardRackPlaceholderIndexValue = useRef(
    new Animated.Value(-1)
  ).current;
  const rackDraggingVisibleIndexValue = useRef(
    new Animated.Value(-1)
  ).current;

  const [draggingTile, setDraggingTile] = useState(null);
  const [settlingTile, setSettlingTile] = useState(null);
  const [dropTargetRackIndex, setDropTargetRackIndex] = useState(null);
  const [boardHoverRackIndex, setBoardHoverRackIndex] = useState(null);
  const [optimisticPlacement, setOptimisticPlacement] = useState(null);
  const draggingTileRef = useRef(null);
  const settlingTileRef = useRef(null);
  const dropTargetRackIndexRef = useRef(null);
  const optimisticPlacementRef = useRef(null);

  const updateDraggingTile = useCallback((value) => {
    draggingTileRef.current = value;
    setDraggingTile(value);
  }, []);

  const updateSettlingTile = useCallback((value) => {
    settlingTileRef.current = value;
    setSettlingTile(value);
  }, []);

  const updateDropTargetRackIndex = useCallback((value) => {
    dropTargetRackIndexRef.current = value;
    setDropTargetRackIndex(value);
  }, []);

  const flushDropTargetRackIndex = useCallback(() => {
    dropTargetFrameRef.current = null;
    if (pendingDropTargetRackIndexRef.current !== dropTargetRackIndexRef.current) {
      updateDropTargetRackIndex(pendingDropTargetRackIndexRef.current);
    }
  }, [updateDropTargetRackIndex]);

  const scheduleDropTargetRackIndex = useCallback(
    (value) => {
      pendingDropTargetRackIndexRef.current = value;
      if (dropTargetFrameRef.current != null) {
        return;
      }
      dropTargetFrameRef.current = requestAnimationFrame(flushDropTargetRackIndex);
    },
    [flushDropTargetRackIndex]
  );

  const updateOptimisticPlacement = useCallback((value) => {
    optimisticPlacementRef.current = value;
    setOptimisticPlacement(value);
  }, []);

  const visibleRackTiles = useMemo(
    () =>
      rackTiles
        .map((tile, index) => ({
          ...tile,
          hidden:
            ((settlingTile?.destination === "rack" &&
              settlingTile?.id != null &&
              settlingTile?.id === tile.id) ||
              (draggingTile?.settlingDestination === "rack" &&
                draggingTile?.tile?.id != null &&
                draggingTile?.tile?.id === tile.id)),
          used:
            optimisticPlacement?.id === tile.id ||
            (settlingTile?.destination === "board" &&
              settlingTile?.id === tile.id) ||
            isRackTileUsed(tile, index),
          rackIndex: index,
        }))
        .filter((tile) => !tile.used)
        .map((tile, visibleIndex) => ({
          ...tile,
          visibleIndex,
        })),
    [draggingTile, isRackTileUsed, optimisticPlacement, rackTiles, settlingTile]
  );

  const refreshContainerWindowPosition = useCallback(() => {
    containerRef.current?.measureInWindow?.((x, y) => {
      containerWindowRef.current = { x, y };
    });
  }, [containerRef]);

  const updateRackLayout = useCallback((layout) => {
    if (!layout) return;
    rackLayoutRef.current = layout;
  }, []);

  const resetController = useCallback(() => {
    rackSettleActiveRef.current = null;
    rackDragMetricsRef.current = null;
    hoverIndexRef.current = null;
    boardHoverRackIndexRef.current = null;
    boardDragPayloadRef.current = null;
    pendingDropTargetRackIndexRef.current = null;
    if (dropTargetFrameRef.current != null) {
      cancelAnimationFrame(dropTargetFrameRef.current);
      dropTargetFrameRef.current = null;
    }
    if (boardDragUpdateFrameRef.current != null) {
      cancelAnimationFrame(boardDragUpdateFrameRef.current);
      boardDragUpdateFrameRef.current = null;
    }
    pendingBoardDragPointRef.current = null;
    if (rackSettleClearTimeoutRef.current != null) {
      clearTimeout(rackSettleClearTimeoutRef.current);
      rackSettleClearTimeoutRef.current = null;
    }
    if (boardReturnCommitTimeoutRef.current != null) {
      clearTimeout(boardReturnCommitTimeoutRef.current);
      boardReturnCommitTimeoutRef.current = null;
    }
    if (boardSettleCleanupTimeoutRef.current != null) {
      clearTimeout(boardSettleCleanupTimeoutRef.current);
      boardSettleCleanupTimeoutRef.current = null;
    }
    updateDraggingTile(null);
    updateSettlingTile(null);
    updateDropTargetRackIndex(null);
    boardHoverRackIndexRef.current = null;
    setBoardHoverRackIndex(null);
    updateOptimisticPlacement(null);
    dragAnimatingPickupRef.current = false;
    dragPendingFinalizeRef.current = null;
    dragReleasedDuringPickupRef.current = false;
    rackPointerCorrectionRef.current = { x: 0, y: 0 };
    dragPosition.stopAnimation();
    dragScale.stopAnimation();
    dragPosition.setValue({ x: 0, y: 0 });
    dragScale.setValue(1);
    settlePosition.stopAnimation();
    settleScale.stopAnimation();
    settlePosition.setValue({ x: 0, y: 0 });
    settleScale.setValue(1);
    rackHoverIndexValue.stopAnimation();
    rackDraggingVisibleIndexValue.stopAnimation();
    rackHoverIndexValue.setValue(-1);
    boardRackPlaceholderIndexValue.setValue(-1);
    rackDraggingVisibleIndexValue.setValue(-1);
  }, [
    boardRackPlaceholderIndexValue,
    dragPosition,
    dragScale,
    rackDraggingVisibleIndexValue,
    rackHoverIndexValue,
    settlePosition,
    settleScale,
    updateDraggingTile,
    updateDropTargetRackIndex,
    updateOptimisticPlacement,
    updateSettlingTile,
  ]);

  const resetDragAnimation = useCallback(() => {
    dragAnimatingPickupRef.current = false;
    dragPendingFinalizeRef.current = null;
    dragReleasedDuringPickupRef.current = false;
    dragPosition.stopAnimation();
    dragScale.stopAnimation();
    dragPosition.setValue(dragTargetRef.current);
    dragScale.setValue(1);
  }, [dragPosition, dragScale]);

  const getDragPositionFromScreen = useCallback(
    (screenX, screenY) => {
      const { x: ox, y: oy } = containerWindowRef.current;
      const { x: touchOffsetX, y: touchOffsetY } = dragTouchOffsetRef.current;
      return {
        x: screenX - ox - touchOffsetX,
        y: screenY - oy - touchOffsetY,
      };
    },
    []
  );

  const setDragPositionFromScreen = useCallback(
    (screenX, screenY) => {
      dragTargetRef.current = getDragPositionFromScreen(screenX, screenY);
      if (dragAnimatingPickupRef.current) {
        dragAnimatingPickupRef.current = false;
        dragPendingFinalizeRef.current = null;
        dragReleasedDuringPickupRef.current = false;
        dragPosition.stopAnimation();
        dragScale.stopAnimation();
        dragScale.setValue(1);
      }
      dragPosition.setValue(dragTargetRef.current);
    },
    [dragPosition, getDragPositionFromScreen]
  );

  const getRackTileSourceTarget = useCallback((visibleIndex, slotCount) => {
    const {
      x: rackScreenX,
      y: rackScreenY,
      width: rackWidth,
      height: rackHeight,
    } = rackLayoutRef.current;
    const { x: containerScreenX, y: containerScreenY } =
      containerWindowRef.current;
    if (
      typeof rackScreenX !== "number" ||
      typeof rackScreenY !== "number" ||
      typeof rackWidth !== "number" ||
      typeof rackHeight !== "number" ||
      rackWidth <= 0 ||
      rackHeight <= 0 ||
      typeof containerScreenX !== "number" ||
      typeof containerScreenY !== "number" ||
      slotCount <= 0 ||
      visibleIndex == null
    ) {
      return null;
    }

    const tileSize = DRAG_TILE_HALF_SIZE * 2;
    const rackLeft =
      rackScreenX -
      containerScreenX +
      (rackWidth - slotCount * RACK_SLOT_WIDTH) / 2;
    const tileTop =
      rackScreenY - containerScreenY + Math.max(0, (rackHeight - tileSize) / 2);
    return {
      x:
        rackLeft +
        visibleIndex * RACK_SLOT_WIDTH +
        (RACK_SLOT_WIDTH - tileSize) / 2,
      y: tileTop,
    };
  }, []);

  const getRackSlotTarget = useCallback((slotIndex, slotCount) => {
    const {
      x: rackScreenX,
      y: rackScreenY,
      width: rackWidth,
      height: rackHeight,
    } = rackLayoutRef.current;
    const { x: containerScreenX, y: containerScreenY } =
      containerWindowRef.current;
    if (
      typeof rackScreenX !== "number" ||
      typeof rackScreenY !== "number" ||
      typeof rackWidth !== "number" ||
      typeof rackHeight !== "number" ||
      typeof containerScreenX !== "number" ||
      typeof containerScreenY !== "number" ||
      slotCount <= 0 ||
      slotIndex == null
    ) {
      return null;
    }

    const tileSize = DRAG_TILE_HALF_SIZE * 2;
    const rackLeft =
      rackScreenX -
      containerScreenX +
      (rackWidth - slotCount * RACK_SLOT_WIDTH) / 2;
    const tileTop =
      rackScreenY - containerScreenY + Math.max(0, (rackHeight - tileSize) / 2);

    return {
      x:
        rackLeft +
        slotIndex * RACK_SLOT_WIDTH +
        (RACK_SLOT_WIDTH - tileSize) / 2,
      y: tileTop,
    };
  }, []);

  const getBoardTileSettleTarget = useCallback(
    (row, col) => {
      const layout = boardLayoutRef.current;
      const { x: containerScreenX, y: containerScreenY } =
        containerWindowRef.current;
      if (
        !layout ||
        typeof containerScreenX !== "number" ||
        typeof containerScreenY !== "number"
      ) {
        return null;
      }

      const { screenLeft, screenTop, screenRight, screenBottom } = layout;
      if (
        typeof screenLeft !== "number" ||
        typeof screenTop !== "number" ||
        typeof screenRight !== "number" ||
        typeof screenBottom !== "number"
      ) {
        return null;
      }

      const boardScreenSize = screenRight - screenLeft;
      const boardScreenHeight = screenBottom - screenTop;
      if (boardScreenSize <= 0 || boardScreenHeight <= 0) return null;

      const screenCellWidth = boardScreenSize / boardSize;
      const screenCellHeight = boardScreenHeight / boardSize;
      const tileRatio =
        layout.cellSize > 0
          ? Math.max(0.01, (layout.cellSize - 3) / layout.cellSize)
          : 1;
      const tileScreenSize =
        Math.min(screenCellWidth, screenCellHeight) * tileRatio;
      let tileScale = tileScreenSize / (DRAG_TILE_HALF_SIZE * 2);
      const zoomState =
        typeof layout.getZoomPan === "function" ? layout.getZoomPan() : null;
      const zoomValue =
        zoomState && Number.isFinite(zoomState.zoom) ? zoomState.zoom : null;
      if (
        zoomValue != null &&
        typeof layout.cellSize === "number" &&
        layout.cellSize > 0
      ) {
        // `measureInWindow` can briefly lag while pinch-zoom is active, so floor the
        // settle scale by the live zoom-derived tile size to avoid false "shrink" drops.
        const zoomDerivedTileScale =
          (Math.max(1, layout.cellSize - 3) * Math.max(1, zoomValue)) /
          (DRAG_TILE_HALF_SIZE * 2);
        tileScale = Math.max(tileScale, zoomDerivedTileScale);
      }
      const cellCenterX =
        screenLeft - containerScreenX + (col + 0.5) * screenCellWidth;
      const cellCenterY =
        screenTop - containerScreenY + (row + 0.5) * screenCellHeight;

      return {
        x: cellCenterX - DRAG_TILE_HALF_SIZE,
        y: cellCenterY - DRAG_TILE_HALF_SIZE,
        scale: tileScale,
      };
    },
    [boardLayoutRef, boardSize]
  );

  const animateDragPickup = useCallback(() => {
    dragAnimatingPickupRef.current = false;
    dragPendingFinalizeRef.current = null;
    dragReleasedDuringPickupRef.current = false;
    dragPosition.stopAnimation();
    dragScale.stopAnimation();
    dragPosition.setValue(dragTargetRef.current);
    dragScale.setValue(1);
  }, [dragPosition, dragScale]);

  const animateBoardPickupToDragTarget = useCallback(
    (row, col) => {
      const sourceTarget = getBoardTileSettleTarget(row, col);
      if (!sourceTarget) {
        animateDragPickup();
        return;
      }
      dragAnimatingPickupRef.current = true;
      dragPendingFinalizeRef.current = null;
      dragReleasedDuringPickupRef.current = false;
      dragPosition.stopAnimation();
      dragScale.stopAnimation();
      dragPosition.setValue({ x: sourceTarget.x, y: sourceTarget.y });
      dragScale.setValue(sourceTarget.scale);
      requestAnimationFrame(() => {
        if (!dragAnimatingPickupRef.current) return;
        const pickupTarget = { ...dragTargetRef.current };
        Animated.parallel([
          Animated.timing(dragPosition, {
            toValue: pickupTarget,
            duration: DRAG_BOARD_PICKUP_DURATION,
            useNativeDriver: true,
          }),
          Animated.timing(dragScale, {
            toValue: 1,
            duration: DRAG_BOARD_PICKUP_DURATION,
            useNativeDriver: true,
          }),
        ]).start(({ finished }) => {
          dragAnimatingPickupRef.current = false;
          dragPosition.setValue(dragTargetRef.current);
          dragScale.setValue(1);
          if (!finished) return;
          const pendingFinalize = dragPendingFinalizeRef.current;
          if (pendingFinalize) {
            dragPendingFinalizeRef.current = null;
            pendingFinalize();
          }
        });
      });
    },
    [animateDragPickup, dragPosition, dragScale, getBoardTileSettleTarget]
  );

  const animateRackPickupToDragTarget = useCallback(
    (sourceX, sourceY) => {
      dragAnimatingPickupRef.current = true;
      dragPendingFinalizeRef.current = null;
      dragReleasedDuringPickupRef.current = false;
      dragPosition.stopAnimation();
      dragScale.stopAnimation();
      dragPosition.setValue({ x: sourceX, y: sourceY });
      dragScale.setValue(1);
      Animated.parallel([
        Animated.timing(dragPosition, {
          toValue: dragTargetRef.current,
          duration: DRAG_RACK_PICKUP_DURATION,
          useNativeDriver: true,
        }),
        Animated.timing(dragScale, {
          toValue: 1,
          duration: DRAG_RACK_PICKUP_DURATION,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        dragAnimatingPickupRef.current = false;
        dragPosition.setValue(dragTargetRef.current);
        dragScale.setValue(1);
        if (!finished) return;
        const pendingFinalize = dragPendingFinalizeRef.current;
        if (pendingFinalize) {
          dragPendingFinalizeRef.current = null;
          pendingFinalize();
        }
      });
    },
    [dragPosition, dragScale]
  );

  const animateSettlingTileToBoard = useCallback(
    (startPosition, startScaleValue, settleTarget, onComplete) => {
      settlePosition.setValue(startPosition);
      settleScale.setValue(startScaleValue);
      Animated.parallel([
        Animated.timing(settlePosition, {
          toValue: { x: settleTarget.x, y: settleTarget.y },
          duration: DRAG_BOARD_SETTLE_DURATION,
          useNativeDriver: true,
        }),
        Animated.timing(settleScale, {
          toValue: settleTarget.scale,
          duration: DRAG_BOARD_SETTLE_DURATION,
          useNativeDriver: true,
        }),
      ]).start(() => onComplete?.());
    },
    [settlePosition, settleScale]
  );

  const animateDragIntoRackSlot = useCallback(
    (slotIndex, slotCount, onComplete) => {
      const settleTarget = getRackSlotTarget(slotIndex, slotCount);
      if (!settleTarget) {
        onComplete();
        return;
      }
      dragTargetRef.current = settleTarget;
      Animated.timing(dragPosition, {
        toValue: settleTarget,
        duration: DRAG_RACK_SETTLE_DURATION,
        useNativeDriver: true,
      }).start(() => onComplete());
    },
    [dragPosition, getRackSlotTarget]
  );

  const finalizeDrag = useCallback(
    (commit, animateBeforeCommit, options = {}) => {
      const { interruptPickup = false } = options;
      const runCommit = () => {
        const finish = () => {
          updateDraggingTile(null);
          updateDropTargetRackIndex(null);
          resetDragAnimation();
          commit();
        };
        if (animateBeforeCommit) {
          animateBeforeCommit(finish);
          return;
        }
        finish();
      };

      if (dragAnimatingPickupRef.current) {
        if (interruptPickup) {
          dragAnimatingPickupRef.current = false;
          dragPendingFinalizeRef.current = null;
          dragReleasedDuringPickupRef.current = false;
          dragPosition.stopAnimation();
          dragScale.stopAnimation();
          runCommit();
          return;
        }
        dragReleasedDuringPickupRef.current = true;
        dragPendingFinalizeRef.current = runCommit;
        return;
      }

      runCommit();
    },
    [
      dragPosition,
      dragScale,
      resetDragAnimation,
      updateDraggingTile,
      updateDropTargetRackIndex,
    ]
  );

  const completeBoardDrop = useCallback(
    (
      tile,
      settleTarget,
      optimistic,
      commit,
      options = {}
    ) => {
      const {
        deferCommit = false,
        useSettlingState = true,
        settleDuration = DRAG_BOARD_SETTLE_DURATION,
      } = options;
      if (!settleTarget) {
        updateDraggingTile(null);
        updateDropTargetRackIndex(null);
        resetDragAnimation();
        commit?.();
        return;
      }

      dragAnimatingPickupRef.current = false;
      dragPendingFinalizeRef.current = null;
      dragReleasedDuringPickupRef.current = false;
      dragPosition.stopAnimation();
      dragScale.stopAnimation();
      if (useSettlingState) {
        updateSettlingTile({
          ...tile,
          destination: "board",
          fromRow: optimistic?.fromRow ?? null,
          fromCol: optimistic?.fromCol ?? null,
          row: optimistic?.row ?? null,
          col: optimistic?.col ?? null,
        });
      }
      dragTargetRef.current = {
        x: settleTarget.x,
        y: settleTarget.y,
      };
      if (boardSettleCleanupTimeoutRef.current != null) {
        clearTimeout(boardSettleCleanupTimeoutRef.current);
        boardSettleCleanupTimeoutRef.current = null;
      }
      let didCleanup = false;
      const finalizeBoardSettle = () => {
        if (didCleanup) return;
        didCleanup = true;
        if (boardSettleCleanupTimeoutRef.current != null) {
          clearTimeout(boardSettleCleanupTimeoutRef.current);
          boardSettleCleanupTimeoutRef.current = null;
        }
        updateDraggingTile(null);
        updateSettlingTile(null);
        updateDropTargetRackIndex(null);
        resetDragAnimation();
      };
      Animated.parallel([
        Animated.timing(dragPosition, {
          toValue: { x: settleTarget.x, y: settleTarget.y },
          duration: settleDuration,
          useNativeDriver: true,
        }),
        Animated.timing(dragScale, {
          toValue: settleTarget.scale,
          duration: settleDuration,
          useNativeDriver: true,
        }),
      ]).start(() => {
        finalizeBoardSettle();
      });
      boardSettleCleanupTimeoutRef.current = setTimeout(
        finalizeBoardSettle,
        settleDuration + BOARD_SETTLE_CLEANUP_FALLBACK_MS
      );
      if (deferCommit) {
        requestAnimationFrame(() => {
          commit?.();
        });
      } else {
        commit?.();
      }
    },
    [
      dragPosition,
      dragScale,
      resetDragAnimation,
      updateDraggingTile,
      updateDropTargetRackIndex,
      updateSettlingTile,
    ]
  );

  const completeRackReturn = useCallback(
    (tile, slotIndex, slotCount, commit, options = {}) => {
      const {
        releasePosition = null,
        shouldAnimateDisplacedReorder = false,
        forceReleaseCatchup = false,
      } = options;
      const settleTarget = getRackSlotTarget(slotIndex, slotCount);
      if (!settleTarget) {
        updateDraggingTile(null);
        updateDropTargetRackIndex(null);
        resetDragAnimation();
        commit?.();
        return;
      }
      dragAnimatingPickupRef.current = false;
      dragPendingFinalizeRef.current = null;
      dragReleasedDuringPickupRef.current = false;
      let dragStartPosition = dragTargetRef.current;
      let dragStartScale = 1;
      dragPosition.stopAnimation((value) => {
        if (value && typeof value.x === "number" && typeof value.y === "number") {
          dragStartPosition = value;
        }
      });
      dragScale.stopAnimation((value) => {
        if (typeof value === "number") {
          dragStartScale = value;
        }
      });
      settlePosition.stopAnimation();
      settleScale.stopAnimation();
      dragTargetRef.current = settleTarget;
      settlePosition.setValue({
        x: dragStartPosition.x,
        y: dragStartPosition.y,
      });
      settleScale.setValue(dragStartScale);
      const animateToSettleTarget = () => {
        Animated.parallel([
          Animated.timing(settlePosition, {
            toValue: { x: settleTarget.x, y: settleTarget.y },
            duration: DRAG_RACK_RETURN_DURATION,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(settleScale, {
            toValue: 1,
            duration: DRAG_RACK_RETURN_DURATION,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]).start(({ finished }) => {
          if (rackSettleActiveRef.current?.id === settleId) {
            rackSettleActiveRef.current = null;
          }
          logRackDrag("settle-end", {
            settleId,
            finished,
            slotIndex,
            slotCount,
            hasReleaseCatchup: false,
          });
          if (!finished) return;
          if (rackSettleClearTimeoutRef.current != null) {
            clearTimeout(rackSettleClearTimeoutRef.current);
            rackSettleClearTimeoutRef.current = null;
          }
          updateDraggingTile(null);
          updateSettlingTile(null);
          resetDragAnimation();
        });
      };
      const hasReleasePosition =
        releasePosition != null &&
        typeof releasePosition.x === "number" &&
        typeof releasePosition.y === "number";
      const releaseDistancePx = hasReleasePosition
        ? Math.hypot(
            releasePosition.x - dragStartPosition.x,
            releasePosition.y - dragStartPosition.y
          )
        : 0;
      const shouldAnimateReleaseCatchup =
        hasReleasePosition &&
        (forceReleaseCatchup ||
          releaseDistancePx > DRAG_RACK_RELEASE_CATCHUP_MIN_DISTANCE_PX);
      const settleId = rackSettleIdRef.current + 1;
      rackSettleIdRef.current = settleId;
      const settleDurationMs = shouldAnimateReleaseCatchup
        ? DRAG_RACK_RELEASE_CATCHUP_DURATION + DRAG_RACK_RETURN_DURATION
        : DRAG_RACK_RETURN_DURATION;
      const settleStartedAt = getNow();
      rackSettleActiveRef.current = {
        id: settleId,
        startedAt: settleStartedAt,
        expectedEndAt: settleStartedAt + settleDurationMs,
      };
      logRackDrag("settle-start", {
        settleId,
        slotIndex,
        slotCount,
        hasReleaseCatchup: shouldAnimateReleaseCatchup,
        releaseDistancePx: Math.round(releaseDistancePx * 10) / 10,
        durationMs: settleDurationMs,
      });
      if (shouldAnimateReleaseCatchup) {
        Animated.parallel([
          Animated.sequence([
            Animated.timing(settlePosition, {
              toValue: { x: releasePosition.x, y: releasePosition.y },
              duration: DRAG_RACK_RELEASE_CATCHUP_DURATION,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.timing(settlePosition, {
              toValue: { x: settleTarget.x, y: settleTarget.y },
              duration: DRAG_RACK_RETURN_DURATION,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
          ]),
          Animated.timing(settleScale, {
            toValue: 1,
            duration:
              DRAG_RACK_RELEASE_CATCHUP_DURATION + DRAG_RACK_RETURN_DURATION,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]).start(({ finished }) => {
          if (rackSettleActiveRef.current?.id === settleId) {
            rackSettleActiveRef.current = null;
          }
          logRackDrag("settle-end", {
            settleId,
            finished,
            slotIndex,
            slotCount,
            hasReleaseCatchup: true,
          });
          if (!finished) return;
          if (rackSettleClearTimeoutRef.current != null) {
            clearTimeout(rackSettleClearTimeoutRef.current);
            rackSettleClearTimeoutRef.current = null;
          }
          updateDraggingTile(null);
          updateSettlingTile(null);
          resetDragAnimation();
        });
      } else {
        animateToSettleTarget();
      }
      updateSettlingTile({
        ...tile,
        destination: "rack",
        slotIndex,
        slotCount,
        shouldAnimateDisplacedReorder,
        from: "rack",
        visibleRackOrder: visibleRackTiles
          .filter((rackTile) => rackTile.id !== tile.id)
          .map((rackTile) => rackTile.id),
      });
      updateDraggingTile(null);
      updateDropTargetRackIndex(null);
      rackDraggingVisibleIndexValue.setValue(-1);
      rackHoverIndexValue.setValue(-1);
      hoverIndexRef.current = null;
      if (rackSettleClearTimeoutRef.current != null) {
        clearTimeout(rackSettleClearTimeoutRef.current);
        rackSettleClearTimeoutRef.current = null;
      }
      if (boardReturnCommitTimeoutRef.current != null) {
        clearTimeout(boardReturnCommitTimeoutRef.current);
        boardReturnCommitTimeoutRef.current = null;
      }
      commit?.();
    },
    [
      getNow,
      getRackSlotTarget,
      logRackDrag,
      rackDraggingVisibleIndexValue,
      rackHoverIndexValue,
      resetDragAnimation,
      settlePosition,
      settleScale,
      updateDraggingTile,
      updateDropTargetRackIndex,
      updateSettlingTile,
      visibleRackTiles,
    ]
  );

  const completeBoardReturnToRack = useCallback(
    (tile, slotIndex, slotCount, commit, options = {}) => {
      const { useSettlingState = true } = options;
      const settleTarget = getRackSlotTarget(slotIndex, slotCount);
      if (!settleTarget) {
        updateDraggingTile(null);
        updateDropTargetRackIndex(null);
        resetDragAnimation();
        commit?.();
        return;
      }

      dragAnimatingPickupRef.current = false;
      dragPendingFinalizeRef.current = null;
      dragReleasedDuringPickupRef.current = false;
      dragPosition.stopAnimation();
      dragScale.stopAnimation();
      dragTargetRef.current = settleTarget;
      Animated.parallel([
        Animated.timing(dragPosition, {
          toValue: { x: settleTarget.x, y: settleTarget.y },
          duration: DRAG_RACK_RETURN_DURATION,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(dragScale, {
          toValue: 1,
          duration: DRAG_RACK_RETURN_DURATION,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        // A quick subsequent pickup interrupts this animation; ignore stale completion so
        // we do not clear the next drag's state/overlay.
        if (!finished) return;
        if (rackSettleClearTimeoutRef.current != null) {
          clearTimeout(rackSettleClearTimeoutRef.current);
          rackSettleClearTimeoutRef.current = null;
        }
        updateDraggingTile(null);
        updateSettlingTile(null);
        resetDragAnimation();
      });
      if (useSettlingState) {
        updateSettlingTile({
          ...tile,
          destination: "rack",
          slotIndex,
          slotCount,
          from: "board",
          visibleRackOrder: visibleRackTiles
            .filter((rackTile) => rackTile.id !== tile.id)
            .map((rackTile) => rackTile.id),
        });
        updateDraggingTile({
          ...(draggingTileRef.current ?? {
            from: "board",
            row: null,
            col: null,
            tile: {
              id: tile.id,
              letter: tile.letter,
              value: tile.value,
              rackIndex: tile.rackIndex,
            },
          }),
          settlingDestination: "rack",
        });
      } else {
        updateDraggingTile({
          ...(draggingTileRef.current ?? {
            from: "board",
            row: null,
            col: null,
            tile: {
              id: tile.id,
              letter: tile.letter,
              value: tile.value,
              rackIndex: tile.rackIndex,
            },
          }),
          settlingDestination: "rack",
          settlingSlotIndex: slotIndex,
          settlingSlotCount: slotCount,
        });
      }
      updateDropTargetRackIndex(null);
      rackDraggingVisibleIndexValue.setValue(-1);
      rackHoverIndexValue.setValue(-1);
      hoverIndexRef.current = null;
      if (rackSettleClearTimeoutRef.current != null) {
        clearTimeout(rackSettleClearTimeoutRef.current);
      }
      if (boardReturnCommitTimeoutRef.current != null) {
        clearTimeout(boardReturnCommitTimeoutRef.current);
        boardReturnCommitTimeoutRef.current = null;
      }
      boardReturnCommitTimeoutRef.current = setTimeout(() => {
        boardReturnCommitTimeoutRef.current = null;
        unstable_batchedUpdates(() => {
          commit?.();
        });
      }, 0);
    },
    [
      boardReturnCommitTimeoutRef,
      dragPosition,
      dragScale,
      getRackSlotTarget,
      rackDraggingVisibleIndexValue,
      rackHoverIndexValue,
      resetDragAnimation,
      settlePosition,
      settleScale,
      updateDraggingTile,
      updateDropTargetRackIndex,
      updateSettlingTile,
      visibleRackTiles,
    ]
  );

  const computeRackIndex = useCallback(
    (screenX, screenY, rackLength, options = {}) => {
      const { clampToEdges = true } = options;
      const rack = rackLayoutRef.current;
      if (rack.width <= 0 || rack.height <= 0 || rackLength <= 0) return null;
      const { x: touchOffsetX, y: touchOffsetY } = dragTouchOffsetRef.current;
      const tileCenterX = screenX - touchOffsetX + DRAG_TILE_HALF_SIZE;
      const tileCenterY = screenY - touchOffsetY + DRAG_TILE_HALF_SIZE;
      if (
        tileCenterY < rack.y - rackDropExpansionTop ||
        tileCenterY > rack.y + rack.height + rackDropExpansionBottom
      ) {
        return null;
      }
      const rackLeft =
        rack.x + (rack.width - rackLength * RACK_SLOT_WIDTH) / 2;
      const rackRight = rackLeft + rackLength * RACK_SLOT_WIDTH;
      if (tileCenterX <= rackLeft) {
        return clampToEdges ? 0 : null;
      }
      if (tileCenterX >= rackRight) {
        return clampToEdges ? rackLength - 1 : null;
      }
      const index = Math.floor(
        (tileCenterX - rackLeft + RACK_SLOT_WIDTH / 2) / RACK_SLOT_WIDTH
      );
      return Math.min(rackLength - 1, Math.max(0, index));
    },
    [rackDropExpansionBottom, rackDropExpansionTop]
  );

  const isWithinRackDropZone = useCallback(
    (screenX, screenY) => {
      const rack = rackLayoutRef.current;
      if (rack.width <= 0 || rack.height <= 0) {
        return false;
      }
      const { x: touchOffsetX, y: touchOffsetY } = dragTouchOffsetRef.current;
      const tileCenterX = screenX - touchOffsetX + DRAG_TILE_HALF_SIZE;
      const tileCenterY = screenY - touchOffsetY + DRAG_TILE_HALF_SIZE;
      return (
        tileCenterX >= rack.x &&
        tileCenterX <= rack.x + rack.width &&
        tileCenterY >= rack.y - rackDropExpansionTop &&
        tileCenterY <= rack.y + rack.height + rackDropExpansionBottom
      );
    },
    [rackDropExpansionBottom, rackDropExpansionTop]
  );

  const screenToBoardCell = useCallback(
    (screenX, screenY) => {
      const layout = boardLayoutRef.current;
      if (!layout) return null;
      const { cellSize, gridSize } = layout;
      if (gridSize == null) return null;

      const viewportX = layout.x;
      const viewportY = layout.y;
      const viewportWidth = layout.width;
      const viewportHeight = layout.height;
      const hasViewportBounds =
        typeof viewportX === "number" &&
        typeof viewportY === "number" &&
        typeof viewportWidth === "number" &&
        typeof viewportHeight === "number" &&
        viewportWidth > 0 &&
        viewportHeight > 0;
      if (hasViewportBounds) {
        const viewportRight = viewportX + viewportWidth;
        const viewportBottom = viewportY + viewportHeight;
        if (
          screenX < viewportX ||
          screenX > viewportRight ||
          screenY < viewportY ||
          screenY > viewportBottom
        ) {
          return null;
        }
      }

      const sl = layout.screenLeft;
      const st = layout.screenTop;
      const sr = layout.screenRight;
      const sb = layout.screenBottom;
      const hasMeasuredBounds =
        typeof sl === "number" &&
        typeof st === "number" &&
        typeof sr === "number" &&
        typeof sb === "number";

      let gx;
      let gy;
      if (hasMeasuredBounds) {
        const width = sr - sl;
        const height = sb - st;
        if (width <= 0 || height <= 0) return null;
        gx = ((screenX - sl) / width) * gridSize;
        gy = ((screenY - st) / height) * gridSize;
        if (gx < 0 || gx >= gridSize || gy < 0 || gy >= gridSize) return null;
      } else {
        const padding = layout.padding ?? 0;
        const contentLeft = layout.x + (layout.contentOriginX ?? padding);
        const contentTop = layout.y + (layout.contentOriginY ?? padding);
        gx = screenX - contentLeft;
        gy = screenY - contentTop;
      }

      const col = Math.floor(gx / cellSize);
      const row = Math.floor(gy / cellSize);
      if (row >= 0 && row < boardSize && col >= 0 && col < boardSize) {
        return { row, col };
      }
      return null;
    },
    [boardLayoutRef, boardSize]
  );

  const getDropTargetCell = useCallback(
    (screenX, screenY) => {
      const cell = screenToBoardCell(screenX, screenY);
      if (cell != null && board[cell.row][cell.col] === null) {
        return cell;
      }
      return null;
    },
    [board, screenToBoardCell]
  );

  const getCellAtPosition = useCallback(
    (screenX, screenY) => screenToBoardCell(screenX, screenY),
    [screenToBoardCell]
  );

  const withFreshBoardGridBounds = useCallback(
    (work) => {
      const measureGridBounds = boardLayoutRef.current?.measureGridBounds;
      if (typeof measureGridBounds === "function") {
        // Kick off transformed-bound refresh, but do not block tile release UX.
        measureGridBounds();
      }
      work?.();
    },
    [boardLayoutRef]
  );

  const getDraggableTileCell = useCallback(
    (screenX, screenY) => {
      const cell = getCellAtPosition(screenX, screenY);
      if (cell && isBoardTileDraggable(board[cell.row]?.[cell.col], cell.row, cell.col)) {
        return cell;
      }

      const layout = boardLayoutRef.current;
      if (
        !layout ||
        typeof layout.cellSize !== "number" ||
        layout.cellSize <= 0
      ) {
        return null;
      }

      const rowCandidates = cell
        ? [cell.row - 1, cell.row, cell.row + 1]
        : Array.from({ length: boardSize }, (_, row) => row);
      const colCandidates = cell
        ? [cell.col - 1, cell.col, cell.col + 1]
        : Array.from({ length: boardSize }, (_, col) => col);
      const tileScreenSize = Math.max(1, layout.cellSize - 3);

      for (const row of rowCandidates) {
        if (row < 0 || row >= boardSize) continue;
        for (const col of colCandidates) {
          if (col < 0 || col >= boardSize) continue;
          const tile = board[row]?.[col];
          if (!isBoardTileDraggable(tile, row, col)) continue;
          const settleTarget = getBoardTileSettleTarget(row, col);
          if (!settleTarget) continue;
          const left =
            settleTarget.x + containerWindowRef.current.x - BOARD_TILE_PICKUP_SLOP;
          const top =
            settleTarget.y + containerWindowRef.current.y - BOARD_TILE_PICKUP_SLOP;
          const size = tileScreenSize + BOARD_TILE_PICKUP_SLOP * 2;
          if (
            screenX >= left &&
            screenX <= left + size &&
            screenY >= top &&
            screenY <= top + size
          ) {
            return { row, col };
          }
        }
      }
      return null;
    },
    [
      board,
      boardLayoutRef,
      boardSize,
      getBoardTileSettleTarget,
      getCellAtPosition,
      isBoardTileDraggable,
    ]
  );

  const handleRackDragStart = useCallback(
    (index, tile, x, y, touchOffsetX, touchOffsetY) => {
      if (!canInteract) return;
      const now = getNow();
      const activeSettle = rackSettleActiveRef.current;
      rackDragMetricsRef.current = {
        startedAt: now,
        lastUpdateAt: now,
        updateCount: 0,
        maxUpdateGapMs: 0,
        sourceRackIndex: index,
        sourceVisibleIndex: tile?.visibleIndex ?? null,
      };
      logRackDrag("start", {
        rackIndex: index,
        visibleIndex: tile?.visibleIndex ?? null,
        x,
        y,
        settleActive: !!activeSettle,
        settleId: activeSettle?.id ?? null,
        settleEndsInMs:
          activeSettle != null
            ? Math.max(0, Math.round(activeSettle.expectedEndAt - now))
            : 0,
      });
      let interruptedSettlePosition = null;
      if (
        settlingTileRef.current?.destination === "rack" &&
        settlingTileRef.current?.id != null &&
        settlingTileRef.current.id === tile.id
      ) {
        if (rackSettleClearTimeoutRef.current != null) {
          clearTimeout(rackSettleClearTimeoutRef.current);
          rackSettleClearTimeoutRef.current = null;
        }
        settlePosition.stopAnimation((value) => {
          interruptedSettlePosition = value;
        });
      } else {
        settlePosition.stopAnimation();
      }
      settleScale.stopAnimation();
      updateSettlingTile(null);
      const resolvedTouchOffsetX = DRAG_TILE_HALF_SIZE;
      const resolvedTouchOffsetY = DRAG_TILE_HALF_SIZE;
      const calibrationTouchOffsetX =
        typeof touchOffsetX === "number"
          ? Math.max(0, Math.min(DRAG_TILE_SIZE, touchOffsetX))
          : DRAG_TILE_HALF_SIZE;
      const calibrationTouchOffsetY =
        typeof touchOffsetY === "number"
          ? Math.max(0, Math.min(DRAG_TILE_SIZE, touchOffsetY))
          : DRAG_TILE_HALF_SIZE;
      dragTouchOffsetRef.current = {
        x: resolvedTouchOffsetX,
        y: resolvedTouchOffsetY,
      };
      const sourceTarget = getRackTileSourceTarget(
        tile?.visibleIndex,
        visibleRackTiles.length
      );
      const hasTouchOffsets =
        Number.isFinite(calibrationTouchOffsetX) &&
        Number.isFinite(calibrationTouchOffsetY);
      const hasSourceTarget =
        sourceTarget &&
        typeof sourceTarget.x === "number" &&
        typeof sourceTarget.y === "number";
      if (hasTouchOffsets && hasSourceTarget) {
        const { x: containerScreenX, y: containerScreenY } =
          containerWindowRef.current;
        const expectedX =
          containerScreenX + sourceTarget.x + calibrationTouchOffsetX;
        const expectedY =
          containerScreenY + sourceTarget.y + calibrationTouchOffsetY;
        const correctionX = expectedX - (x ?? 0);
        const correctionY = expectedY - (y ?? 0);
        const isSaneCorrection =
          Number.isFinite(correctionX) &&
          Number.isFinite(correctionY) &&
          Math.abs(correctionX) <= MAX_RACK_POINTER_CORRECTION_PX &&
          Math.abs(correctionY) <= MAX_RACK_POINTER_CORRECTION_PX;
        rackPointerCorrectionRef.current = {
          x: isSaneCorrection ? correctionX : 0,
          y: isSaneCorrection ? correctionY : 0,
        };
      } else {
        rackPointerCorrectionRef.current = { x: 0, y: 0 };
      }
      const correctedStart = {
        x: (x ?? 0) + rackPointerCorrectionRef.current.x,
        y: (y ?? 0) + rackPointerCorrectionRef.current.y,
      };
      setDragPositionFromScreen(correctedStart.x, correctedStart.y);
      hoverIndexRef.current = tile.visibleIndex;
      updateDraggingTile({
        from: "rack",
        index,
        visibleIndex: tile.visibleIndex,
        tile,
      });
      rackDraggingVisibleIndexValue.setValue(tile.visibleIndex);
      rackHoverIndexValue.setValue(tile.visibleIndex);
      const pickupSource =
        interruptedSettlePosition &&
        typeof interruptedSettlePosition.x === "number" &&
        typeof interruptedSettlePosition.y === "number"
          ? interruptedSettlePosition
          : null;

      if (pickupSource) {
        animateRackPickupToDragTarget(pickupSource.x, pickupSource.y);
      } else {
        animateDragPickup();
      }
    },
    [
      animateDragPickup,
      animateRackPickupToDragTarget,
      canInteract,
      getRackTileSourceTarget,
      getNow,
      logRackDrag,
      rackDraggingVisibleIndexValue,
      rackHoverIndexValue,
      setDragPositionFromScreen,
      settlePosition,
      settleScale,
      updateDraggingTile,
      updateSettlingTile,
      visibleRackTiles.length,
    ]
  );

  const handleRackDragUpdate = useCallback(
    (x, y) => {
      if (!canInteract) return;
      const now = getNow();
      const metrics = rackDragMetricsRef.current;
      if (metrics) {
        const gap = Math.max(0, now - metrics.lastUpdateAt);
        metrics.lastUpdateAt = now;
        metrics.updateCount += 1;
        if (gap > metrics.maxUpdateGapMs) {
          metrics.maxUpdateGapMs = gap;
        }
      }
      const correctedX = x + rackPointerCorrectionRef.current.x;
      const correctedY = y + rackPointerCorrectionRef.current.y;
      setDragPositionFromScreen(correctedX, correctedY);
      const nextIndex = computeRackIndex(
        correctedX,
        correctedY,
        visibleRackTiles.length
      );
      if (nextIndex !== hoverIndexRef.current) {
        const previousIndex = hoverIndexRef.current;
        hoverIndexRef.current = nextIndex;
        const targetValue = nextIndex ?? -1;
        if (nextIndex == null) {
          logRackDrag("hover-change", {
            to: null,
            x: correctedX,
            y: correctedY,
            elapsedMs: Math.round(now - (metrics?.startedAt ?? now)),
          });
          rackHoverIndexValue.stopAnimation();
          rackHoverIndexValue.setValue(-1);
          return;
        }
        logRackDrag("hover-change", {
              from: previousIndex,
              to: nextIndex,
              x: correctedX,
              y: correctedY,
              elapsedMs: Math.round(now - (metrics?.startedAt ?? now)),
            });
        if (previousIndex == null || previousIndex < 0) {
          rackHoverIndexValue.stopAnimation();
          rackHoverIndexValue.setValue(targetValue);
          return;
        }
        rackHoverIndexValue.stopAnimation((currentValue) => {
          const distance = Math.abs(targetValue - currentValue);
          if (distance <= 1) {
            rackHoverIndexValue.setValue(targetValue);
            return;
          }

          Animated.timing(rackHoverIndexValue, {
            toValue: targetValue,
            duration: Math.min(
              RACK_HOVER_MAX_DURATION,
              Math.max(RACK_HOVER_STEP_DURATION, distance * RACK_HOVER_STEP_DURATION)
            ),
            easing: Easing.linear,
            useNativeDriver: false,
          }).start();
        });
      }
    },
    [
      canInteract,
      computeRackIndex,
      getNow,
      logRackDrag,
      rackHoverIndexValue,
      setDragPositionFromScreen,
      visibleRackTiles.length,
    ]
  );

  const handleTileDrop = useCallback(
    (tileIndex, screenX, screenY, gesture = null) => {
      if (!canInteract) return;
      withFreshBoardGridBounds(() => {
        const now = getNow();
        const metrics = rackDragMetricsRef.current;
        const pickupWasAnimatingOnDrop = dragAnimatingPickupRef.current;
        hoverIndexRef.current = null;
        const draggedFromRack = draggingTileRef.current?.from === "rack";
        const correctedScreenX =
          draggedFromRack
            ? screenX + rackPointerCorrectionRef.current.x
            : screenX;
        const correctedScreenY =
          draggedFromRack
            ? screenY + rackPointerCorrectionRef.current.y
            : screenY;
        const releasePosition = getDragPositionFromScreen(
          correctedScreenX,
          correctedScreenY
        );
        const placeAt = getDropTargetCell(correctedScreenX, correctedScreenY);
        const originalVisibleIndex = draggedFromRack
          ? draggingTileRef.current?.visibleIndex
          : null;
        const hasGestureDeltaX = typeof gesture?.deltaX === "number";
        const hasHorizontalIntent =
          !hasGestureDeltaX ||
          Math.abs(gesture.deltaX) >= RACK_REORDER_INTENT_THRESHOLD_PX;
        const rackTargetIndex =
          draggedFromRack && !hasHorizontalIntent
            ? originalVisibleIndex
            : computeRackIndex(
                correctedScreenX,
                correctedScreenY,
                visibleRackTiles.length
              );
        const returnRackIndex =
          rackTargetIndex ??
          (draggedFromRack ? originalVisibleIndex : null);
        const msSinceLastUpdate =
          metrics?.lastUpdateAt != null ? Math.max(0, now - metrics.lastUpdateAt) : 0;
        const forceReleaseCatchup =
          draggedFromRack &&
          !!gesture?.didMove &&
          msSinceLastUpdate > 24;
        if (draggedFromRack) {
          const elapsedMs = Math.round(now - (metrics?.startedAt ?? now));
          const updateCount = metrics?.updateCount ?? 0;
          const avgUpdateGapMs =
            updateCount > 0 && metrics?.startedAt != null
              ? Math.round(elapsedMs / updateCount)
              : 0;
          logRackDrag("drop", {
            from: metrics?.sourceVisibleIndex ?? originalVisibleIndex ?? null,
            to: returnRackIndex,
            computedTarget: rackTargetIndex,
            elapsedMs,
            updateCount,
            avgUpdateGapMs,
            maxUpdateGapMs: Math.round(metrics?.maxUpdateGapMs ?? 0),
            releaseX: Math.round(correctedScreenX),
            releaseY: Math.round(correctedScreenY),
            deltaX: Math.round(gesture?.deltaX ?? 0),
            deltaY: Math.round(gesture?.deltaY ?? 0),
            msSinceLastUpdate: Math.round(msSinceLastUpdate),
            forceReleaseCatchup,
          });
        }
        rackDragMetricsRef.current = null;
        rackPointerCorrectionRef.current = { x: 0, y: 0 };

        if (placeAt) {
          setDragPositionFromScreen(correctedScreenX, correctedScreenY);
          const tile = getRackTileByIndex(tileIndex);
          if (!tile) return;
          if (isBlankRackTile(tile)) {
            finalizeDrag(
              () => onBlankPlacementRequested?.(tileIndex, placeAt.row, placeAt.col),
              undefined,
              { interruptPickup: true }
            );
            return;
          }

          completeBoardDrop(
            {
              id: tile.id,
              letter: tile.letter,
              value: tile.value,
              rackIndex: tileIndex,
            },
            getBoardTileSettleTarget(placeAt.row, placeAt.col),
            {
              row: placeAt.row,
              col: placeAt.col,
              id: tile.id,
              letter: tile.letter,
              value: tile.value,
              rackIndex: tileIndex,
              renderTarget: false,
            },
            () => onPlaceRackTile(tileIndex, placeAt.row, placeAt.col)
          );
          return;
        }

        if (
          returnRackIndex != null &&
          visibleRackTiles.length > 0 &&
          draggedFromRack
        ) {
          completeRackReturn(
            {
              id: draggingTileRef.current.tile.id,
              letter: draggingTileRef.current.tile.letter,
              value: draggingTileRef.current.tile.value,
              rackIndex: draggingTileRef.current.index,
            },
            returnRackIndex,
            visibleRackTiles.length,
            () => onReorderRack(tileIndex, returnRackIndex),
            {
              releasePosition,
              shouldAnimateDisplacedReorder: pickupWasAnimatingOnDrop,
              forceReleaseCatchup,
            }
          );
          return;
        }

        setDragPositionFromScreen(correctedScreenX, correctedScreenY);
        finalizeDrag(
          () => {
            if (rackTargetIndex != null && visibleRackTiles.length > 0) {
              onReorderRack(tileIndex, rackTargetIndex);
            }
          },
          rackTargetIndex != null && visibleRackTiles.length > 0
            ? (finish) =>
                animateDragIntoRackSlot(
                  returnRackIndex,
                  visibleRackTiles.length,
                  finish
                )
            : undefined
        );
      });
    },
    [
      animateDragIntoRackSlot,
      canInteract,
      completeBoardDrop,
      completeRackReturn,
      computeRackIndex,
      finalizeDrag,
      getDragPositionFromScreen,
      getNow,
      getBoardTileSettleTarget,
      getDropTargetCell,
      getRackTileByIndex,
      logRackDrag,
      isBlankRackTile,
      onBlankPlacementRequested,
      onPlaceRackTile,
      onReorderRack,
      setDragPositionFromScreen,
      withFreshBoardGridBounds,
      visibleRackTiles.length,
    ]
  );

  const handleBoardTilePickup = useCallback(
    (row, col, pageX, pageY) => {
      if (!canInteract) return;
      settlePosition.stopAnimation();
      settleScale.stopAnimation();
      updateSettlingTile(null);
      const tile = board[row]?.[col];
      if (!isBoardTileDraggable(tile, row, col)) return;
      const sx = pageX ?? 0;
      const sy = pageY ?? 0;
      const payload = {
        from: "board",
        row,
        col,
        tile: {
          id: tile.id,
          letter: tile.letter,
          value: tile.value,
          rackIndex: tile.rackIndex,
        },
      };
      boardDragPayloadRef.current = payload;
      hoverIndexRef.current = null;
      boardHoverRackIndexRef.current = null;
      pendingDropTargetRackIndexRef.current = null;
      if (dropTargetFrameRef.current != null) {
        cancelAnimationFrame(dropTargetFrameRef.current);
        dropTargetFrameRef.current = null;
      }
      updateDropTargetRackIndex(null);
      setBoardHoverRackIndex(null);
      rackPointerCorrectionRef.current = { x: 0, y: 0 };
      dragTouchOffsetRef.current = {
        x: DRAG_TILE_HALF_SIZE,
        y: DRAG_TILE_HALF_SIZE,
      };
      const { x: ox, y: oy } = containerWindowRef.current;
      dragTargetRef.current = {
        x: sx - ox - DRAG_TILE_HALF_SIZE,
        y: sy - oy - DRAG_TILE_HALF_SIZE,
      };
      const pickupSourceTarget = getBoardTileSettleTarget(row, col);
      if (pickupSourceTarget) {
        dragPosition.setValue({
          x: pickupSourceTarget.x,
          y: pickupSourceTarget.y,
        });
        dragScale.setValue(pickupSourceTarget.scale);
      } else {
        dragPosition.setValue(dragTargetRef.current);
        dragScale.setValue(1);
      }
      rackDraggingVisibleIndexValue.setValue(-1);
      boardRackPlaceholderIndexValue.setValue(-1);
      updateDraggingTile(payload);
      animateBoardPickupToDragTarget(row, col);
    },
    [
      animateBoardPickupToDragTarget,
      boardRackPlaceholderIndexValue,
      board,
      canInteract,
      dragPosition,
      dragScale,
      getBoardTileSettleTarget,
      isBoardTileDraggable,
      rackDraggingVisibleIndexValue,
      settlePosition,
      settleScale,
      updateDraggingTile,
      updateSettlingTile,
    ]
  );

  const handleBoardDragUpdate = useCallback(
    (x, y) => {
      if (!canInteract) return;
      pendingBoardDragPointRef.current = { x, y };
      if (boardDragUpdateFrameRef.current != null) {
        return;
      }
      boardDragUpdateFrameRef.current = requestAnimationFrame(() => {
        boardDragUpdateFrameRef.current = null;
        const point = pendingBoardDragPointRef.current;
        if (!point) return;
        pendingBoardDragPointRef.current = null;
        setDragPositionFromScreen(point.x, point.y);
        let nextIndex = computeRackIndex(
          point.x,
          point.y,
          visibleRackTiles.length + 1,
          {
            clampToEdges: false,
          }
        );
        if (
          nextIndex == null &&
          isWithinRackDropZone(point.x, point.y) &&
          visibleRackTiles.length + 1 > 0
        ) {
          nextIndex = computeRackIndex(point.x, point.y, visibleRackTiles.length + 1, {
            clampToEdges: true,
          });
        }
        boardRackPlaceholderIndexValue.setValue(nextIndex ?? -1);
        boardHoverRackIndexRef.current = nextIndex;
        if (nextIndex !== hoverIndexRef.current) {
          hoverIndexRef.current = nextIndex;
        }
      });
    },
    [
      boardRackPlaceholderIndexValue,
      canInteract,
      computeRackIndex,
      isWithinRackDropZone,
      setDragPositionFromScreen,
      visibleRackTiles.length,
    ]
  );

  const handleBoardTileDrop = useCallback(
    (screenX, screenY) => {
      if (!canInteract) return;
      if (boardDragUpdateFrameRef.current != null) {
        cancelAnimationFrame(boardDragUpdateFrameRef.current);
        boardDragUpdateFrameRef.current = null;
      }
      pendingBoardDragPointRef.current = null;
      const payload =
        draggingTileRef.current?.from === "board"
          ? draggingTileRef.current
          : boardDragPayloadRef.current;
      if (!payload || payload.from !== "board") return;

      boardDragPayloadRef.current = null;
      const lastHoverIndex = boardHoverRackIndexRef.current;
      hoverIndexRef.current = null;
      boardHoverRackIndexRef.current = null;
      setBoardHoverRackIndex(null);
      const releasedInRackDropZone = isWithinRackDropZone(screenX, screenY);
      let rackTargetIndex =
        lastHoverIndex ??
        computeRackIndex(screenX, screenY, visibleRackTiles.length + 1, {
          clampToEdges: false,
        });
      if (
        rackTargetIndex == null &&
        releasedInRackDropZone &&
        visibleRackTiles.length + 1 > 0
      ) {
        rackTargetIndex = computeRackIndex(
          screenX,
          screenY,
          visibleRackTiles.length + 1,
          {
            clampToEdges: true,
          }
        );
      }

      if (
        dragAnimatingPickupRef.current &&
        releasedInRackDropZone &&
        rackTargetIndex != null
      ) {
        const { tile, row: fromRow, col: fromCol } = payload;
        const rackIndex =
          tile?.id != null
            ? getRackIndexByTileId?.(tile.id) ?? tile?.rackIndex
            : tile?.rackIndex;
        if (rackIndex !== undefined && rackIndex != null && tile) {
          completeBoardReturnToRack(
            {
              id: tile.id,
              letter: tile.letter,
              value: tile.value,
              rackIndex,
            },
            rackTargetIndex,
            visibleRackTiles.length + 1,
            () => {
              onRemoveBoardTile(fromRow, fromCol);
              onReorderRack(rackIndex, rackTargetIndex, rackIndex);
            },
            { useSettlingState: false }
          );
        }
        return;
      }

      withFreshBoardGridBounds(() => {
        const sameCellDrop = (() => {
          const cell = screenToBoardCell(screenX, screenY);
          if (!cell) return null;
          return cell.row === payload.row && cell.col === payload.col ? cell : null;
        })();
        const target = sameCellDrop ?? getDropTargetCell(screenX, screenY);
        setDragPositionFromScreen(screenX, screenY);
        if (target != null) {
          const { tile, row: fromRow, col: fromCol } = payload;
          const rackIndex = tile?.rackIndex;
          if (rackIndex !== undefined && tile) {
            if (target.row === fromRow && target.col === fromCol) {
              completeBoardDrop(
                { id: tile.id, letter: tile.letter, value: tile.value, rackIndex },
                getBoardTileSettleTarget(target.row, target.col),
                null,
                () => {},
                {
                  deferCommit: true,
                  useSettlingState: false,
                  settleDuration: DRAG_BOARD_INVALID_RETURN_DURATION,
                }
              );
              return;
            }
            completeBoardDrop(
              { id: tile.id, letter: tile.letter, value: tile.value, rackIndex },
              getBoardTileSettleTarget(target.row, target.col),
              {
                fromRow,
                fromCol,
                row: target.row,
                col: target.col,
                id: tile.id,
                letter: tile.letter,
                value: tile.value,
                rackIndex,
                renderTarget: false,
              },
              () => onMoveBoardTile(fromRow, fromCol, target.row, target.col),
              {
                deferCommit: true,
                useSettlingState: false,
              }
            );
          }
          return;
        }

        if (rackTargetIndex == null) {
          const { tile, row: fromRow, col: fromCol } = payload;
          if (tile) {
            completeBoardDrop(
              {
                id: tile.id,
                letter: tile.letter,
                value: tile.value,
                rackIndex: tile.rackIndex,
              },
              getBoardTileSettleTarget(fromRow, fromCol),
              null,
              () => {},
              {
                deferCommit: true,
                useSettlingState: false,
                settleDuration: DRAG_BOARD_INVALID_RETURN_DURATION,
              }
            );
          }
          return;
        }

        const { tile, row: fromRow, col: fromCol } = payload;
        const rackIndex =
          tile?.id != null
            ? getRackIndexByTileId?.(tile.id) ?? tile?.rackIndex
            : tile?.rackIndex;
        if (rackIndex !== undefined && rackIndex != null && tile) {
          completeBoardReturnToRack(
            {
              id: tile.id,
              letter: tile.letter,
              value: tile.value,
              rackIndex,
            },
            rackTargetIndex,
            visibleRackTiles.length + 1,
            () => {
              onRemoveBoardTile(fromRow, fromCol);
              onReorderRack(rackIndex, rackTargetIndex, rackIndex);
            },
            { useSettlingState: false }
          );
        }
      });
    },
    [
      canInteract,
      completeBoardDrop,
      completeBoardReturnToRack,
      computeRackIndex,
      getRackIndexByTileId,
      getBoardTileSettleTarget,
      getDropTargetCell,
      isWithinRackDropZone,
      onMoveBoardTile,
      onRemoveBoardTile,
      onReorderRack,
      screenToBoardCell,
      setDragPositionFromScreen,
      withFreshBoardGridBounds,
      visibleRackTiles.length,
    ]
  );

  const handleBoardTap = useCallback(
    (screenX, screenY) => {
      if (!canInteract) return;
      const cell = getCellAtPosition(screenX, screenY);
      if (cell) {
        onBoardCellTap?.(cell.row, cell.col);
      }
    },
    [canInteract, getCellAtPosition, onBoardCellTap]
  );

  return {
    visibleRackTiles,
    draggingTile,
    settlingTile,
    dropTargetRackIndex,
    boardHoverRackIndex,
    rackHoverIndexValue,
    boardRackPlaceholderIndexValue,
    rackDraggingVisibleIndexValue,
    optimisticPlacement,
    dragPosition,
    dragScale,
    settlePosition,
    settleScale,
    refreshContainerWindowPosition,
    updateRackLayout,
    resetController,
    getDraggableTileCell,
    handleRackDragStart,
    handleRackDragUpdate,
    handleTileDrop,
    handleBoardTilePickup,
    handleBoardDragUpdate,
    handleBoardTileDrop,
    handleBoardTap,
  };
};
