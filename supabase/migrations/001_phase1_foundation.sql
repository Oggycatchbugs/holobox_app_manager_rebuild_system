-- TLC HoloBox Manager - Phase 1 foundation
-- Run once in Supabase SQL Editor before the first Render deploy.

create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text not null default '',
  phone text not null default '',
  email text not null default '',
  status text not null default 'active' check (status in ('active','inactive','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete restrict,
  username text not null,
  password_hash text not null,
  display_name text not null default '',
  role text not null check (role in ('platform_admin','company_operator')),
  language text not null default 'vi' check (language in ('vi','en')),
  active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create unique index if not exists users_username_lower_uidx on public.users(lower(username)) where archived_at is null;

create table if not exists public.playlists (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null default 'Active Ads Playlist',
  type text not null default 'advertisement' check (type in ('advertisement','audio')),
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create unique index if not exists one_active_ad_playlist_per_org
  on public.playlists(organization_id)
  where type = 'advertisement' and is_active = true and archived_at is null;

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  device_code text not null,
  name text not null,
  location_name text not null default '',
  stream_url text not null default '',
  desired_power_state text not null default 'OFF' check (desired_power_state in ('ON','OFF')),
  desired_mode text not null default 'ASSISTANT' check (desired_mode in ('ASSISTANT','ADS_ONLY')),
  active_playlist_id uuid references public.playlists(id) on delete set null,
  sync_requested_at timestamptz,
  status text not null default 'active' check (status in ('active','inactive','decommissioned','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create unique index if not exists devices_code_lower_uidx on public.devices(lower(device_code)) where archived_at is null;
create index if not exists devices_org_idx on public.devices(organization_id);

create table if not exists public.device_credentials (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  token_hash text not null unique,
  token_prefix text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists device_credentials_device_idx on public.device_credentials(device_id);

create table if not exists public.device_reported_states (
  device_id uuid primary key references public.devices(id) on delete cascade,
  reported_at timestamptz not null default now(),
  runtime_state text not null default 'UNKNOWN',
  applied_power_state text not null default 'UNKNOWN',
  applied_mode text not null default 'UNKNOWN',
  camera_status text not null default 'UNKNOWN',
  arm_status text not null default 'NOT_CONFIGURED',
  door_status text not null default 'NOT_CONFIGURED',
  model_status text not null default 'UNKNOWN',
  sync_status text not null default 'UNKNOWN',
  app_version text not null default '',
  installed_manifest_version bigint not null default 0,
  current_media_id uuid,
  current_media_name text not null default '',
  current_audio_name text not null default '',
  person_detected boolean not null default false,
  storage_free_mb bigint,
  last_error text not null default '',
  telemetry jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  kind text not null check (kind in ('advertisement_video','advertisement_image','system_audio')),
  name text not null,
  storage_path text not null unique,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0,
  checksum_sha256 text not null default '',
  duration_seconds numeric not null default 0,
  role_key text not null default '',
  status text not null default 'active' check (status in ('active','archived','error')),
  uploaded_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create unique index if not exists media_org_name_lower_uidx
  on public.media_assets(organization_id, lower(name)) where archived_at is null;
create index if not exists media_org_kind_idx on public.media_assets(organization_id, kind);

create table if not exists public.playlist_items (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  media_asset_id uuid not null references public.media_assets(id) on delete cascade,
  sort_order integer not null default 1,
  created_at timestamptz not null default now(),
  unique(playlist_id, media_asset_id),
  unique(playlist_id, sort_order)
);
create index if not exists playlist_items_playlist_idx on public.playlist_items(playlist_id, sort_order);

create table if not exists public.device_manifests (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  version bigint not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  unique(device_id, version)
);
create index if not exists device_manifests_latest_idx on public.device_manifests(device_id, version desc);

create table if not exists public.assistant_scripts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  script_key text not null,
  title text not null,
  language text not null default 'vi' check (language in ('vi','en')),
  text_content text not null,
  audio_media_id uuid references public.media_assets(id) on delete set null,
  enabled boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists assistant_scripts_org_idx on public.assistant_scripts(organization_id);

create table if not exists public.device_events (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  event_type text not null,
  severity text not null default 'INFO' check (severity in ('INFO','SUCCESS','WARNING','ERROR')),
  module text not null default 'RUNTIME',
  message text not null default '',
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  received_at timestamptz not null default now()
);
create index if not exists device_events_device_time_idx on public.device_events(device_id, occurred_at desc);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null check (actor_type in ('user','device','system')),
  actor_id uuid,
  organization_id uuid references public.organizations(id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_time_idx on public.audit_logs(created_at desc);
create index if not exists audit_logs_org_idx on public.audit_logs(organization_id, created_at desc);

create table if not exists public.app_settings (
  id text primary key default 'main',
  system_name text not null default 'TLC HoloBox Manager',
  default_language text not null default 'vi',
  maintenance_phone text not null default '090x xxx xxx',
  maintenance_email text not null default 'support@tlc.vn',
  maintenance_zalo text not null default '',
  offline_warning_seconds integer not null default 45,
  offline_timeout_seconds integer not null default 90,
  updated_at timestamptz not null default now()
);
insert into public.app_settings(id) values ('main') on conflict (id) do nothing;

-- Transactional playlist reorder helper.
create or replace function public.replace_playlist_items(p_playlist_id uuid, p_media_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_media_id uuid;
  v_order integer := 1;
begin
  delete from public.playlist_items where playlist_id = p_playlist_id;
  foreach v_media_id in array coalesce(p_media_ids, array[]::uuid[]) loop
    insert into public.playlist_items(playlist_id, media_asset_id, sort_order)
    values (p_playlist_id, v_media_id, v_order);
    v_order := v_order + 1;
  end loop;
end;
$$;

-- Private media bucket. Server-side service role bypasses Storage RLS.
insert into storage.buckets (id, name, public, file_size_limit)
values ('holobox-media', 'holobox-media', false, 262144000)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- Keep the old demo table untouched for backup/migration reference.
-- The Phase 1 app does not read or write holobox_state.

-- Lock all public tables behind the service-role backend.
alter table public.organizations enable row level security;
alter table public.users enable row level security;
alter table public.playlists enable row level security;
alter table public.devices enable row level security;
alter table public.device_credentials enable row level security;
alter table public.device_reported_states enable row level security;
alter table public.media_assets enable row level security;
alter table public.playlist_items enable row level security;
alter table public.device_manifests enable row level security;
alter table public.assistant_scripts enable row level security;
alter table public.device_events enable row level security;
alter table public.audit_logs enable row level security;
alter table public.app_settings enable row level security;

revoke all on function public.replace_playlist_items(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.replace_playlist_items(uuid, uuid[]) to service_role;
