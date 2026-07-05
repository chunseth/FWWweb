-- Global rank for a 5-minute Rush score.
--
-- Rank = 1 + number of players whose personal-best score beats the given
-- score. Uses best-per-player, matching get_rush_leaderboard, and exposes
-- only a count — no identifiers.

create or replace function public.get_rush_rank(
  p_score integer
)
returns bigint
language sql
security definer
set search_path = public
stable
as $$
  select count(*) + 1
  from (
    select distinct on (player_id) final_score
    from public.rush_scores
    where duration_seconds = 300
    order by player_id, final_score desc
  ) as best
  where best.final_score > p_score;
$$;

revoke all on function public.get_rush_rank(integer) from public;
grant execute on function public.get_rush_rank(integer)
  to anon, authenticated;
