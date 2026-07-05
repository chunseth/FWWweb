import AsyncStorage from "@react-native-async-storage/async-storage";

const PLAYER_PROFILE_KEY = "wwrf.playerProfile.v1";

const createPlayerId = () =>
  `player_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const DEFAULT_DISPLAY_NAME_PATTERN = /^Player [A-Z0-9]{4}$/;
const OBSCENE_USERNAME_TOKENS = [
  "asshole",
  "bitch",
  "bullshit",
  "cock",
  "cunt",
  "dick",
  "fag",
  "faggot",
  "fuck",
  "motherfucker",
  "nigger",
  "penis",
  "pussy",
  "shit",
  "slut",
  "twat",
  "vagina",
  "whore",
];

const createDefaultProfile = () => ({
  playerId: createPlayerId(),
  displayName: `Player ${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
  hasChosenUsername: false,
});

const normalizeUsernameForModeration = (value) =>
  value
    .toLowerCase()
    .replace(/[@4]/g, "a")
    .replace(/[30]/g, "o")
    .replace(/[1!|]/g, "i")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/[^a-z]/g, "");

const containsObsceneUsernameToken = (value) => {
  const normalizedValue = normalizeUsernameForModeration(value);
  return OBSCENE_USERNAME_TOKENS.some((token) =>
    normalizedValue.includes(token)
  );
};

export const validatePlayerDisplayName = (displayName) => {
  const trimmedName =
    typeof displayName === "string" ? displayName.trim() : "";

  if (trimmedName.length < 3) {
    return "Username must be at least 3 characters.";
  }

  if (trimmedName.length > 20) {
    return "Username must be 20 characters or fewer.";
  }

  if (!/^[A-Za-z0-9_]+$/.test(trimmedName)) {
    return "Username can only use letters, numbers, and underscores.";
  }

  if (containsObsceneUsernameToken(trimmedName)) {
    return "Username can't contain obscene language.";
  }

  return null;
};

const sanitizeProfile = (value) => {
  if (
    value &&
    typeof value.playerId === "string" &&
    value.playerId.length > 0 &&
    typeof value.displayName === "string" &&
    validatePlayerDisplayName(value.displayName) == null
  ) {
    const trimmedDisplayName = value.displayName.trim();
    return {
      playerId: value.playerId,
      displayName: trimmedDisplayName,
      hasChosenUsername:
        value.hasChosenUsername === true ||
        (value.hasChosenUsername !== false &&
          !DEFAULT_DISPLAY_NAME_PATTERN.test(trimmedDisplayName)),
    };
  }

  return null;
};

export const hasStoredPlayerProfile = async () => {
  try {
    const storedValue = await AsyncStorage.getItem(PLAYER_PROFILE_KEY);
    return sanitizeProfile(JSON.parse(storedValue)) != null;
  } catch (error) {
    console.warn("Failed to check player profile", error);
    return false;
  }
};

export const loadOrCreatePlayerProfile = async () => {
  try {
    const storedValue = await AsyncStorage.getItem(PLAYER_PROFILE_KEY);
    if (storedValue) {
      const parsedValue = sanitizeProfile(JSON.parse(storedValue));
      if (parsedValue) {
        return parsedValue;
      }
    }
  } catch (error) {
    console.warn("Failed to load player profile", error);
  }

  const nextProfile = createDefaultProfile();

  try {
    await AsyncStorage.setItem(PLAYER_PROFILE_KEY, JSON.stringify(nextProfile));
  } catch (error) {
    console.warn("Failed to save player profile", error);
  }

  return nextProfile;
};

export const savePlayerDisplayName = async (displayName) => {
  const currentProfile = await loadOrCreatePlayerProfile();
  const validationError = validatePlayerDisplayName(displayName);
  const nextProfile = {
    ...currentProfile,
    displayName: validationError == null
      ? displayName.trim()
      : currentProfile.displayName,
    hasChosenUsername:
      validationError == null ? true : currentProfile.hasChosenUsername,
  };

  try {
    await AsyncStorage.setItem(PLAYER_PROFILE_KEY, JSON.stringify(nextProfile));
  } catch (error) {
    console.warn("Failed to save player profile", error);
  }

  return nextProfile;
};

export const clearPlayerProfile = async () => {
  try {
    await AsyncStorage.removeItem(PLAYER_PROFILE_KEY);
  } catch (error) {
    console.warn("Failed to clear player profile", error);
  }
};
