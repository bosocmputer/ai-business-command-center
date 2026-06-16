import type {
  BusinessSignalRecord,
  LineAccessProfileKey,
  LineChannelRecord,
  LineTargetRecord,
  NotificationRuleRecord,
  NotificationRuleRunRecord,
  ReportCategory,
  ReportKey,
  ReportRunRecord,
  Tenant,
  TenantId,
  TenantReportRolePermissionRecord,
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
  targets: LineTargetRecord[];
  readiness: {
    ready_targets: number;
    total_targets: number;
    send_ready_channels: number;
    total_channels: number;
  };
};

export type OwnerV2NotificationSetupPayload = {
  tenant: Pick<Tenant, "id" | "name" | "status">;
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
};
