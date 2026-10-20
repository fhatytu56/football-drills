-- ============================================================
-- 010: U9 Girls age group ('u9g': trains Tue & Thu; plays like U9s)
-- Run once in Supabase → SQL Editor, BEFORE merging the new code. Safe to re-run.
-- Paste it from this file, not from chat (chat can strip the $$ quoting).
--
-- Also lets a team move between age groups: a team's players, matches and
-- sub plans now follow it when teams.age_group changes (used to move 9.6 Girls
-- out of U9s). Changes nothing on its own.
-- ============================================================

-- 1. If drills.age_category is an enum, add the new value.
--    (New enum values can't be used until this has run, so starter drills are copied in a second run.)
do $$
declare t text;
begin
  select c.udt_name into t from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'drills' and c.column_name = 'age_category';
  if exists (select 1 from pg_type where typname = t and typtype = 'e') then
    execute format('alter type %I add value if not exists %L', t, 'u9g');
  end if;
end $$;

-- 2. Every table that lists the age groups: add 'u9g'.
do $$
declare tbl text;
begin
  foreach tbl in array array['session_drills','coach_groups','teams','players','matches','match_plans'] loop
    execute format('alter table public.%I drop constraint if exists %I', tbl, tbl || '_age_group_check');
    execute format(
      'alter table public.%I add constraint %I check (age_group in (''academy'',''u8'',''u9'',''u9g'',''u10'',''u11''))',
      tbl, tbl || '_age_group_check');
  end loop;
end $$;

-- 3. U9 Girls can have a second game on the day, like U8s/U9s/Academy.
alter table public.matches drop constraint if exists matches_second_game;
alter table public.matches add constraint matches_second_game check (
  (kickoff_2 is null and opponent_2 is null)
  or (age_group in ('academy','u8','u9','u9g') and kickoff_2 is not null and opponent_2 is not null)
);

-- 4. When a team changes age group, its players and matches follow it, and the
--    matches' sub plans follow them. (Same links as before, plus "on update cascade".)
do $$
declare r record;
begin
  for r in
    select con.conname, rel.relname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    join pg_class ref on ref.oid = con.confrelid
    where n.nspname = 'public' and con.contype = 'f'
      and (   (rel.relname in ('players','matches') and ref.relname = 'teams')
           or (rel.relname = 'match_plans' and ref.relname = 'matches'))
      and array_length(con.conkey, 1) = 2
  loop
    execute format('alter table public.%I drop constraint %I', r.relname, r.conname);
  end loop;
end $$;

alter table public.players add constraint players_team_id_age_group_fkey
  foreign key (team_id, age_group) references public.teams (id, age_group)
  on update cascade on delete set null (team_id);

alter table public.matches add constraint matches_team_id_age_group_fkey
  foreign key (team_id, age_group) references public.teams (id, age_group)
  on update cascade on delete cascade;

alter table public.match_plans add constraint match_plans_match_id_age_group_fkey
  foreign key (match_id, age_group) references public.matches (id, age_group)
  on update cascade on delete cascade;

-- 5. Eoin coordinates U9 Girls (team coaches are linked by a separate script).
insert into public.coach_groups (user_id, age_group, all_teams)
select id, 'u9g', true from auth.users where email = '47cummins@gmail.com'
on conflict (user_id, age_group) do update set all_teams = true;

-- Check: 6 tables allow u9g, second game allowed, 3 links follow their team, U9 Girls coordinator
select 'tables allowing u9g' as what, count(*)::text as value
from pg_constraint
where contype = 'c' and conname like '%_age_group_check'
  and pg_get_constraintdef(oid) like '%u9g%'
union all
select 'u9g second game', (count(*) > 0)::text from pg_constraint
where conname = 'matches_second_game' and pg_get_constraintdef(oid) like '%u9g%'
union all
select 'links follow team', count(*)::text from pg_constraint
where contype = 'f' and confupdtype = 'c'
  and conname in ('players_team_id_age_group_fkey','matches_team_id_age_group_fkey','match_plans_match_id_age_group_fkey')
union all
select 'u9g coordinator', u.email from public.coach_groups c join auth.users u on u.id = c.user_id
where c.age_group = 'u9g' and c.all_teams;
