-- ============================================================
-- 011: U10 manager game — one secret game link per team
--
-- Kids open /game/<token> on their own phone. No login.
-- Like the parents' RSVP link: the token is the only way in, and the function below
-- returns first names + positions for that one team, plus the U10 Tue/Thu plan.
-- Nothing else about the squad (no matches, no parents' answers).
--
-- Run once in Supabase → SQL Editor, BEFORE merging the new code. Safe to re-run.
-- ============================================================

-- 1. A game token per team (32 hex chars, unguessable). Existing teams get one now.
alter table public.teams
  add column if not exists game_token text not null default replace(gen_random_uuid()::text, '-', '');
create unique index if not exists teams_game_token_key on public.teams(game_token);

-- 2. Everything the game needs, for one U10 team, by token.
create or replace function public.game_team(p_token text)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'team', t.name,
    'age_group', t.age_group,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'first_name', p.first_name, 'positions', p.positions)
                       order by p.first_name)
      from public.players p where p.team_id = t.id), '[]'::jsonb),
    -- this week's plan: the drills on Tuesday and Thursday, in plan order
    'plan', coalesce((
      select jsonb_agg(jsonb_build_object(
               'day', s.training_day::text,
               'drill_id', d.id, 'title', d.title, 'game_phase', d.game_phase::text,
               'equipment', coalesce(d.equipment_needed, '{}'), 'thumbnail_url', d.thumbnail_url)
             order by s.created_at)
      from public.session_drills s join public.drills d on d.id = s.drill_id
      where s.age_group = t.age_group and s.training_day::text in ('tuesday','thursday')), '[]'::jsonb),
    -- the whole U10 library, for the wrong answers in the quiz
    'library', coalesce((
      select jsonb_agg(jsonb_build_object(
               'drill_id', d.id, 'title', d.title, 'game_phase', d.game_phase::text,
               'equipment', coalesce(d.equipment_needed, '{}')))
      from public.drills d
      where d.age_category::text = t.age_group and not coalesce(d.is_flagged, false)), '[]'::jsonb))
  from public.teams t
  where t.game_token = p_token and t.age_group = 'u10';
$$;

revoke all on function public.game_team(text) from public;
grant execute on function public.game_team(text) to anon, authenticated;

-- Check: every team has a token, and the function exists.
select
  (select count(*) from public.teams where game_token is null) as teams_without_token,
  (select count(*) from pg_proc where proname = 'game_team' and pronamespace = 'public'::regnamespace) as functions;
