create table if not exists tenants (
  id text primary key,
  name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists datasources (
  id text primary key,
  tenant_id text not null references tenants(id),
  kind text not null default 'sml_postgres',
  database_name text not null,
  secret_ref text not null,
  created_at timestamptz not null default now()
);

create table if not exists report_definitions (
  report_key text primary key,
  name text not null,
  version text not null,
  contract_json jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists report_runs (
  id text primary key,
  tenant_id text not null references tenants(id),
  report_key text not null references report_definitions(report_key),
  params_json jsonb not null,
  status text not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  row_count integer not null default 0,
  safe_error_message text
);

create table if not exists report_snapshots (
  id text primary key,
  tenant_id text not null references tenants(id),
  report_key text not null references report_definitions(report_key),
  report_run_id text not null references report_runs(id),
  snapshot_json jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists report_runs_latest_idx
on report_runs (tenant_id, report_key, started_at desc);

create index if not exists report_snapshots_latest_idx
on report_snapshots (tenant_id, report_key, created_at desc);

create table if not exists audit_logs (
  id bigserial primary key,
  tenant_id text,
  actor_id text,
  action text not null,
  target_type text not null,
  target_id text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
