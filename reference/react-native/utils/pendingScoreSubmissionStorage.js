import AsyncStorage from "@react-native-async-storage/async-storage";

const PENDING_SCORE_SUBMISSIONS_KEY = "wwrf.pendingScoreSubmissions.v1";
const MAX_PENDING_SUBMISSIONS = 50;

export const PENDING_SCORE_SUBMISSION_KIND_LEADERBOARD = "leaderboard";
export const PENDING_SCORE_SUBMISSION_KIND_BOARD_VARIANT = "boardVariant";
export const PENDING_SCORE_SUBMISSION_KIND_SPRINT = "sprint";
export const PENDING_SCORE_SUBMISSION_KIND_RUSH = "rush";

const normalizeKind = (kind) =>
  kind === PENDING_SCORE_SUBMISSION_KIND_BOARD_VARIANT ||
  kind === PENDING_SCORE_SUBMISSION_KIND_SPRINT ||
  kind === PENDING_SCORE_SUBMISSION_KIND_RUSH
    ? kind
    : PENDING_SCORE_SUBMISSION_KIND_LEADERBOARD;

const buildPayloadKey = (kind, payload) => {
  const normalizedKind = normalizeKind(kind);

  if (normalizedKind === PENDING_SCORE_SUBMISSION_KIND_BOARD_VARIANT) {
    return [
      normalizedKind,
      payload?.boardVariantId ?? "",
      payload?.modeId ?? "classic",
      payload?.seed ?? "",
      payload?.finalScore ?? "",
    ].join(":");
  }

  if (normalizedKind === PENDING_SCORE_SUBMISSION_KIND_SPRINT) {
    return [
      normalizedKind,
      payload?.seed ?? "",
      payload?.turnCount ?? "",
      payload?.durationSeconds ?? "",
      payload?.finalScore ?? "",
    ].join(":");
  }

  if (normalizedKind === PENDING_SCORE_SUBMISSION_KIND_RUSH) {
    return [
      normalizedKind,
      payload?.seed ?? "",
      payload?.durationSeconds ?? "",
      payload?.finalScore ?? "",
    ].join(":");
  }

  return [
    normalizedKind,
    payload?.scoreMode ?? "solo",
    payload?.seed ?? "",
    payload?.finalScore ?? "",
    payload?.displayNameOverride ?? "",
  ].join(":");
};

const sanitizeSubmission = (value) => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value.payload;
  if (
    !payload ||
    typeof payload !== "object" ||
    typeof payload.seed !== "string" ||
    payload.seed.trim().length === 0 ||
    typeof payload.finalScore !== "number" ||
    !payload.finalScoreBreakdown ||
    typeof payload.finalScoreBreakdown !== "object"
  ) {
    return null;
  }

  const kind = normalizeKind(value.kind);
  if (
    kind === PENDING_SCORE_SUBMISSION_KIND_BOARD_VARIANT &&
    (typeof payload.boardVariantId !== "string" ||
      payload.boardVariantId.trim().length === 0)
  ) {
    return null;
  }

  if (
    kind === PENDING_SCORE_SUBMISSION_KIND_SPRINT &&
    (typeof payload.turnCount !== "number" ||
      typeof payload.durationSeconds !== "number")
  ) {
    return null;
  }

  if (
    kind === PENDING_SCORE_SUBMISSION_KIND_RUSH &&
    typeof payload.durationSeconds !== "number"
  ) {
    return null;
  }

  const queuedAt =
    typeof value.queuedAt === "string" && value.queuedAt.length > 0
      ? value.queuedAt
      : new Date().toISOString();
  const completedAt =
    typeof payload.completedAt === "string" && payload.completedAt.length > 0
      ? payload.completedAt
      : queuedAt;
  const id =
    typeof value.id === "string" && value.id.length > 0
      ? value.id
      : buildPayloadKey(kind, payload);

  return {
    id,
    kind,
    payload: {
      ...payload,
      completedAt,
    },
    queuedAt,
    lastAttemptAt:
      typeof value.lastAttemptAt === "string" ? value.lastAttemptAt : null,
    attemptCount:
      typeof value.attemptCount === "number"
        ? Math.max(0, value.attemptCount)
        : 0,
  };
};

const sanitizeQueue = (value) => {
  const rawItems = Array.isArray(value) ? value : [];
  const itemsById = new Map();

  for (const item of rawItems) {
    const sanitized = sanitizeSubmission(item);
    if (!sanitized) {
      continue;
    }
    itemsById.set(sanitized.id, sanitized);
  }

  return Array.from(itemsById.values()).slice(-MAX_PENDING_SUBMISSIONS);
};

export const buildPendingScoreSubmission = (
  kind,
  payload,
  queuedAt = new Date().toISOString()
) => {
  const normalizedKind = normalizeKind(kind);
  return sanitizeSubmission({
    id: buildPayloadKey(normalizedKind, payload),
    kind: normalizedKind,
    payload: {
      ...payload,
      completedAt:
        typeof payload?.completedAt === "string" && payload.completedAt.length > 0
          ? payload.completedAt
          : queuedAt,
    },
    queuedAt,
    lastAttemptAt: null,
    attemptCount: 0,
  });
};

export const loadPendingScoreSubmissions = async () => {
  try {
    const storedValue = await AsyncStorage.getItem(PENDING_SCORE_SUBMISSIONS_KEY);
    if (!storedValue) {
      return [];
    }
    return sanitizeQueue(JSON.parse(storedValue));
  } catch (error) {
    console.warn("Failed to load pending score submissions", error);
    return [];
  }
};

const savePendingScoreSubmissions = async (submissions) => {
  const sanitized = sanitizeQueue(submissions);
  try {
    await AsyncStorage.setItem(
      PENDING_SCORE_SUBMISSIONS_KEY,
      JSON.stringify(sanitized)
    );
  } catch (error) {
    console.warn("Failed to save pending score submissions", error);
  }
  return sanitized;
};

export const enqueuePendingScoreSubmission = async (kind, payload) => {
  const pendingSubmission = buildPendingScoreSubmission(kind, payload);
  if (!pendingSubmission) {
    return [];
  }

  const existing = await loadPendingScoreSubmissions();
  const withoutDuplicate = existing.filter(
    (submission) => submission.id !== pendingSubmission.id
  );
  return savePendingScoreSubmissions([...withoutDuplicate, pendingSubmission]);
};

export const markPendingScoreSubmissionAttempted = async (
  id,
  attemptedAt = new Date().toISOString()
) => {
  const existing = await loadPendingScoreSubmissions();
  const next = existing.map((submission) =>
    submission.id === id
      ? {
          ...submission,
          lastAttemptAt: attemptedAt,
          attemptCount: submission.attemptCount + 1,
        }
      : submission
  );
  return savePendingScoreSubmissions(next);
};

export const removePendingScoreSubmission = async (id) => {
  const existing = await loadPendingScoreSubmissions();
  return savePendingScoreSubmissions(
    existing.filter((submission) => submission.id !== id)
  );
};
