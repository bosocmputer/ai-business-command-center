create table if not exists tenants (
  id text primary key,
  name text not null,
  status text not null default 'active',
  plan_code text not null default 'starter',
  database_name text not null default '',
  description text not null default '',
  datasource_configured boolean not null default false,
  feature_flags_json jsonb not null default '{"business_signals_enabled":true,"line_action_digest_v2_enabled":true,"line_heavy_report_fallback_enabled":true,"line_report_failure_incident_enabled":true,"sml_chunked_heavy_reports_enabled":true,"telegram_operational_alerts_enabled":true,"demo_mode_enabled":false}'::jsonb,
  business_signal_thresholds_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table tenants
  add column if not exists plan_code text not null default 'starter',
  add column if not exists database_name text not null default '',
  add column if not exists description text not null default '',
  add column if not exists datasource_configured boolean not null default false,
  add column if not exists feature_flags_json jsonb not null default '{"business_signals_enabled":true,"line_action_digest_v2_enabled":true,"line_heavy_report_fallback_enabled":true,"line_report_failure_incident_enabled":true,"sml_chunked_heavy_reports_enabled":true,"telegram_operational_alerts_enabled":true,"demo_mode_enabled":false}'::jsonb,
  add column if not exists business_signal_thresholds_json jsonb not null default '{}'::jsonb,
  add column if not exists suspended_reason text,
  add column if not exists current_period_end timestamptz,
  add column if not exists billing_cycle text;

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
  queued_at timestamptz,
  claimed_at timestamptz,
  worker_id text,
  execution_strategy text,
  progress_stage text,
  progress_percent integer,
  progress_updated_at timestamptz,
  started_at timestamptz not null,
  finished_at timestamptz,
  row_count integer not null default 0,
  safe_error_message text,
  failure_kind text,
  failure_phase text,
  failure_metadata_json jsonb not null default '{}'::jsonb
);

alter table report_runs
  add column if not exists queued_at timestamptz,
  add column if not exists claimed_at timestamptz,
  add column if not exists worker_id text,
  add column if not exists execution_strategy text,
  add column if not exists progress_stage text,
  add column if not exists progress_percent integer,
  add column if not exists progress_updated_at timestamptz,
  add column if not exists failure_kind text,
  add column if not exists failure_phase text,
  add column if not exists failure_metadata_json jsonb not null default '{}'::jsonb;

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

create index if not exists report_runs_async_idx
on report_runs (tenant_id, report_key, status, execution_strategy, queued_at desc);

create table if not exists report_run_chunks (
  id text primary key,
  tenant_id text not null references tenants(id),
  report_run_id text not null references report_runs(id) on delete cascade,
  report_key text not null references report_definitions(report_key),
  chunk_no integer not null,
  chunk_key text not null,
  status text not null,
  attempt integer not null default 0,
  unit_start_index integer not null default 0,
  unit_count integer not null default 0,
  total_units integer not null default 0,
  row_count integer not null default 0,
  cursor_from text,
  cursor_to text,
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer,
  safe_error_message text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_run_id, chunk_no)
);

create index if not exists report_run_chunks_run_idx
on report_run_chunks (report_run_id, chunk_no);

create index if not exists report_run_chunks_status_idx
on report_run_chunks (tenant_id, report_key, status, updated_at)
where status in ('queued', 'running');

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

create table if not exists flowaccount_connections (
  tenant_id text primary key references tenants(id) on delete cascade,
  environment text not null default 'sandbox',
  auth_mode text not null default 'client_credentials',
  status text not null default 'configured_untested',
  company_id text,
  support_code text,
  access_token_expires_at timestamptz,
  last_tested_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists flowaccount_connections_status_idx
on flowaccount_connections (status, updated_at desc);

create table if not exists tenant_ai_profiles (
  tenant_id text primary key references tenants(id) on delete cascade,
  ai_enabled boolean not null default false,
  shadow_mode_enabled boolean not null default true,
  advisor_name text not null default 'AI CEO',
  business_type text not null default 'retail',
  selected_model_id text not null default 'qwen/qwen3.7-max',
  key_mode text not null default 'system_default',
  daily_token_budget integer not null default 80000,
  monthly_token_budget integer not null default 2000000,
  daily_cost_budget_usd numeric(12, 4) not null default 2,
  monthly_cost_budget_usd numeric(12, 4) not null default 60,
  active_prompt_version_id text,
  last_dry_run_at timestamptz,
  last_run_at timestamptz,
  last_status text,
  last_safe_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tenant_ai_prompt_versions (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  version integer not null,
  prompt_text text not null,
  created_by text,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (tenant_id, version)
);

create index if not exists tenant_ai_prompt_versions_tenant_idx
on tenant_ai_prompt_versions (tenant_id, version desc, created_at desc);

create table if not exists openrouter_model_catalog (
  model_id text primary key,
  display_name text not null,
  provider text not null,
  recommended_tier text not null default 'business',
  use_case text not null,
  intelligence_label text not null,
  context_length integer not null default 128000,
  price_input_per_m numeric(12, 6) not null default 0,
  price_output_per_m numeric(12, 6) not null default 0,
  supports_structured_outputs boolean not null default true,
  enabled boolean not null default true,
  fetched_at timestamptz not null default now()
);

create table if not exists metric_snapshots (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  report_key text not null,
  metric_date date not null,
  period_preset text not null,
  metrics_json jsonb not null default '{}'::jsonb,
  quality_status text not null default 'partial',
  source_run_ids_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists metric_snapshots_tenant_idx
on metric_snapshots (tenant_id, metric_date desc, created_at desc);

create index if not exists metric_snapshots_report_date_idx
on metric_snapshots (tenant_id, report_key, metric_date desc, created_at desc);

create table if not exists ai_advisor_runs (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  run_date date not null,
  trigger_type text not null,
  status text not null,
  idempotency_key text not null unique,
  model_provider text not null default 'openrouter',
  model_id text not null,
  prompt_version_id text,
  context_hash text not null,
  source_report_keys_json jsonb not null default '[]'::jsonb,
  input_tokens integer,
  output_tokens integer,
  cost_estimate_usd numeric(12, 6),
  latency_ms integer,
  fallback_used boolean not null default false,
  response_json jsonb,
  safe_error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index if not exists ai_advisor_runs_tenant_idx
on ai_advisor_runs (tenant_id, run_date desc, created_at desc);

create index if not exists ai_advisor_runs_status_idx
on ai_advisor_runs (status, created_at desc);

create table if not exists ai_advisor_items (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  advisor_run_id text not null references ai_advisor_runs(id) on delete cascade,
  item_date date not null,
  severity text not null default 'info',
  title text not null,
  reason text not null,
  recommended_action text not null,
  evidence_json jsonb not null default '{}'::jsonb,
  confidence numeric(5, 4) not null default 0.5,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists ai_advisor_items_tenant_status_idx
on ai_advisor_items (tenant_id, status, created_at desc);

create index if not exists ai_advisor_items_tenant_date_status_idx
on ai_advisor_items (tenant_id, item_date desc, status, severity);

create table if not exists ai_usage_ledger (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  provider text not null default 'openrouter',
  model_id text not null,
  advisor_run_id text references ai_advisor_runs(id) on delete set null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_estimate_usd numeric(12, 6) not null default 0,
  usage_source text not null default 'estimated',
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_ledger_tenant_created_idx
on ai_usage_ledger (tenant_id, created_at desc);

create table if not exists audit_logs (
  id bigserial primary key,
  tenant_id text,
  actor_id text,
  action text not null,
  target_type text not null,
  target_id text,
  metadata_json jsonb not null default '{}'::jsonb,
  dedupe_key text,
  created_at timestamptz not null default now()
);

alter table audit_logs
  add column if not exists dedupe_key text;

create unique index if not exists audit_logs_dedupe_key_unique_idx
on audit_logs (tenant_id, dedupe_key)
where dedupe_key is not null;

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
  digest_mode text not null default 'all_reports',
  retry_policy_json jsonb not null default '{"max_attempts":2,"retry_delay_minutes":3}'::jsonb,
  last_run_at timestamptz,
  last_run_status text,
  last_safe_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table notification_rules
  add column if not exists digest_mode text not null default 'all_reports';

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
  report_results_json jsonb,
  delivery_ids_json jsonb not null default '[]'::jsonb,
  safe_error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  queued_at timestamptz,
  claimed_at timestamptz,
  worker_id text,
  client_request_id text,
  target_ids_override_json jsonb,
  next_retry_at timestamptz,
  progress_stage text,
  progress_percent integer,
  progress_current_report_key text,
  progress_done_reports integer,
  progress_total_reports integer,
  progress_updated_at timestamptz,
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
  add column if not exists client_request_id text,
  add column if not exists target_ids_override_json jsonb,
  add column if not exists report_results_json jsonb,
  add column if not exists progress_stage text,
  add column if not exists progress_percent integer,
  add column if not exists progress_current_report_key text,
  add column if not exists progress_done_reports integer,
  add column if not exists progress_total_reports integer,
  add column if not exists progress_updated_at timestamptz;

create index if not exists notification_rule_runs_queued_idx
on notification_rule_runs (status, queued_at, created_at)
where status = 'queued';

create index if not exists notification_rule_runs_schedule_idx
on notification_rule_runs (tenant_id, rule_id, scheduled_local_date, scheduled_local_time, created_at desc);

create index if not exists notification_rule_runs_status_created_idx
on notification_rule_runs (status, created_at desc);

create index if not exists notification_rule_runs_active_manual_idx
on notification_rule_runs (rule_id, scheduled_local_date, scheduled_local_time, mode, source, status, created_at desc)
where status in ('queued', 'running');

create table if not exists report_viewer_tokens (
  token_hash text primary key,
  token_version smallint not null default 1,
  tenant_id text not null,
  report_key text,
  run_id text not null,
  jti text,
  target_id_hash text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  session_id text,
  session_bound_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

alter table report_viewer_tokens
  add column if not exists token_version smallint not null default 1,
  add column if not exists report_key text,
  add column if not exists jti text,
  add column if not exists target_id_hash text,
  add column if not exists session_id text,
  add column if not exists session_bound_at timestamptz,
  add column if not exists revoked_at timestamptz;

create index if not exists report_viewer_tokens_expires_idx
on report_viewer_tokens (expires_at);

create unique index if not exists report_viewer_tokens_jti_unique_idx
on report_viewer_tokens (jti)
where jti is not null;

create index if not exists report_viewer_tokens_session_scope_idx
on report_viewer_tokens (session_id, tenant_id, report_key, expires_at)
where session_id is not null and revoked_at is null;

create index if not exists report_viewer_tokens_target_idx
on report_viewer_tokens (tenant_id, target_id_hash, expires_at)
where target_id_hash is not null and revoked_at is null;

create table if not exists dashboard_viewer_tokens (
  token_hash text primary key,
  tenant_id text not null references tenants(id),
  source_run_id text not null,
  jti text not null,
  scope_json jsonb not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists dashboard_viewer_tokens_tenant_idx
on dashboard_viewer_tokens (tenant_id, created_at desc);

create index if not exists dashboard_viewer_tokens_expires_idx
on dashboard_viewer_tokens (expires_at);

create table if not exists executive_dashboard_runs (
  id text primary key,
  tenant_id text not null references tenants(id),
  token_hash text not null,
  token_jti text not null,
  source_run_id text not null,
  params_json jsonb not null,
  report_keys_json jsonb not null default '[]'::jsonb,
  status text not null,
  report_run_ids_json jsonb not null default '[]'::jsonb,
  report_results_json jsonb not null default '[]'::jsonb,
  safe_error_message text,
  queued_at timestamptz,
  claimed_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  worker_id text,
  progress_stage text,
  progress_percent integer,
  progress_current_report_key text,
  progress_done_reports integer,
  progress_total_reports integer,
  progress_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists executive_dashboard_runs_token_recent_idx
on executive_dashboard_runs (tenant_id, token_hash, created_at desc);

create index if not exists executive_dashboard_runs_queued_idx
on executive_dashboard_runs (status, queued_at, created_at)
where status = 'queued';

create index if not exists executive_dashboard_runs_active_tenant_idx
on executive_dashboard_runs (tenant_id, status, created_at desc)
where status in ('queued', 'running');

create table if not exists operational_alert_targets (
  id text primary key,
  channel text not null,
  display_name text not null,
  target_id_encrypted text not null,
  target_id_masked text not null,
  target_id_hash text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, target_id_hash)
);

create index if not exists operational_alert_targets_channel_idx
on operational_alert_targets (channel, enabled, updated_at desc);

create table if not exists operational_alert_deliveries (
  id text primary key,
  channel text not null,
  target_id_masked text,
  alert_type text not null,
  severity text not null,
  status text not null,
  dedupe_key text,
  message_text text not null,
  provider_response_json jsonb,
  safe_error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists operational_alert_deliveries_latest_idx
on operational_alert_deliveries (channel, created_at desc);

create index if not exists operational_alert_deliveries_dedupe_idx
on operational_alert_deliveries (channel, dedupe_key, status)
where dedupe_key is not null;
