import React from "react";
import { Text, StyleSheet, View } from "react-native";

const GameInfo = ({
  wordCount,
  turnCount,
  tilesRemaining,
  overallHighScore,
  pendingTurnFlavor,
  sprintRushMode = "standard",
  sprintTargetScore = 200,
  currentScore = 0,
  rushRemainingSeconds = null,
  rushDurationSeconds = null,
  gameOver = false,
  isDarkMode = false,
}) => {
  const theme = isDarkMode ? DARK_THEME : LIGHT_THEME;

  const formatClock = (seconds) => {
    if (typeof seconds !== "number") return "--:--";
    const clamped = Math.max(0, seconds);
    const minutes = Math.floor(clamped / 60);
    const remainder = clamped % 60;
    return `${minutes}:${String(remainder).padStart(2, "0")}`;
  };

  const renderMetricValue = (label, total, flavorValue) => {
    const pendingValue =
      pendingTurnFlavor && typeof flavorValue?.pendingPrevious === "number"
        ? flavorValue.pendingPrevious
        : null;

    return (
      <View style={[styles.infoItem, { backgroundColor: theme.infoBackground }]}>
        <Text style={[styles.label, { color: theme.label }]}>{label}</Text>
        <View style={styles.valueContainer}>
          {pendingValue != null ? (
            <Text style={[styles.value, { color: theme.valueColor }]}>{pendingValue}</Text>
          ) : (
            <Text style={[styles.value, { color: theme.valueColor }]}>{total}</Text>
          )}
        </View>
      </View>
    );
  };

  const renderTilesValue = () => {
    const pendingValue = pendingTurnFlavor?.previousTilesRemaining ?? null;

    return (
      <View style={[styles.infoItem, { backgroundColor: theme.infoBackground }]}>
        <Text style={[styles.label, { color: theme.label }]}>Tiles</Text>
        <View style={styles.valueContainer}>
          {pendingValue != null ? (
            <Text style={[styles.value, { color: theme.valueColor }]}>{pendingValue}</Text>
          ) : (
            <Text style={[styles.value, { color: theme.valueColor }]}>{tilesRemaining}</Text>
          )}
        </View>
      </View>
    );
  };

  if (sprintRushMode === "sprint") {
    return (
      <View style={styles.container}>
        <View style={styles.row}>
          <Metric label="Mode" value="Sprint" theme={theme} />
          <Metric
            label="Target"
            value={`${Math.max(0, currentScore)}/${sprintTargetScore}`}
            theme={theme}
          />
          <Metric
            label="Turn"
            value={gameOver ? turnCount : turnCount + 1}
            theme={theme}
          />
          <Metric label="Best" value={overallHighScore ?? "-"} theme={theme} />
        </View>
      </View>
    );
  }

  if (sprintRushMode === "rush") {
    return (
      <View style={styles.container}>
        <View style={styles.row}>
          <Metric
            label="Rush"
            value={formatClock(rushRemainingSeconds)}
            theme={theme}
          />
          <Metric
            label="Limit"
            value={
              typeof rushDurationSeconds === "number"
                ? `${rushDurationSeconds / 60}m`
                : "-"
            }
            theme={theme}
          />
          <Metric label="Turn" value={turnCount} theme={theme} />
          {renderTilesValue()}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={[styles.infoItem, { backgroundColor: theme.infoBackground }]}>
          <Text style={[styles.label, { color: theme.label }]}>Best</Text>
          <Text style={[styles.value, { color: theme.valueColor }]}>
            {overallHighScore ?? "-"}
          </Text>
        </View>
        {renderMetricValue("Words", wordCount, {
          pendingPrevious: pendingTurnFlavor?.previousWordCount,
        })}
        {renderMetricValue("Turn", turnCount, {
          pendingPrevious: pendingTurnFlavor?.previousTurnCount,
        })}
        {renderTilesValue()}
      </View>
    </View>
  );
};

const Metric = ({ label, value, theme }) => (
  <View style={[styles.infoItem, { backgroundColor: theme.infoBackground }]}>
    <Text style={[styles.label, { color: theme.label }]}>{label}</Text>
    <View style={styles.valueContainer}>
      <Text
        style={[styles.value, { color: theme.valueColor }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
    </View>
  </View>
);

const LIGHT_THEME = {
  infoBackground: "#ffffff",
  label: "#7f8c8d",
  valueColor: "#2c3e50",
};

const DARK_THEME = {
  infoBackground: "#4b5563",
  label: "#d1d5db",
  valueColor: "#f9fafb",
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  infoItem: {
    flex: 1,
    backgroundColor: "white",
    borderRadius: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  label: {
    fontSize: 10,
    fontWeight: "600",
    color: "#7f8c8d",
  },
  value: {
    color: "#2c3e50",
    fontSize: 14,
    fontWeight: "700",
  },
  valueContainer: {
    minHeight: 18,
    justifyContent: "center",
    alignItems: "center",
    alignSelf: "stretch",
  },
});

export default GameInfo;
