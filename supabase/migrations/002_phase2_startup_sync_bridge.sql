-- Phase 2 startup media sync bridge
-- Run this migration before deploying the matching Manager patch.

alter table public.devices
  add column if not exists default_language text not null default 'vi';

alter table public.devices
  drop constraint if exists devices_default_language_check;

alter table public.devices
  add constraint devices_default_language_check
  check (default_language in ('vi','en'));

alter table public.media_assets
  add column if not exists purge_after timestamptz;

create index if not exists media_assets_purge_after_idx
  on public.media_assets(purge_after)
  where status = 'archived' and purge_after is not null;
