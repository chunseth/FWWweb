import AsyncStorage from "@react-native-async-storage/async-storage";

const GAME_SNAPSHOT_STORAGE_KEY = "wwrf.activeGameSnapshot.v1";

const isFiniteNumber = (value) =>
  typeof value === "number" && Number.isFinite(value);

const sanitizeGameSnapshotPayload = (value) => {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (!value.snapshot || typeof value.snapshot !== "object") {
    return null;
  }

  return {
    snapshot: value.snapshot,
    activeDailySeed:
      typeof value.activeDailySeed === "string" &&
      value.activeDailySeed.length > 0
        ? value.activeDailySeed
        : null,
    activeGameMode:
      typeof value.activeGameMode === "string" &&
      value.activeGameMode.length > 0
        ? value.activeGameMode
        : null,
    activeGameType:
      typeof value.activeGameType === "string" &&
      value.activeGameType.length > 0
        ? value.activeGameType
        : null,
    activeBoardVariant:
      value.activeBoardVariant && typeof value.activeBoardVariant === "object"
        ? value.activeBoardVariant
        : null,
    savedAt: isFiniteNumber(value.savedAt) ? value.savedAt : Date.now(),
  };
};

export const loadGameSnapshotPayload = async () => {
  try {
    const storedValue = await AsyncStorage.getItem(GAME_SNAPSHOT_STORAGE_KEY);
    if (!storedValue) {
      return null;
    }

    return sanitizeGameSnapshotPayload(JSON.parse(storedValue));
  } catch (error) {
    console.warn("Failed to load saved game snapshot", error);
    return null;
  }
};

export const saveGameSnapshotPayload = async (payload) => {
  const sanitizedPayload = sanitizeGameSnapshotPayload(payload);
  if (!sanitizedPayload) {
    return null;
  }

  try {
    await AsyncStorage.setItem(
      GAME_SNAPSHOT_STORAGE_KEY,
      JSON.stringify(sanitizedPayload)
    );
  } catch (error) {
    console.warn("Failed to save game snapshot", error);
  }

  return sanitizedPayload;
};

export const clearGameSnapshotPayload = async () => {
  try {
    await AsyncStorage.removeItem(GAME_SNAPSHOT_STORAGE_KEY);
  } catch (error) {
    console.warn("Failed to clear game snapshot", error);
  }
};
