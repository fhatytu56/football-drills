-- ============================================
-- MIGRATION: Full schema (run once, in order, in Supabase SQL Editor)
-- ============================================

create extension if not exists "pgcrypto";

create type age_category as enum (
  'u6','u7','u8','u9','u10','u11','u12','u13','u14','u15','u16','u17','u18'
);
create type game_phase as enum (
  'attacking','defending','transition_attack','transition_defense',
  'possession','set_pieces','goalkeeping','warmup','conditioning'
);
create type platform_type as enum ('youtube','vimeo','instagram','tiktok','other');

create table drills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  title text not null,
  url text not null,
  platform platform_type not null default 'other',
  thumbnail_url text,
  age_category age_category not null,
  game_phase game_phase not null,
  player_count_min smallint not null default 1,
  player_count_max smallint not null default 1,
  equipment_needed text[],
  is_flagged boolean not null default false,
  flag_reason text,
  flagged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint player_count_valid check (player_count_max >= player_count_min)
);

alter table drills add column search_vector tsvector
  generated always as (to_tsvector('english', coalesce(title, ''))) stored;

create table tags (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table drill_tags (
  drill_id uuid not null references drills(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  primary key (drill_id, tag_id)
);

create table drill_reports (
  id uuid primary key default gen_random_uuid(),
  drill_id uuid not null references drills(id) on delete cascade,
  reported_by uuid references auth.users(id) on delete set null,
  reason text not null,
  created_at timestamptz not null default now()
);

-- Indexes
create index idx_drills_age_category on drills(age_category);
create index idx_drills_game_phase on drills(game_phase);
create index idx_drills_player_range on drills(player_count_min, player_count_max);
create index idx_drills_user_id on drills(user_id);
create index idx_drills_created_at on drills(created_at desc);
create index idx_drills_age_phase on drills(age_category, game_phase);
create index idx_drills_equipment_gin on drills using gin(equipment_needed);
create index idx_drills_search on drills using gin(search_vector);
create index idx_tags_slug on tags(slug);
create index idx_drill_tags_tag_id on drill_tags(tag_id);
create index idx_drill_tags_drill_id on drill_tags(drill_id);
create index idx_drill_reports_drill_id on drill_reports(drill_id);

-- updated_at trigger
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_drills_updated_at
before update on drills
for each row execute function set_updated_at();

-- RLS
alter table drills enable row level security;
alter table tags enable row level security;
alter table drill_tags enable row level security;
alter table drill_reports enable row level security;

create policy "Public read unflagged drills" on drills
  for select using (is_flagged = false or auth.uid() = user_id);
create policy "Users insert own drills" on drills
  for insert with check (auth.uid() = user_id);
create policy "Users update own drills" on drills
  for update using (auth.uid() = user_id);
create policy "Users delete own drills" on drills
  for delete using (auth.uid() = user_id);

create policy "Public read tags" on tags for select using (true);
create policy "Public read drill_tags" on drill_tags for select using (true);

create policy "Authenticated users can report" on drill_reports
  for insert with check (auth.uid() is not null);
create policy "Users can view own reports" on drill_reports
  for select using (auth.uid() = reported_by);

-- RPC: filtered/paginated drill search
create or replace function filter_drills(
  p_age text default null,
  p_phase text default null,
  p_tag_ids uuid[] default null,
  p_search text default null,
  p_limit int default 24,
  p_offset int default 0
)
returns table (
  id uuid, title text, url text, platform text, thumbnail_url text,
  age_category text, game_phase text, player_count_min smallint,
  player_count_max smallint, equipment_needed text[],
  created_at timestamptz, total_count bigint
)
language sql stable
as $$
  with matched as (
    select
      d.id,
      d.title,
      d.url,
      d.platform::text as platform,
      d.thumbnail_url,
      d.age_category::text as age_category,
      d.game_phase::text as game_phase,
      d.player_count_min,
      d.player_count_max,
      d.equipment_needed,
      d.created_at
    from drills d
    where (p_age is null or d.age_category = p_age::age_category)
      and (p_phase is null or d.game_phase = p_phase::game_phase)
      and (p_search is null or d.search_vector @@ websearch_to_tsquery('english', p_search))
      and (
        p_tag_ids is null or array_length(p_tag_ids, 1) is null or (
          select count(distinct dt.tag_id) from drill_tags dt
          where dt.drill_id = d.id and dt.tag_id = any(p_tag_ids)
        ) = array_length(p_tag_ids, 1)
      )
  )
  select m.*, count(*) over() as total_count
  from matched m
  order by m.created_at desc
  limit p_limit offset p_offset;
$$;
