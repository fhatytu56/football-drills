-- ============================================================
-- 002: Age groups (U8, U9, U10, U11) + coach login per group
-- Run once in Supabase → SQL Editor, BEFORE deploying the new code.
-- Safe to re-run. Existing drills and session items stay in U10.
-- ============================================================

-- 1. Make sure the enum types (if the columns use enums) accept the new values.
do $$
declare
  t text;
  v text;
begin
  -- drills.age_category
  select c.udt_name into t from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'drills' and c.column_name = 'age_category';
  if exists (select 1 from pg_type where typname = t and typtype = 'e') then
    foreach v in array array['u8','u9','u10','u11'] loop
      execute format('alter type %I add value if not exists %L', t, v);
    end loop;
  end if;

  -- session_drills.training_day
  select c.udt_name into t from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'session_drills' and c.column_name = 'training_day';
  if exists (select 1 from pg_type where typname = t and typtype = 'e') then
    foreach v in array array['tuesday','wednesday','thursday','friday'] loop
      execute format('alter type %I add value if not exists %L', t, v);
    end loop;
  end if;
end $$;

-- 2. Drop any old CHECK constraint on session_drills.training_day that only allows tue/thu.
do $$
declare r record;
begin
  for r in
    select con.conname from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'public' and rel.relname = 'session_drills' and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%training_day%'
  loop
    execute format('alter table public.session_drills drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.session_drills
  add constraint session_drills_training_day_check
  check (training_day::text in ('tuesday','wednesday','thursday','friday'));

-- 3. Session items belong to an age group. Existing ones are U10.
alter table public.session_drills add column if not exists age_group text;
update public.session_drills set age_group = 'u10' where age_group is null;
alter table public.session_drills alter column age_group set not null;
alter table public.session_drills drop constraint if exists session_drills_age_group_check;
alter table public.session_drills
  add constraint session_drills_age_group_check check (age_group in ('u8','u9','u10','u11'));
create index if not exists idx_session_drills_group_day on public.session_drills(age_group, training_day);

-- 4. Which coach can edit which group. Add rows by hand (see README "Coach accounts").
create table if not exists public.coach_groups (
  user_id uuid not null references auth.users(id) on delete cascade,
  age_group text not null check (age_group in ('u8','u9','u10','u11')),
  created_at timestamptz not null default now(),
  primary key (user_id, age_group)
);
alter table public.coach_groups enable row level security;
drop policy if exists "Coaches read own groups" on public.coach_groups;
create policy "Coaches read own groups" on public.coach_groups
  for select using (auth.uid() = user_id);
-- No insert/update/delete policies: only the Supabase dashboard can change coach access.

create or replace function public.is_group_coach(g text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.coach_groups
    where user_id = auth.uid() and age_group = g
  );
$$;

-- 5. Replace ALL existing policies on drills + session_drills with group-based ones.
do $$
declare r record;
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('drills','session_drills')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

alter table public.drills enable row level security;
alter table public.session_drills enable row level security;

-- Everyone can view. Only that group's coaches can change.
create policy "Anyone reads drills" on public.drills
  for select using (true);
create policy "Group coaches add drills" on public.drills
  for insert with check (public.is_group_coach(age_category::text));
create policy "Group coaches edit drills" on public.drills
  for update using (public.is_group_coach(age_category::text))
  with check (public.is_group_coach(age_category::text));
create policy "Group coaches delete drills" on public.drills
  for delete using (public.is_group_coach(age_category::text));

create policy "Anyone reads sessions" on public.session_drills
  for select using (true);
create policy "Group coaches add to sessions" on public.session_drills
  for insert with check (
    public.is_group_coach(age_group)
    and exists (select 1 from public.drills d
                where d.id = drill_id and d.age_category::text = age_group)
  );
create policy "Group coaches edit sessions" on public.session_drills
  for update using (public.is_group_coach(age_group))
  with check (public.is_group_coach(age_group));
create policy "Group coaches remove from sessions" on public.session_drills
  for delete using (public.is_group_coach(age_group));

-- 6. Quick check — should show your drills per group and session items per group/day.
select 'drills' as what, age_category::text as grp, null as day, count(*) from public.drills group by 2
union all
select 'sessions', age_group, training_day::text, count(*) from public.session_drills group by 2, 3
order by 1, 2, 3;
