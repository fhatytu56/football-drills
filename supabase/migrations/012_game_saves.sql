-- ============================================================
-- 012: U10 manager game — logins, saved games, team leaderboard
--
-- A parent signs up with their email + a password (Supabase Auth, same as coaches) and picks
-- a manager nickname. One saved game per login, on the team whose game link they used.
-- Parent logins get NO coach access: coach access comes only from coach_groups / coach_teams,
-- which these accounts are never in.
--
-- Also: Supabase → Authentication → Sign In / Providers → turn OFF "Confirm email"
-- (the project has no email service, so confirm emails never arrive).
--
-- Run once in Supabase → SQL Editor, BEFORE merging the new code. Safe to re-run.
-- ============================================================

create table if not exists public.game_saves (
  user_id uuid primary key references auth.users(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  manager_name text not null check (char_length(manager_name) between 2 and 20),
  save jsonb,
  -- leaderboard summary, written by the game alongside the save
  season int not null default 1,
  played int not null default 0,
  pts int not null default 0,
  pos int,
  gd int not null default 0,
  cups int not null default 0,
  titles int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists game_saves_team_name_key on public.game_saves(team_id, lower(manager_name));

alter table public.game_saves enable row level security;

-- Each login sees and saves only its own game. No insert/delete from the app: joining goes
-- through game_join() below, which checks the team link.
drop policy if exists "Managers read own save" on public.game_saves;
create policy "Managers read own save" on public.game_saves
  for select using (auth.uid() = user_id);
drop policy if exists "Managers write own save" on public.game_saves;
create policy "Managers write own save" on public.game_saves
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

revoke all on public.game_saves from anon, authenticated;
grant select on public.game_saves to authenticated;
-- team and nickname can't be changed from the app
grant update (save, season, played, pts, pos, gd, cups, titles, updated_at) on public.game_saves to authenticated;

-- Join a team's game with its link token. Returns 'ok', 'taken' (nickname used on this team),
-- 'bad_name', 'bad_link' or 'signed_out'. Already joined: just 'ok' (nothing changes).
create or replace function public.game_join(p_token text, p_name text)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_team uuid;
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if auth.uid() is null then return 'signed_out'; end if;
  if exists (select 1 from game_saves where user_id = auth.uid()) then return 'ok'; end if;
  select id into v_team from teams where game_token = p_token and age_group = 'u10';
  if v_team is null then return 'bad_link'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 20 then return 'bad_name'; end if;
  if exists (select 1 from game_saves where team_id = v_team and lower(manager_name) = lower(v_name)) then
    return 'taken';
  end if;
  insert into game_saves (user_id, team_id, manager_name) values (auth.uid(), v_team, v_name);
  return 'ok';
end;
$$;

-- This login's game: nickname, which team (and that team's link, to open the right game), the save.
create or replace function public.game_mine()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object('manager_name', g.manager_name, 'team', t.name, 'token', t.game_token, 'save', g.save)
  from game_saves g join teams t on t.id = g.team_id
  where g.user_id = auth.uid();
$$;

-- Leaderboard for one team (by its link): nicknames and results only.
create or replace function public.game_leaderboard(p_token text)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'manager_name', g.manager_name, 'season', g.season, 'played', g.played, 'pts', g.pts,
           'pos', g.pos, 'gd', g.gd, 'cups', g.cups, 'titles', g.titles, 'me', g.user_id = auth.uid())
         order by g.titles desc, g.cups desc, g.season desc, g.pts desc, g.gd desc, g.manager_name), '[]'::jsonb)
  from game_saves g join teams t on t.id = g.team_id
  where t.game_token = p_token and t.age_group = 'u10' and g.save is not null;
$$;

revoke all on function public.game_join(text, text) from public;
revoke all on function public.game_mine() from public;
revoke all on function public.game_leaderboard(text) from public;
grant execute on function public.game_join(text, text) to authenticated;
grant execute on function public.game_mine() to authenticated;
grant execute on function public.game_leaderboard(text) to anon, authenticated;

-- Check: table + 2 policies + 3 functions.
select
  (select count(*) from pg_tables where schemaname = 'public' and tablename = 'game_saves') as tables,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'game_saves') as policies,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('game_join', 'game_mine', 'game_leaderboard')) as functions;
