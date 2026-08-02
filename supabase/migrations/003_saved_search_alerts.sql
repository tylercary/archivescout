-- ════════════════════════════════════════════════════════════════════════
-- Saved-search alerts: listing snapshots + alert events.
--
-- The sweep runs under the SERVICE ROLE (server-only, bypasses RLS). These
-- policies exist for the BROWSER: a signed-in user may READ their own rows and
-- nothing else. No user-facing INSERT/UPDATE/DELETE policy is defined, so the
-- browser cannot fabricate an alert or tamper with price history even for its
-- own searches — that data is only ever written by the job.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

-- ─────────────────── saved_search_listing_snapshots ───────────────────
-- One row per (saved search × marketplace × listing). This is the memory that
-- makes "new" and "cheaper than before" answerable.
create table if not exists public.saved_search_listing_snapshots (
  id                   uuid primary key default gen_random_uuid(),
  saved_search_id      uuid not null references public.saved_searches (id) on delete cascade,
  marketplace          text not null,
  external_listing_id  text not null,
  last_price           numeric,
  currency             text not null default 'USD',
  first_seen_at        timestamptz not null default now(),
  last_seen_at         timestamptz not null default now(),
  -- The price we last ALERTED on. Distinct from last_price: it is what stops
  -- a standing $450 from re-notifying on every sweep.
  last_notified_price  numeric,
  is_active            boolean not null default true,
  listing_snapshot     jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Snapshot identity. Also the ON CONFLICT target the sweep upserts against,
-- which is what makes a re-run idempotent rather than duplicating history.
create unique index if not exists saved_search_snapshots_identity_idx
  on public.saved_search_listing_snapshots
     (saved_search_id, marketplace, external_listing_id);

create index if not exists saved_search_snapshots_search_idx
  on public.saved_search_listing_snapshots (saved_search_id);

-- ───────────────────── saved_search_alert_events ─────────────────────
create table if not exists public.saved_search_alert_events (
  id                   uuid primary key default gen_random_uuid(),
  saved_search_id      uuid not null references public.saved_searches (id) on delete cascade,
  -- Denormalized so RLS and digest queries don't need a join to saved_searches.
  user_id              uuid not null references auth.users (id) on delete cascade,
  event_type           text not null check (event_type in ('new_listing', 'price_drop')),
  marketplace          text not null,
  external_listing_id  text not null,
  previous_price       numeric,
  current_price        numeric,
  currency             text not null default 'USD',
  listing_snapshot     jsonb not null default '{}'::jsonb,
  -- The idempotency key. Shape (built in code, see alert-sweep.ts):
  --   new_listing : <search>:new:<marketplace>:<listing>
  --   price_drop  : <search>:drop:<marketplace>:<listing>:<current_price>
  -- Including the price means a SECOND drop is a genuinely new key, while a
  -- repeat of the same price collides and is rejected.
  dedupe_key           text not null,
  delivery_status      text not null default 'pending'
                       check (delivery_status in ('pending', 'sent', 'failed', 'skipped')),
  created_at           timestamptz not null default now(),
  delivered_at         timestamptz
);

-- The heart of idempotency: a retried sweep inserts the same key and gets
-- 23505 instead of a second email.
create unique index if not exists saved_search_alert_events_dedupe_idx
  on public.saved_search_alert_events (dedupe_key);

-- Digest query: this user's undelivered events.
create index if not exists saved_search_alert_events_pending_idx
  on public.saved_search_alert_events (user_id, delivery_status, created_at)
  where delivery_status = 'pending';

-- ─────────────────────────── sweep leasing ───────────────────────────
-- Prevents two overlapping cron runs from processing the same search. A lease
-- is a timestamp in the future; another worker skips searches already leased.
alter table public.saved_searches
  add column if not exists alert_lease_until timestamptz,
  add column if not exists alert_lease_owner text;

-- ────────────────────────────── RLS ──────────────────────────────
alter table public.saved_search_listing_snapshots enable row level security;
alter table public.saved_search_alert_events      enable row level security;

-- READ-ONLY for users, scoped through the parent saved search's owner.
drop policy if exists snapshots_owner_read on public.saved_search_listing_snapshots;
create policy snapshots_owner_read
  on public.saved_search_listing_snapshots
  for select
  using (
    exists (
      select 1 from public.saved_searches s
       where s.id = saved_search_id
         and s.user_id = auth.uid()
    )
  );

-- user_id is denormalized, but the parent is ALSO checked: a forged user_id
-- can't grant access to a search the requester doesn't own.
drop policy if exists alert_events_owner_read on public.saved_search_alert_events;
create policy alert_events_owner_read
  on public.saved_search_alert_events
  for select
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.saved_searches s
       where s.id = saved_search_id
         and s.user_id = auth.uid()
    )
  );

-- Keep updated_at honest on snapshots.
-- Redefined here (create or replace, identical to 002) so this migration does
-- not DEPEND on 002 having been applied. The SQL editor runs the whole script
-- in one transaction: a missing function at the very bottom would abort it and
-- silently roll back every table above, which looks like nothing ran at all.
create or replace function public.touch_saved_search_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists snapshots_touch_updated_at on public.saved_search_listing_snapshots;
create trigger snapshots_touch_updated_at
  before update on public.saved_search_listing_snapshots
  for each row
  execute function public.touch_saved_search_updated_at();

-- ─────────────────────── confirm it actually landed ───────────────────────
-- PostgREST serves the API from a cached schema. Without this nudge the new
-- tables can 404 (PGRST205) for a while even though they exist.
notify pgrst, 'reload schema';

-- Runs last so the editor's result pane IS the confirmation: expect two rows.
-- No rows means the script rolled back — read the error, don't re-run blindly.
select table_name
  from information_schema.tables
 where table_schema = 'public'
   and table_name in ('saved_search_listing_snapshots', 'saved_search_alert_events')
 order by table_name;
