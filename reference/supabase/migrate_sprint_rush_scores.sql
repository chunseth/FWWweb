begin;

create table if not exists public.sprint_scores (
  id uuid primary key default gen_random_uuid(),
  player_id text not null,
  display_name text not null,
  seed text not null,
  sprint_score integer not null,
  turn_count integer not null,
  duration_seconds integer not null,
  points_earned integer not null,
  swap_penalties integer not null default 0,
  turn_penalties integer not null default 0,
  scrabble_bonus integer not null default 0,
  time_bonus integer not null default 0,
  consistency_bonus integer not null default 0,
  skill_bonus_total integer not null default 0,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists sprint_scores_player_seed_idx
  on public.sprint_scores (player_id, seed);

create index if not exists sprint_scores_rank_idx
  on public.sprint_scores (turn_count asc, duration_seconds asc, completed_at asc);

alter table public.sprint_scores enable row level security;

drop policy if exists "sprint_scores_read_all" on public.sprint_scores;
create policy "sprint_scores_read_all"
  on public.sprint_scores
  for select
  using (true);

drop policy if exists "sprint_scores_insert_authenticated_self" on public.sprint_scores;
create policy "sprint_scores_insert_authenticated_self"
  on public.sprint_scores
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and player_id = auth.uid()::text
  );

drop policy if exists "sprint_scores_update_authenticated_self" on public.sprint_scores;
create policy "sprint_scores_update_authenticated_self"
  on public.sprint_scores
  for update
  to authenticated
  using (
    auth.uid() is not null
    and player_id = auth.uid()::text
  )
  with check (
    auth.uid() is not null
    and player_id = auth.uid()::text
  );

create table if not exists public.rush_scores (
  id uuid primary key default gen_random_uuid(),
  player_id text not null,
  display_name text not null,
  seed text not null,
  duration_seconds integer not null,
  final_score integer not null,
  points_earned integer not null,
  swap_penalties integer not null default 0,
  turn_penalties integer not null default 0,
  scrabble_bonus integer not null default 0,
  time_bonus integer not null default 0,
  consistency_bonus integer not null default 0,
  skill_bonus_total integer not null default 0,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rush_scores_duration_check
    check (duration_seconds in (300, 600))
);

create unique index if not exists rush_scores_player_seed_duration_idx
  on public.rush_scores (player_id, seed, duration_seconds);

create index if not exists rush_scores_duration_score_idx
  on public.rush_scores (duration_seconds, final_score desc, completed_at asc);

alter table public.rush_scores enable row level security;

drop policy if exists "rush_scores_read_all" on public.rush_scores;
create policy "rush_scores_read_all"
  on public.rush_scores
  for select
  using (true);

drop policy if exists "rush_scores_insert_authenticated_self" on public.rush_scores;
create policy "rush_scores_insert_authenticated_self"
  on public.rush_scores
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and player_id = auth.uid()::text
  );

drop policy if exists "rush_scores_update_authenticated_self" on public.rush_scores;
create policy "rush_scores_update_authenticated_self"
  on public.rush_scores
  for update
  to authenticated
  using (
    auth.uid() is not null
    and player_id = auth.uid()::text
  )
  with check (
    auth.uid() is not null
    and player_id = auth.uid()::text
  );

commit;
