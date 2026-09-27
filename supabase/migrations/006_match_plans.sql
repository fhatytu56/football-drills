-- ============================================================
-- 006: Sub plans — one per match, shared by that age group's coaches
-- Run once in Supabase → SQL Editor, BEFORE merging the new code. Safe to re-run.
-- ============================================================

-- lets match_plans point at (match, age group) so a plan can't sit in the wrong group
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'matches_id_age_group_key') then
    alter table public.matches add constraint matches_id_age_group_key unique (id, age_group);
  end if;
end $$;

create table if not exists public.match_plans (
  match_id uuid primary key,
  age_group text not null check (age_group in ('u8','u9','u10','u11')),
  here uuid[] not null default '{}',            -- players expected
  lineup jsonb not null default '{}',           -- {"gk": "<player id>", "lb": ...}
  bench uuid[] not null default '{}',
  sub_gap smallint not null check (sub_gap between 1 and 25),
  subs jsonb not null default '[]'              -- [{"on": "<id>", "off": "<id>"}, ...]
    check (jsonb_typeof(subs) = 'array' and jsonb_array_length(subs) <= 60),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  foreign key (match_id, age_group) references public.matches (id, age_group) on delete cascade,
  check (jsonb_typeof(lineup) = 'object')
);

alter table public.match_plans enable row level security;
grant select, insert, update, delete on public.match_plans to authenticated;

do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'match_plans'
  loop
    execute format('drop policy %I on public.match_plans', r.policyname);
  end loop;
end $$;

create policy "Group coaches read plans" on public.match_plans
  for select using (public.is_group_coach(age_group));
create policy "Group coaches add plans" on public.match_plans
  for insert with check (public.is_group_coach(age_group));
create policy "Group coaches edit plans" on public.match_plans
  for update using (public.is_group_coach(age_group))
  with check (public.is_group_coach(age_group));
create policy "Group coaches delete plans" on public.match_plans
  for delete using (public.is_group_coach(age_group));

-- Check: 4 policies, and signed-in users can reach the table
select count(*) as policies,
       has_table_privilege('authenticated', 'public.match_plans', 'insert') as app_can_save
from pg_policies where schemaname = 'public' and tablename = 'match_plans';
