-- ============================================================================
-- ArchiveScout — Supabase / PostgreSQL schema
-- ----------------------------------------------------------------------------
-- Run this in the Supabase SQL editor (or via the CLI) to provision the tables
-- backing favorites, saved searches, and recent searches. Auth is handled by
-- Supabase's built-in `auth.users`. Row Level Security ensures each user can
-- only ever read/write their own rows.
--
-- The app runs fully WITHOUT this schema (data falls back to local storage);
-- applying it enables cross-device sync once auth is configured.
-- ============================================================================

-- Needed for gen_random_uuid()
create extension if not exists pgcrypto;

-- ─────────────────────────── favorites ───────────────────────────
create table if not exists public.favorites (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  listing_id   text not null,               -- ArchiveScout id: "marketplace:externalId"
  marketplace  text not null check (marketplace in ('ebay', 'grailed')),
  listing      jsonb not null,              -- normalized Listing snapshot
  created_at   timestamptz not null default now(),
  unique (user_id, listing_id)
);

create index if not exists favorites_user_created_idx
  on public.favorites (user_id, created_at desc);

-- ─────────────────────────── saved_searches ───────────────────────────
create table if not exists public.saved_searches (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  query              text not null default '',
  marketplaces       text[] not null default '{ebay,grailed}',
  filters            jsonb not null default '{}'::jsonb,
  sort               text not null default 'recommended',
  max_desired_price  numeric,
  price_alert        boolean not null default false,
  created_at         timestamptz not null default now()
);

create index if not exists saved_searches_user_created_idx
  on public.saved_searches (user_id, created_at desc);

-- Speeds up the (future) price-alert sweep job.
create index if not exists saved_searches_price_alert_idx
  on public.saved_searches (price_alert) where price_alert = true;

-- ─────────────────────────── recent_searches ───────────────────────────
create table if not exists public.recent_searches (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  query         text not null,
  marketplaces  text[] not null default '{ebay,grailed}',
  created_at    timestamptz not null default now()
);

create index if not exists recent_searches_user_created_idx
  on public.recent_searches (user_id, created_at desc);

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.favorites       enable row level security;
alter table public.saved_searches  enable row level security;
alter table public.recent_searches enable row level security;

-- favorites
drop policy if exists favorites_owner_only on public.favorites;
create policy favorites_owner_only
  on public.favorites
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- saved_searches
drop policy if exists saved_searches_owner_only on public.saved_searches;
create policy saved_searches_owner_only
  on public.saved_searches
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- recent_searches
drop policy if exists recent_searches_owner_only on public.recent_searches;
create policy recent_searches_owner_only
  on public.recent_searches
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================================
-- Optional: cap recent searches to the latest 20 per user via a trigger.
-- ============================================================================
create or replace function public.trim_recent_searches()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.recent_searches
  where user_id = new.user_id
    and id not in (
      select id from public.recent_searches
      where user_id = new.user_id
      order by created_at desc
      limit 20
    );
  return new;
end;
$$;

drop trigger if exists trim_recent_searches_trg on public.recent_searches;
create trigger trim_recent_searches_trg
  after insert on public.recent_searches
  for each row execute function public.trim_recent_searches();
