-- ============================================================
-- 003: Teams + squad (players) per age group
-- Run once in Supabase → SQL Editor, BEFORE deploying the new code.
-- Safe to re-run. Only coaches of an age group can see or change its squad.
-- ============================================================

-- Teams within an age group, e.g. "10.1", "10.2".
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  age_group text not null check (age_group in ('u8','u9','u10','u11')),
  name text not null check (length(trim(name)) between 1 and 30),
  created_at timestamptz not null default now(),
  unique (age_group, name),
  unique (id, age_group)
);

-- Players: first name only. Positions (max 2, outfield) only for U10s/U11s.
create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  age_group text not null check (age_group in ('u8','u9','u10','u11')),
  team_id uuid,
  first_name text not null check (length(trim(first_name)) between 1 and 30),
  positions text[] not null default '{}',
  created_at timestamptz not null default now(),
  -- a player's team must be in the same age group; deleting a team leaves its players unassigned
  foreign key (team_id, age_group) references public.teams (id, age_group) on delete set null (team_id),
  constraint players_positions_valid check (
    positions <@ array['def','mid','st']::text[]
    and cardinality(positions) <= 2
    and (cardinality(positions) < 2 or positions[1] <> positions[2])
    and (age_group in ('u10','u11') or cardinality(positions) = 0)
  )
);

create index if not exists idx_teams_group on public.teams(age_group);
create index if not exists idx_players_group on public.players(age_group);
create index if not exists idx_players_team on public.players(team_id);

-- Coaches of the group only — children's names are never public.
alter table public.teams enable row level security;
alter table public.players enable row level security;

-- Signed-in users can reach the tables; the policies below decide which rows.
grant select, insert, update, delete on public.teams, public.players to authenticated;

do $$
declare r record;
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('teams','players')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy "Group coaches read teams" on public.teams
  for select using (public.is_group_coach(age_group));
create policy "Group coaches add teams" on public.teams
  for insert with check (public.is_group_coach(age_group));
create policy "Group coaches edit teams" on public.teams
  for update using (public.is_group_coach(age_group))
  with check (public.is_group_coach(age_group));
create policy "Group coaches delete teams" on public.teams
  for delete using (public.is_group_coach(age_group));

create policy "Group coaches read players" on public.players
  for select using (public.is_group_coach(age_group));
create policy "Group coaches add players" on public.players
  for insert with check (public.is_group_coach(age_group));
create policy "Group coaches edit players" on public.players
  for update using (public.is_group_coach(age_group))
  with check (public.is_group_coach(age_group));
create policy "Group coaches delete players" on public.players
  for delete using (public.is_group_coach(age_group));

-- Check: both tables exist with 4 policies each.
select tablename, count(*) as policies
from pg_policies where schemaname = 'public' and tablename in ('teams','players')
group by 1 order by 1;
