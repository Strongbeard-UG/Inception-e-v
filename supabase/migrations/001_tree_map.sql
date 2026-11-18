-- Inception Tree Map: Tabellen für Standorte, Bäume und Sync-Läufe
-- Im Supabase SQL-Editor einmal ausführen.

create table if not exists public.sites (
  id            uuid primary key default gen_random_uuid(),
  notion_id     text unique not null,
  type          text not null check (type in ('school', 'community')),
  name          text not null,
  lat           double precision,
  lng           double precision,
  status        text,
  maps_url      text,
  hub           text,                -- Jinja / Mbale, später aus Operation Area
  trees_tracked integer not null default 0,
  last_tracked  timestamptz,
  updated_at    timestamptz not null default now()
);

create table if not exists public.trees (
  greenstand_id bigint primary key,
  lat           double precision not null,
  lng           double precision not null,
  captured_at   timestamptz,
  species       text,
  image_url     text,
  site_id       uuid references public.sites(id) on delete set null,
  distance_m    integer,             -- Abstand zur zugeordneten Schule/Community
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now()
);

create index if not exists trees_site_idx on public.trees(site_id);

create table if not exists public.sync_runs (
  id          bigserial primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  summary     jsonb
);

-- Öffentlich lesbar (die Karte ist öffentlich), schreiben nur mit Service-Role-Key
alter table public.sites enable row level security;
alter table public.trees enable row level security;
alter table public.sync_runs enable row level security;

drop policy if exists "public read sites" on public.sites;
create policy "public read sites" on public.sites for select using (true);

drop policy if exists "public read trees" on public.trees;
create policy "public read trees" on public.trees for select using (true);
