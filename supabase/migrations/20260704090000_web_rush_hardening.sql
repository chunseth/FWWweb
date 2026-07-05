-- Web Rush hardening, stage 1 (additive).
--
-- Adds the server-authoritative run table and a safe leaderboard read path.
-- Client writes to rush_scores are NOT removed here — mobile still uses them.
-- See 20260704090001_rush_scores_lockdown.sql for stage 2.

-- ---------------------------------------------------------------------------
-- web_rush_runs: one row per web Rush run, created ONLY by the
-- create-rush-run Edge Function (service role). Clients can read their own
-- rows; they can never insert, update, or delete.
-- ---------------------------------------------------------------------------

create table if not exists public.web_rush_runs (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references auth.users (id) on delete cascade,
  seed text not null,
  duration_seconds integer not null default 300,
  status text not null default 'active',
  started_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  submitted_at timestamptz,
  final_score integer,
  created_at timestamptz not null default now(),
  constraint web_rush_runs_duration_check
    check (duration_seconds in (300, 600)),
  constraint web_rush_runs_status_check
    check (status in ('active', 'submitted', 'expired', 'invalid')),
  constraint web_rush_runs_seed_length_check
    check (char_length(seed) between 6 and 64)
);

create index if not exists web_rush_runs_player_started_idx
  on public.web_rush_runs (player_id, started_at desc);

alter table public.web_rush_runs enable row level security;

-- Owners may read their own runs (to resume / show sync state).
drop policy if exists "web_rush_runs_select_own" on public.web_rush_runs;
create policy "web_rush_runs_select_own"
  on public.web_rush_runs
  for select
  to authenticated
  using (auth.uid() = player_id);

-- No insert/update/delete policies on purpose: with RLS enabled and no
-- matching policy, authenticated clients cannot write. The Edge Functions
-- use the service role, which bypasses RLS.

-- ---------------------------------------------------------------------------
-- Safe public leaderboard read: best score per player, no player_id exposed.
-- ---------------------------------------------------------------------------

create or replace function public.get_rush_leaderboard(
  limit_count integer default 25,
  p_duration_seconds integer default 300
)
returns table (
  rank bigint,
  display_name text,
  final_score integer,
  completed_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    row_number() over (order by best.final_score desc, best.completed_at asc)
      as rank,
    best.display_name,
    best.final_score,
    best.completed_at
  from (
    select distinct on (player_id)
      display_name,
      final_score,
      completed_at
    from public.rush_scores
    where duration_seconds = case
      when p_duration_seconds = 600 then 600
      else 300
    end
    order by player_id, final_score desc, completed_at asc
  ) as best
  order by best.final_score desc, best.completed_at asc
  limit greatest(1, least(coalesce(limit_count, 25), 100));
$$;

revoke all on function public.get_rush_leaderboard(integer, integer) from public;
grant execute on function public.get_rush_leaderboard(integer, integer)
  to anon, authenticated;
