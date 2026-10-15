-- ============================================================
-- 009: Team lock — team coaches only see their own team(s)
--
--   Coordinator (coach_groups.all_teams = true, the default): every team in the age group,
--     and the only ones who can add, rename or delete teams.
--   Team coach (all_teams = false + rows in coach_teams): only their team(s) — squad,
--     matches, parents' answers, sub plans, Match Day.
--   Drills and training plans stay shared by everyone in the age group (unchanged).
--
-- Run once in Supabase → SQL Editor, BEFORE merging the new code. Safe to re-run.
-- Changes nothing for anyone yet: every existing coach is a coordinator until
-- all_teams is set to false for them (see README "Coach accounts").
-- ============================================================

-- 1. Coordinator or team coach, per age group.
alter table public.coach_groups add column if not exists all_teams boolean not null default true;

-- 2. Which team(s) a team coach has.
create table if not exists public.coach_teams (
  user_id uuid not null references auth.users(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, team_id)
);
create index if not exists idx_coach_teams_team on public.coach_teams(team_id);
alter table public.coach_teams enable row level security;
drop policy if exists "Coaches read own teams" on public.coach_teams;
create policy "Coaches read own teams" on public.coach_teams
  for select using (auth.uid() = user_id);
-- No insert/update/delete policies: only the Supabase dashboard can change who coaches what.
grant select on public.coach_teams to authenticated;

-- 3. Checks used by the policies below.
-- Coordinator of the age group.
create or replace function public.is_group_lead(g text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.coach_groups
    where user_id = auth.uid() and age_group = g and all_teams
  );
$$;

-- Can see/change this team: a coordinator of its age group, or one of its coaches
-- (who must still be a coach of that age group).
create or replace function public.is_team_coach(t uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.teams tm
    join public.coach_groups g on g.age_group = tm.age_group and g.user_id = auth.uid()
    where tm.id = t
      and (g.all_teams or exists (
        select 1 from public.coach_teams ct where ct.user_id = auth.uid() and ct.team_id = t))
  );
$$;

revoke all on function public.is_group_lead(text) from public;
revoke all on function public.is_team_coach(uuid) from public;
grant execute on function public.is_group_lead(text) to authenticated;
grant execute on function public.is_team_coach(uuid) to authenticated;

-- 4. Replace the age-group policies with team ones.
do $$
declare r record;
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('teams','players','matches','availability','match_plans')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Teams: coordinators see all and manage them; team coaches see only theirs.
create policy "Coaches read teams" on public.teams
  for select using (public.is_group_lead(age_group) or public.is_team_coach(id));
create policy "Coordinators add teams" on public.teams
  for insert with check (public.is_group_lead(age_group));
create policy "Coordinators edit teams" on public.teams
  for update using (public.is_group_lead(age_group))
  with check (public.is_group_lead(age_group));
create policy "Coordinators delete teams" on public.teams
  for delete using (public.is_group_lead(age_group));

-- Players: coordinators see everyone (incl. "No team yet"); team coaches only their team's
-- players, and can't move a player out of their own team(s).
create policy "Coaches read players" on public.players
  for select using (public.is_group_lead(age_group) or (team_id is not null and public.is_team_coach(team_id)));
create policy "Coaches add players" on public.players
  for insert with check (public.is_group_lead(age_group) or (team_id is not null and public.is_team_coach(team_id)));
create policy "Coaches edit players" on public.players
  for update using (public.is_group_lead(age_group) or (team_id is not null and public.is_team_coach(team_id)))
  with check (public.is_group_lead(age_group) or (team_id is not null and public.is_team_coach(team_id)));
create policy "Coaches delete players" on public.players
  for delete using (public.is_group_lead(age_group) or (team_id is not null and public.is_team_coach(team_id)));

-- Matches belong to a team (same age group, enforced by the foreign key).
create policy "Coaches read matches" on public.matches
  for select using (public.is_team_coach(team_id));
create policy "Coaches add matches" on public.matches
  for insert with check (public.is_team_coach(team_id));
create policy "Coaches edit matches" on public.matches
  for update using (public.is_team_coach(team_id))
  with check (public.is_team_coach(team_id));
create policy "Coaches delete matches" on public.matches
  for delete using (public.is_team_coach(team_id));

-- Answers and sub plans follow their match's team.
create policy "Coaches read answers" on public.availability
  for select using (exists (select 1 from public.matches m
                            where m.id = match_id and public.is_team_coach(m.team_id)));
create policy "Coaches set answers" on public.availability
  for insert with check (exists (select 1 from public.matches m
                                 where m.id = match_id and public.is_team_coach(m.team_id)));
create policy "Coaches change answers" on public.availability
  for update using (exists (select 1 from public.matches m
                            where m.id = match_id and public.is_team_coach(m.team_id)));
create policy "Coaches clear answers" on public.availability
  for delete using (exists (select 1 from public.matches m
                            where m.id = match_id and public.is_team_coach(m.team_id)));

create policy "Coaches read plans" on public.match_plans
  for select using (exists (select 1 from public.matches m
                            where m.id = match_id and public.is_team_coach(m.team_id)));
create policy "Coaches add plans" on public.match_plans
  for insert with check (exists (select 1 from public.matches m
                                 where m.id = match_id and public.is_team_coach(m.team_id)));
create policy "Coaches edit plans" on public.match_plans
  for update using (exists (select 1 from public.matches m
                            where m.id = match_id and public.is_team_coach(m.team_id)))
  with check (exists (select 1 from public.matches m
                      where m.id = match_id and public.is_team_coach(m.team_id)));
create policy "Coaches delete plans" on public.match_plans
  for delete using (exists (select 1 from public.matches m
                            where m.id = match_id and public.is_team_coach(m.team_id)));

-- Check: 4 policies on each of the 5 tables, coach_teams readable, and nobody locked yet.
select tablename as what, count(*)::text as value
from pg_policies where schemaname = 'public'
  and tablename in ('teams','players','matches','availability','match_plans')
group by 1
union all
select 'app can read coach_teams', has_table_privilege('authenticated', 'public.coach_teams', 'select')::text
union all
select 'team coaches (locked)', count(*)::text from public.coach_groups where not all_teams
order by 1;
