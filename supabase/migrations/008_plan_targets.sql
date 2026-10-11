-- ============================================================
-- 008: Sub plans get sub windows and game-time targets
--   schedule: {"firstAt": 10, "firstCount": 2, "every": 5, "per": 1}
--   targets:  {"<player id>": 40, ...}  (% of the day's playing time; missing = Auto)
-- Run once in Supabase → SQL Editor, BEFORE merging the new code. Safe to re-run.
-- Plans saved before this keep working: no schedule = one sub every sub_gap minutes.
-- ============================================================

alter table public.match_plans add column if not exists schedule jsonb;
alter table public.match_plans add column if not exists targets jsonb not null default '{}';

alter table public.match_plans drop constraint if exists match_plans_schedule_check;
alter table public.match_plans add constraint match_plans_schedule_check
  check (schedule is null or jsonb_typeof(schedule) = 'object');

alter table public.match_plans drop constraint if exists match_plans_targets_check;
alter table public.match_plans add constraint match_plans_targets_check
  check (jsonb_typeof(targets) = 'object');

-- Check: both columns there, and signed-in users can still save
select count(*) as new_columns,
       has_table_privilege('authenticated', 'public.match_plans', 'update') as app_can_save
from information_schema.columns
where table_schema = 'public' and table_name = 'match_plans' and column_name in ('schedule', 'targets');
