import { ensureSupabaseSession, getSupabaseClient } from "../lib/supabase";
import { isBackendConfigured } from "../config/backend";
import { loadOrCreatePlayerProfile } from "../utils/playerProfile";
import { isBetterRushResult, isBetterSprintResult } from "../game/shared/scoring";

const SPRINT_SCORES_TABLE = "sprint_scores";
const RUSH_SCORES_TABLE = "rush_scores";

const buildCommonSubmissionFields = async (displayNameOverride = null) => {
  const sessionResult = await ensureSupabaseSession();
  if (!sessionResult.ok) {
    return {
      ok: false,
      reason: sessionResult.reason ?? "auth_failed",
      error: sessionResult.error ?? null,
    };
  }

  const authUserId = sessionResult.session?.user?.id;
  if (!authUserId) {
    return { ok: false, reason: "auth_failed" };
  }

  const playerProfile = await loadOrCreatePlayerProfile();
  const displayName =
    typeof displayNameOverride === "string" && displayNameOverride.trim().length > 0
      ? displayNameOverride.trim()
      : playerProfile.displayName;

  return { ok: true, authUserId, displayName };
};

const buildBreakdownFields = (breakdown) => ({
  points_earned: breakdown.pointsEarned,
  swap_penalties: breakdown.swapPenalties ?? 0,
  turn_penalties: breakdown.turnPenalties ?? 0,
  scrabble_bonus: breakdown.scrabbleBonus ?? 0,
  time_bonus: breakdown.timeBonus ?? 0,
  consistency_bonus: breakdown.consistencyBonusTotal ?? 0,
  skill_bonus_total: breakdown.skillBonusTotal ?? 0,
});

const dedupeBestScoresByPlayer = (entries = [], limit = 100) => {
  const uniqueEntries = [];
  const seenPlayerIds = new Set();

  for (const entry of entries) {
    const playerId = entry?.player_id;
    if (!playerId || seenPlayerIds.has(playerId)) {
      continue;
    }
    seenPlayerIds.add(playerId);
    uniqueEntries.push(entry);
    if (uniqueEntries.length >= limit) {
      break;
    }
  }

  return uniqueEntries;
};

export const submitSprintScore = async ({
  seed,
  finalScore,
  finalScoreBreakdown,
  turnCount,
  durationSeconds,
  displayNameOverride = null,
  completedAt = null,
}) => {
  if (!isBackendConfigured()) {
    return { ok: false, reason: "backend_not_configured" };
  }

  if (
    !seed ||
    typeof finalScore !== "number" ||
    typeof turnCount !== "number" ||
    typeof durationSeconds !== "number" ||
    !finalScoreBreakdown ||
    typeof finalScoreBreakdown.pointsEarned !== "number"
  ) {
    return { ok: false, reason: "invalid_payload" };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return { ok: false, reason: "backend_not_configured" };
  }

  const common = await buildCommonSubmissionFields(displayNameOverride);
  if (!common.ok) return common;

  const submission = {
    player_id: common.authUserId,
    display_name: common.displayName,
    seed,
    sprint_score: finalScore,
    turn_count: turnCount,
    duration_seconds: durationSeconds,
    ...buildBreakdownFields(finalScoreBreakdown),
    completed_at:
      typeof completedAt === "string" && completedAt.length > 0
        ? completedAt
        : new Date().toISOString(),
  };

  const { data: existingScore, error: existingScoreError } = await supabase
    .from(SPRINT_SCORES_TABLE)
    .select("id, sprint_score, turn_count, duration_seconds")
    .eq("player_id", common.authUserId)
    .eq("seed", seed)
    .maybeSingle();

  if (existingScoreError) {
    return { ok: false, reason: "lookup_failed", error: existingScoreError };
  }

  if (
    existingScore &&
    !isBetterSprintResult(
      { turnCount, durationSeconds },
      {
        turn_count: existingScore.turn_count,
        duration_seconds: existingScore.duration_seconds,
      }
    )
  ) {
    return { ok: true, reason: "existing_score_kept" };
  }

  const result = existingScore?.id
    ? await supabase
        .from(SPRINT_SCORES_TABLE)
        .update(submission)
        .eq("id", existingScore.id)
        .select("id")
        .single()
    : await supabase
        .from(SPRINT_SCORES_TABLE)
        .insert(submission)
        .select("id")
        .single();

  if (result.error) {
    return { ok: false, reason: "write_failed", error: result.error };
  }

  return { ok: true, reason: "score_saved", id: result.data?.id ?? null };
};

export const submitRushScore = async ({
  seed,
  durationSeconds,
  finalScore,
  finalScoreBreakdown,
  displayNameOverride = null,
  completedAt = null,
}) => {
  if (!isBackendConfigured()) {
    return { ok: false, reason: "backend_not_configured" };
  }

  if (
    !seed ||
    typeof durationSeconds !== "number" ||
    typeof finalScore !== "number" ||
    !finalScoreBreakdown ||
    typeof finalScoreBreakdown.pointsEarned !== "number"
  ) {
    return { ok: false, reason: "invalid_payload" };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return { ok: false, reason: "backend_not_configured" };
  }

  const common = await buildCommonSubmissionFields(displayNameOverride);
  if (!common.ok) return common;

  const submission = {
    player_id: common.authUserId,
    display_name: common.displayName,
    seed,
    duration_seconds: durationSeconds,
    final_score: finalScore,
    ...buildBreakdownFields(finalScoreBreakdown),
    completed_at:
      typeof completedAt === "string" && completedAt.length > 0
        ? completedAt
        : new Date().toISOString(),
  };

  const { data: existingScore, error: existingScoreError } = await supabase
    .from(RUSH_SCORES_TABLE)
    .select("id, final_score")
    .eq("player_id", common.authUserId)
    .eq("seed", seed)
    .eq("duration_seconds", durationSeconds)
    .maybeSingle();

  if (existingScoreError) {
    return { ok: false, reason: "lookup_failed", error: existingScoreError };
  }

  if (
    existingScore &&
    !isBetterRushResult({ finalScore }, { final_score: existingScore.final_score })
  ) {
    return { ok: true, reason: "existing_score_kept" };
  }

  const result = existingScore?.id
    ? await supabase
        .from(RUSH_SCORES_TABLE)
        .update(submission)
        .eq("id", existingScore.id)
        .select("id")
        .single()
    : await supabase
        .from(RUSH_SCORES_TABLE)
        .insert(submission)
        .select("id")
        .single();

  if (result.error) {
    return { ok: false, reason: "write_failed", error: result.error };
  }

  return { ok: true, reason: "score_saved", id: result.data?.id ?? null };
};

export const fetchSprintLeaderboard = async (limit = 100) => {
  if (!isBackendConfigured()) {
    return { ok: false, reason: "backend_not_configured", leaderboard: [] };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return { ok: false, reason: "backend_not_configured", leaderboard: [] };
  }

  const { data, error } = await supabase
    .from(SPRINT_SCORES_TABLE)
    .select(
      "player_id, display_name, seed, sprint_score, turn_count, duration_seconds, points_earned, swap_penalties, turn_penalties, scrabble_bonus, time_bonus, consistency_bonus, skill_bonus_total, completed_at"
    )
    .order("turn_count", { ascending: true })
    .order("duration_seconds", { ascending: true })
    .order("completed_at", { ascending: true })
    .limit(limit * 5);

  if (error) {
    return { ok: false, reason: "fetch_failed", error, leaderboard: [] };
  }

  return { ok: true, leaderboard: dedupeBestScoresByPlayer(data ?? [], limit) };
};

export const fetchRushLeaderboard = async (durationSeconds, limit = 100) => {
  if (!isBackendConfigured()) {
    return { ok: false, reason: "backend_not_configured", leaderboard: [] };
  }

  if (typeof durationSeconds !== "number") {
    return { ok: false, reason: "invalid_duration", leaderboard: [] };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return { ok: false, reason: "backend_not_configured", leaderboard: [] };
  }

  const { data, error } = await supabase
    .from(RUSH_SCORES_TABLE)
    .select(
      "player_id, display_name, seed, duration_seconds, final_score, points_earned, swap_penalties, turn_penalties, scrabble_bonus, time_bonus, consistency_bonus, skill_bonus_total, completed_at"
    )
    .eq("duration_seconds", durationSeconds)
    .order("final_score", { ascending: false })
    .order("completed_at", { ascending: true })
    .limit(limit * 5);

  if (error) {
    return { ok: false, reason: "fetch_failed", error, leaderboard: [] };
  }

  return { ok: true, leaderboard: dedupeBestScoresByPlayer(data ?? [], limit) };
};

export const fetchCurrentPlayerSprintRank = async () => {
  if (!isBackendConfigured()) {
    return { ok: false, reason: "backend_not_configured", rank: null };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return { ok: false, reason: "backend_not_configured", rank: null };
  }

  const sessionResult = await ensureSupabaseSession();
  if (!sessionResult.ok) {
    return {
      ok: false,
      reason: sessionResult.reason ?? "auth_failed",
      error: sessionResult.error ?? null,
      rank: null,
    };
  }

  const authUserId = sessionResult.session?.user?.id;
  if (!authUserId) {
    return { ok: false, reason: "auth_failed", rank: null };
  }

  const { data, error } = await supabase
    .from(SPRINT_SCORES_TABLE)
    .select("player_id, turn_count, duration_seconds, completed_at")
    .order("turn_count", { ascending: true })
    .order("duration_seconds", { ascending: true })
    .order("completed_at", { ascending: true })
    .limit(5000);

  if (error) {
    return { ok: false, reason: "fetch_failed", error, rank: null };
  }

  const rankedPlayers = dedupeBestScoresByPlayer(data ?? [], 5000);
  const foundIndex = rankedPlayers.findIndex(
    (entry) => entry?.player_id === authUserId
  );

  return {
    ok: foundIndex >= 0,
    reason: foundIndex >= 0 ? "rank_found" : "rank_not_found",
    rank: foundIndex >= 0 ? foundIndex + 1 : null,
  };
};

export const fetchCurrentPlayerRushRank = async (durationSeconds) => {
  if (!isBackendConfigured()) {
    return { ok: false, reason: "backend_not_configured", rank: null };
  }

  if (typeof durationSeconds !== "number") {
    return { ok: false, reason: "invalid_duration", rank: null };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return { ok: false, reason: "backend_not_configured", rank: null };
  }

  const sessionResult = await ensureSupabaseSession();
  if (!sessionResult.ok) {
    return {
      ok: false,
      reason: sessionResult.reason ?? "auth_failed",
      error: sessionResult.error ?? null,
      rank: null,
    };
  }

  const authUserId = sessionResult.session?.user?.id;
  if (!authUserId) {
    return { ok: false, reason: "auth_failed", rank: null };
  }

  const { data, error } = await supabase
    .from(RUSH_SCORES_TABLE)
    .select("player_id, final_score, completed_at")
    .eq("duration_seconds", durationSeconds)
    .order("final_score", { ascending: false })
    .order("completed_at", { ascending: true })
    .limit(5000);

  if (error) {
    return { ok: false, reason: "fetch_failed", error, rank: null };
  }

  const rankedPlayers = dedupeBestScoresByPlayer(data ?? [], 5000);
  const foundIndex = rankedPlayers.findIndex(
    (entry) => entry?.player_id === authUserId
  );

  return {
    ok: foundIndex >= 0,
    reason: foundIndex >= 0 ? "rank_found" : "rank_not_found",
    rank: foundIndex >= 0 ? foundIndex + 1 : null,
  };
};
