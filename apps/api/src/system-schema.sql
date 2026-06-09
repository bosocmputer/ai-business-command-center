create table if not exists tenants (
  id text primary key,
  name text not null,
  status text not null default 'active',
  plan_code text not null default 'starter',
  database_name text not null default '',
  description text not null default '',
  datasource_configured boolean not null default false,
  feature_flags_json jsonb not null default '{"business_signals_enabled":true,"line_action_digest_v2_enabled":false,"line_heavy_report_fallback_enabled":true,"demo_mode_enabled":false}'::jsonb,
  business_signal_thresholds_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table tenants
  add column if not exists plan_code text not null default 'starter',
  add column if not exists database_name text not null default '',
  add column if not exists description text not null default '',
  add column if not exists datasource_configured boolean not null default false,
  add column if not exists feature_flags_json jsonb not null default '{"business_signals_enabled":true,"line_action_digest_v2_enabled":false,"line_heavy_report_fallback_enabled":true,"demo_mode_enabled":false}'::jsonb,
  add column if not exists business_signal_thresholds_json jsonb not null default '{}'::jsonb,
  add column if not exists suspended_reason text,
  add column if not exists current_period_end timestamptz;

create table if not exists datasources (
  id text primary key,
  tenant_id text not null references tenants(id),
  kind text not null default 'sml_javaws',
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

create table if not exists business_signals (
  id text primary key,
  tenant_id text not null references tenants(id),
  signal_key text not null,
  category text not null,
  severity text not null,
  title text not null,
  insight text not null,
  recommended_action text not null,
  amount_impact numeric,
  source_report_key text not null references report_definitions(report_key),
  source_run_id text not null references report_runs(id),
  period_from date not null,
  period_to date not null,
  dimension_type text not null default 'report',
  dimension_id text not null default '',
  rule_version text not null,
  status text not null default 'open',
  evidence_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, signal_key, period_from, period_to, dimension_type, dimension_id)
);

create index if not exists business_signals_tenant_period_idx
on business_signals (tenant_id, period_to desc, severity, status);

create index if not exists business_signals_source_run_idx
on business_signals (tenant_id, source_report_key, source_run_id);

create table if not exists line_targets (
  id text primary key,
  tenant_id text not null references tenants(id),
  line_channel_id text,
  display_name text not null,
  target_type text not null,
  target_id text not null,
  target_id_masked text not null,
  target_id_hash text not null,
  recipient_count_estimate integer,
  access_profile_key text not null,
  allowed_report_keys jsonb not null default '[]'::jsonb,
  allowed_actions jsonb not null default '[]'::jsonb,
  enabled boolean not null default false,
  approved boolean not null default false,
  source text not null default 'manual',
  last_delivery_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, target_id_hash)
);

create index if not exists line_targets_tenant_idx
on line_targets (tenant_id, updated_at desc);

alter table line_targets
  add column if not exists line_channel_id text;

alter table line_targets
  add column if not exists recipient_count_estimate integer;

create table if not exists tenant_report_role_permissions (
  tenant_id text not null references tenants(id) on delete cascade,
  access_profile_key text not null,
  allowed_report_keys_json jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, access_profile_key)
);

create index if not exists tenant_report_role_permissions_tenant_idx
on tenant_report_role_permissions (tenant_id, updated_at desc);

create table if not exists line_channels (
  id text primary key,
  tenant_id text not null references tenants(id),
  display_name text not null,
  channel_type text not null default 'line_oa',
  scope text not null default 'tenant',
  channel_access_token_configured boolean not null default false,
  channel_secret_configured boolean not null default false,
  enabled boolean not null default true,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table line_channels
  add column if not exists scope text not null default 'tenant';

create index if not exists line_channels_tenant_idx
on line_channels (tenant_id, updated_at desc);

create table if not exists secrets (
  id text primary key,
  tenant_id text references tenants(id),
  scope text not null,
  secret_key text not null,
  encrypted_value text not null,
  encryption_key_id text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, scope, secret_key)
);

create index if not exists secrets_tenant_idx
on secrets (tenant_id, scope, updated_at desc);

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

create table if not exists notification_rules (
  id text primary key,
  tenant_id text not null references tenants(id),
  name text not null,
  enabled boolean not null default true,
  timezone text not null default 'Asia/Bangkok',
  period_preset text not null default 'yesterday',
  schedule_json jsonb not null,
  report_keys_json jsonb not null,
  target_ids_json jsonb not null,
  message_packaging text not null default 'digest',
  digest_mode text not null default 'action_only',
  retry_policy_json jsonb not null default '{"max_attempts":2,"retry_delay_minutes":3}'::jsonb,
  last_run_at timestamptz,
  last_run_status text,
  last_safe_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table notification_rules
  add column if not exists digest_mode text not null default 'action_only';

create table if not exists notification_rule_runs (
  id text primary key,
  rule_id text not null references notification_rules(id),
  tenant_id text not null references tenants(id),
  scheduled_local_date date not null,
  scheduled_local_time text not null,
  timezone text not null default 'Asia/Bangkok',
  period_from date not null,
  period_to date not null,
  period_from_time text,
  period_to_time text,
  period_strategy text not null default 'executive_checkpoints',
  unknown_doc_time_count integer not null default 0,
  status text not null,
  mode text not null default 'send',
  source text not null default 'worker_due',
  attempt integer not null default 1,
  idempotency_key text not null unique,
  report_run_ids_json jsonb not null default '[]'::jsonb,
  delivery_ids_json jsonb not null default '[]'::jsonb,
  safe_error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  queued_at timestamptz,
  claimed_at timestamptz,
  worker_id text,
  client_request_id text,
  next_retry_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table notification_rule_runs
  add column if not exists period_from_time text,
  add column if not exists period_to_time text,
  add column if not exists period_strategy text not null default 'executive_checkpoints',
  add column if not exists unknown_doc_time_count integer not null default 0,
  add column if not exists mode text not null default 'send',
  add column if not exists source text not null default 'worker_due',
  add column if not exists queued_at timestamptz,
  add column if not exists claimed_at timestamptz,
  add column if not exists worker_id text,
  add column if not exists client_request_id text;

create index if not exists notification_rule_runs_queued_idx
on notification_rule_runs (status, queued_at, created_at)
where status = 'queued';

create index if not exists notification_rule_runs_active_manual_idx
on notification_rule_runs (rule_id, scheduled_local_date, scheduled_local_time, mode, source, status, created_at desc)
where status in ('queued', 'running');
