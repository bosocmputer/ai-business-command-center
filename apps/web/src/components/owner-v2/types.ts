import type {
  AiAdvisorItemRecord,
  AiAdvisorRunRecord,
  AiCeoAdvisorResponse,
  BusinessSignalRecord,
  BusinessSignalThresholdsConfig,
  LineAccessProfileKey,
  LineChannelRecord,
  LineTargetRecord,
  NotificationRuleRecord,
  NotificationRuleRunRecord,
  ReportCategory,
  ReportKey,
  ReportRunRecord,
  Tenant,
  TenantAiProfileRecord,
  TenantAiPromptVersionRecord,
  TenantFeatureFlags,
  TenantId,
  TenantReportRolePermissionRecord,
  OpenRouterModelCatalogRecord,
} from "@ai-bcc/shared";

export type OwnerV2StepId =
  | "store"
  | "sml"
  | "reports"
  | "line"
  | "permissions"
  | "notifications";

export type OwnerV2SetupStep = {
  key: string;
  ok: boolean;
  label: string;
  detail: string;
  step: OwnerV2StepId;
  action_label: string;
  href: string;
};

export type OwnerV2Tenant = {
  id: TenantId;
  name: string;
  status: Tenant["status"];
  plan_code: Tenant["planCode"];
  dashboard_path: string | null;
  ready: boolean;
  completed_steps: number;
  total_steps: number;
  next_action: OwnerV2SetupStep | null;
  health: {
    datasource_configured: boolean;
    line_targets_enabled: number;
    notification_rules_enabled: number;
    latest_report_status: string | null;
    latest_notification_run_status: string | null;
    critical_business_signals: number;
  };
};

export type OwnerV2WorkbenchPayload = {
  tenants: OwnerV2Tenant[];
  selected_tenant_id: TenantId | null;
  selected: {
    tenant: OwnerV2Tenant;
    steps: OwnerV2SetupStep[];
    next_action: OwnerV2SetupStep | null;
    access_message: string;
  } | null;
  ops: {
    warning_count: number;
    critical_count: number;
    worker_status: string | null;
    telegram_ready: boolean;
  };
  cockpit: OwnerV2Cockpit;
};

export type OwnerV2CockpitTone = "error" | "warning" | "info" | "success";

export type OwnerV2CockpitNextAction = {
  title: string;
  description: string;
  action_label: string;
  href: string;
  tone: OwnerV2CockpitTone;
  tenant_id: TenantId | null;
  tenant_name: string | null;
};

export type OwnerV2CockpitHealthCell = {
  label: string;
  tone: OwnerV2CockpitTone | "light";
};

export type OwnerV2CockpitHealthMatrixRow = {
  tenant_id: TenantId;
  tenant_name: string;
  status: Tenant["status"];
  next_action_label: string;
  sml: OwnerV2CockpitHealthCell;
  line: OwnerV2CockpitHealthCell;
  schedule: OwnerV2CockpitHealthCell;
  latest_run: OwnerV2CockpitHealthCell;
  incident: OwnerV2CockpitHealthCell;
  signals: OwnerV2CockpitHealthCell;
  proof: OwnerV2CockpitHealthCell;
  href: string;
};

export type OwnerV2ProofDay = {
  day: number;
  date: string;
  status: "success" | "partial" | "failed" | "missing" | "unknown";
};

export type OwnerV2ProofStrip = {
  tenant_id: TenantId;
  tenant_name: string | null;
  eligible: boolean;
  days: OwnerV2ProofDay[];
  scheduled_run_count: number;
  scheduled_success_count: number;
  scheduled_failed_count: number;
  line_delivery_count: number;
  line_delivery_success_count: number;
  missing_round_count: number;
  evidence_count: number;
  latest_checked_at: string | null;
  latest_success_at: string | null;
  latest_problem_at: string | null;
};

export type OwnerV2Cockpit = {
  next_action: OwnerV2CockpitNextAction;
  health_matrix: OwnerV2CockpitHealthMatrixRow[];
  proof_strips: OwnerV2ProofStrip[];
  active_tenant_count: number;
};

export type OwnerV2DatasourceStatus = {
  source: "encrypted_store" | "env" | "missing";
  kind: string | null;
  host?: string | null;
  port?: number | null;
  database: string | null;
  user?: string | null;
  base_url?: string | null;
  webapp_path?: string | null;
  endpoint?: string | null;
  config_file_name: string | null;
  query_method?: string | null;
  auth_mode: string | null;
  auth_configured: boolean;
  password_configured: boolean;
  encryption_configured: boolean;
  updated_at: string | null;
};

export type OwnerV2DatasourceTestResult = {
  ok: boolean;
  checked_at: string;
  mode: "sml_javaws" | "sml_postgres";
  latency_ms: number;
  database_name: string | null;
  user_name_masked: string | null;
  required_tables: {
    ic_trans: boolean;
    ic_trans_detail: boolean;
    ar_customer: boolean;
    ap_supplier: boolean;
    erp_branch_list: boolean;
  };
  safe_error_message: string | null;
};

export type OwnerV2FlowAccountConfigStatus = {
  environment: "sandbox";
  auth_mode: "client_credentials";
  status: "missing" | "configured_untested" | "connected" | "error";
  credentials_configured: boolean;
  company_id: string | null;
  support_code: string | null;
  access_token_expires_at: string | null;
  last_tested_at: string | null;
  last_error: string | null;
  updated_at: string | null;
  encryption_configured: boolean;
};

export type OwnerV2FlowAccountTestResult = {
  ok: boolean;
  checked_at: string;
  environment: "sandbox";
  latency_ms: number;
  provider_status: number | null;
  company_id: string | null;
  support_code: string | null;
  safe_error_message: string | null;
};

export type OwnerV2AiCeoSetupStatus = {
  tenant: Pick<Tenant, "id" | "name" | "status"> & {
    planCode: Tenant["planCode"];
  };
  plan_eligible: boolean;
  encryption_configured: boolean;
  key_configured: boolean;
  key_source: "tenant_override" | "system_default" | "env" | "missing";
  profile: TenantAiProfileRecord;
  active_prompt: TenantAiPromptVersionRecord | null;
  prompt_versions: TenantAiPromptVersionRecord[];
  model_catalog: OpenRouterModelCatalogRecord[];
  latest_runs: AiAdvisorRunRecord[];
  open_items: AiAdvisorItemRecord[];
  usage: {
    today_tokens: number;
    today_cost_usd: number;
    month_tokens: number;
    month_cost_usd: number;
  };
};

export type OwnerV2AiCeoDryRunResult = {
  ok: boolean;
  checked_at: string;
  latency_ms: number;
  run: AiAdvisorRunRecord;
  items: AiAdvisorItemRecord[];
  response: AiCeoAdvisorResponse | null;
  safe_error_message: string | null;
  provider_status: number | null;
};

export type OwnerV2JavaWsDatabaseDiscoveryResult = {
  ok: boolean;
  checked_at: string;
  mode: "sml_javaws";
  latency_ms: number;
  config_file_name: string;
  databases: Array<{
    code: string;
    name: string;
    database_name: string;
  }>;
  safe_error_message: string | null;
};

export type OwnerV2SmlSetupPayload = {
  tenant: Pick<Tenant, "id" | "name" | "status" | "databaseName">;
  datasource: OwnerV2DatasourceStatus;
  latest_test: null;
  latest_report_run: Pick<
    ReportRunRecord,
    | "id"
    | "report_key"
    | "status"
    | "started_at"
    | "finished_at"
    | "row_count"
    | "safe_error_message"
    | "failure_kind"
    | "failure_phase"
  > | null;
};

export type OwnerV2LineSetupPayload = {
  tenant: Pick<Tenant, "id" | "name" | "status">;
  channels: LineChannelRecord[];
  targets: Array<LineTargetRecord & { sibling_tenant_names: string[] }>;
  readiness: {
    ready_targets: number;
    total_targets: number;
    send_ready_channels: number;
    total_channels: number;
  };
};

export type OwnerV2NotificationSetupPayload = {
  tenant: Pick<Tenant, "id" | "name" | "status">;
  ai_ceo: {
    ai_enabled: boolean;
    shadow_mode_enabled: boolean;
    advisor_name: string;
    plan_eligible: boolean;
    encryption_configured: boolean;
    key_configured: boolean;
    key_source: "tenant_override" | "system_default" | "env" | "missing";
    selected_model_id: TenantAiProfileRecord["selected_model_id"];
  };
  rules: Array<
    NotificationRuleRecord & {
      next_run: {
        date: string;
        time: string;
        timezone: string;
      } | null;
    }
  >;
  recent_runs: NotificationRuleRunRecord[];
  target_count: number;
  enabled_target_count: number;
};

export type OwnerV2PermissionSetupPayload = {
  tenant: Pick<Tenant, "id" | "name" | "status">;
  reports: Array<{
    report_key: ReportKey;
    label: string;
    description: string;
    sensitive: boolean;
  }>;
  roles: Array<{
    access_profile_key: LineAccessProfileKey;
    label: string;
    target_count: number;
  }>;
  permissions: TenantReportRolePermissionRecord[];
  matrix: Partial<Record<LineAccessProfileKey, ReportKey[]>>;
  target_counts: Partial<Record<LineAccessProfileKey, number>>;
  impacted_notification_plans: Array<{
    rule_id: string;
    rule_name: string;
    target_id: string;
    target_display_name: string;
    access_profile_key: LineAccessProfileKey;
    report_key: ReportKey;
    report_label: string;
  }>;
  updated_line_targets?: number;
};

export type OwnerV2ReportSetupPayload = {
  tenant: Pick<Tenant, "id" | "name" | "status"> & {
    feature_flags: {
      sml_chunked_heavy_reports_enabled: boolean;
    };
  };
  reports: Array<{
    report_key: ReportKey;
    label: string;
    short_label: string;
    description: string;
    category: ReportCategory;
    sensitive: boolean;
    heavy: boolean;
    async_supported: boolean;
    line_card: boolean;
    signed_viewer: boolean;
  }>;
  latest_runs: Array<
    Pick<
      ReportRunRecord,
      | "id"
      | "tenant_id"
      | "report_key"
      | "params"
      | "status"
      | "started_at"
      | "finished_at"
      | "row_count"
      | "safe_error_message"
      | "queued_at"
      | "claimed_at"
      | "worker_id"
      | "execution_strategy"
      | "progress_stage"
      | "progress_percent"
      | "progress_updated_at"
      | "failure_kind"
      | "failure_phase"
    >
  >;
  latest_snapshots: Array<{
    report_key: ReportKey;
    run_id: string;
    generated_at: string;
    params: ReportRunRecord["params"];
    quality_status: string;
  }>;
};

export type OwnerV2StoreSetupCheck = {
  key: string;
  ok: boolean;
  label: string;
  detail: string;
  href: string;
};

export type OwnerV2StoreSetupReadiness = {
  ready: boolean;
  completed: number;
  total: number;
  next_action: OwnerV2StoreSetupCheck | null;
  checks: OwnerV2StoreSetupCheck[];
};

export type OwnerV2StoreSetupTenantSummary = {
  tenant: Tenant;
  customer_dashboard_path: string | null;
  access: {
    enabled: boolean;
    status: string;
    message: string;
  };
  feature_flags: TenantFeatureFlags;
  business_signal_thresholds: BusinessSignalThresholdsConfig;
  health: OwnerV2Tenant["health"] & {
    line_channels: number;
    line_targets_total: number;
    users: number;
    latest_report_run_at: string | null;
    latest_snapshot_at: string | null;
    latest_line_delivery_at: string | null;
    latest_line_delivery_status: string | null;
    notification_rules_total: number;
    latest_notification_run_at: string | null;
    latest_notification_run_error: string | null;
    open_business_signals: number;
    latest_business_signal_at: string | null;
  };
  setup_readiness?: OwnerV2StoreSetupReadiness;
};

export type OwnerV2StoreSetupPayload = {
  summary: OwnerV2StoreSetupTenantSummary;
  datasource: OwnerV2DatasourceStatus;
  line_channels: LineChannelRecord[];
  line_targets: LineTargetRecord[];
  notification_rules: OwnerV2NotificationSetupPayload["rules"];
  business_signals: BusinessSignalRecord[];
  readiness: OwnerV2StoreSetupReadiness;
  proof_strip: OwnerV2ProofStrip;
  latest_javaws_failure: {
    report_key: ReportKey;
    failure_kind: string | null;
    failure_phase: string | null;
    finished_at: string | null;
    safe_error_message: string | null;
  } | null;
};

export type OwnerV2TenantDeleteImpact = {
  tenant_id: string;
  tenant_name: string;
  tenant_status: Tenant["status"];
  dashboard_path: string | null;
  notification_rules_total: number;
  notification_rules_enabled: number;
  notification_rule_runs_recent: number;
  notification_rule_runs_running: number;
  line_targets_total: number;
  line_targets_enabled: number;
  line_channels_total: number;
  report_runs_recent: number;
  latest_report_run_at: string | null;
  latest_snapshot_at: string | null;
  latest_line_delivery_at: string | null;
  can_cancel: boolean;
  blockers: Array<{
    reason: string;
    message: string;
    count: number;
  }>;
};

/** Re-export shared tenant config types so setup pages have one import. */
export type { TenantFeatureFlags, BusinessSignalThresholdsConfig };
