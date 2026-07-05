import React, { useRef, useEffect, useLayoutEffect, useState } from "react";
import { View, Text, StyleSheet, Animated, Platform } from "react-native";

const TILE_SIZE = 42;
const TILE_MARGIN = 2;
export const SLOT_WIDTH = TILE_SIZE + 2 * TILE_MARGIN;
const SHUFFLE_ANIM_DURATION = 280;
const CLEAR_RETURN_ANIM_DURATION = 380;
const CLEAR_RETURN_SHRINK_DURATION = 100;
const CLEAR_RETURN_START_SCALE = 0.8;
const CLEAR_RETURN_SHRINK_SCALE = 0.6;
const RACK_REORDER_SETTLE_ANIM_DURATION = 220;

const TAP_SLOP = 14;
const RACK_TILE_PICKUP_SLOP = 10;
const USE_ANDROID_RESPONDER_INPUT =
  Platform.OS === "android" && global.__ANDROID_GESTURE_PIPELINE_V2__ === true;

/**
 * Uses direct touch events so drag updates arrive immediately without gesture activation delay.
 * When onPress is provided (e.g. swap mode), a short tap without drag calls onPress(index).
 */
function getDisplacementOffset(rackIndex, fromIdx, toIdx) {
  if (fromIdx < toIdx) {
    if (rackIndex > fromIdx && rackIndex <= toIdx) return -SLOT_WIDTH;
  } else if (fromIdx > toIdx) {
    if (rackIndex >= toIdx && rackIndex < fromIdx) return SLOT_WIDTH;
  }
  return 0;
}

function DraggableTileInner({
  index,
  tile,
  tileTheme,
  onDragStart,
  onDragUpdate,
  onDrop,
  onPress,
  isDragging,
  translateX,
  displacementX,
  clearReturnScale,
  isSwapSelected,
  collapseInRack,
  animationState,
  interactionsDisabled,
}) {
  const isUsed = tile.used;
  const touchStartRef = React.useRef(null);
  const lastTouchRef = React.useRef(null);
  const didMoveRef = React.useRef(false);

  const getTouchPoint = (e) => {
    const event = e?.nativeEvent ?? {};
    const touch = event.changedTouches?.[0] ?? event.touches?.[0];
    if (touch) {
      return { pageX: touch.pageX ?? 0, pageY: touch.pageY ?? 0 };
    }
    return { pageX: event.pageX ?? 0, pageY: event.pageY ?? 0 };
  };

  const handleTouchStart = (e) => {
    if (isUsed || interactionsDisabled) return;
    if (touchStartRef.current) return;
    const { pageX, pageY } = getTouchPoint(e);
    const { locationX = 0, locationY = 0 } = e.nativeEvent;
    touchStartRef.current = { x: pageX, y: pageY };
    lastTouchRef.current = { x: pageX, y: pageY };
    didMoveRef.current = false;
    if (!onPress) {
      onDragStart(
        index,
        {
          id: tile.id,
          letter: tile.letter,
          value: tile.value,
          rackIndex: tile.rackIndex,
          visibleIndex: tile.visibleIndex,
        },
        pageX,
        pageY,
        locationX,
        locationY
      );
    }
  };

  const handleTouchMove = (e) => {
    if (isUsed || interactionsDisabled) return;
    const { pageX, pageY } = getTouchPoint(e);
    lastTouchRef.current = { x: pageX, y: pageY };
    if (touchStartRef.current) {
      const dx = pageX - touchStartRef.current.x;
      const dy = pageY - touchStartRef.current.y;
      if (dx * dx + dy * dy > TAP_SLOP * TAP_SLOP) didMoveRef.current = true;
    }
    if (!onPress) onDragUpdate(pageX, pageY);
  };

  const handleTouchEnd = (e) => {
    if (interactionsDisabled) {
      touchStartRef.current = null;
      lastTouchRef.current = null;
      return;
    }
    const { pageX, pageY } = getTouchPoint(e);
    const touchStart = touchStartRef.current;
    const deltaX = touchStart ? pageX - touchStart.x : 0;
    const deltaY = touchStart ? pageY - touchStart.y : 0;
    if (onPress && !didMoveRef.current) {
      onPress(index);
      touchStartRef.current = null;
      lastTouchRef.current = null;
      return;
    }
    onDrop(index, pageX, pageY, {
      didMove: didMoveRef.current,
      deltaX,
      deltaY,
    });
    touchStartRef.current = null;
    lastTouchRef.current = null;
  };

  const handleTouchCancel = () => {
    if (!touchStartRef.current) return;
    if (!onPress && !interactionsDisabled) {
      const lastTouch = lastTouchRef.current ?? touchStartRef.current;
      onDrop(index, lastTouch.x, lastTouch.y);
    }
    touchStartRef.current = null;
    lastTouchRef.current = null;
  };

  const handleResponderGrant = (e) => {
    handleTouchStart(e);
  };

  const handleResponderMove = (e) => {
    handleTouchMove(e);
  };

  const handleResponderRelease = (e) => {
    handleTouchEnd(e);
  };

  const handleResponderTerminate = () => {
    handleTouchCancel();
  };

  const transform = [];
  if (translateX) transform.push({ translateX });
  if (displacementX) transform.push({ translateX: displacementX });
  if (animationState?.translateY)
    transform.push({ translateY: animationState.translateY });
  if (clearReturnScale) transform.push({ scale: clearReturnScale });
  const tileStyle = [
    styles.tile,
    tileTheme
      ? {
          backgroundColor: tileTheme.tileBackground,
          borderColor: tileTheme.tileBorder,
        }
      : null,
    isUsed && styles.tileUsed,
    isUsed && tileTheme ? { backgroundColor: tileTheme.tileUsedBackground } : null,
    isSwapSelected && styles.tileSwapSelected,
    isSwapSelected && tileTheme
      ? {
          borderColor: tileTheme.tileSwapBorder,
          backgroundColor: tileTheme.tileSwapBackground,
        }
      : null,
    isDragging && styles.tileDragging,
    collapseInRack && styles.tileCollapsed,
    animationState?.opacity ? { opacity: animationState.opacity } : null,
    tile.hidden && styles.tileHidden,
    transform.length > 0 ? { transform } : null,
  ].filter(Boolean);

  return (
    <Animated.View
      style={tileStyle}
      pointerEvents={interactionsDisabled ? "none" : "auto"}
      hitSlop={{
        top: RACK_TILE_PICKUP_SLOP,
        bottom: RACK_TILE_PICKUP_SLOP,
        left: RACK_TILE_PICKUP_SLOP,
        right: RACK_TILE_PICKUP_SLOP,
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={USE_ANDROID_RESPONDER_INPUT ? undefined : handleTouchMove}
      onTouchEnd={USE_ANDROID_RESPONDER_INPUT ? undefined : handleTouchEnd}
      onTouchCancel={USE_ANDROID_RESPONDER_INPUT ? undefined : handleTouchCancel}
      onStartShouldSetResponder={
        USE_ANDROID_RESPONDER_INPUT && !interactionsDisabled ? () => true : undefined
      }
      onMoveShouldSetResponder={
        USE_ANDROID_RESPONDER_INPUT && !interactionsDisabled ? () => true : undefined
      }
      onResponderGrant={USE_ANDROID_RESPONDER_INPUT ? handleResponderGrant : undefined}
      onResponderMove={USE_ANDROID_RESPONDER_INPUT ? handleResponderMove : undefined}
      onResponderRelease={USE_ANDROID_RESPONDER_INPUT ? handleResponderRelease : undefined}
      onResponderTerminate={USE_ANDROID_RESPONDER_INPUT ? handleResponderTerminate : undefined}
    >
      {animationState?.scoreText ? (
        <Animated.View
          style={[
            styles.swapScoreRow,
            {
              opacity: animationState.scoreOpacity,
              transform: [
                animationState.scoreTranslateY
                  ? { translateY: animationState.scoreTranslateY }
                  : { translateY: 0 },
                animationState.scoreScale
                  ? { scale: animationState.scoreScale }
                  : { scale: 1 },
              ],
            },
          ]}
        >
          <Text style={styles.swapScoreText}>{animationState.scoreText}</Text>
          {animationState.multiplierText ? (
            <Animated.Text
              style={[
                styles.swapMultiplierText,
                {
                  opacity: animationState.multiplierOpacity,
                  transform: animationState.multiplierScale
                    ? [{ scale: animationState.multiplierScale }]
                    : undefined,
                },
              ]}
            >
              {animationState.multiplierText}
            </Animated.Text>
          ) : null}
        </Animated.View>
      ) : null}
      {tile.value > 0 && (
        <Text style={[styles.tileValue, tileTheme ? { color: tileTheme.tileValue } : null]}>
          {tile.value}
        </Text>
      )}
      <Text
        style={[
          styles.tileLetter,
          tileTheme ? { color: tileTheme.tileLetter } : null,
          (tile.letter === " " || tile.letter === "") && styles.tileLetterBlank,
        ]}
      >
        {tile.letter === " " || tile.letter === "" ? " " : tile.letter}
      </Text>
    </Animated.View>
  );
}

function tilePropsEqual(a, b) {
  if (
    a.index !== b.index ||
    a.isDragging !== b.isDragging ||
    a.isSwapSelected !== b.isSwapSelected ||
    a.collapseInRack !== b.collapseInRack
  )
    return false;
  if (
    a.translateX !== b.translateX ||
    a.displacementX !== b.displacementX ||
    a.clearReturnScale !== b.clearReturnScale
  )
    return false;
  if (
    a.animationState !== b.animationState ||
    a.interactionsDisabled !== b.interactionsDisabled
  )
    return false;
  if (
    a.onDragStart !== b.onDragStart ||
    a.onDragUpdate !== b.onDragUpdate ||
    a.onDrop !== b.onDrop ||
    a.onPress !== b.onPress
  )
    return false;
  if (a.tileTheme !== b.tileTheme) return false;
  const ta = a.tile;
  const tb = b.tile;
  return (
    ta.id === tb.id &&
    ta.letter === tb.letter &&
    ta.value === tb.value &&
    ta.hidden === tb.hidden &&
    ta.used === tb.used &&
    ta.rackIndex === tb.rackIndex &&
    ta.visibleIndex === tb.visibleIndex
  );
}

const DraggableTile = React.memo(DraggableTileInner, tilePropsEqual);

const TileRack = ({
  tiles,
  isDarkMode = false,
  onDragStart,
  onDragUpdate,
  onDrop,
  onTilePress,
  swapSelectedIndices = [],
  draggingRackIndex,
  draggingTileId = null,
  draggingVisibleIndex,
  draggingVisibleIndexValue,
  predictedInsertionIndex,
  hoverIndexValue,
  rackPlaceholderIndex,
  rackPlaceholderIndexValue,
  showBoardPlaceholder = false,
  settlingRackPlaceholderIndex = null,
  settlingRackSlotCount = null,
  settlingRackTileId = null,
  settlingRackOrder = null,
  settlingRackShouldAnimateReorder = true,
  shuffleTrigger,
  clearedRackTileIds = [],
  onClearReturnAnimationComplete,
  onMeasureLayout,
  isSwapMode = false,
  tileAnimationStates = {},
  interactionsDisabled = false,
  swapMultiplier = 1,
}) => {
  const tileTheme = isDarkMode ? DARK_THEME : LIGHT_THEME;
  const lastOrderRef = useRef([]);
  const prevShuffleTriggerRef = useRef(0);
  const animatedValuesRef = useRef(null);
  const displacementAnimRef = useRef({});
  const displacementValueRef = useRef({});
  const rackRootRef = useRef(null);
  const rackRowRef = useRef(null);
  const draggingVisibleIndexRef = useRef(draggingVisibleIndex ?? -1);
  const hoverIndexRef = useRef(predictedInsertionIndex ?? -1);
  const [boardPlaceholderIndex, setBoardPlaceholderIndex] = useState(null);
  const [isDraggingOutsideRack, setIsDraggingOutsideRack] = useState(false);

  if (!animatedValuesRef.current) {
    animatedValuesRef.current = {};
  }
  const getAnimatedValue = (tileId) => {
    if (!animatedValuesRef.current[tileId]) {
      animatedValuesRef.current[tileId] = new Animated.Value(0);
    }
    return animatedValuesRef.current[tileId];
  };

  const getDisplacementValue = (tileId) => {
    if (!displacementAnimRef.current[tileId]) {
      displacementAnimRef.current[tileId] = new Animated.Value(0);
      displacementValueRef.current[tileId] = 0;
    }
    return displacementAnimRef.current[tileId];
  };

  const clearReturnScaleRef = useRef({});
  const getClearReturnScale = (tileId) => {
    if (!clearReturnScaleRef.current[tileId]) {
      clearReturnScaleRef.current[tileId] = new Animated.Value(1);
    }
    return clearReturnScaleRef.current[tileId];
  };

  useLayoutEffect(() => {
    if (clearedRackTileIds.length === 0) return;
    const tileIds = clearedRackTileIds;
    const runAnimation = () => {
      tileIds.forEach((tileId) => {
        const scale = getClearReturnScale(tileId);
        scale.setValue(CLEAR_RETURN_START_SCALE);
        Animated.sequence([
          Animated.timing(scale, {
            toValue: CLEAR_RETURN_SHRINK_SCALE,
            duration: CLEAR_RETURN_SHRINK_DURATION,
            useNativeDriver: true,
          }),
          Animated.spring(scale, {
            toValue: 1,
            useNativeDriver: true,
            friction: 7,
            tension: 100,
          }),
        ]).start();
      });
    };
    const frameId = requestAnimationFrame(runAnimation);
    const t = setTimeout(() => {
      onClearReturnAnimationComplete?.();
    }, CLEAR_RETURN_ANIM_DURATION);
    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(t);
    };
  }, [clearedRackTileIds, onClearReturnAnimationComplete]);

  // Store current order (by tile id) for next time; skip when shuffle just fired so shuffle effect can read old order
  useEffect(() => {
    const sameTrigger = shuffleTrigger === prevShuffleTriggerRef.current;
    if (sameTrigger) {
      lastOrderRef.current = tiles.map((t) => t.id);
    }
  }, [tiles, shuffleTrigger]);

  // When shuffle button was pressed, animate from last order to current order (by tile id)
  useLayoutEffect(() => {
    if (shuffleTrigger === 0) return;
    const prevOrder = lastOrderRef.current;
    const newOrder = tiles.map((t) => t.id);
    prevShuffleTriggerRef.current = shuffleTrigger;
    if (prevOrder.length !== newOrder.length) return;
    const orderChanged = prevOrder.some((r, i) => r !== newOrder[i]);
    if (!orderChanged) return;

    tiles.forEach((tile, newIndex) => {
      const oldIndex = prevOrder.indexOf(tile.id);
      if (oldIndex !== newIndex) {
        const anim = getAnimatedValue(tile.id);
        const delta = (oldIndex - newIndex) * SLOT_WIDTH;
        anim.setValue(delta);
        Animated.timing(anim, {
          toValue: 0,
          duration: SHUFFLE_ANIM_DURATION,
          useNativeDriver: true,
        }).start();
      }
    });
  }, [shuffleTrigger]);

  // When rack order changes during drag-settle, animate non-dragged tiles into place
  // so adjacent swaps do not visually snap.
  useLayoutEffect(() => {
    if (settlingRackTileId == null || !settlingRackShouldAnimateReorder) return;
    const prevOrder = lastOrderRef.current;
    const newOrder = tiles.map((t) => t.id);
    if (prevOrder.length !== newOrder.length || prevOrder.length === 0) return;
    const orderChanged = prevOrder.some((id, idx) => id !== newOrder[idx]);
    if (!orderChanged) return;

    tiles.forEach((tile, newIndex) => {
      if (tile.id === settlingRackTileId) return;
      const oldIndex = prevOrder.indexOf(tile.id);
      if (oldIndex < 0 || oldIndex === newIndex) return;
      const anim = getAnimatedValue(tile.id);
      const delta = (oldIndex - newIndex) * SLOT_WIDTH;
      anim.setValue(delta);
      Animated.timing(anim, {
        toValue: 0,
        duration: RACK_REORDER_SETTLE_ANIM_DURATION,
        useNativeDriver: true,
      }).start();
    });
  }, [settlingRackShouldAnimateReorder, settlingRackTileId, tiles]);

  // Update displacement Animated.Values only when hover index changes; only affected tiles get setValue.
  useEffect(() => {
    draggingVisibleIndexRef.current = draggingVisibleIndex ?? -1;
    if (draggingVisibleIndex == null) {
      setIsDraggingOutsideRack(false);
      applyDisplacementOffsets(-1, -1);
    }
  }, [applyDisplacementOffsets, draggingVisibleIndex]);

  useEffect(() => {
    hoverIndexRef.current = predictedInsertionIndex ?? -1;
    if (draggingVisibleIndex != null) {
      setIsDraggingOutsideRack(predictedInsertionIndex == null);
    }
  }, [predictedInsertionIndex]);

  useEffect(() => {
    if (!showBoardPlaceholder) {
      setBoardPlaceholderIndex(null);
      return undefined;
    }
    if (rackPlaceholderIndex != null) {
      setBoardPlaceholderIndex(Math.round(rackPlaceholderIndex));
      return undefined;
    }
    if (!rackPlaceholderIndexValue) {
      const nextIndex =
        rackPlaceholderIndex == null ? null : Math.round(rackPlaceholderIndex);
      setBoardPlaceholderIndex(nextIndex);
      return undefined;
    }
    const subscriptionId = rackPlaceholderIndexValue.addListener(({ value }) => {
      const nextIndex = Math.round(value);
      if (nextIndex >= 0) {
        setBoardPlaceholderIndex(nextIndex);
        return;
      }
      setBoardPlaceholderIndex(null);
    });
    return () => {
      rackPlaceholderIndexValue.removeListener(subscriptionId);
    };
  }, [rackPlaceholderIndex, rackPlaceholderIndexValue, showBoardPlaceholder]);

  const applyDisplacementOffsets = React.useCallback(
    (fromIdx, toIdx) => {
      if (fromIdx == null || fromIdx < 0 || toIdx == null || toIdx < 0) {
        Object.keys(displacementAnimRef.current).forEach((id) => {
          const anim = displacementAnimRef.current[id];
          anim.setValue(0);
          displacementValueRef.current[id] = 0;
        });
        return;
      }
      tiles.forEach((tile) => {
        const newOffset = getDisplacementOffset(
          tile.visibleIndex,
          fromIdx,
          toIdx
        );
        const current = displacementValueRef.current[tile.id] ?? 0;
        if (newOffset === current) return;
        const anim = getDisplacementValue(tile.id);
        anim.setValue(newOffset);
        displacementValueRef.current[tile.id] = newOffset;
      });
    },
    [tiles]
  );

  useEffect(() => {
    if (!isDraggingOutsideRack) return;
    applyDisplacementOffsets(-1, -1);
  }, [applyDisplacementOffsets, isDraggingOutsideRack]);

  useEffect(() => {
    applyDisplacementOffsets(
      draggingVisibleIndexRef.current,
      hoverIndexRef.current
    );
  }, [applyDisplacementOffsets, tiles]);

  useEffect(() => {
    if (!draggingVisibleIndexValue) return undefined;
    const subscriptionId = draggingVisibleIndexValue.addListener(({ value }) => {
      draggingVisibleIndexRef.current = Math.round(value);
      applyDisplacementOffsets(
        draggingVisibleIndexRef.current,
        hoverIndexRef.current
      );
    });
    return () => {
      draggingVisibleIndexValue.removeListener(subscriptionId);
    };
  }, [applyDisplacementOffsets, draggingVisibleIndexValue]);

  useEffect(() => {
    if (!hoverIndexValue) return undefined;
    const subscriptionId = hoverIndexValue.addListener(({ value }) => {
      hoverIndexRef.current = Math.round(value);
      if (draggingVisibleIndexRef.current < 0) {
        applyDisplacementOffsets(-1, -1);
        return;
      }
      if (draggingVisibleIndexRef.current != null && draggingVisibleIndexRef.current >= 0) {
        setIsDraggingOutsideRack(hoverIndexRef.current < 0);
      }
      applyDisplacementOffsets(
        draggingVisibleIndexRef.current,
        hoverIndexRef.current
      );
    });
    return () => {
      hoverIndexValue.removeListener(subscriptionId);
    };
  }, [applyDisplacementOffsets, hoverIndexValue]);

  useEffect(() => {
    const fromIdx = draggingVisibleIndex;
    const toIdx = predictedInsertionIndex;
    if (draggingVisibleIndexValue || hoverIndexValue) {
      return undefined;
    }
    if (fromIdx == null || toIdx == null) {
      Object.keys(displacementAnimRef.current).forEach((id) => {
        const anim = displacementAnimRef.current[id];
        anim.setValue(0);
        displacementValueRef.current[id] = 0;
      });
      return;
    }
    tiles.forEach((tile) => {
      const newOffset = getDisplacementOffset(
        tile.visibleIndex,
        fromIdx,
        toIdx
      );
      const current = displacementValueRef.current[tile.id] ?? 0;
      if (newOffset === current) return;
      const anim = getDisplacementValue(tile.id);
        anim.setValue(newOffset);
        displacementValueRef.current[tile.id] = newOffset;
      });
  }, [
    draggingVisibleIndex,
    draggingVisibleIndexValue,
    hoverIndexValue,
    predictedInsertionIndex,
    tiles,
  ]);

  // Keep the dragged tile's footprint only while it still has a valid rack
  // insertion target. Once it leaves the rack area, collapse it so the
  // remaining tiles recenter as n - 1.
  const collapseDraggedTile = isDraggingOutsideRack;
  const showSettlingRackPlaceholder = settlingRackPlaceholderIndex != null;
  const rackRenderTiles = React.useMemo(() => {
    if (!showSettlingRackPlaceholder || settlingRackTileId == null) {
      return tiles;
    }

    const currentTiles = tiles.filter((tile) => tile.id !== settlingRackTileId);
    const currentById = new Map(currentTiles.map((tile) => [tile.id, tile]));
    const frozenOrder = settlingRackOrder;
    if (!frozenOrder) {
      return currentTiles;
    }

    const ordered = frozenOrder
      .map((tileId) => currentById.get(tileId))
      .filter(Boolean);
    const seenIds = new Set(ordered.map((tile) => tile.id));
    currentTiles.forEach((tile) => {
      if (!seenIds.has(tile.id)) {
        ordered.push(tile);
      }
    });
    return ordered;
  }, [settlingRackOrder, settlingRackTileId, showSettlingRackPlaceholder, tiles]);
  const showPlaceholder =
    showSettlingRackPlaceholder ||
    (showBoardPlaceholder &&
      (rackPlaceholderIndexValue
        ? boardPlaceholderIndex != null
        : rackPlaceholderIndex != null));
  const slotCount = rackRenderTiles.length + (showPlaceholder ? 1 : 0);
  const placeholderIndex = showPlaceholder
    ? Math.min(
        showSettlingRackPlaceholder
          ? settlingRackPlaceholderIndex
          : rackPlaceholderIndexValue
            ? boardPlaceholderIndex
            : rackPlaceholderIndex,
        rackRenderTiles.length
      )
    : -1;
  const slotIndices = Array.from({ length: slotCount }, (_, i) => i);

  const hasDisplacement =
    !collapseDraggedTile &&
    ((draggingVisibleIndexValue != null && hoverIndexValue != null) ||
      (draggingVisibleIndex != null && predictedInsertionIndex != null));

  const handleRackLayout = () => {
    rackRowRef.current?.measureInWindow?.((x, y, width, height) => {
      onMeasureLayout?.({ x, y, width, height });
    });
  };

  return (
    <View
      ref={rackRootRef}
      style={[
        styles.container,
        {
          backgroundColor: tileTheme.rackBackground,
          borderColor: isSwapMode ? tileTheme.swapBorder : "transparent",
        },
      ]}
    >
      {isSwapMode && !interactionsDisabled && (
        <Text style={[styles.swapLabel, { color: tileTheme.swapLabel }]}>
          {`click tiles to swap! (- ${swapMultiplier.toFixed(1)}x)`}
        </Text>
      )}
      <View ref={rackRowRef} style={styles.rack} onLayout={handleRackLayout}>
        {slotIndices.map((slotIndex) =>
          showPlaceholder && slotIndex === placeholderIndex ? (
            <View key="rack-placeholder" style={styles.rackPlaceholder} />
          ) : (
            (() => {
              const tileIndex =
                showPlaceholder && slotIndex > placeholderIndex
                  ? slotIndex - 1
                  : slotIndex;
              const tile = rackRenderTiles[tileIndex];
              if (!tile) return null;
              return (
                <DraggableTile
                  key={tile.id ?? `tile-${tile.rackIndex}-${slotIndex}`}
                  index={tile.rackIndex}
                  tile={tile}
                  onDragStart={onDragStart}
                  onDragUpdate={onDragUpdate}
                  onDrop={onDrop}
                  onPress={onTilePress}
                  isSwapSelected={swapSelectedIndices.includes(tile.rackIndex)}
                  isDragging={
                    !collapseDraggedTile &&
                    (draggingTileId != null
                      ? draggingTileId === tile.id
                      : draggingRackIndex === tile.rackIndex)
                  }
                  collapseInRack={
                    collapseDraggedTile &&
                    (draggingTileId != null
                      ? draggingTileId === tile.id
                      : draggingRackIndex === tile.rackIndex)
                  }
                  animationState={tileAnimationStates[tile.id]}
                  tileTheme={tileTheme}
                  interactionsDisabled={interactionsDisabled}
                  translateX={getAnimatedValue(tile.id)}
                  displacementX={
                    hasDisplacement ? getDisplacementValue(tile.id) : undefined
                  }
                  clearReturnScale={getClearReturnScale(tile.id)}
                />
              );
            })()
          )
        )}
      </View>
    </View>
  );
};

const LIGHT_THEME = {
  rackBackground: "#f5f6f7",
  swapBorder: "#2980b9",
  swapLabel: "#2980b9",
  tileBackground: "#f5ebe0",
  tileBorder: "#bdc3c7",
  tileUsedBackground: "#ebe0d5",
  tileSwapBorder: "#2980b9",
  tileSwapBackground: "#e8f4fc",
  tileLetter: "#2c3e50",
  tileValue: "#7f8c8d",
};

const DARK_THEME = {
  rackBackground: "#4b5563",
  swapBorder: "#1d4ed8",
  swapLabel: "#dbeafe",
  tileBackground: "#e2e8f0",
  tileBorder: "#94a3b8",
  tileUsedBackground: "#cfd8e3",
  tileSwapBorder: "#1d4ed8",
  tileSwapBackground: "#c7dcfb",
  tileLetter: "#111827",
  tileValue: "#374151",
};

const styles = StyleSheet.create({
  container: {
    width: "100%",
    alignItems: "center",
    backgroundColor: "#f5f6f7",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: "transparent",
  },
  containerSwapMode: {
    borderColor: "#2980b9",
  },
  swapLabel: {
    marginBottom: 4,
    fontSize: 13,
    fontWeight: "600",
    color: "#2980b9",
    textAlign: "center",
    textTransform: "lowercase",
  },
  rack: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    minHeight: TILE_SIZE + 8,
  },
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    backgroundColor: "#f5ebe0",
    borderRadius: 4,
    justifyContent: "center",
    alignItems: "center",
    marginHorizontal: 2,
    borderWidth: 1,
    borderColor: "#bdc3c7",
    position: "relative",
  },
  tileUsed: {
    opacity: 0.5,
    backgroundColor: "#ebe0d5",
  },
  tileSwapSelected: {
    borderColor: "#2980b9",
    borderWidth: 2,
    backgroundColor: "#e8f4fc",
  },
  tileLetterBlank: {
    color: "transparent",
    opacity: 0,
  },
  tileDragging: {
    opacity: 0,
  },
  tileCollapsed: {
    width: 0,
    height: 0,
    marginHorizontal: 0,
    borderWidth: 0,
    opacity: 0,
  },
  tileHidden: {
    opacity: 0,
  },
  tileLetter: {
    fontSize: 20,
    fontWeight: "700",
    color: "#2c3e50",
  },
  tileValue: {
    position: "absolute",
    top: 2,
    right: 3,
    fontSize: 9,
    color: "#7f8c8d",
  },
  swapScoreRow: {
    position: "absolute",
    top: -20,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  swapScoreText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#2980b9",
  },
  swapMultiplierText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#1f5f8b",
  },
  rackPlaceholder: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    marginHorizontal: TILE_MARGIN,
  },
});

export default TileRack;
