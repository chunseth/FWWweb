/**
 * POST /functions/v1/create-rush-run
 *
 * Issues a server-authoritative Rush run: a server-generated seed and a
 * web_rush_runs row with a hard submission deadline
 * (started_at + 300s + 60s grace). Public-leaderboard eligibility requires
 * starting a run here — a client can never mint its own seed or deadline.
 *
 * Auth: Supabase JWT (anonymous sessions are fine). The service role key is
 * used only inside this function and never reaches a client.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { handleOptions, json } from "../_shared/http.ts";
import {
  CLASSIC_RUSH_DURATION_SECONDS,
  RUSH_DURATION_SECONDS,
  RUSH_SUBMIT_GRACE_MS,
} from "../_shared/engine.mjs";

const MAX_RUNS_PER_HOUR = 30;

Deno.serve(async (req: Request) => {
  const options = handleOptions(req);
  if (options) return options;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
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
    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const requested = (body ?? {}) as {
      durationSeconds?: unknown;
      mode?: unknown;
    };
    const durationSeconds =
      requested.durationSeconds === CLASSIC_RUSH_DURATION_SECONDS ||
      requested.mode === "classic"
        ? CLASSIC_RUSH_DURATION_SECONDS
        : RUSH_DURATION_SECONDS;

    // Cheap rate limit: bound run creation per player.
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const { count, error: countError } = await admin
      .from("web_rush_runs")
      .select("id", { count: "exact", head: true })
      .eq("player_id", playerId)
      .gte("started_at", hourAgo);
    if (countError) return json({ error: "internal" }, 500);
    if ((count ?? 0) >= MAX_RUNS_PER_HOUR) {
      return json({ error: "rate_limited" }, 429);
    }

    // Server-generated seed: the client cannot choose its own bag order.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const seed = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const startedAt = new Date();
    const deadlineAt = new Date(
      startedAt.getTime() + durationSeconds * 1000 + RUSH_SUBMIT_GRACE_MS
    );

    const { data: run, error: insertError } = await admin
      .from("web_rush_runs")
      .insert({
        player_id: playerId,
        seed,
        duration_seconds: durationSeconds,
        status: "active",
        started_at: startedAt.toISOString(),
        deadline_at: deadlineAt.toISOString(),
      })
      .select("id")
      .single();
    if (insertError || !run) return json({ error: "internal" }, 500);

    return json({
      runId: run.id,
      seed,
      durationSeconds,
      startedAt: startedAt.toISOString(),
      deadlineAt: deadlineAt.toISOString(),
    });
  } catch {
    return json({ error: "internal" }, 500);
  }
});
