-- Client Intelligence Engine — shared platform + canonical store (Supabase/Postgres).
-- Additive and idempotent. Safe to run on the existing engine database.
-- The apps write via the service role (server-side), which bypasses RLS; RLS is
-- enabled with no public policies so the anon/public API can read nothing.

-- ---------- Canonical clients (already used by the engine) ----------
create table if not exists canonical_clients (
  tenant_id  text not null,
  id         text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id)
);
create index if not exists canonical_clients_tenant_idx on canonical_clients (tenant_id);

create table if not exists engine_reports (
  tenant_id  text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------- Platform: tenants ----------
create table if not exists tenants (
  id         text primary key,
  slug       text not null unique,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------- Platform: memberships (user ↔ tenant ↔ app) ----------
create table if not exists tenant_memberships (
  tenant_id  text not null,
  user_id    text not null,
  app_key    text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id, app_key)
);
create index if not exists tenant_memberships_user_idx on tenant_memberships (user_id);

-- ---------- Platform: app registry + installations ----------
create table if not exists app_definitions (
  key        text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists tenant_app_installations (
  tenant_id  text not null,
  app_key    text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, app_key)
);

-- ---------- Platform: audit log ----------
create table if not exists audit_events (
  id          text primary key,
  tenant_id   text not null,
  occurred_at timestamptz not null default now(),
  data        jsonb not null
);
create index if not exists audit_events_tenant_time_idx on audit_events (tenant_id, occurred_at desc);

-- ---------- Lock down the public API surface (service role bypasses RLS) ----------
alter table canonical_clients        enable row level security;
alter table engine_reports           enable row level security;
alter table tenants                  enable row level security;
alter table tenant_memberships       enable row level security;
alter table app_definitions          enable row level security;
alter table tenant_app_installations enable row level security;
alter table audit_events             enable row level security;

-- ---------- Optional seed for the Map Ranking tenant + live apps ----------
-- Run once to register the canonical tenant and activate MTOS + SEOOS.
-- (Data is stored in the `data` jsonb to match the app record shapes.)
insert into tenants (id, slug, data, updated_at) values (
  'map-ranking', 'map-ranking',
  jsonb_build_object(
    'schemaVersion', 1, 'id', 'map-ranking', 'slug', 'map-ranking',
    'displayName', 'Map Ranking', 'status', 'active',
    'branding', jsonb_build_object('terminology', '{}'::jsonb),
    'timezone', 'America/New_York', 'locale', 'en-US',
    'featureFlags', '{}'::jsonb,
    'createdAt', now(), 'updatedAt', now()
  ),
  now()
) on conflict (id) do nothing;

insert into app_definitions (key, data, updated_at) values
  ('mtos',  jsonb_build_object('schemaVersion',1,'key','mtos','name','MTOS','description','Account management & client communication.','status','available','version',1,'createdAt',now(),'updatedAt',now()), now()),
  ('seoos', jsonb_build_object('schemaVersion',1,'key','seoos','name','SEOOS','description','SEO operations & delivery.','status','available','version',1,'createdAt',now(),'updatedAt',now()), now())
on conflict (key) do nothing;

insert into tenant_app_installations (tenant_id, app_key, data, updated_at) values
  ('map-ranking','mtos',  jsonb_build_object('schemaVersion',1,'id','map-ranking:mtos','tenantId','map-ranking','appKey','mtos','enabled',true,'config','{}'::jsonb,'enabledAt',now(),'createdAt',now(),'updatedAt',now()), now()),
  ('map-ranking','seoos', jsonb_build_object('schemaVersion',1,'id','map-ranking:seoos','tenantId','map-ranking','appKey','seoos','enabled',true,'config','{}'::jsonb,'enabledAt',now(),'createdAt',now(),'updatedAt',now()), now())
on conflict (tenant_id, app_key) do nothing;
