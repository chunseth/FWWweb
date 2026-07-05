-- Drop the original one-argument RPC overloads (pre-duration-tab versions).
--
-- PostgREST resolves RPCs by name + named arguments; a stale overload that
-- coexists with the two-argument versions is dead weight and can cause
-- ambiguous resolution for callers that omit defaults. Safe no-ops when the
-- old signatures were never applied.

drop function if exists public.get_rush_leaderboard(integer);
drop function if exists public.get_rush_rank(integer);
