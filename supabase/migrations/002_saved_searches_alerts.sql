-- ════════════════════════════════════════════════════════════════════════
-- Saved searches → alert-ready model.
--
-- Extends the existing `saved_searches` table (001/schema.sql) with the fields
-- scheduled alert jobs will need, WITHOUT changing how searches are stored:
-- `filters` remains ArchiveScout's normalized, marketplace-neutral filter
-- model (never marketplace-specific syntax), so a future NotificationScheduler
-- can replay a saved search through the same engine the UI uses.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

alter table public.saved_searches
  -- User-editable label. Defaults to the query at save time.
  add column if not exists name text not null default '',
  add column if not exists updated_at timestamptz not null default now(),
  -- Last time a scheduled job evaluated this search. NULL = never checked.
  add column if not exists last_checked_at timestamptz,
  add column if not exists is_notification_enabled boolean not null default false,
  -- Which alerts the user opted into: subset of ('new_listings','price_drops').
  add column if not exists notification_types text[] not null default '{}';

-- Backfill a sensible name for rows created before this migration.
update public.saved_searches
   set name = coalesce(nullif(name, ''), nullif(query, ''), 'Saved search')
 where name = '';

-- The alert sweep's access pattern: "enabled searches, least recently checked
-- first". Partial index keeps it small — most searches won't have alerts on.
create index if not exists saved_searches_alert_sweep_idx
  on public.saved_searches (last_checked_at nulls first)
  where is_notification_enabled = true;

-- A user shouldn't accumulate duplicates of the identical search. Uniqueness
-- is on the SEARCH IDENTITY (query + filters + marketplaces + sort), not the
-- name, so renaming stays free while re-saving the same search is a no-op.
create unique index if not exists saved_searches_identity_idx
  on public.saved_searches (
    user_id,
    query,
    md5(filters::text),
    md5(array_to_string(marketplaces, ',')),
    sort
  );

-- Keep updated_at honest.
create or replace function public.touch_saved_search_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists saved_searches_touch_updated_at on public.saved_searches;
create trigger saved_searches_touch_updated_at
  before update on public.saved_searches
  for each row
  execute function public.touch_saved_search_updated_at();
