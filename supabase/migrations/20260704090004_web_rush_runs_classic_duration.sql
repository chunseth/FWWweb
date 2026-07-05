-- Allow 10-minute classic runs on web_rush_runs.
--
-- `create table if not exists` never updates constraints on an existing
-- table, so databases created before classic mode still enforce
-- duration_seconds = 300 and reject classic run creation. Re-assert the
-- constraint explicitly. Idempotent.

alter table public.web_rush_runs
  drop constraint if exists web_rush_runs_duration_check;

alter table public.web_rush_runs
  add constraint web_rush_runs_duration_check
  check (duration_seconds in (300, 600));
