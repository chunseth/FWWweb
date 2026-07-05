-- Rush seeds are six random digits (000000–999999).
alter table public.web_rush_runs
  drop constraint if exists web_rush_runs_seed_length_check;

alter table public.web_rush_runs
  add constraint web_rush_runs_seed_length_check
  check (char_length(seed) between 6 and 64);
