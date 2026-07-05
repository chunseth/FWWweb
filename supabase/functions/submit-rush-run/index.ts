/**
 * POST /functions/v1/submit-rush-run
 *
 * The ONLY path by which a web Rush score reaches the public leaderboard.
 *
 * The client sends its run id and the replayable turn journal. This function:
 *   1. verifies the caller owns the run and it hasn't been submitted,
 *   2. enforces the hard deadline (started_at + 300s + 60s grace),
 *   3. replays the journal from the server-issued seed with the SAME game
 *      engine the browser runs (bundled in ../_shared/engine.mjs),
 *   4. recomputes the authoritative score — every client-claimed number is
 *      cross-checked and the server's own numbers are what get stored,
 *   5. applies better-score-wins server-side,
 *   6. writes rush_scores with the service role (clients never write it).
 *
 * Rejections mark the run so it cannot be retried into acceptance.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { handleOptions, json } from "../_shared/http.ts";
import {
  buildCurrentBreakdown,
  CLASSIC_RUSH_DURATION_SECONDS,
  getServerDictionary,
  isPlausibleJournal,
  replayJournal,
  RUSH_DURATION_SECONDS,
} from "../_shared/engine.mjs";

const MAX_BODY_BYTES = 256 * 1024;

const sanitizeDisplayName = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 20) return null;
  return trimmed;
};

Deno.serve(async (req: Request) => {
  const options = handleOptions(req);
  if (options) return options;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const contentLength = Number(req.headers.get("content-length") ?? "0");
    if (contentLength > MAX_BODY_BYTES) {
      return json({ error: "payload_too_large" }, 413);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    const token = (req.headers.get("Authorization") ?? "").replace(
      /^Bearer\s+/i,
      ""
    );
    const { data: userData, error: userError } = await admin.auth.getUser(
      token
    );
    if (userError || !userData?.user) {
      return json({ error: "unauthorized" }, 401);
    }
    const playerId = userData.user.id;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ error: "bad_request" }, 400);
    }
    const { runId, journal, displayName } = (body ?? {}) as {
      runId?: unknown;
      journal?: unknown;
      displayName?: unknown;
    };
    if (typeof runId !== "string" || runId.length > 64) {
      return json({ error: "bad_request" }, 400);
    }
    if (!isPlausibleJournal(journal)) {
      return json({ error: "invalid_journal" }, 422);
    }

    // --- Run ownership, one-shot submission, and deadline -----------------
    const { data: run, error: runError } = await admin
      .from("web_rush_runs")
      .select("id, player_id, seed, duration_seconds, started_at, deadline_at, status")
      .eq("id", runId)
      .maybeSingle();
    if (runError) return json({ error: "internal" }, 500);
    if (!run) return json({ error: "run_not_found" }, 404);
    if (run.player_id !== playerId) return json({ error: "forbidden" }, 403);
    if (
      run.duration_seconds !== RUSH_DURATION_SECONDS &&
      run.duration_seconds !== CLASSIC_RUSH_DURATION_SECONDS
    ) {
      return json({ error: "invalid_run" }, 422);
    }
    if (run.status === "submitted") {
      return json({ error: "already_submitted" }, 409);
    }
    if (run.status !== "active") {
      return json({ error: "run_closed" }, 410);
    }
    if (Date.now() > new Date(run.deadline_at).getTime()) {
      await admin
        .from("web_rush_runs")
        .update({ status: "expired" })
        .eq("id", run.id)
        .eq("status", "active");
      return json({ error: "deadline_expired" }, 410);
    }

    // --- Authoritative replay ---------------------------------------------
    const dictionary = await getServerDictionary();
    const replay = replayJournal(run.seed, journal, dictionary, undefined, {
      durationSeconds: run.duration_seconds,
    });
    if (!replay.ok || !replay.state) {
      await admin
        .from("web_rush_runs")
        .update({ status: "invalid" })
        .eq("id", run.id)
        .eq("status", "active");
      return json({ error: "replay_rejected", detail: replay.error }, 422);
    }

    const finalState = replay.state;
    const lastEntry = (journal as Array<{ atElapsedMs: number }>).at(-1);
    const elapsedMs = Math.min(
      lastEntry?.atElapsedMs ?? 0,
      run.duration_seconds * 1000
    );
    const breakdown = buildCurrentBreakdown(finalState, elapsedMs);

    // --- Display name: profiles first, sanitized payload as fallback ------
    const { data: profileRow } = await admin
      .from("profiles")
      .select("display_name, username")
      .eq("id", playerId)
      .maybeSingle();
    const resolvedName =
      sanitizeDisplayName(profileRow?.display_name) ??
      sanitizeDisplayName(profileRow?.username) ??
      sanitizeDisplayName(displayName) ??
      "Player";

    // --- Better-score-wins, enforced here and not in the client -----------
    const { data: existingBest } = await admin
      .from("rush_scores")
      .select("id, final_score")
      .eq("player_id", playerId)
      .eq("duration_seconds", run.duration_seconds)
      .order("final_score", { ascending: false })
      .limit(1)
      .maybeSingle();

    const improved =
      !existingBest || breakdown.finalScore > existingBest.final_score;

    const { error: scoreError } = await admin.from("rush_scores").upsert(
      {
        player_id: playerId,
        display_name: resolvedName,
        seed: run.seed,
        duration_seconds: run.duration_seconds,
        final_score: breakdown.finalScore,
        points_earned: breakdown.pointsEarned,
        swap_penalties: breakdown.swapPenalties,
        turn_penalties: breakdown.turnPenalties,
        scrabble_bonus: breakdown.scrabbleBonus,
        time_bonus: breakdown.timeBonus,
        consistency_bonus: breakdown.consistencyBonusTotal,
        skill_bonus_total: breakdown.skillBonusTotal,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "player_id,seed,duration_seconds" }
    );
    if (scoreError) return json({ error: "internal" }, 500);

    await admin
      .from("web_rush_runs")
      .update({
        status: "submitted",
        submitted_at: new Date().toISOString(),
        final_score: breakdown.finalScore,
      })
      .eq("id", run.id)
      .eq("status", "active");

    // Global rank of the player's current personal best (what the public
    // leaderboard actually shows for them).
    const personalBest = improved
      ? breakdown.finalScore
      : existingBest?.final_score ?? breakdown.finalScore;
    let rank: number | null = null;
    const { data: rankData, error: rankError } = await admin.rpc(
      "get_rush_rank",
      { p_score: personalBest, p_duration_seconds: run.duration_seconds }
    );
    if (!rankError && rankData != null) {
      rank = Number(rankData);
    }

    return json({
      ok: true,
      finalScore: breakdown.finalScore,
      breakdown,
      improved,
      personalBest,
      rank,
    });
  } catch {
    return json({ error: "internal" }, 500);
  }
});
