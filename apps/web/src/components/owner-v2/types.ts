import type {
  LineChannelRecord,
  LineTargetRecord,
  NotificationRuleRecord,
  NotificationRuleRunRecord,
  ReportRunRecord,
  Tenant,
  TenantId,
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
  database: string | null;
  config_file_name: string | null;
  auth_mode: string | null;
  auth_configured: boolean;
  password_configured: boolean;
  encryption_configured: boolean;
  updated_at: string | null;
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
  roles: Array<{
    access_profile_key: string;
    label: string;
    target_count: number;
  }>;
  permissions: Array<{
    access_profile_key: string;
    allowed_report_keys: string[];
    updated_at: string;
  }>;
  impacted_notification_plans: Array<{
    rule_name: string;
    target_display_name: string;
    report_label: string;
  }>;
};
