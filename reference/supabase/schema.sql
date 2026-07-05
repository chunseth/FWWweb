create extension if not exists pgcrypto;

create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  player_id text not null,
  display_name text not null,
  seed text not null,
  score_mode text not null default 'solo',
  is_daily_seed boolean not null default false,
  final_score integer not null,
  points_earned integer not null,
  swap_penalties integer not null default 0,
  turn_penalties integer not null default 0,
  rack_penalty integer not null default 0,
  scrabble_bonus integer not null default 0,
  time_bonus integer not null default 0,
  consistency_bonus integer not null default 0,
  skill_bonus_total integer not null default 0,
  duration_seconds integer,
  board_tiles jsonb,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.scores
  drop constraint if exists scores_score_mode_check;

alter table public.scores
  add constraint scores_score_mode_check
  check (score_mode in ('solo', 'multiplayer', 'mini'));

drop index if exists scores_player_seed_idx;
create unique index if not exists scores_player_seed_mode_idx
  on public.scores (player_id, seed, score_mode);

drop index if exists scores_seed_score_idx;
create index if not exists scores_seed_mode_score_idx
  on public.scores (seed, score_mode, final_score desc, completed_at asc);

alter table public.scores enable row level security;

drop policy if exists "scores_read_all" on public.scores;
create policy "scores_read_all"
  on public.scores
  for select
  using (true);

drop policy if exists "scores_insert_authenticated_self" on public.scores;
drop policy if exists "scores_insert_all" on public.scores;
create policy "scores_insert_authenticated_self"
  on public.scores
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and player_id = auth.uid()::text
  );

drop policy if exists "scores_update_authenticated_self" on public.scores;
drop policy if exists "scores_update_same_player_seed" on public.scores;
create policy "scores_update_authenticated_self"
  on public.scores
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

create table if not exists public.board_variant_scores (
  id uuid primary key default gen_random_uuid(),
  player_id text not null,
  board_variant_id uuid not null,
  mode_id text not null default 'classic',
  display_name text not null,
  seed text not null,
  is_daily_seed boolean not null default true,
  final_score integer not null,
  points_earned integer not null,
  swap_penalties integer not null default 0,
  turn_penalties integer not null default 0,
  rack_penalty integer not null default 0,
  scrabble_bonus integer not null default 0,
  time_bonus integer not null default 0,
  perfection_bonus integer not null default 0,
  consistency_bonus integer not null default 0,
  skill_bonus_total integer not null default 0,
  duration_seconds integer,
  invalid_word_attempts integer not null default 0,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint board_variant_scores_mode_check
    check (mode_id in ('classic', 'mini'))
);

create unique index if not exists board_variant_scores_player_variant_mode_idx
  on public.board_variant_scores (player_id, board_variant_id, mode_id);

create index if not exists board_variant_scores_variant_mode_score_idx
  on public.board_variant_scores (board_variant_id, mode_id, final_score desc, completed_at asc);

alter table public.board_variant_scores enable row level security;

drop policy if exists "board_variant_scores_read_all" on public.board_variant_scores;
create policy "board_variant_scores_read_all"
  on public.board_variant_scores
  for select
  using (true);

drop policy if exists "board_variant_scores_insert_authenticated_self" on public.board_variant_scores;
create policy "board_variant_scores_insert_authenticated_self"
  on public.board_variant_scores
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and player_id = auth.uid()::text
  );

drop policy if exists "board_variant_scores_update_authenticated_self" on public.board_variant_scores;
create policy "board_variant_scores_update_authenticated_self"
  on public.board_variant_scores
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

create table if not exists public.multiplayer_sessions (
  id uuid primary key default gen_random_uuid(),
  session_id text not null unique,
  mode_id text not null,
  board_variant_id uuid,
  seed text not null,
  status text not null default 'active',
  board_revision integer not null default 0,
  active_player_id text,
  participant_player_ids text[] not null default '{}',
  session_payload jsonb not null,
  saved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists multiplayer_sessions_saved_at_idx
  on public.multiplayer_sessions (saved_at desc);

create index if not exists multiplayer_sessions_status_idx
  on public.multiplayer_sessions (status, saved_at desc);

create index if not exists multiplayer_sessions_board_variant_idx
  on public.multiplayer_sessions (board_variant_id, saved_at desc);

alter table public.multiplayer_sessions enable row level security;

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'multiplayer_sessions'
  ) then
    alter publication supabase_realtime add table public.multiplayer_sessions;
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and to_regclass('public.friend_requests') is not null and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'friend_requests'
  ) then
    alter publication supabase_realtime add table public.friend_requests;
  end if;

  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and to_regclass('public.multiplayer_notifications') is not null and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'multiplayer_notifications'
  ) then
    alter publication supabase_realtime add table public.multiplayer_notifications;
  end if;

  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and to_regclass('public.multiplayer_game_requests') is not null and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'multiplayer_game_requests'
  ) then
    alter publication supabase_realtime add table public.multiplayer_game_requests;
  end if;
end
$$;

drop policy if exists "multiplayer_sessions_read_authenticated" on public.multiplayer_sessions;
create policy "multiplayer_sessions_read_authenticated"
  on public.multiplayer_sessions
  for select
  to authenticated
  using (
    auth.uid() is not null
    and auth.uid()::text = any(participant_player_ids)
  );

drop policy if exists "multiplayer_sessions_insert_authenticated" on public.multiplayer_sessions;
create policy "multiplayer_sessions_insert_authenticated"
  on public.multiplayer_sessions
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and auth.uid()::text = any(participant_player_ids)
  );

drop policy if exists "multiplayer_sessions_update_authenticated" on public.multiplayer_sessions;
create policy "multiplayer_sessions_update_authenticated"
  on public.multiplayer_sessions
  for update
  to authenticated
  using (
    auth.uid() is not null
    and auth.uid()::text = any(participant_player_ids)
  )
  with check (
    auth.uid() is not null
    and auth.uid()::text = any(participant_player_ids)
  );

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_length_check
    check (char_length(username) between 3 and 20),
  constraint profiles_username_format_check
    check (username ~ '^[A-Za-z0-9_]+$'),
  constraint profiles_display_name_length_check
    check (char_length(display_name) between 3 and 20)
);

create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

alter table public.profiles enable row level security;

drop policy if exists "profiles_read_all" on public.profiles;
create policy "profiles_read_all"
  on public.profiles
  for select
  using (true);

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self"
  on public.profiles
  for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users (id) on delete cascade,
  receiver_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint friend_requests_distinct_users_check
    check (sender_id <> receiver_id),
  constraint friend_requests_status_check
    check (status in ('pending', 'accepted', 'declined', 'canceled'))
);

create index if not exists friend_requests_sender_idx
  on public.friend_requests (sender_id, status, updated_at desc);

create index if not exists friend_requests_receiver_idx
  on public.friend_requests (receiver_id, status, updated_at desc);

create unique index if not exists friend_requests_pending_pair_idx
  on public.friend_requests (
    least(sender_id::text, receiver_id::text),
    greatest(sender_id::text, receiver_id::text)
  )
  where status = 'pending';

alter table public.friend_requests enable row level security;

drop policy if exists "friend_requests_read_participants" on public.friend_requests;
create policy "friend_requests_read_participants"
  on public.friend_requests
  for select
  to authenticated
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

drop policy if exists "friend_requests_insert_sender" on public.friend_requests;
create policy "friend_requests_insert_sender"
  on public.friend_requests
  for insert
  to authenticated
  with check (auth.uid() = sender_id);

drop policy if exists "friend_requests_update_participants" on public.friend_requests;
create policy "friend_requests_update_participants"
  on public.friend_requests
  for update
  to authenticated
  using (auth.uid() = sender_id or auth.uid() = receiver_id)
  with check (auth.uid() = sender_id or auth.uid() = receiver_id);

create table if not exists public.friends (
  id uuid primary key default gen_random_uuid(),
  player_low_id uuid not null references auth.users (id) on delete cascade,
  player_high_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint friends_distinct_users_check
    check (player_low_id <> player_high_id)
);

create unique index if not exists friends_unique_pair_idx
  on public.friends (player_low_id, player_high_id);

create index if not exists friends_player_low_idx
  on public.friends (player_low_id, created_at desc);

create index if not exists friends_player_high_idx
  on public.friends (player_high_id, created_at desc);

alter table public.friends enable row level security;

drop policy if exists "friends_read_participants" on public.friends;
create policy "friends_read_participants"
  on public.friends
  for select
  to authenticated
  using (auth.uid() = player_low_id or auth.uid() = player_high_id);

drop policy if exists "friends_insert_participant" on public.friends;
create policy "friends_insert_participant"
  on public.friends
  for insert
  to authenticated
  with check (auth.uid() = player_low_id or auth.uid() = player_high_id);

drop policy if exists "friends_delete_participant" on public.friends;
create policy "friends_delete_participant"
  on public.friends
  for delete
  to authenticated
  using (auth.uid() = player_low_id or auth.uid() = player_high_id);

create table if not exists public.multiplayer_game_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users (id) on delete cascade,
  receiver_id uuid not null references auth.users (id) on delete cascade,
  game_type text not null,
  seed text not null,
  status text not null default 'pending',
  session_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint multiplayer_game_requests_distinct_users_check
    check (sender_id <> receiver_id),
  constraint multiplayer_game_requests_status_check
    check (status in ('pending', 'accepted', 'declined', 'canceled')),
  constraint multiplayer_game_requests_type_check
    check (game_type in ('daily', 'random', 'seeded'))
);

create index if not exists multiplayer_game_requests_sender_idx
  on public.multiplayer_game_requests (sender_id, status, updated_at desc);

create index if not exists multiplayer_game_requests_receiver_idx
  on public.multiplayer_game_requests (receiver_id, status, updated_at desc);

create index if not exists multiplayer_game_requests_session_idx
  on public.multiplayer_game_requests (session_id);

alter table public.multiplayer_game_requests enable row level security;

drop policy if exists "multiplayer_game_requests_read_participants" on public.multiplayer_game_requests;
create policy "multiplayer_game_requests_read_participants"
  on public.multiplayer_game_requests
  for select
  to authenticated
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

drop policy if exists "multiplayer_game_requests_insert_sender" on public.multiplayer_game_requests;
create policy "multiplayer_game_requests_insert_sender"
  on public.multiplayer_game_requests
  for insert
  to authenticated
  with check (auth.uid() = sender_id);

drop policy if exists "multiplayer_game_requests_update_participants" on public.multiplayer_game_requests;
create policy "multiplayer_game_requests_update_participants"
  on public.multiplayer_game_requests
  for update
  to authenticated
  using (auth.uid() = sender_id or auth.uid() = receiver_id)
  with check (auth.uid() = sender_id or auth.uid() = receiver_id);

create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null,
  provider text not null,
  token text not null,
  device_id text not null,
  app_build text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_tokens_platform_check
    check (platform in ('ios', 'android')),
  constraint push_tokens_provider_check
    check (provider in ('apns', 'fcm'))
);

create unique index if not exists push_tokens_user_device_token_idx
  on public.push_tokens (user_id, device_id, token);

create index if not exists push_tokens_user_updated_idx
  on public.push_tokens (user_id, updated_at desc);

alter table public.push_tokens enable row level security;

drop policy if exists "push_tokens_read_self" on public.push_tokens;
create policy "push_tokens_read_self"
  on public.push_tokens
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "push_tokens_insert_self" on public.push_tokens;
create policy "push_tokens_insert_self"
  on public.push_tokens
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "push_tokens_update_self" on public.push_tokens;
create policy "push_tokens_update_self"
  on public.push_tokens
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.multiplayer_user_session_state (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references public.multiplayer_sessions (session_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  last_seen_revision integer not null default 0,
  last_opened_at timestamptz,
  muted_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists multiplayer_user_session_state_unique_idx
  on public.multiplayer_user_session_state (session_id, user_id);

create index if not exists multiplayer_user_session_state_user_idx
  on public.multiplayer_user_session_state (user_id, updated_at desc);

alter table public.multiplayer_user_session_state enable row level security;

drop policy if exists "multiplayer_user_session_state_read_self_participant" on public.multiplayer_user_session_state;
create policy "multiplayer_user_session_state_read_self_participant"
  on public.multiplayer_user_session_state
  for select
  to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.multiplayer_sessions ms
      where ms.session_id = multiplayer_user_session_state.session_id
        and auth.uid()::text = any(ms.participant_player_ids)
    )
  );

drop policy if exists "multiplayer_user_session_state_insert_self_participant" on public.multiplayer_user_session_state;
create policy "multiplayer_user_session_state_insert_self_participant"
  on public.multiplayer_user_session_state
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.multiplayer_sessions ms
      where ms.session_id = multiplayer_user_session_state.session_id
        and auth.uid()::text = any(ms.participant_player_ids)
    )
  );

drop policy if exists "multiplayer_user_session_state_update_self_participant" on public.multiplayer_user_session_state;
create policy "multiplayer_user_session_state_update_self_participant"
  on public.multiplayer_user_session_state
  for update
  to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.multiplayer_sessions ms
      where ms.session_id = multiplayer_user_session_state.session_id
        and auth.uid()::text = any(ms.participant_player_ids)
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.multiplayer_sessions ms
      where ms.session_id = multiplayer_user_session_state.session_id
        and auth.uid()::text = any(ms.participant_player_ids)
    )
  );

create table if not exists public.multiplayer_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  entity_id text,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint multiplayer_notifications_type_check
    check (
      type in (
        'friend_request',
        'game_request',
        'request_accepted',
        'turn_ready',
        'session_conflict',
        'reminder'
      )
    )
);

create index if not exists multiplayer_notifications_recipient_unread_idx
  on public.multiplayer_notifications (recipient_user_id, read_at, created_at desc);

create index if not exists multiplayer_notifications_entity_idx
  on public.multiplayer_notifications (entity_id, created_at desc);

alter table public.multiplayer_notifications enable row level security;

drop policy if exists "multiplayer_notifications_read_self" on public.multiplayer_notifications;
create policy "multiplayer_notifications_read_self"
  on public.multiplayer_notifications
  for select
  to authenticated
  using (auth.uid() = recipient_user_id);

drop policy if exists "multiplayer_notifications_update_self" on public.multiplayer_notifications;
create policy "multiplayer_notifications_update_self"
  on public.multiplayer_notifications
  for update
  to authenticated
  using (auth.uid() = recipient_user_id)
  with check (auth.uid() = recipient_user_id);

create table if not exists public.push_delivery_queue (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.multiplayer_notifications (id) on delete cascade,
  recipient_user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  entity_id text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_attempt_at timestamptz,
  last_error text,
  push_result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_delivery_queue_status_check
    check (status in ('pending', 'processing', 'retry', 'sent', 'failed')),
  constraint push_delivery_queue_attempts_check
    check (attempts >= 0),
  constraint push_delivery_queue_max_attempts_check
    check (max_attempts >= 1),
  constraint push_delivery_queue_notification_unique
    unique (notification_id)
);

create index if not exists push_delivery_queue_status_next_idx
  on public.push_delivery_queue (status, next_attempt_at, created_at);

create index if not exists push_delivery_queue_recipient_idx
  on public.push_delivery_queue (recipient_user_id, created_at desc);

alter table public.push_delivery_queue enable row level security;

create table if not exists public.user_presence (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status text not null default 'online',
  last_active_at timestamptz not null default now(),
  last_session_id text,
  updated_at timestamptz not null default now(),
  constraint user_presence_status_check
    check (status in ('online', 'away', 'offline'))
);

alter table public.user_presence enable row level security;

drop policy if exists "user_presence_read_all" on public.user_presence;
create policy "user_presence_read_all"
  on public.user_presence
  for select
  to authenticated
  using (true);

drop policy if exists "user_presence_write_self" on public.user_presence;
create policy "user_presence_write_self"
  on public.user_presence
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.multiplayer_user_notification_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  turn_reminders_enabled boolean not null default true,
  quiet_hours_start time,
  quiet_hours_end time,
  timezone text,
  updated_at timestamptz not null default now()
);

alter table public.multiplayer_user_notification_settings enable row level security;

drop policy if exists "multiplayer_notification_settings_read_self" on public.multiplayer_user_notification_settings;
create policy "multiplayer_notification_settings_read_self"
  on public.multiplayer_user_notification_settings
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "multiplayer_notification_settings_insert_self" on public.multiplayer_user_notification_settings;
create policy "multiplayer_notification_settings_insert_self"
  on public.multiplayer_user_notification_settings
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "multiplayer_notification_settings_update_self" on public.multiplayer_user_notification_settings;
create policy "multiplayer_notification_settings_update_self"
  on public.multiplayer_user_notification_settings
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.accept_multiplayer_game_request(
  p_request_id uuid,
  p_session_id text,
  p_mode_id text,
  p_seed text,
  p_game_type text,
  p_active_player_id text,
  p_participant_player_ids text[],
  p_session_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  request_row public.multiplayer_game_requests%rowtype;
  requested_revision integer := coalesce((p_session_payload ->> 'boardRevision')::integer, 0);
begin
  if current_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'auth_failed');
  end if;

  if p_request_id is null
    or p_session_id is null
    or p_mode_id is null
    or p_seed is null
    or p_game_type is null
    or p_active_player_id is null
    or p_participant_player_ids is null
    or p_session_payload is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  select *
  into request_row
  from public.multiplayer_game_requests
  where id = p_request_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'request_not_found');
  end if;

  if request_row.receiver_id <> current_user_id then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if request_row.status <> 'pending' then
    return jsonb_build_object(
      'ok',
      false,
      'reason',
      'request_not_pending',
      'status',
      request_row.status
    );
  end if;

  if request_row.seed <> p_seed or request_row.game_type <> p_game_type then
    return jsonb_build_object('ok', false, 'reason', 'request_mismatch');
  end if;

  if not (request_row.sender_id::text = any(p_participant_player_ids))
    or not (request_row.receiver_id::text = any(p_participant_player_ids)) then
    return jsonb_build_object('ok', false, 'reason', 'participants_mismatch');
  end if;

  insert into public.multiplayer_sessions (
    session_id,
    mode_id,
    seed,
    status,
    board_revision,
    active_player_id,
    participant_player_ids,
    session_payload,
    saved_at
  )
  values (
    p_session_id,
    p_mode_id,
    p_seed,
    coalesce(p_session_payload ->> 'status', 'active'),
    requested_revision,
    p_active_player_id,
    p_participant_player_ids,
    p_session_payload,
    now()
  );

  update public.multiplayer_game_requests
  set
    status = 'accepted',
    session_id = p_session_id,
    responded_at = now(),
    updated_at = now()
  where id = p_request_id;

  return jsonb_build_object(
    'ok',
    true,
    'reason',
    'request_accepted',
    'session_id',
    p_session_id
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'session_id_conflict');
end;
$$;

create or replace function public.multiplayer_commit_turn(
  p_session_id text,
  p_expected_revision integer,
  p_action text,
  p_session_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id text := auth.uid()::text;
  current_session public.multiplayer_sessions%rowtype;
  next_revision integer;
  server_saved_at_ms bigint := floor(extract(epoch from now()) * 1000)::bigint;
  next_payload jsonb;
begin
  if current_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'auth_failed');
  end if;

  if p_session_id is null
    or p_expected_revision is null
    or p_action is null
    or p_session_payload is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  select *
  into current_session
  from public.multiplayer_sessions
  where session_id = p_session_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'session_not_found');
  end if;

  if not (current_user_id = any(current_session.participant_player_ids)) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if current_session.status <> 'active' then
    return jsonb_build_object(
      'ok',
      false,
      'reason',
      'session_not_active',
      'status',
      current_session.status
    );
  end if;

  if current_session.active_player_id is distinct from current_user_id then
    return jsonb_build_object(
      'ok',
      false,
      'reason',
      'not_active_player',
      'active_player_id',
      current_session.active_player_id
    );
  end if;

  if current_session.board_revision <> p_expected_revision then
    return jsonb_build_object(
      'ok',
      false,
      'reason',
      'revision_conflict',
      'current_revision',
      current_session.board_revision,
      'session',
      current_session.session_payload
    );
  end if;

  if p_action in ('finish_request', 'finish_accept', 'finish_decline') then
    if coalesce((p_session_payload #>> '{bag,remainingCount}')::integer, 1) <> 0 then
      return jsonb_build_object(
        'ok',
        false,
        'reason',
        'bag_not_empty'
      );
    end if;
  end if;

  next_revision := p_expected_revision + 1;
  next_payload := jsonb_set(
    jsonb_set(
      p_session_payload,
      '{boardRevision}',
      to_jsonb(next_revision),
      true
    ),
    '{savedAt}',
    to_jsonb(server_saved_at_ms),
    true
  );

  update public.multiplayer_sessions
  set
    session_payload = next_payload,
    board_revision = next_revision,
    status = coalesce(next_payload ->> 'status', status),
    active_player_id = coalesce(next_payload #>> '{turn,activePlayerId}', active_player_id),
    saved_at = now(),
    updated_at = now()
  where id = current_session.id;

  return jsonb_build_object(
    'ok',
    true,
    'reason',
    'turn_committed',
    'action',
    p_action,
    'session',
    next_payload
  );
end;
$$;

create or replace function public.enqueue_multiplayer_notification(
  p_recipient_user_id uuid,
  p_type text,
  p_entity_id text default null,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  notification_id uuid;
begin
  if p_recipient_user_id is null or p_type is null then
    return null;
  end if;

  insert into public.multiplayer_notifications (
    recipient_user_id,
    type,
    entity_id,
    payload
  )
  values (
    p_recipient_user_id,
    p_type,
    p_entity_id,
    coalesce(p_payload, '{}'::jsonb)
  )
  returning id into notification_id;

  return notification_id;
end;
$$;

create or replace function public.enqueue_push_delivery_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.type in (
    'friend_request',
    'game_request',
    'request_accepted',
    'turn_ready',
    'session_conflict',
    'reminder'
  ) then
    insert into public.push_delivery_queue (
      notification_id,
      recipient_user_id,
      type,
      entity_id,
      payload,
      next_attempt_at,
      updated_at
    )
    values (
      new.id,
      new.recipient_user_id,
      new.type,
      new.entity_id,
      coalesce(new.payload, '{}'::jsonb),
      now(),
      now()
    )
    on conflict (notification_id) do nothing;
  end if;

  return new;
end;
$$;

create or replace function public.claim_push_delivery_jobs(
  p_limit integer default 50,
  p_worker_id text default null
)
returns table (
  id uuid,
  notification_id uuid,
  recipient_user_id uuid,
  type text,
  entity_id text,
  payload jsonb,
  attempts integer,
  max_attempts integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  claim_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
begin
  return query
  with candidates as (
    select q.id
    from public.push_delivery_queue q
    where (
      (q.status in ('pending', 'retry') and q.next_attempt_at <= now())
      or (q.status = 'processing' and q.locked_at <= now() - interval '10 minutes')
    )
      and q.attempts < q.max_attempts
    order by q.next_attempt_at asc, q.created_at asc
    limit claim_limit
    for update skip locked
  ), updated as (
    update public.push_delivery_queue q
    set
      status = 'processing',
      locked_at = now(),
      locked_by = coalesce(p_worker_id, 'push-worker'),
      last_attempt_at = now(),
      attempts = q.attempts + 1,
      updated_at = now()
    from candidates c
    where q.id = c.id
    returning
      q.id,
      q.notification_id,
      q.recipient_user_id,
      q.type,
      q.entity_id,
      q.payload,
      q.attempts,
      q.max_attempts
  )
  select * from updated;
end;
$$;

create or replace function public.complete_push_delivery_job(
  p_job_id uuid,
  p_success boolean,
  p_error text default null,
  p_push_result jsonb default null,
  p_retry_delay_seconds integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row public.push_delivery_queue%rowtype;
  delay_seconds integer;
begin
  if p_job_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  select *
  into job_row
  from public.push_delivery_queue
  where id = p_job_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'job_not_found');
  end if;

  if coalesce(p_success, false) then
    update public.push_delivery_queue
    set
      status = 'sent',
      locked_at = null,
      locked_by = null,
      last_error = null,
      push_result = coalesce(p_push_result, '{}'::jsonb),
      updated_at = now()
    where id = job_row.id;

    return jsonb_build_object('ok', true, 'reason', 'sent');
  end if;

  delay_seconds := greatest(
    30,
    coalesce(
      p_retry_delay_seconds,
      (power(2::numeric, least(job_row.attempts, 8)) * 30)::integer
    )
  );

  if p_error = 'no_push_tokens' then
    update public.push_delivery_queue
    set
      status = 'retry',
      attempts = 0,
      locked_at = null,
      locked_by = null,
      next_attempt_at = now() + make_interval(secs => greatest(delay_seconds, 3600)),
      last_error = p_error,
      push_result = coalesce(p_push_result, '{}'::jsonb),
      updated_at = now()
    where id = job_row.id;

    return jsonb_build_object(
      'ok',
      true,
      'reason',
      'retry_scheduled_no_tokens',
      'delay_seconds',
      greatest(delay_seconds, 3600)
    );
  end if;

  if job_row.attempts >= job_row.max_attempts then
    update public.push_delivery_queue
    set
      status = 'failed',
      locked_at = null,
      locked_by = null,
      next_attempt_at = now(),
      last_error = coalesce(p_error, 'send_failed'),
      push_result = coalesce(p_push_result, '{}'::jsonb),
      updated_at = now()
    where id = job_row.id;

    return jsonb_build_object('ok', true, 'reason', 'failed_permanent');
  end if;

  update public.push_delivery_queue
  set
    status = 'retry',
    locked_at = null,
    locked_by = null,
    next_attempt_at = now() + make_interval(secs => delay_seconds),
    last_error = coalesce(p_error, 'send_failed'),
    push_result = coalesce(p_push_result, '{}'::jsonb),
    updated_at = now()
  where id = job_row.id;

  return jsonb_build_object(
    'ok',
    true,
    'reason',
    'retry_scheduled',
    'delay_seconds',
    delay_seconds
  );
end;
$$;

create or replace function public.register_push_token(
  p_platform text,
  p_provider text,
  p_token text,
  p_device_id text,
  p_app_build text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'auth_failed');
  end if;

  if p_platform is null or p_provider is null or p_token is null or p_device_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  insert into public.push_tokens (
    user_id,
    platform,
    provider,
    token,
    device_id,
    app_build,
    last_seen_at,
    updated_at
  )
  values (
    current_user_id,
    p_platform,
    p_provider,
    p_token,
    p_device_id,
    p_app_build,
    now(),
    now()
  )
  on conflict (user_id, device_id, token)
  do update set
    platform = excluded.platform,
    provider = excluded.provider,
    app_build = excluded.app_build,
    last_seen_at = now(),
    updated_at = now();

  return jsonb_build_object('ok', true, 'reason', 'token_registered');
end;
$$;

create or replace function public.list_broadcast_push_recipients(
  p_limit integer default 100,
  p_offset integer default 0,
  p_user_ids uuid[] default null
)
returns table (user_id uuid)
language sql
security definer
set search_path = public
as $$
  select distinct pt.user_id
  from public.push_tokens pt
  where p_user_ids is null
    or pt.user_id = any(p_user_ids)
  order by pt.user_id
  limit greatest(1, least(coalesce(p_limit, 100), 500))
  offset greatest(0, coalesce(p_offset, 0));
$$;

create or replace function public.upsert_presence(
  p_status text,
  p_last_session_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'auth_failed');
  end if;

  insert into public.user_presence (
    user_id,
    status,
    last_active_at,
    last_session_id,
    updated_at
  )
  values (
    current_user_id,
    coalesce(p_status, 'online'),
    now(),
    p_last_session_id,
    now()
  )
  on conflict (user_id)
  do update set
    status = coalesce(p_status, user_presence.status),
    last_active_at = now(),
    last_session_id = coalesce(p_last_session_id, user_presence.last_session_id),
    updated_at = now();

  return jsonb_build_object('ok', true, 'reason', 'presence_updated');
end;
$$;

create or replace function public.mark_multiplayer_notifications_read(
  p_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  updated_count integer := 0;
begin
  if current_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'auth_failed');
  end if;

  if p_ids is null or array_length(p_ids, 1) is null then
    return jsonb_build_object('ok', true, 'updated_count', 0);
  end if;

  update public.multiplayer_notifications
  set read_at = now()
  where id = any(p_ids)
    and recipient_user_id = current_user_id
    and read_at is null;

  get diagnostics updated_count = row_count;
  return jsonb_build_object('ok', true, 'updated_count', updated_count);
end;
$$;

create or replace function public.mark_session_seen(
  p_session_id text,
  p_seen_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'auth_failed');
  end if;

  if p_session_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  if not exists (
    select 1
    from public.multiplayer_sessions ms
    where ms.session_id = p_session_id
      and current_user_id::text = any(ms.participant_player_ids)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  insert into public.multiplayer_user_session_state (
    session_id,
    user_id,
    last_seen_revision,
    last_opened_at,
    updated_at
  )
  values (
    p_session_id,
    current_user_id,
    greatest(coalesce(p_seen_revision, 0), 0),
    now(),
    now()
  )
  on conflict (session_id, user_id)
  do update set
    last_seen_revision = greatest(
      multiplayer_user_session_state.last_seen_revision,
      greatest(coalesce(p_seen_revision, 0), 0)
    ),
    last_opened_at = now(),
    updated_at = now();

  return jsonb_build_object('ok', true, 'reason', 'session_seen_marked');
end;
$$;

create or replace function public.get_multiplayer_notification_settings()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  settings_row public.multiplayer_user_notification_settings%rowtype;
begin
  if current_user_id is null then
    return null;
  end if;

  select *
  into settings_row
  from public.multiplayer_user_notification_settings
  where user_id = current_user_id;

  if not found then
    return jsonb_build_object(
      'user_id', current_user_id,
      'turn_reminders_enabled', true,
      'quiet_hours_start', null,
      'quiet_hours_end', null,
      'timezone', null
    );
  end if;

  return jsonb_build_object(
    'user_id', settings_row.user_id,
    'turn_reminders_enabled', settings_row.turn_reminders_enabled,
    'quiet_hours_start', settings_row.quiet_hours_start,
    'quiet_hours_end', settings_row.quiet_hours_end,
    'timezone', settings_row.timezone
  );
end;
$$;

create or replace function public.upsert_multiplayer_notification_settings(
  p_turn_reminders_enabled boolean default true,
  p_quiet_hours_start time default null,
  p_quiet_hours_end time default null,
  p_timezone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  settings_row public.multiplayer_user_notification_settings%rowtype;
begin
  if current_user_id is null then
    return null;
  end if;

  insert into public.multiplayer_user_notification_settings (
    user_id,
    turn_reminders_enabled,
    quiet_hours_start,
    quiet_hours_end,
    timezone,
    updated_at
  )
  values (
    current_user_id,
    coalesce(p_turn_reminders_enabled, true),
    p_quiet_hours_start,
    p_quiet_hours_end,
    p_timezone,
    now()
  )
  on conflict (user_id)
  do update set
    turn_reminders_enabled = coalesce(
      p_turn_reminders_enabled,
      multiplayer_user_notification_settings.turn_reminders_enabled
    ),
    quiet_hours_start = p_quiet_hours_start,
    quiet_hours_end = p_quiet_hours_end,
    timezone = p_timezone,
    updated_at = now();

  select *
  into settings_row
  from public.multiplayer_user_notification_settings
  where user_id = current_user_id;

  return jsonb_build_object(
    'user_id', settings_row.user_id,
    'turn_reminders_enabled', settings_row.turn_reminders_enabled,
    'quiet_hours_start', settings_row.quiet_hours_start,
    'quiet_hours_end', settings_row.quiet_hours_end,
    'timezone', settings_row.timezone
  );
end;
$$;

create or replace function public.set_session_reminder_mute(
  p_session_id text,
  p_muted_until timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'auth_failed');
  end if;

  if p_session_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  if not exists (
    select 1
    from public.multiplayer_sessions ms
    where ms.session_id = p_session_id
      and current_user_id::text = any(ms.participant_player_ids)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  insert into public.multiplayer_user_session_state (
    session_id,
    user_id,
    last_seen_revision,
    muted_until,
    updated_at
  )
  values (
    p_session_id,
    current_user_id,
    0,
    p_muted_until,
    now()
  )
  on conflict (session_id, user_id)
  do update set
    muted_until = p_muted_until,
    updated_at = now();

  return jsonb_build_object('ok', true, 'reason', 'session_mute_updated');
end;
$$;

create or replace function public.archive_multiplayer_session_for_user(
  p_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  current_session public.multiplayer_sessions%rowtype;
  next_payload jsonb;
begin
  if current_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'auth_failed');
  end if;

  select *
  into current_session
  from public.multiplayer_sessions
  where session_id = p_session_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'session_not_found');
  end if;

  if not (current_user_id::text = any(current_session.participant_player_ids)) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  next_payload := jsonb_set(
    current_session.session_payload,
    '{status}',
    to_jsonb('archived'::text),
    true
  );

  update public.multiplayer_sessions
  set
    status = 'archived',
    session_payload = next_payload,
    saved_at = now(),
    updated_at = now()
  where id = current_session.id;

  return jsonb_build_object('ok', true, 'reason', 'session_archived');
end;
$$;

create or replace function public.create_multiplayer_rematch(
  p_session_id text,
  p_new_session_id text,
  p_seed text,
  p_game_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  source_session public.multiplayer_sessions%rowtype;
  participant_ids text[];
begin
  if current_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'auth_failed');
  end if;

  if p_session_id is null or p_new_session_id is null or p_seed is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  select *
  into source_session
  from public.multiplayer_sessions
  where session_id = p_session_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'session_not_found');
  end if;

  if not (current_user_id::text = any(source_session.participant_player_ids)) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  participant_ids := source_session.participant_player_ids;

  insert into public.multiplayer_sessions (
    session_id,
    mode_id,
    seed,
    status,
    board_revision,
    active_player_id,
    participant_player_ids,
    session_payload,
    saved_at
  )
  values (
    p_new_session_id,
    source_session.mode_id,
    p_seed,
    'active',
    0,
    participant_ids[1],
    participant_ids,
    jsonb_build_object(
      'schemaVersion', 1,
      'modeId', source_session.mode_id,
      'sessionId', p_new_session_id,
      'seed', p_seed,
      'gameType', coalesce(p_game_type, source_session.session_payload ->> 'gameType', 'seeded'),
      'status', 'active',
      'boardRevision', 0,
      'savedAt', floor(extract(epoch from now()) * 1000)::bigint
    ),
    now()
  );

  return jsonb_build_object(
    'ok',
    true,
    'reason',
    'rematch_created',
    'session_id',
    p_new_session_id
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'session_id_conflict');
end;
$$;

create or replace function public.enqueue_turn_reminders()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer := 0;
begin
  with candidates as (
    select
      ms.session_id,
      ms.active_player_id::uuid as recipient_user_id
    from public.multiplayer_sessions ms
    left join public.multiplayer_user_session_state mus
      on mus.session_id = ms.session_id
      and mus.user_id::text = ms.active_player_id
    left join public.multiplayer_user_notification_settings muns
      on muns.user_id::text = ms.active_player_id
    where ms.status = 'active'
      and ms.active_player_id is not null
      and ms.saved_at < now() - interval '12 hours'
      and (mus.muted_until is null or mus.muted_until < now())
      and coalesce(muns.turn_reminders_enabled, true)
      and (
        muns.quiet_hours_start is null
        or muns.quiet_hours_end is null
        or (
          case
            when muns.quiet_hours_start <= muns.quiet_hours_end
              then not ((now() at time zone coalesce(muns.timezone, 'UTC'))::time >= muns.quiet_hours_start
                and (now() at time zone coalesce(muns.timezone, 'UTC'))::time < muns.quiet_hours_end)
            else not ((now() at time zone coalesce(muns.timezone, 'UTC'))::time >= muns.quiet_hours_start
              or (now() at time zone coalesce(muns.timezone, 'UTC'))::time < muns.quiet_hours_end)
          end
        )
      )
      and not exists (
        select 1
        from public.multiplayer_notifications mn
        where mn.recipient_user_id::text = ms.active_player_id
          and mn.type = 'reminder'
          and mn.entity_id = ms.session_id
          and mn.created_at > now() - interval '24 hours'
      )
  ), inserted as (
    insert into public.multiplayer_notifications (
      recipient_user_id,
      type,
      entity_id,
      payload
    )
    select
      c.recipient_user_id,
      'reminder',
      c.session_id,
      jsonb_build_object('sessionId', c.session_id, 'version', 1)
    from candidates c
    returning id
  )
  select count(*)::integer into inserted_count from inserted;

  return jsonb_build_object('ok', true, 'inserted_count', inserted_count);
end;
$$;

create or replace function public.handle_friend_request_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform public.enqueue_multiplayer_notification(
      new.receiver_id,
      'friend_request',
      new.id::text,
      jsonb_build_object(
        'requestId',
        new.id,
        'friendId',
        new.sender_id,
        'route',
        'multiplayer-menu',
        'version',
        1
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists friend_request_notification_trigger on public.friend_requests;
create trigger friend_request_notification_trigger
after insert on public.friend_requests
for each row
execute function public.handle_friend_request_notification();

create or replace function public.handle_multiplayer_game_request_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform public.enqueue_multiplayer_notification(
      new.receiver_id,
      'game_request',
      new.id::text,
      jsonb_build_object(
        'requestId',
        new.id,
        'friendId',
        new.sender_id,
        'route',
        'multiplayer-menu',
        'version',
        1
      )
    );
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    perform public.enqueue_multiplayer_notification(
      new.sender_id,
      'request_accepted',
      coalesce(new.session_id, new.id::text),
      jsonb_build_object(
        'requestId',
        new.id,
        'sessionId',
        new.session_id,
        'friendId',
        new.receiver_id,
        'route',
        'multiplayer',
        'version',
        1
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists multiplayer_game_request_notification_trigger on public.multiplayer_game_requests;
create trigger multiplayer_game_request_notification_trigger
after insert or update on public.multiplayer_game_requests
for each row
execute function public.handle_multiplayer_game_request_notification();

drop trigger if exists multiplayer_notification_push_queue_trigger on public.multiplayer_notifications;
create trigger multiplayer_notification_push_queue_trigger
after insert on public.multiplayer_notifications
for each row
execute function public.enqueue_push_delivery_job();

create or replace function public.handle_multiplayer_session_turn_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
    and old.active_player_id is distinct from new.active_player_id
    and new.active_player_id is not null
    and new.status = 'active' then
    perform public.enqueue_multiplayer_notification(
      new.active_player_id::uuid,
      'turn_ready',
      new.session_id,
      jsonb_build_object(
        'sessionId',
        new.session_id,
        'friendId',
        old.active_player_id,
        'route',
        'multiplayer',
        'version',
        1
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists multiplayer_session_turn_notification_trigger on public.multiplayer_sessions;
create trigger multiplayer_session_turn_notification_trigger
after update on public.multiplayer_sessions
for each row
execute function public.handle_multiplayer_session_turn_notification();

create or replace function public.delete_my_account_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  archived_sessions_count integer := 0;
  canceled_game_requests_count integer := 0;
  deleted_friend_requests_count integer := 0;
  deleted_friendships_count integer := 0;
  deleted_profiles_count integer := 0;
begin
  if current_user_id is null then
    raise exception 'not_authenticated';
  end if;

  update public.multiplayer_sessions
  set
    status = 'archived',
    active_player_id = case
      when active_player_id = current_user_id::text then null
      else active_player_id
    end,
    participant_player_ids = array_remove(
      participant_player_ids,
      current_user_id::text
    ),
    session_payload = jsonb_set(
      jsonb_set(
        session_payload,
        '{status}',
        to_jsonb('archived'::text),
        true
      ),
      '{turn,activePlayerId}',
      'null'::jsonb,
      true
    ),
    saved_at = now(),
    updated_at = now()
  where current_user_id::text = any(participant_player_ids);

  get diagnostics archived_sessions_count = row_count;

  update public.multiplayer_game_requests
  set
    status = 'canceled',
    updated_at = now(),
    responded_at = coalesce(responded_at, now())
  where
    (sender_id = current_user_id or receiver_id = current_user_id)
    and status in ('pending', 'accepted');

  get diagnostics canceled_game_requests_count = row_count;

  delete from public.friend_requests
  where sender_id = current_user_id or receiver_id = current_user_id;

  get diagnostics deleted_friend_requests_count = row_count;

  delete from public.friends
  where
    player_low_id = current_user_id
    or player_high_id = current_user_id;

  get diagnostics deleted_friendships_count = row_count;

  delete from public.profiles
  where id = current_user_id;

  get diagnostics deleted_profiles_count = row_count;

  return jsonb_build_object(
    'archived_sessions_count',
    archived_sessions_count,
    'canceled_game_requests_count',
    canceled_game_requests_count,
    'deleted_friend_requests_count',
    deleted_friend_requests_count,
    'deleted_friendships_count',
    deleted_friendships_count,
    'deleted_profiles_count',
    deleted_profiles_count
  );
end;
$$;

create table if not exists public.layout_lab_saved_layouts (
  id uuid primary key default gen_random_uuid(),
  player_id text not null,
  mode_id text not null,
  layout_name text not null,
  seed text,
  board_size integer not null,
  premium_squares jsonb not null default '{}'::jsonb,
  tile_counts jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  saved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint layout_lab_saved_layouts_mode_check
    check (mode_id in ('classic', 'mini'))
);

create index if not exists layout_lab_saved_layouts_player_saved_idx
  on public.layout_lab_saved_layouts (player_id, saved_at desc);

create index if not exists layout_lab_saved_layouts_mode_saved_idx
  on public.layout_lab_saved_layouts (mode_id, saved_at desc);

alter table public.layout_lab_saved_layouts enable row level security;

drop policy if exists "layout_lab_saved_layouts_read_own" on public.layout_lab_saved_layouts;
drop policy if exists "layout_lab_saved_layouts_read_authenticated" on public.layout_lab_saved_layouts;
create policy "layout_lab_saved_layouts_read_authenticated"
  on public.layout_lab_saved_layouts
  for select
  to authenticated
  using (auth.uid() is not null);

drop policy if exists "layout_lab_saved_layouts_insert_own" on public.layout_lab_saved_layouts;
create policy "layout_lab_saved_layouts_insert_own"
  on public.layout_lab_saved_layouts
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and player_id = auth.uid()::text
  );

drop policy if exists "layout_lab_saved_layouts_update_own" on public.layout_lab_saved_layouts;
create policy "layout_lab_saved_layouts_update_own"
  on public.layout_lab_saved_layouts
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

grant execute on function public.delete_my_account_data() to authenticated;
grant execute on function public.accept_multiplayer_game_request(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text[],
  jsonb
) to authenticated;
grant execute on function public.multiplayer_commit_turn(
  text,
  integer,
  text,
  jsonb
) to authenticated;
grant execute on function public.enqueue_multiplayer_notification(
  uuid,
  text,
  text,
  jsonb
) to authenticated;
grant execute on function public.claim_push_delivery_jobs(
  integer,
  text
) to service_role;
grant execute on function public.complete_push_delivery_job(
  uuid,
  boolean,
  text,
  jsonb,
  integer
) to service_role;
grant select, insert, update on table public.push_delivery_queue to service_role;
grant execute on function public.register_push_token(
  text,
  text,
  text,
  text,
  text
) to authenticated;
grant execute on function public.list_broadcast_push_recipients(
  integer,
  integer,
  uuid[]
) to service_role;
grant execute on function public.upsert_presence(
  text,
  text
) to authenticated;
grant execute on function public.mark_multiplayer_notifications_read(
  uuid[]
) to authenticated;
grant execute on function public.mark_session_seen(
  text,
  integer
) to authenticated;
grant execute on function public.get_multiplayer_notification_settings() to authenticated;
grant execute on function public.upsert_multiplayer_notification_settings(
  boolean,
  time,
  time,
  text
) to authenticated;
grant execute on function public.set_session_reminder_mute(
  text,
  timestamptz
) to authenticated;
grant execute on function public.archive_multiplayer_session_for_user(
  text
) to authenticated;
grant execute on function public.create_multiplayer_rematch(
  text,
  text,
  text,
  text
) to authenticated;
grant execute on function public.enqueue_turn_reminders() to authenticated;
