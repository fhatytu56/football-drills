-- ============================================================
-- 005: Positions with sides + goalkeeper (U10s/U11s, 7-a-side)
--      GK, LB, RB, LM, CM, RM, ST — main + second, max 2
-- Run once in Supabase → SQL Editor, BEFORE merging the new code. Safe to re-run.
-- ============================================================

alter table public.players drop constraint if exists players_positions_valid;

-- Old DEF / MID had no side, so they can't be mapped. Drop them and keep the rest
-- (ST stays ST). Those players show "Set positions" again.
update public.players p
set positions = coalesce((
  select array_agg(x order by i)
  from unnest(p.positions) with ordinality as u(x, i)
  where x in ('gk','lb','rb','lm','cm','rm','st')
), '{}')
where not (positions <@ array['gk','lb','rb','lm','cm','rm','st']::text[]);

alter table public.players add constraint players_positions_valid check (
  positions <@ array['gk','lb','rb','lm','cm','rm','st']::text[]
  and cardinality(positions) <= 2
  and (cardinality(positions) < 2 or positions[1] <> positions[2])
  and (age_group in ('u10','u11') or cardinality(positions) = 0)
);

-- Check: players per number of positions set (0 = still to set)
select cardinality(positions) as positions_set, count(*) as players
from public.players where age_group in ('u10','u11')
group by 1 order by 1;
