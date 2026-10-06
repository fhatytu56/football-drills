-- ============================================================
-- 007: Academy age group (trains Sundays; plays like U8s/U9s)
-- Run once in Supabase → SQL Editor, BEFORE merging the new code. Safe to re-run.
-- ============================================================

-- 1. If drills.age_category / session_drills.training_day are enums, add the new values.
do $$
declare t text;
begin
  select c.udt_name into t from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'drills' and c.column_name = 'age_category';
  if exists (select 1 from pg_type where typname = t and typtype = 'e') then
    execute format('alter type %I add value if not exists %L', t, 'academy');
  end if;

  select c.udt_name into t from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'session_drills' and c.column_name = 'training_day';
  if exists (select 1 from pg_type where typname = t and typtype = 'e') then
    execute format('alter type %I add value if not exists %L', t, 'sunday');
  end if;
end $$;

-- 2. Every table that lists the age groups: add 'academy'.
do $$
declare tbl text;
begin
  foreach tbl in array array['session_drills','coach_groups','teams','players','matches','match_plans'] loop
    execute format('alter table public.%I drop constraint if exists %I', tbl, tbl || '_age_group_check');
    execute format(
      'alter table public.%I add constraint %I check (age_group in (''academy'',''u8'',''u9'',''u10'',''u11''))',
      tbl, tbl || '_age_group_check');
  end loop;
end $$;

-- 3. Sunday training.
alter table public.session_drills drop constraint if exists session_drills_training_day_check;
alter table public.session_drills
  add constraint session_drills_training_day_check
  check (training_day::text in ('tuesday','wednesday','thursday','friday','sunday'));

-- 4. Academy can have a second game on the day, like U8s/U9s.
alter table public.matches drop constraint if exists matches_second_game;
alter table public.matches add constraint matches_second_game check (
  (kickoff_2 is null and opponent_2 is null)
  or (age_group in ('academy','u8','u9') and kickoff_2 is not null and opponent_2 is not null)
);

-- 5. Eoin gets Academy too (other Academy coaches: same insert with their email).
insert into public.coach_groups (user_id, age_group)
select id, 'academy' from auth.users where email = '47cummins@gmail.com'
on conflict do nothing;

-- Check: 6 tables allow academy, Sunday allowed, who coaches Academy
select 'tables allowing academy' as what, count(*)::text as value
from pg_constraint
where contype = 'c' and conname like '%_age_group_check'
  and pg_get_constraintdef(oid) like '%academy%'
union all
select 'sunday allowed', (count(*) > 0)::text from pg_constraint
where conname = 'session_drills_training_day_check' and pg_get_constraintdef(oid) like '%sunday%'
union all
select 'academy coach', u.email from public.coach_groups c join auth.users u on u.id = c.user_id
where c.age_group = 'academy';
