import React from "react";
import { View, Text, StyleSheet, Dimensions } from "react-native";

const BOARD_TILE_BACKGROUND = "#FADFB6";
const BOARD_TILE_BORDER = "#E4CDA7";
const BOARD_TILE_LETTER = "#2c3e50";
const BOARD_TILE_LETTER_DARK = "#000000";
const BOARD_TILE_VALUE = "#7f8c8d";
const BOARD_TILE_VALUE_DARK = "#000000";

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const BOARD_SIZE = 15;
// Board background border: 4px on each side
const BOARD_PADDING = 6;
// Base cell size; tiles are 2px smaller (TILE_SIZE), spacing increased to keep board size same
const BASE_CELL_MARGIN = 0.5;
const CELL_SIZE = Math.min(
    (SCREEN_WIDTH - 40 - (BOARD_SIZE - 1) * 2 * BASE_CELL_MARGIN - 2 * BOARD_PADDING) / BOARD_SIZE,
    35
);
const TILE_SIZE = CELL_SIZE - 2;

function isBlankLetter(letter) {
  return letter === " " || letter === "";
}

export default function BoardTileFace({
  letter,
  value = 0,
  size = 42,
  isDarkMode = false,
  fitContainer = false,
  style = null,
}) {
  const blank = isBlankLetter(letter);
  const tileSize = Math.max(1, Number.isFinite(size) ? size : 42);
  const letterFontSize = tileSize * 0.4 + 2;
  const valueFontSize = tileSize * 0.2;

  return (
    <View
      style={[
        styles.tile,
        fitContainer ? styles.tileFill : { width: tileSize, height: tileSize },
        isDarkMode ? styles.tileDark : null,
        style,
      ]}
    >
      {!isDarkMode && <View style={styles.tileEdgeTop} pointerEvents="none" />}
      {!isDarkMode && <View style={styles.tileEdgeRight} pointerEvents="none" />}
      {!isDarkMode && <View style={styles.tileEdgeLeftLower} pointerEvents="none" />}
      {!isDarkMode && <View style={styles.tileEdgeBottomLower} pointerEvents="none" />}
      <Text
        style={[
          styles.tileLetter,
          { fontSize: letterFontSize, color: isDarkMode ? BOARD_TILE_LETTER_DARK : BOARD_TILE_LETTER },
          blank ? styles.tileLetterBlank : null,
        ]}
      >
        {blank ? " " : letter}
      </Text>
      {!blank && value > 0 ? (
        <Text
          style={[
            styles.tileValue,
            { fontSize: valueFontSize, color: isDarkMode ? BOARD_TILE_VALUE_DARK : BOARD_TILE_VALUE },
          ]}
        >
          {value}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
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
});
