/**
 * Client side of the hardened Rush run path.
 *
 * - createRushRunOnServer: asks the create-rush-run Edge Function for a
 *   server-issued seed/run. Falls back to null quickly (timeout) so the game
 *   can start locally as `local_only` when offline/unconfigured.
 * - submitRushRunToServer: sends the replay journal; the server recomputes
 *   the score. Outcomes distinguish logical rejection (don't retry) from
 *   network failure (queue and retry).
 *
 * The client never touches rush_scores directly and holds only the anon key.
 */

import { getSupabaseClient } from "./supabaseClient";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RushTurnEntry } from "../game/shared/types";

export interface ServerRun {
  runId: string;
  seed: string;
  startedAtMs: number;
  deadlineAtMs: number;
}

export type SubmitOutcome =
  | {
      status: "accepted";
      finalScore: number;
      improved: boolean;
      /** Global rank of the player's personal best, when the server knows it. */
      rank: number | null;
      personalBest: number;
    }
  | { status: "rejected"; reason: string }
  | { status: "network" };

const ensureSession = async (supabase: SupabaseClient): Promise<boolean> => {
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) return true;
    const { error } = await supabase.auth.signInAnonymously();
    return !error;
  } catch {
    return false;
  }
};

export const createRushRunOnServer = async (
  timeoutMs = 2500
): Promise<ServerRun | null> => {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const attempt = (async (): Promise<ServerRun | null> => {
    if (!(await ensureSession(supabase))) return null;
    const { data, error } = await supabase.functions.invoke("create-rush-run", {
      body: {},
    });
    if (
      error ||
      typeof data?.runId !== "string" ||
      typeof data?.seed !== "string" ||
      data.seed.length < 8
    ) {
      return null;
    }
    const startedAtMs = Date.parse(data.startedAt) || Date.now();
    const deadlineAtMs =
      Date.parse(data.deadlineAt) || startedAtMs + 360_000;
    return { runId: data.runId, seed: data.seed, startedAtMs, deadlineAtMs };
  })();

  const timeout = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), timeoutMs)
  );

  try {
    return await Promise.race([attempt, timeout]);
  } catch {
    return null;
  }
};

export const submitRushRunToServer = async (
  runId: string,
  journal: RushTurnEntry[],
  displayName?: string
): Promise<SubmitOutcome> => {
  const supabase = getSupabaseClient();
  if (!supabase) return { status: "network" };

  try {
    if (!(await ensureSession(supabase))) return { status: "network" };
    const { data, error } = await supabase.functions.invoke("submit-rush-run", {
      body: { runId, journal, displayName },
    });

    if (error) {
      // FunctionsHttpError carries the server Response; a 4xx (except 429)
      // is a logical rejection — retrying would produce the same answer.
      const response = (error as { context?: Response }).context;
      const status = response?.status;
      if (
        typeof status === "number" &&
        status >= 400 &&
        status < 500 &&
        status !== 429
      ) {
        let reason = `http_${status}`;
        try {
          const body = await response!.json();
          if (typeof body?.error === "string") reason = body.error;
        } catch {
          /* keep http_ code */
        }
        return { status: "rejected", reason };
      }
      return { status: "network" };
    }

    if (data?.ok && typeof data.finalScore === "number") {
      return {
        status: "accepted",
        finalScore: data.finalScore,
        improved: data.improved === true,
        rank:
          typeof data.rank === "number" && Number.isFinite(data.rank)
            ? data.rank
            : null,
        personalBest:
          typeof data.personalBest === "number"
            ? data.personalBest
            : data.finalScore,
      };
    }
    return {
      status: "rejected",
      reason: typeof data?.error === "string" ? data.error : "unknown",
    };
  } catch {
    return { status: "network" };
  }
};

/** Global rank a given score would hold on the 5-minute Rush leaderboard. */
export const fetchRushRank = async (score: number): Promise<number | null> => {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc("get_rush_rank", {
      p_score: score,
    });
    if (error || data == null) return null;
    const rank = Number(data);
    return Number.isFinite(rank) ? rank : null;
  } catch {
    return null;
  }
};

export interface LeaderboardRow {
  rank: number;
  displayName: string;
  finalScore: number;
  completedAt: string;
}

/** Public leaderboard via the safe RPC (no player ids exposed). */
export const fetchRushLeaderboard = async (
  limit = 25
): Promise<LeaderboardRow[] | null> => {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc("get_rush_leaderboard", {
      limit_count: limit,
    });
    if (error || !Array.isArray(data)) return null;
    return data.map((row) => ({
      rank: Number(row.rank),
      displayName: String(row.display_name ?? "Player"),
      finalScore: Number(row.final_score ?? 0),
      completedAt: String(row.completed_at ?? ""),
    }));
  } catch {
    return null;
  }
};
