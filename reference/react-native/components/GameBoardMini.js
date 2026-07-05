import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions, Animated, Platform, Easing } from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import LinearGradient from 'react-native-linear-gradient';

const MIN_ZOOM = 1;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.010;
const BOARD_BORDER = 2;

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const BOARD_SIZE = 11;
// Board background border: 4px on each side
const BOARD_PADDING = 6;
// Base cell size; tiles are 2px smaller (TILE_SIZE), spacing increased to keep board size same
const BASE_CELL_MARGIN = 0.5;
const CELL_SIZE = Math.min(
    (SCREEN_WIDTH - 40 - (BOARD_SIZE - 1) * 2 * BASE_CELL_MARGIN - 2 * BOARD_PADDING) / BOARD_SIZE,
    35
);
const TILE_SIZE = CELL_SIZE - 2;

const TILE_GRADIENT_HEIGHT_PX = Math.max(1, Math.floor(TILE_SIZE * 0.5));
// Spacing between tiles; board size is then computed from content so it exactly encapsulates
const CELL_MARGIN = 1.5;
const ANDROID_GESTURE_PIPELINE_V2 =
    Platform.OS === 'android' && global.__ANDROID_GESTURE_PIPELINE_V2__ === true;
const OVERLAY_PAN_MIN_DISTANCE = 0;

const CELL_SIZE_EFFECTIVE = TILE_SIZE + 2 * CELL_MARGIN;
const BOARD_INDICES = Array.from({ length: BOARD_SIZE }, (_, index) => index);
const INTERACTION_MODE_IDLE = 'idle';
const INTERACTION_MODE_TILE_DRAG = 'tile_drag';
const INTERACTION_MODE_PINCH_ZOOM = 'pinch_zoom';
const ZOOM_BOUND_EPSILON = 0.0005;
const ZOOM_BOUND_LOCK_RELEASE_DELTA = 0.015;
const ZOOM_DIRECTION_LOCK_DEADZONE = 0.002;

function shouldSkipZoomAtBounds(currentZoom, scale) {
    if (!Number.isFinite(scale) || scale === 1) return false;
    if (currentZoom >= MAX_ZOOM - ZOOM_BOUND_EPSILON && scale > 1) return true;
    if (currentZoom <= MIN_ZOOM + ZOOM_BOUND_EPSILON && scale < 1) return true;
    return false;
}

function resolveBoundedZoom(startZoom, scale, boundLockRef) {
    const minScale = MIN_ZOOM / startZoom;
    const maxScale = MAX_ZOOM / startZoom;
    const lock = boundLockRef.current;

    if (lock === 'max') {
        if (scale >= maxScale - ZOOM_BOUND_LOCK_RELEASE_DELTA) {
            return MAX_ZOOM;
        }
        boundLockRef.current = null;
    } else if (lock === 'min') {
        if (scale <= minScale + ZOOM_BOUND_LOCK_RELEASE_DELTA) {
            return MIN_ZOOM;
        }
        boundLockRef.current = null;
    }

    if (scale >= maxScale) {
        boundLockRef.current = 'max';
        return MAX_ZOOM;
    }
    if (scale <= minScale) {
        boundLockRef.current = 'min';
        return MIN_ZOOM;
    }
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, startZoom * scale));
}

function resolveDirectionLockedScale(rawScale, scale, directionLockRef) {
    if (!Number.isFinite(rawScale) || !Number.isFinite(scale)) return 1;
    const direction = directionLockRef.current;
    if (!direction) {
        if (rawScale > 1 + ZOOM_DIRECTION_LOCK_DEADZONE) {
            directionLockRef.current = 'in';
            return scale;
        }
        if (rawScale < 1 - ZOOM_DIRECTION_LOCK_DEADZONE) {
            directionLockRef.current = 'out';
            return scale;
        }
        return 1;
    }
    if (direction === 'in' && rawScale < 1) return 1;
    if (direction === 'out' && rawScale > 1) return 1;
    return scale;
}

function enforceDirectionLockedZoom(nextZoom, currentZoom, direction) {
    if (!direction) return nextZoom;
    if (direction === 'out') {
        return Math.min(nextZoom, currentZoom);
    }
    if (direction === 'in') {
        return Math.max(nextZoom, currentZoom);
    }
    return nextZoom;
}

const GameBoardMini = ({ board, selectedCells, premiumSquares, onCellClick, boardLayoutRef, optimisticPlacement, dragSourceCell, settlingBoardTile = null, onBoardTilePickup, onBoardDragUpdate, onBoardTileDrop, getDraggableTileCell, onBoardTap, disableOverlayInteractions = false, allowEmptyCellPress = false, submitScorePreview = null, submitScorePreviewIsValid = false, submitScorePreviewCell = null, isDarkMode = false }) => {
    const boardViewRef = useRef(null);
    const zoomWrapperRef = useRef(null);
    const [zoom, setZoom] = useState(1);
    const zoomRef = useRef(1);
    const zoomAnim = useRef(new Animated.Value(1)).current;

    // Pan as Animated.ValueXY so updates run on native driver (no re-render per frame = smooth)
    const panAnim = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
    const panCurrentRef = useRef({ x: 0, y: 0 });
    const panStartRef = useRef({ x: 0, y: 0 });
    const twoTouchStart = useRef(null); // { centerX, centerY, initialMaxDist, zoom, panX, panY } when active
    const pinchStartRef = useRef(null); // { zoom, panX, panY, focalX, focalY }
    const zoomBoundLockRef = useRef(null); // 'max' | 'min' | null
    const zoomDirectionLockRef = useRef(null); // 'in' | 'out' | null
    const tileDragActiveRef = useRef(false);
    const interactionModeRef = useRef(INTERACTION_MODE_IDLE);
    const draggingTileFromOverlayRef = useRef(false);
    const lastOverlayPointRef = useRef(null);
    const onBoardTilePickupRef = useRef(onBoardTilePickup);
    const onBoardDragUpdateRef = useRef(onBoardDragUpdate);
    const onBoardTileDropRef = useRef(onBoardTileDrop);
    const getDraggableTileCellRef = useRef(getDraggableTileCell);
    const onBoardTapRef = useRef(onBoardTap);
    onBoardTilePickupRef.current = onBoardTilePickup;
    onBoardDragUpdateRef.current = onBoardDragUpdate;
    onBoardTileDropRef.current = onBoardTileDrop;
    getDraggableTileCellRef.current = getDraggableTileCell;
    onBoardTapRef.current = onBoardTap;

    const commitZoom = useCallback((nextZoom, flush = false) => {
        zoomRef.current = nextZoom;
        zoomAnim.setValue(nextZoom);
        if (flush) {
            setZoom((prev) => (Math.abs(prev - nextZoom) < 0.0005 ? prev : nextZoom));
        }
    }, [zoomAnim]);

    const resolveGestureScreenPoint = useCallback((event) => {
        const layout = boardLayoutRef?.current;
        const hasLayout =
            layout &&
            Number.isFinite(layout.x) &&
            Number.isFinite(layout.y);
        const hasLocalCoords = Number.isFinite(event?.x) && Number.isFinite(event?.y);
        if (Platform.OS === 'android' && hasLayout && hasLocalCoords) {
            return {
                x: layout.x + event.x,
                y: layout.y + event.y,
            };
        }
        if (Number.isFinite(event?.absoluteX) && Number.isFinite(event?.absoluteY)) {
            return { x: event.absoluteX, y: event.absoluteY };
        }
        if (hasLayout && hasLocalCoords) {
            return {
                x: layout.x + event.x,
                y: layout.y + event.y,
            };
        }
        return null;
    }, [boardLayoutRef]);

    const handleOverlayBoardPickup = useCallback((absoluteX, absoluteY) => {
        const cell = getDraggableTileCellRef.current?.(absoluteX, absoluteY);
        if (cell) {
            draggingTileFromOverlayRef.current = true;
            tileDragActiveRef.current = true;
            interactionModeRef.current = INTERACTION_MODE_TILE_DRAG;
            lastOverlayPointRef.current = { x: absoluteX, y: absoluteY };
            onBoardTilePickupRef.current?.(cell.row, cell.col, absoluteX, absoluteY);
            return true;
        }

        draggingTileFromOverlayRef.current = false;
        tileDragActiveRef.current = false;
        if (interactionModeRef.current === INTERACTION_MODE_TILE_DRAG) {
            interactionModeRef.current = INTERACTION_MODE_IDLE;
        }
        panStartRef.current = { x: panCurrentRef.current.x, y: panCurrentRef.current.y };
        return false;
    }, []);

    const handleOverlayBoardMove = useCallback((absoluteX, absoluteY, translationX, translationY) => {
        if (draggingTileFromOverlayRef.current) {
            lastOverlayPointRef.current = { x: absoluteX, y: absoluteY };
            onBoardDragUpdateRef.current?.(absoluteX, absoluteY);
            return;
        }

        const z = zoomRef.current;
        if (z <= 1) return;
        const next = {
            x: clampPan(panStartRef.current.x + translationX, z),
            y: clampPan(panStartRef.current.y + translationY, z),
        };
        panCurrentRef.current = next;
        panAnim.setValue(next);
    }, []);

    const handleOverlayBoardEnd = useCallback((absoluteX, absoluteY) => {
        if (draggingTileFromOverlayRef.current) {
            onBoardTileDropRef.current?.(absoluteX, absoluteY);
        } else if (zoomRef.current <= 1) {
            onBoardTapRef.current?.(absoluteX, absoluteY);
        }
        draggingTileFromOverlayRef.current = false;
        tileDragActiveRef.current = false;
        interactionModeRef.current = INTERACTION_MODE_IDLE;
        lastOverlayPointRef.current = null;
    }, []);

    const handleOverlayPanFinalize = useCallback((absoluteX, absoluteY) => {
        if (!draggingTileFromOverlayRef.current) return;
        const point = Number.isFinite(absoluteX) && Number.isFinite(absoluteY)
            ? { x: absoluteX, y: absoluteY }
            : lastOverlayPointRef.current;
        if (point) {
            onBoardTileDropRef.current?.(point.x, point.y);
        }
        draggingTileFromOverlayRef.current = false;
        tileDragActiveRef.current = false;
        interactionModeRef.current = INTERACTION_MODE_IDLE;
        lastOverlayPointRef.current = null;
    }, []);

    useEffect(() => {
        if (zoom <= 1) {
            panAnim.setValue({ x: 0, y: 0 });
            panCurrentRef.current = { x: 0, y: 0 };
        } else {
            const next = {
                x: clampPan(panCurrentRef.current.x, zoom),
                y: clampPan(panCurrentRef.current.y, zoom),
            };
            panCurrentRef.current = next;
            panAnim.setValue(next);
        }
    }, [zoom, panAnim]);

    // Board pan only (used when zoom <= 1 or as fallback; when zoomed, overlay pan handles both)
    const panGesture = useMemo(() => Gesture.Pan()
        .minPointers(1)
        .minDistance(10)
        .onStart(() => {
            panStartRef.current = { x: panCurrentRef.current.x, y: panCurrentRef.current.y };
        })
        .onUpdate((e) => {
            const z = zoomRef.current;
            if (z <= 1) return;
            const next = {
                x: clampPan(panStartRef.current.x + e.translationX, z),
                y: clampPan(panStartRef.current.y + e.translationY, z),
            };
            panCurrentRef.current = next;
            panAnim.setValue(next);
        }), [panAnim]);

    // Convert touch (pageX, pageY) to board content coords. Content origin = board view + border + padding.
    const touchToContent = useCallback((pageX, pageY) => {
        const layout = boardLayoutRef?.current;
        if (layout && typeof layout.x === 'number' && typeof layout.y === 'number') {
            const pad = zoomRef.current > 1 ? BOARD_PADDING / zoomRef.current : BOARD_PADDING;
            return {
                x: pageX - layout.x - BOARD_BORDER - pad,
                y: pageY - layout.y - BOARD_BORDER - pad,
            };
        }
        return { x: pageX, y: pageY };
    }, []);

    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const isTileDragActive = useCallback(
        () => tileDragActiveRef.current || draggingTileFromOverlayRef.current || !!dragSourceCell,
        [dragSourceCell]
    );

    // Two-touch zoom: focal = bottom finger (fixed at start). Scale = longest drag from center (either finger).
    const handleTwoTouchMove = useCallback((e) => {
        if (interactionModeRef.current !== INTERACTION_MODE_PINCH_ZOOM || isTileDragActive()) return;
        const start = twoTouchStart.current;
        if (!start || !e.nativeEvent.touches || e.nativeEvent.touches.length < 2) return;
        const t0 = e.nativeEvent.touches[0];
        const t1 = e.nativeEvent.touches[1];
        const p0 = touchToContent(t0.pageX, t0.pageY);
        const p1 = touchToContent(t1.pageX, t1.pageY);
        const center = start.center;
        const d0 = dist(p0, center);
        const d1 = dist(p1, center);
        const currentMaxDist = Math.max(d0, d1);
        if (start.initialMaxDist <= 0) return;
        const rawScale = currentMaxDist / start.initialMaxDist;
        const scale = resolveDirectionLockedScale(rawScale, rawScale, zoomDirectionLockRef);
        if (shouldSkipZoomAtBounds(zoomRef.current, scale)) return;
        const boundedZoom = resolveBoundedZoom(start.zoom, scale, zoomBoundLockRef);
        const newZoom = enforceDirectionLockedZoom(
            boundedZoom,
            zoomRef.current,
            zoomDirectionLockRef.current
        );
        if (Math.abs(newZoom - zoomRef.current) < ZOOM_BOUND_EPSILON) return;
        const C = GRID_SIZE / 2;
        // Keep focal (bottom finger at start) fixed: pan_new = pan_old + (focal - C)*(z_old - z_new)
        const panX = start.panX + (start.focalX - C) * (start.zoom - newZoom);
        const panY = start.panY + (start.focalY - C) * (start.zoom - newZoom);
        const clampedX = clampPan(panX, newZoom);
        const clampedY = clampPan(panY, newZoom);
        panCurrentRef.current = { x: clampedX, y: clampedY };
        panAnim.setValue({ x: clampedX, y: clampedY });
        commitZoom(newZoom);
    }, [touchToContent, panAnim, isTileDragActive, commitZoom]);

    const handleTwoTouchGrant = useCallback((e) => {
        if (isTileDragActive()) return;
        if (!e.nativeEvent.touches || e.nativeEvent.touches.length < 2) return;
        interactionModeRef.current = INTERACTION_MODE_PINCH_ZOOM;
        const t0 = e.nativeEvent.touches[0];
        const t1 = e.nativeEvent.touches[1];
        const p0 = touchToContent(t0.pageX, t0.pageY);
        const p1 = touchToContent(t1.pageX, t1.pageY);
        const centerX = (p0.x + p1.x) / 2;
        const centerY = (p0.y + p1.y) / 2;
        const center = { x: centerX, y: centerY };
        const d0 = dist(p0, center);
        const d1 = dist(p1, center);
        const initialMaxDist = Math.max(d0, d1, 1); // avoid 0
        const pan = panCurrentRef.current;
        const bottom = p0.y >= p1.y ? p0 : p1;
        zoomBoundLockRef.current = null;
        zoomDirectionLockRef.current = null;
        twoTouchStart.current = {
            focalX: bottom.x,
            focalY: bottom.y,
            centerX,
            centerY,
            center,
            initialMaxDist,
            zoom: zoomRef.current,
            panX: pan.x,
            panY: pan.y,
        };
    }, [touchToContent, isTileDragActive]);

    const handleTwoTouchRelease = useCallback(() => {
        twoTouchStart.current = null;
        zoomBoundLockRef.current = null;
        zoomDirectionLockRef.current = null;
        commitZoom(zoomRef.current, true);
        if (interactionModeRef.current === INTERACTION_MODE_PINCH_ZOOM) {
            interactionModeRef.current = INTERACTION_MODE_IDLE;
        }
    }, [commitZoom]);

    const handlePinchBegin = useCallback((focalX, focalY) => {
        if (isTileDragActive()) return;
        interactionModeRef.current = INTERACTION_MODE_PINCH_ZOOM;
        zoomBoundLockRef.current = null;
        zoomDirectionLockRef.current = null;
        const focal = touchToContent(focalX, focalY);
        const pan = panCurrentRef.current;
        pinchStartRef.current = {
            zoom: zoomRef.current,
            panX: pan.x,
            panY: pan.y,
            focalX: focal.x,
            focalY: focal.y,
        };
    }, [touchToContent, isTileDragActive]);

    const handlePinchUpdate = useCallback((scale, focalX, focalY) => {
        if (interactionModeRef.current !== INTERACTION_MODE_PINCH_ZOOM || isTileDragActive()) return;
        const start = pinchStartRef.current;
        if (!start) return;
        const effectiveScale = resolveDirectionLockedScale(scale, scale, zoomDirectionLockRef);
        if (shouldSkipZoomAtBounds(zoomRef.current, effectiveScale)) return;
        const focal = touchToContent(focalX, focalY);
        const boundedZoom = resolveBoundedZoom(
            start.zoom,
            effectiveScale,
            zoomBoundLockRef
        );
        const nextZoom = enforceDirectionLockedZoom(
            boundedZoom,
            zoomRef.current,
            zoomDirectionLockRef.current
        );
        if (Math.abs(nextZoom - zoomRef.current) < ZOOM_BOUND_EPSILON) return;
        const C = GRID_SIZE / 2;
        const focalXForPan = Number.isFinite(focal.x) ? focal.x : start.focalX;
        const focalYForPan = Number.isFinite(focal.y) ? focal.y : start.focalY;
        const panX = start.panX + (focalXForPan - C) * (start.zoom - nextZoom);
        const panY = start.panY + (focalYForPan - C) * (start.zoom - nextZoom);
        const clampedX = clampPan(panX, nextZoom);
        const clampedY = clampPan(panY, nextZoom);
        panCurrentRef.current = { x: clampedX, y: clampedY };
        panAnim.setValue({ x: clampedX, y: clampedY });
        commitZoom(nextZoom);
    }, [panAnim, touchToContent, isTileDragActive, commitZoom]);

    const handlePinchEnd = useCallback(() => {
        pinchStartRef.current = null;
        zoomBoundLockRef.current = null;
        zoomDirectionLockRef.current = null;
        commitZoom(zoomRef.current, true);
        if (interactionModeRef.current === INTERACTION_MODE_PINCH_ZOOM) {
            interactionModeRef.current = INTERACTION_MODE_IDLE;
        }
    }, [commitZoom]);

    const wantTwoTouch = useCallback(
        (e) =>
            interactionModeRef.current !== INTERACTION_MODE_TILE_DRAG &&
            !isTileDragActive() &&
            e.nativeEvent.touches &&
            e.nativeEvent.touches.length >= 2,
        [isTileDragActive]
    );
    const onMoveShouldSetResponderCapture = wantTwoTouch;
    const onMoveShouldSetResponder = wantTwoTouch;

    const onResponderGrant = useCallback((e) => {
        handleTwoTouchGrant(e);
    }, [handleTwoTouchGrant]);

    const onResponderMove = useCallback((e) => {
        handleTwoTouchMove(e);
    }, [handleTwoTouchMove]);

    const onResponderRelease = useCallback((e) => {
        if (!e.nativeEvent.touches || e.nativeEvent.touches.length < 2) {
            handleTwoTouchRelease();
        }
    }, [handleTwoTouchRelease]);

    const onResponderTerminate = useCallback(() => {
        handleTwoTouchRelease();
    }, [handleTwoTouchRelease]);

    // When zoomed: one Pan on overlay. On touch start, hit-test. If on a draggable tile → lift tile and drag it; else → board pan.
    // Refs for callbacks so gesture is stable across re-renders (pickup causes setState; recreating gesture would break active pan).
    // Keep the gesture itself on the UI thread and bridge only the JS controller callbacks that still require JS state.
    const overlayPanGesture = useMemo(() => {
        const base = Gesture.Pan()
            .minPointers(1)
            .maxPointers(1)
            .minDistance(OVERLAY_PAN_MIN_DISTANCE);

        if (ANDROID_GESTURE_PIPELINE_V2) {
            return base
                .runOnJS(true)
                .onBegin((e) => {
                    const point = resolveGestureScreenPoint(e);
                    if (point) {
                        handleOverlayBoardPickup(point.x, point.y);
                    }
                })
                .onUpdate((e) => {
                    const point = resolveGestureScreenPoint(e);
                    if (!point) return;
                    handleOverlayBoardMove(
                        point.x,
                        point.y,
                        e.translationX,
                        e.translationY
                    );
                })
                .onEnd((e) => {
                    const point = resolveGestureScreenPoint(e);
                    if (point) {
                        handleOverlayBoardEnd(point.x, point.y);
                    }
                })
                .onFinalize((e) => {
                    const point = resolveGestureScreenPoint(e);
                    handleOverlayPanFinalize(point?.x, point?.y);
                });
        }

        return base
            .runOnJS(true)
            .onBegin((e) => {
                const point = resolveGestureScreenPoint(e);
                if (point) {
                    handleOverlayBoardPickup(point.x, point.y);
                }
            })
            .onUpdate((e) => {
                const point = resolveGestureScreenPoint(e);
                if (!point) return;
                handleOverlayBoardMove(
                    point.x,
                    point.y,
                    e.translationX,
                    e.translationY
                );
            })
            .onEnd((e) => {
                const point = resolveGestureScreenPoint(e);
                if (point) {
                    handleOverlayBoardEnd(point.x, point.y);
                }
            })
            .onFinalize((e) => {
                const point = resolveGestureScreenPoint(e);
                handleOverlayPanFinalize(point?.x, point?.y);
            });
    }, [handleOverlayBoardEnd, handleOverlayBoardMove, handleOverlayBoardPickup, handleOverlayPanFinalize, resolveGestureScreenPoint]);

    const overlayPinchGesture = useMemo(() => {
        if (!ANDROID_GESTURE_PIPELINE_V2) return null;

        return Gesture.Pinch()
            .runOnJS(true)
            .onBegin((e) => {
                handlePinchBegin(e.focalX, e.focalY);
            })
            .onUpdate((e) => {
                handlePinchUpdate(e.scale, e.focalX, e.focalY);
            })
            .onEnd(() => {
                handlePinchEnd();
            });
    }, [handlePinchBegin, handlePinchEnd, handlePinchUpdate]);

    const overlayGesture = useMemo(() => {
        if (ANDROID_GESTURE_PIPELINE_V2 && overlayPinchGesture) {
            return Gesture.Simultaneous(overlayPanGesture, overlayPinchGesture);
        }
        return overlayPanGesture;
    }, [overlayPanGesture, overlayPinchGesture]);

    const updateGridBounds = useCallback(() => {
        if (!boardLayoutRef || !zoomWrapperRef.current) return;
        zoomWrapperRef.current.measureInWindow((lx, ly, w, h) => {
            if (boardLayoutRef.current) {
                boardLayoutRef.current.screenLeft = lx;
                boardLayoutRef.current.screenTop = ly;
                boardLayoutRef.current.screenRight = lx + w;
                boardLayoutRef.current.screenBottom = ly + h;
            }
        });
    }, [boardLayoutRef]);

    const updateBoardLayout = useCallback(() => {
        if (!boardLayoutRef || !boardViewRef.current) return;
        boardViewRef.current.measureInWindow((x, y, width, height) => {
            const z = zoomRef.current;
            const effectivePad = z <= 1 ? BOARD_PADDING : BOARD_PADDING / Math.max(1, z);
            const gridSize = BOARD_SIZE * CELL_SIZE_EFFECTIVE;
            boardLayoutRef.current = {
                x, y, width, height,
                padding: effectivePad,
                cellSize: CELL_SIZE_EFFECTIVE,
                gridSize,
                boardType: 'mini',
                maxZoom: MAX_ZOOM,
                contentOriginX: effectivePad,
                contentOriginY: effectivePad,
                getZoomPan: () => ({ zoom: zoomRef.current, pan: panCurrentRef.current }),
            };
            updateGridBounds();
        });
    }, [boardLayoutRef, updateGridBounds]);

    useEffect(() => {
        if (!boardLayoutRef) return;
        updateBoardLayout();
    }, [boardLayoutRef, zoom, updateBoardLayout]);

    // Keep grid bounds current during pan (throttled)
    const lastMeasureRef = useRef(0);
    useEffect(() => {
        if (!boardLayoutRef) return;
        const throttleMs = 50;
        const listener = () => {
            const now = Date.now();
            if (now - lastMeasureRef.current >= throttleMs) {
                lastMeasureRef.current = now;
                updateGridBounds();
            }
        };
        const idX = panAnim.x.addListener(listener);
        const idY = panAnim.y.addListener(listener);
        return () => {
            panAnim.x.removeListener(idX);
            panAnim.y.removeListener(idY);
        };
    }, [boardLayoutRef, updateGridBounds, panAnim.x, panAnim.y]);

    const effectivePadding = zoom > 1 ? BOARD_PADDING / Math.max(1, zoom) : BOARD_PADDING;
    const selectedCellKeys = useMemo(
        () => new Set(selectedCells.map(({ row, col }) => `${row},${col}`)),
        [selectedCells]
    );
    const submitScorePreviewCellKey = useMemo(() => {
        if (!submitScorePreviewCell) return null;
        return `${submitScorePreviewCell.row},${submitScorePreviewCell.col}`;
    }, [submitScorePreviewCell]);

    return (
        <View
            ref={boardViewRef}
            style={[
                styles.board,
                isDarkMode ? styles.boardDark : null,
                { padding: effectivePadding },
            ]}
            onLayout={boardLayoutRef ? updateBoardLayout : undefined}
        >
            <View style={styles.boardInner}>
                <Animated.View
                    ref={zoomWrapperRef}
                    style={[
                        styles.zoomWrapper,
                        {
                            transform: [
                                { translateX: -GRID_SIZE / 2 },
                                { translateY: -GRID_SIZE / 2 },
                                { scale: zoomAnim },
                                { translateX: GRID_SIZE / 2 },
                                { translateY: GRID_SIZE / 2 },
                                { translateX: panAnim.x },
                                { translateY: panAnim.y },
                            ],
                        },
                    ]}
                >
                    {BOARD_INDICES.map((row) =>
                        <View key={row} style={styles.row}>
                            {BOARD_INDICES.map((col) => {
                                const cellTile = board[row][col];
                                const isOptimisticSource = optimisticPlacement?.fromRow != null && optimisticPlacement?.fromCol != null && row === optimisticPlacement.fromRow && col === optimisticPlacement.fromCol;
                                const isOptimisticTarget = optimisticPlacement && optimisticPlacement.row === row && optimisticPlacement.col === col && optimisticPlacement.renderTarget !== false;
                                const isSettlingSource = settlingBoardTile && settlingBoardTile.fromRow === row && settlingBoardTile.fromCol === col && cellTile?.id === settlingBoardTile.id;
                                const isSettlingTarget = settlingBoardTile && settlingBoardTile.row === row && settlingBoardTile.col === col && cellTile?.id === settlingBoardTile.id;
                                const optTile = isOptimisticTarget ? { letter: optimisticPlacement.letter, value: optimisticPlacement.value, isFromRack: true, rackIndex: optimisticPlacement.rackIndex } : null;
                                const tile = isOptimisticSource || isSettlingSource ? null : (cellTile ?? optTile);
                                const defaultSelected = selectedCellKeys.has(`${row},${col}`);
                                const isSelected = (isOptimisticSource || isSettlingTarget)
                                    ? false
                                    : (isOptimisticTarget ? true : defaultSelected);
                                return (
                                <BoardCell
                                    key={`${row}-${col}`}
                                    row={row}
                                    col={col}
                                    tile={tile}
                                    isSelected={isSelected}
                                    isDragSource={!!(dragSourceCell && dragSourceCell.row === row && dragSourceCell.col === col)}
                                    premium={premiumSquares[`${row},${col}`]}
                                    onBoardTilePickup={onBoardTilePickup}
                                    onBoardDragUpdate={onBoardDragUpdate}
                                    onBoardTileDrop={onBoardTileDrop}
                                    onCellClick={onCellClick}
                                    allowEmptyCellPress={allowEmptyCellPress}
                                    showSubmitScorePreview={
                                        submitScorePreview != null &&
                                        submitScorePreviewCellKey === `${row},${col}`
                                    }
                                    submitScorePreview={submitScorePreview}
                                    submitScorePreviewIsValid={submitScorePreviewIsValid}
                                    isDarkMode={isDarkMode}
                                    onTilePickupStateChange={(active) => {
                                        tileDragActiveRef.current = active;
                                        interactionModeRef.current = active
                                            ? INTERACTION_MODE_TILE_DRAG
                                            : INTERACTION_MODE_IDLE;
                                    }}
                                />
                            ); })}
                        </View>
                    )}
                </Animated.View>
            </View>
            {/* Wrapper: take responder when 2 fingers (zoom); Pan has maxPointers(1) so single-touch goes to child. */}
            <View
                style={styles.panOverlay}
                pointerEvents={disableOverlayInteractions ? 'none' : 'auto'}
                onMoveShouldSetResponder={
                    disableOverlayInteractions || ANDROID_GESTURE_PIPELINE_V2
                        ? undefined
                        : onMoveShouldSetResponder
                }
                onMoveShouldSetResponderCapture={
                    disableOverlayInteractions || ANDROID_GESTURE_PIPELINE_V2
                        ? undefined
                        : onMoveShouldSetResponderCapture
                }
                onResponderGrant={
                    disableOverlayInteractions || ANDROID_GESTURE_PIPELINE_V2
                        ? undefined
                        : onResponderGrant
                }
                onResponderMove={
                    disableOverlayInteractions || ANDROID_GESTURE_PIPELINE_V2
                        ? undefined
                        : onResponderMove
                }
                onResponderRelease={
                    disableOverlayInteractions || ANDROID_GESTURE_PIPELINE_V2
                        ? undefined
                        : onResponderRelease
                }
                onResponderTerminate={
                    disableOverlayInteractions || ANDROID_GESTURE_PIPELINE_V2
                        ? undefined
                        : onResponderTerminate
                }
            >
                <GestureDetector gesture={overlayGesture}>
                    <View style={StyleSheet.absoluteFill} />
                </GestureDetector>
            </View>
        </View>
    );
};

// Board size from content: each cell takes TILE_SIZE + 2*CELL_MARGIN. Ceil to avoid rounding
// making the row slightly wider than the board. Add 3px extra on the right.
const boardContentWidth = BOARD_SIZE * (TILE_SIZE + 2 * CELL_MARGIN);
const BOARD_WIDTH = 2 * BOARD_PADDING + Math.ceil(boardContentWidth) + 3;
const BOARD_INNER_SIZE = BOARD_WIDTH - 2 * BOARD_PADDING;
const GRID_SIZE = BOARD_SIZE * (TILE_SIZE + 2 * CELL_MARGIN);

// Base viewport inset (border + padding). Pan viewport is adjusted by a zoom-dependent multiplier.
const PAN_VIEWPORT_INSET_BASE = (2 + BOARD_PADDING); // 12
const REFERENCE_PRO_MAX_SCREEN_WIDTH = 430;
const INSET_DEVICE_SCALE = Math.max(
    0.78,
    Math.min(1, SCREEN_WIDTH / REFERENCE_PRO_MAX_SCREEN_WIDTH)
);

// Inset multiplier varies continuously with zoom (1–1.75) so pinch on iPhone works at any zoom level.
function getInsetMultiplier(zoom) {
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    let base = 15;
    if (z <= 1.05) base = -0.1;
    else if (z <= 1.10) base = 0.1;
    else if (z <= 1.25) {
        const t = (z - 1.1) / (1.25 - 1.1);
        base = 0.1 + t * (2 - 0.1);
    } else if (z >= 1.75) {
        base = 15;
    } else if (z <= 1.4) {
        const t = (z - 1.25) / (1.4 - 1.25);
        base = 2 + t * (4.4 - 2);
    } else if (z <= 1.5) {
        const t = (z - 1.4) / (1.5 - 1.4);
        base = 4.4 + t * (6.7 - 4.4);
    } else if (z <= 1.6) {
        const t = (z - 1.5) / (1.6 - 1.5);
        base = 6.7 + t * (9 - 6.7);
    } else {
        const t = (z - 1.6) / (1.75 - 1.6);
        base = 11 + t * (15 - 11);
    }
    return base * INSET_DEVICE_SCALE;
}

function clampPan(value, zoom) {
    const inset = PAN_VIEWPORT_INSET_BASE * getInsetMultiplier(zoom);
    const viewportRight = BOARD_INNER_SIZE + inset;
    const min = viewportRight - GRID_SIZE * zoom;
    const max = 0;
    return Math.min(max, Math.max(min, value));
}

const BOARD_BG_COLOR = '#e0e0e0';
const BOARD_BORDER_COLOR = '#2c3e50';

const styles = StyleSheet.create({
    board: {
        backgroundColor: BOARD_BG_COLOR,
        borderWidth: 2,
        borderColor: BOARD_BORDER_COLOR,
        padding: BOARD_PADDING,
        borderRadius: 10,
        width: BOARD_WIDTH,
        height: BOARD_WIDTH,
        alignSelf: 'center',
        overflow: 'hidden',
        position: 'relative',
    },
    boardDark: {
        backgroundColor: '#4b5563',
        borderColor: '#ffffff',
    },
    boardInner: {
        width: BOARD_INNER_SIZE,
        height: BOARD_INNER_SIZE,
        justifyContent: 'flex-start',
        alignItems: 'flex-start',
        overflow: 'hidden',
        borderRadius: 8,
    },
    zoomWrapper: {
        width: GRID_SIZE,
        height: GRID_SIZE,
        justifyContent: 'center',
        alignItems: 'center',
    },
    panOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'transparent',
    },
    row: {
        flexDirection: 'row',
    },
    cell: {
        width: TILE_SIZE,
        height: TILE_SIZE,
        backgroundColor: '#ffffff',
        borderRadius: 4,
        justifyContent: 'center',
        alignItems: 'center',
        margin: CELL_MARGIN,
        overflow: 'visible',
    },
    cellWithSubmitScorePreview: {
        zIndex: 1000,
        elevation: 1000,
    },
    cellDark: {
        backgroundColor: '#000000',
    },
    cellInner: {
        width: '100%',
        height: '100%',
        position: 'relative',
        justifyContent: 'center',
        alignItems: 'center',
    },
    tileGradient: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        height: TILE_GRADIENT_HEIGHT_PX,
        borderRadius: 4,
        overflow: 'hidden',
    },
    cellOccupied: {
        backgroundColor: '#f39c12',
    },
    cellSelected: {
        backgroundColor: 'rgba(241, 211, 149, 0.24)',
        borderColor: '#E6CB8D',
        borderWidth: 1,
        transform: [{ scale: 1.03 }],
        zIndex: 10,
        shadowColor: '#E6CB8D',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.18,
        shadowRadius: 4,
        elevation: 2,
    },
    cellSelectedDark: {
        backgroundColor: 'rgba(241, 211, 149, 0.20)',
        borderColor: '#E6CB8D',
        borderWidth: 1,
        transform: [{ scale: 1.03 }],
        zIndex: 10,
        shadowColor: '#E6CB8D',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.15,
        shadowRadius: 3,
        elevation: 1,
    },
    premiumDW: {
        backgroundColor: '#e8a0a0', // lighter pink (Double Word)
    },
    premiumTW: {
        backgroundColor: '#c41e3a', // reddish/dark pink (Triple Word)
    },
    premiumDL: {
        backgroundColor: '#87ceeb', // light blue (Double Letter)
    },
    premiumTL: {
        backgroundColor: '#1e90ff', // cyan/dark blue (Triple Letter)
    },
    premiumCenter: {
        backgroundColor: '#e8a0a0', // same as Double Word, with star for first-turn
    },
    premiumDWDark: {
        backgroundColor: '#D07C9A',
    },
    premiumTWDark: {
        backgroundColor: '#B0374F',
    },
    premiumDLDark: {
        backgroundColor: '#65B2DB',
    },
    premiumTLDark: {
        backgroundColor: '#2D62AD',
    },
    premiumCenterDark: {
        backgroundColor: '#D07C9A',
    },
    premiumLabel: {
        color: 'white',
        fontSize: TILE_SIZE * 0.3,
        fontWeight: '700',
    },
    tile: {
        width: '100%',
        height: '100%',
        backgroundColor: '#FADFB6',
        borderRadius: 4,
        overflow: 'hidden',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#E4CDA7',
    },
    tileDark: {
        backgroundColor: '#FADFB6',
        borderColor: '#E4CDA7',
        shadowColor: '#ffffff',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.22,
        shadowRadius: 3,
        elevation: 3,
    },
    tileLetter: {
        fontSize: TILE_SIZE * 0.4 + 2,
        fontWeight: '700',
        color: '#2c3e50',
    },
    tileLetterDark: {
        color: '#000000',
    },
    tileValue: {
        position: 'absolute',
        top: 0,
        right: 1,
        fontSize: TILE_SIZE * 0.2,
        color: '#7f8c8d',
    },
    tileValueDark: {
        color: '#000000',
    },
    tileEdgeTop: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 1,
        backgroundColor: '#FDF2D8',
    },
    tileEdgeRight: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: 2,
        backgroundColor: '#FDF2D8',
    },
    tileEdgeLeftLower: {
        position: 'absolute',
        top: 0,
        left: 0,
        bottom: 0,
        width: 1,
        backgroundColor: '#E6CB8D',
    },
    tileEdgeBottomLower: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: 1,
        backgroundColor: '#E6CB8D',
    },
    submitScorePreviewBadge: {
        position: 'absolute',
        top: -4,
        right: -4,
        zIndex: 1001,
        elevation: 1001,
        width: 16,
        height: 16,
        borderRadius: 5,
        backgroundColor: '#3f3f3f',
        justifyContent: 'center',
        alignItems: 'center',
    },
    submitScorePreviewBadgeDark: {
        backgroundColor: '#d1d5db',
    },
    submitScorePreviewBadgeValid: {
        backgroundColor: '#22c55e',
    },
    submitScorePreviewBadgeValidDark: {
        backgroundColor: '#16a34a',
    },
    submitScorePreviewText: {
        fontSize: 8,
        lineHeight: 16,
        color: '#ffffff',
        fontWeight: '700',
        width: '100%',
        textAlign: 'center',
        textAlignVertical: 'center',
        includeFontPadding: false,
    },
    submitScorePreviewTextDark: {
        color: '#111827',
    },
});

const PREMIUM_LABELS = { dw: 'DW', tw: 'TW', dl: 'DL', tl: 'TL', center: '★' };

const BoardCell = React.memo(function BoardCell({
    row, col, tile, isSelected, isDragSource, premium,
    onBoardTilePickup, onBoardDragUpdate, onBoardTileDrop, onCellClick, allowEmptyCellPress,
    showSubmitScorePreview, submitScorePreview, submitScorePreviewIsValid = false,
    onTilePickupStateChange,
    isDarkMode = false,
}) {
    const previewBadgeScale = useRef(new Animated.Value(1)).current;
    const previousPreviewValueRef = useRef(null);
    const pickupPointerIdRef = useRef(null);
    const pickupLastPointRef = useRef(null);
    const darkShadowGradientColors = ['rgba(0,0,0,0.22)', 'rgba(0,0,0,0.08)', 'rgba(0,0,0,0)'];
    const showTileInCell = tile && !isDragSource;

    useEffect(() => {
        if (!showSubmitScorePreview || submitScorePreview == null) {
            previousPreviewValueRef.current = null;
            previewBadgeScale.setValue(1);
            return;
        }

        const previewSignature = `${submitScorePreview}:${submitScorePreviewIsValid ? 1 : 0}`;
        const shouldPulse =
            previousPreviewValueRef.current == null ||
            previousPreviewValueRef.current !== previewSignature;
        previousPreviewValueRef.current = previewSignature;

        if (!shouldPulse) return;

        previewBadgeScale.setValue(0.86);
        Animated.sequence([
            Animated.timing(previewBadgeScale, {
                toValue: 1.18,
                duration: 110,
                easing: Easing.out(Easing.quad),
                useNativeDriver: true,
            }),
            Animated.timing(previewBadgeScale, {
                toValue: 1,
                duration: 120,
                easing: Easing.inOut(Easing.quad),
                useNativeDriver: true,
            }),
        ]).start();
    }, [previewBadgeScale, showSubmitScorePreview, submitScorePreview, submitScorePreviewIsValid]);

    const cellStyle = useMemo(() => [
        styles.cell,
        showSubmitScorePreview && styles.cellWithSubmitScorePreview,
        isDarkMode && styles.cellDark,
        tile !== null && styles.cellOccupied,
        isSelected &&
            !showTileInCell &&
            (isDarkMode ? styles.cellSelectedDark : styles.cellSelected),
        premium === 'dw' && (isDarkMode ? styles.premiumDWDark : styles.premiumDW),
        premium === 'tw' && (isDarkMode ? styles.premiumTWDark : styles.premiumTW),
        premium === 'dl' && (isDarkMode ? styles.premiumDLDark : styles.premiumDL),
        premium === 'tl' && (isDarkMode ? styles.premiumTLDark : styles.premiumTL),
        premium === 'center' && (isDarkMode ? styles.premiumCenterDark : styles.premiumCenter),
    ].filter(Boolean), [isDarkMode, tile !== null, isSelected, premium, showTileInCell, showSubmitScorePreview]);

    const premiumGradientColorsLight = !isDarkMode
        ? ({
            dw: ['rgba(187,112,142,1)', 'rgba(187,112,142,0.35)', 'rgba(187,112,142,0)'],
            tw: ['rgba(129,40,73,1)', 'rgba(129,40,73,0.35)', 'rgba(129,40,73,0)'],
            dl: ['rgba(96,136,188,1)', 'rgba(96,136,188,0.35)', 'rgba(96,136,188,0)'],
            tl: ['rgba(56,88,184,1)', 'rgba(56,88,184,0.35)', 'rgba(56,88,184,0)'],
            center: ['rgba(187,112,142,1)', 'rgba(187,112,142,0.35)', 'rgba(187,112,142,0)'],
        }[premium] ?? null)
        : null;
    const letterTileGradientColors = ['rgba(241,211,149,1)', 'rgba(241,211,149,0.35)', 'rgba(241,211,149,0)'];
    const slotShadowGradientColors = showTileInCell
        ? (isDarkMode ? darkShadowGradientColors : letterTileGradientColors)
        : (!isDarkMode && premiumGradientColorsLight
            ? premiumGradientColorsLight
            : (isDarkMode
                ? ['rgba(255,255,255,0.22)', 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0)']
                : darkShadowGradientColors));
    const canPickup = (tile && tile.isFromRack && !tile.scored) || isDragSource;
    const cellContent = (
        <View style={styles.cellInner}>
            {showTileInCell ? (
                <View style={[styles.tile, isDarkMode ? styles.tileDark : null]}>
                    {!isDarkMode && <View style={styles.tileEdgeTop} pointerEvents="none" />}
                    {!isDarkMode && <View style={styles.tileEdgeRight} pointerEvents="none" />}
                    {!isDarkMode && <View style={styles.tileEdgeLeftLower} pointerEvents="none" />}
                    {!isDarkMode && <View style={styles.tileEdgeBottomLower} pointerEvents="none" />}
                    <Text style={[styles.tileLetter, isDarkMode ? styles.tileLetterDark : null]}>{tile.letter}</Text>
                    {!tile.isBlank && (
                        <Text style={[styles.tileValue, isDarkMode ? styles.tileValueDark : null]}>
                            {tile.value}
                        </Text>
                    )}
                </View>
            ) : (
                premium && (
                    <Text style={styles.premiumLabel}>{PREMIUM_LABELS[premium] ?? premium}</Text>
                )
            )}
            <LinearGradient
                pointerEvents="none"
                colors={slotShadowGradientColors}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
                style={styles.tileGradient}
            />
            {showTileInCell && showSubmitScorePreview && (
                <Animated.View
                    style={[
                        styles.submitScorePreviewBadge,
                        isDarkMode ? styles.submitScorePreviewBadgeDark : null,
                        submitScorePreviewIsValid
                            ? (isDarkMode
                                ? styles.submitScorePreviewBadgeValidDark
                                : styles.submitScorePreviewBadgeValid)
                            : null,
                        { transform: [{ scale: previewBadgeScale }] },
                    ]}
                >
                    <Text
                        style={[
                            styles.submitScorePreviewText,
                            isDarkMode && !submitScorePreviewIsValid
                                ? styles.submitScorePreviewTextDark
                                : null,
                        ]}
                    >
                        {submitScorePreview}
                    </Text>
                </Animated.View>
            )}
        </View>
    );

    const useCellPickupHandlers = canPickup && Platform.OS !== 'android';
    if (useCellPickupHandlers) {
        return (
            <View
                style={cellStyle}
                onStartShouldSetResponder={() => true}
                onTouchStart={(e) => {
                    if (!(tile && tile.isFromRack && !tile.scored) || !onBoardTilePickup) return;
                    if ((e.nativeEvent.touches?.length ?? 0) >= 2) return;
                    const starterTouch =
                        e.nativeEvent.changedTouches?.[0] ??
                        e.nativeEvent.touches?.[0] ??
                        e.nativeEvent;
                    const { pageX, pageY } = starterTouch;
                    const pointerId = Number.isFinite(starterTouch.identifier)
                        ? starterTouch.identifier
                        : null;
                    pickupPointerIdRef.current = pointerId;
                    pickupLastPointRef.current = { pageX, pageY };
                    onTilePickupStateChange?.(true);
                    onBoardTilePickup(row, col, pageX, pageY);
                }}
                onResponderMove={(e) => {
                    if (onBoardDragUpdate) {
                        const pointerId = pickupPointerIdRef.current;
                        const pointerTouch =
                            pointerId == null
                                ? e.nativeEvent.touches?.[0] ?? e.nativeEvent
                                : e.nativeEvent.touches?.find((touch) => touch.identifier === pointerId);
                        if (!pointerTouch) return;
                        const { pageX, pageY } = pointerTouch;
                        pickupLastPointRef.current = { pageX, pageY };
                        onBoardDragUpdate(pageX, pageY);
                    }
                }}
                onResponderRelease={(e) => {
                    const pointerId = pickupPointerIdRef.current;
                    const releasedTouch =
                        pointerId == null
                            ? e.nativeEvent.changedTouches?.[0] ??
                              e.nativeEvent.touches?.[0] ??
                              e.nativeEvent
                            : e.nativeEvent.changedTouches?.find(
                                  (touch) => touch.identifier === pointerId
                              );
                    if (!releasedTouch) return;
                    const { pageX, pageY } = releasedTouch;
                    pickupLastPointRef.current = { pageX, pageY };
                    pickupPointerIdRef.current = null;
                    onTilePickupStateChange?.(false);
                    if (onBoardTileDrop && canPickup) onBoardTileDrop(pageX, pageY);
                    else if (tile && onCellClick) onCellClick(row, col);
                }}
                onResponderTerminate={() => {
                    pickupPointerIdRef.current = null;
                    onTilePickupStateChange?.(false);
                    if (onBoardTileDrop && canPickup && pickupLastPointRef.current) {
                        onBoardTileDrop(
                            pickupLastPointRef.current.pageX,
                            pickupLastPointRef.current.pageY
                        );
                    }
                }}
            >
                {cellContent}
            </View>
        );
    }
    return (
        <TouchableOpacity
            style={cellStyle}
            onPress={() => {
                if ((tile || allowEmptyCellPress) && onCellClick) onCellClick(row, col);
            }}
            activeOpacity={0.3}
            disabled={!tile && !allowEmptyCellPress}
        >
            {cellContent}
        </TouchableOpacity>
    );
});

export default React.memo(GameBoardMini);
