-- Web Rush hardening, stage 2 (BREAKING for old mobile clients).
--
-- Removes direct client write access to rush_scores and narrows public reads.
-- Apply ONLY after both web and mobile submit through the hardened
-- create-rush-run / submit-rush-run server path.
--
-- Everything below is wrapped in a guard so applying this migration is an
-- explicit opt-in: set the flag to 'on' first.
--
--   select set_config('app.enable_rush_scores_lockdown', 'on', false);
--   -- then run this file's body, or edit the flag check out.

do $$
begin
  if coalesce(current_setting('app.enable_rush_scores_lockdown', true), 'off')
     <> 'on' then
    raise notice
      'rush_scores lockdown skipped (app.enable_rush_scores_lockdown != on)';
    return;
  end if;

  -- 1) Browsers and mobile clients can no longer write scores directly.
  --    Only the submit-rush-run Edge Function (service role) writes rows.
  drop policy if exists "rush_scores_insert_authenticated_self"
    on public.rush_scores;
  drop policy if exists "rush_scores_update_authenticated_self"
    on public.rush_scores;

  -- 2) Public reads go through get_rush_leaderboard(), which never exposes
  --    player_id. Raw-table reads are limited to the row owner.
  drop policy if exists "rush_scores_read_all" on public.rush_scores;
  drop policy if exists "rush_scores_select_own" on public.rush_scores;
  create policy "rush_scores_select_own"
    on public.rush_scores
    for select
    to authenticated
    using (auth.uid() is not null and player_id = auth.uid()::text);

  raise notice 'rush_scores lockdown applied';
end
$$;
