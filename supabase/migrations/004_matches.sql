-- ============================================================
-- 004: Matches + parent availability (Yes / No via a secret link)
-- Run once in Supabase → SQL Editor, BEFORE deploying the new code.
-- Safe to re-run.
-- ============================================================

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  age_group text not null check (age_group in ('u8','u9','u10','u11')),
  team_id uuid not null,
  match_date date not null,
  meet_time time,
  kickoff time not null,
  opponent text not null check (length(trim(opponent)) between 1 and 60),
  -- U8s/U9s play two games on the day
  kickoff_2 time,
  opponent_2 text check (opponent_2 is null or length(trim(opponent_2)) between 1 and 60),
  home_away text not null default 'home' check (home_away in ('home','away')),
  location text check (location is null or length(location) <= 120),
  kit text check (kit is null or length(kit) <= 80),
  notes text check (notes is null or length(notes) <= 300),
  -- secret for the parents' link: 32 hex chars (122 random bits), unguessable
  share_token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now(),
  foreign key (team_id, age_group) references public.teams (id, age_group) on delete cascade,
  constraint matches_second_game check (
    (kickoff_2 is null and opponent_2 is null)
    or (age_group in ('u8','u9') and kickoff_2 is not null and opponent_2 is not null)
  )
);

create table if not exists public.availability (
  match_id uuid not null references public.matches(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  answer text not null check (answer in ('yes','no')),
  updated_at timestamptz not null default now(),
  primary key (match_id, player_id)
);

create index if not exists idx_matches_group_date on public.matches(age_group, match_date);
create index if not exists idx_availability_match on public.availability(match_id);

alter table public.matches enable row level security;
alter table public.availability enable row level security;

-- Signed-in users can reach the tables; the policies below decide which rows.
-- Parents (not signed in) get no table access at all — only the two functions further down.
grant select, insert, update, delete on public.matches, public.availability to authenticated;
-- Repeat of the 27 Sep hotfix, in case 002/003 were run before it.
grant select on public.coach_groups to authenticated;
grant select, insert, update, delete on public.teams, public.players to authenticated;

do $$
declare r record;
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('matches','availability')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Coaches of the group manage matches and can set answers themselves.
create policy "Group coaches read matches" on public.matches
  for select using (public.is_group_coach(age_group));
create policy "Group coaches add matches" on public.matches
  for insert with check (public.is_group_coach(age_group));
create policy "Group coaches edit matches" on public.matches
  for update using (public.is_group_coach(age_group))
  with check (public.is_group_coach(age_group));
create policy "Group coaches delete matches" on public.matches
  for delete using (public.is_group_coach(age_group));

create policy "Group coaches read answers" on public.availability
  for select using (exists (select 1 from public.matches m
                            where m.id = match_id and public.is_group_coach(m.age_group)));
create policy "Group coaches set answers" on public.availability
  for insert with check (exists (select 1 from public.matches m
                                 where m.id = match_id and public.is_group_coach(m.age_group)));
create policy "Group coaches change answers" on public.availability
  for update using (exists (select 1 from public.matches m
                            where m.id = match_id and public.is_group_coach(m.age_group)));
create policy "Group coaches clear answers" on public.availability
  for delete using (exists (select 1 from public.matches m
                            where m.id = match_id and public.is_group_coach(m.age_group)));

-- ---------- Parents' link (no login) ----------
-- Parents never touch the tables directly. These two functions are the only way in,
-- and only with the match's secret token, and only up to the end of match day (Irish time).

create or replace function public.rsvp_match(p_token text)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'match', jsonb_build_object(
      'age_group', m.age_group, 'team', t.name, 'match_date', m.match_date,
      'meet_time', m.meet_time, 'kickoff', m.kickoff, 'opponent', m.opponent,
      'kickoff_2', m.kickoff_2, 'opponent_2', m.opponent_2, 'home_away', m.home_away,
      'location', m.location, 'kit', m.kit, 'notes', m.notes),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'first_name', p.first_name, 'answer', a.answer)
                       order by p.first_name)
      from public.players p
      left join public.availability a on a.match_id = m.id and a.player_id = p.id
      where p.team_id = m.team_id), '[]'::jsonb))
  from public.matches m
  join public.teams t on t.id = m.team_id
  where m.share_token = p_token
    and m.match_date >= (now() at time zone 'Europe/Dublin')::date;
$$;

create or replace function public.rsvp_answer(p_token text, p_player uuid, p_answer text)
returns boolean
language plpgsql volatile security definer
set search_path = public
as $$
declare v_match uuid;
begin
  if p_answer not in ('yes','no') then return false; end if;
  select m.id into v_match
  from public.matches m
  join public.players p on p.id = p_player and p.team_id = m.team_id
  where m.share_token = p_token
    and m.match_date >= (now() at time zone 'Europe/Dublin')::date;
  if v_match is null then return false; end if;
  insert into public.availability (match_id, player_id, answer, updated_at)
  values (v_match, p_player, p_answer, now())
  on conflict (match_id, player_id) do update set answer = excluded.answer, updated_at = now();
  return true;
end;
$$;

revoke all on function public.rsvp_match(text) from public;
revoke all on function public.rsvp_answer(text, uuid, text) from public;
grant execute on function public.rsvp_match(text) to anon, authenticated;
grant execute on function public.rsvp_answer(text, uuid, text) to anon, authenticated;

-- Check: 4 policies each + the two functions.
select tablename as what, count(*)::text as n
from pg_policies where schemaname = 'public' and tablename in ('matches','availability')
group by 1
union all
select 'functions', count(*)::text from pg_proc
where proname in ('rsvp_match','rsvp_answer') and pronamespace = 'public'::regnamespace
order by 1;
