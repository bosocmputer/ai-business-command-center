import type {
  BusinessSignalRecord,
  LineChannelRecord,
  LineTargetRecord,
  LineAccessProfileKey,
  NotificationRuleRecord,
  NotificationRuleRunRecord,
  ReportCategory,
  ReportKey,
  ReportRunRecord,
  TenantReportRolePermissionRecord,
  Tenant,
  TenantId,
} from "@ai-bcc/shared";
import type { DatasourceConfigStatus } from "./tenant-secret-config.js";

export type OwnerWorkbenchStepKey =
  | "store_active"
  | "sml_javaws"
  | "report_test"
  | "line_channel"
  | "line_target"
  | "report_permissions"
  | "notification_plan";

export type OwnerWorkbenchStep = {
  key: OwnerWorkbenchStepKey;
  ok: boolean;
  label: string;
  detail: string;
  step: "store" | "sml" | "reports" | "line" | "permissions" | "notifications";
  action_label: string;
  href: string;
};

export type OwnerWorkbenchTenant = {
  id: TenantId;
  name: string;
  status: Tenant["status"];
  plan_code: Tenant["planCode"];
  dashboard_path: string | null;
  ready: boolean;
  completed_steps: number;
  total_steps: number;
  next_action: OwnerWorkbenchStep | null;
  health: {
    datasource_configured: boolean;
    line_targets_enabled: number;
    notification_rules_enabled: number;
    latest_report_status: string | null;
    latest_notification_run_status: string | null;
    critical_business_signals: number;
  };
};

export type OwnerWorkbenchSelected = {
  tenant: OwnerWorkbenchTenant;
  steps: OwnerWorkbenchStep[];
  next_action: OwnerWorkbenchStep | null;
  access_message: string;
};

export type OwnerWorkbenchPayload = {
  tenants: OwnerWorkbenchTenant[];
  selected_tenant_id: TenantId | null;
  selected: OwnerWorkbenchSelected | null;
  ops: {
    warning_count: number;
    critical_count: number;
    worker_status: string | null;
    telegram_ready: boolean;
  };
};

export type OwnerWorkbenchDatasourceStatus = Pick<
  DatasourceConfigStatus,
  | "source"
  | "kind"
  | "database"
  | "config_file_name"
  | "auth_mode"
  | "auth_configured"
  | "password_configured"
  | "encryption_configured"
  | "updated_at"
>;

export type OwnerWorkbenchSmlSetupPayload = {
  tenant: Pick<Tenant, "id" | "name" | "status" | "databaseName">;
  datasource: OwnerWorkbenchDatasourceStatus;
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

export type OwnerWorkbenchLineSetupPayload = {
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

export type OwnerWorkbenchNotificationSetupPayload = {
  tenant: Pick<Tenant, "id" | "name" | "status">;
  rules: NotificationRuleRecord[];
  recent_runs: NotificationRuleRunRecord[];
  target_count: number;
  enabled_target_count: number;
};

export type OwnerWorkbenchPermissionSetupPayload = {
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

export type OwnerWorkbenchReportSetupPayload = {
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

type OwnerTenantSummaryLike = {
  tenant: Tenant;
  customer_dashboard_path: string | null;
  access: {
    enabled: boolean;
    message: string;
  };
  health: OwnerWorkbenchTenant["health"] & {
    line_targets_enabled: number;
    notification_rules_enabled: number;
  };
  setup_readiness?: {
    ready: boolean;
    completed: number;
    total: number;
    next_action: OwnerReadinessCheckLike | null;
    checks: OwnerReadinessCheckLike[];
  };
};

type OwnerReadinessCheckLike = {
  key: string;
  ok: boolean;
  label: string;
  detail: string;
  href: string;
};

export function projectOwnerWorkbenchTenant(
  summary: OwnerTenantSummaryLike,
): OwnerWorkbenchTenant {
  const readiness = summary.setup_readiness;
  return {
    id: summary.tenant.id,
    name: summary.tenant.name,
    status: summary.tenant.status,
    plan_code: summary.tenant.planCode,
    dashboard_path: summary.customer_dashboard_path,
    ready: Boolean(readiness?.ready),
    completed_steps: readiness?.completed ?? 0,
    total_steps: readiness?.total ?? 0,
    next_action: readiness?.next_action
      ? projectOwnerWorkbenchStep(readiness.next_action, summary.tenant.id)
      : null,
    health: {
      datasource_configured: summary.health.datasource_configured,
      line_targets_enabled: summary.health.line_targets_enabled,
      notification_rules_enabled: summary.health.notification_rules_enabled,
      latest_report_status: summary.health.latest_report_status,
      latest_notification_run_status:
        summary.health.latest_notification_run_status,
      critical_business_signals: summary.health.critical_business_signals,
    },
  };
}

export function projectOwnerWorkbenchSelected(
  summary: OwnerTenantSummaryLike,
): OwnerWorkbenchSelected {
  return {
    tenant: projectOwnerWorkbenchTenant(summary),
    steps: [
      ...(summary.setup_readiness?.checks ?? []),
      buildReportPermissionsStep(summary),
    ].map((check) => projectOwnerWorkbenchStep(check, summary.tenant.id)),
    next_action: summary.setup_readiness?.next_action
      ? projectOwnerWorkbenchStep(summary.setup_readiness.next_action, summary.tenant.id)
      : null,
    access_message: summary.access.message,
  };
}

export function projectOwnerWorkbenchStep(
  check: OwnerReadinessCheckLike,
  tenantId: TenantId,
): OwnerWorkbenchStep {
  const key = normalizeStepKey(check.key);
  const step = workbenchStepForKey(key);
  return {
    key,
    ok: check.ok,
    label: check.label,
    detail: safeWorkbenchStepDetail({ key, ok: check.ok, detail: check.detail }),
    step,
    action_label: workbenchActionLabelForKey(key, check.ok),
    href: `/owner-v2?tenant=${encodeURIComponent(tenantId)}&step=${step}`,
  };
}

export function sanitizeWorkbenchDatasourceStatus(
  datasource: DatasourceConfigStatus,
): OwnerWorkbenchDatasourceStatus {
  return {
    source: datasource.source,
    kind: datasource.kind,
    database: datasource.database,
    config_file_name: datasource.config_file_name,
    auth_mode: datasource.auth_mode,
    auth_configured: datasource.auth_configured,
    password_configured: datasource.password_configured,
    encryption_configured: datasource.encryption_configured,
    updated_at: datasource.updated_at,
  };
}

export function countOwnerWorkbenchOpsWarnings(input: {
  tenants: OwnerWorkbenchTenant[];
  businessSignals?: BusinessSignalRecord[];
  workerStatus?: string | null;
  telegramReady?: boolean;
}) {
  const blockedTenants = input.tenants.filter(
    (tenant) => tenant.status !== "cancelled" && !tenant.ready,
  ).length;
  const tenantCriticalSignals = input.tenants.reduce(
    (total, tenant) => total + tenant.health.critical_business_signals,
    0,
  );
  const businessSignalWarnings =
    input.businessSignals?.filter((signal) => signal.status === "open").length ?? 0;
  const workerWarning =
    input.workerStatus && input.workerStatus !== "ok" ? 1 : 0;
  const telegramWarning = input.telegramReady === false ? 1 : 0;

  return {
    warning_count:
      blockedTenants + businessSignalWarnings + workerWarning + telegramWarning,
    critical_count: tenantCriticalSignals,
  };
}

export function collectOwnerWorkbenchSensitiveKeys(value: unknown) {
  const leaks: string[] = [];
  const visit = (node: unknown, path: string) => {
    if (!node || typeof node !== "object") {
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      const nextPath = path ? `${path}.${key}` : key;
      if (isSensitiveWorkbenchKey(key)) {
        leaks.push(nextPath);
      }
      visit(child, nextPath);
    }
  };
  visit(value, "");
  return leaks;
}

function buildReportPermissionsStep(
  summary: OwnerTenantSummaryLike,
): OwnerReadinessCheckLike {
  return {
    key: "report_permissions",
    ok:
      summary.health.line_targets_enabled === 0 ||
      summary.health.notification_rules_enabled === 0 ||
      summary.setup_readiness?.ready === true,
    label: "สิทธิ์รายงานพร้อม",
    detail:
      summary.health.line_targets_enabled > 0
        ? "ตรวจว่า role ผู้รับดูรายงานที่อยู่ในแผนแจ้งเตือนได้"
        : "เพิ่มผู้รับ LINE ก่อน แล้วค่อยตรวจสิทธิ์รายงาน",
    href: `/owner-v2/stores/${encodeURIComponent(summary.tenant.id)}/permissions`,
  };
}

function normalizeStepKey(key: string): OwnerWorkbenchStepKey {
  if (key === "line_channel" || key === "line_target") {
    return key;
  }
  if (key === "notification_plan") {
    return key;
  }
  if (key === "report_test") {
    return key;
  }
  if (key === "sml_javaws") {
    return key;
  }
  if (key === "report_permissions") {
    return key;
  }
  return "store_active";
}

function workbenchStepForKey(
  key: OwnerWorkbenchStepKey,
): OwnerWorkbenchStep["step"] {
  if (key === "sml_javaws") {
    return "sml";
  }
  if (key === "report_test") {
    return "reports";
  }
  if (key === "line_channel" || key === "line_target") {
    return "line";
  }
  if (key === "report_permissions") {
    return "permissions";
  }
  if (key === "notification_plan") {
    return "notifications";
  }
  return "store";
}

function workbenchActionLabelForKey(
  key: OwnerWorkbenchStepKey,
  ok: boolean,
) {
  if (ok) {
    return "ดูรายละเอียด";
  }
  if (key === "sml_javaws") {
    return "เชื่อม SML";
  }
  if (key === "report_test") {
    return "ทดสอบรายงาน";
  }
  if (key === "line_channel") {
    return "ตั้ง LINE OA";
  }
  if (key === "line_target") {
    return "เพิ่มผู้รับ";
  }
  if (key === "report_permissions") {
    return "ตรวจสิทธิ์";
  }
  if (key === "notification_plan") {
    return "ตั้งแผน";
  }
  return "ตรวจร้าน";
}

function safeWorkbenchStepDetail(input: {
  key: OwnerWorkbenchStepKey;
  ok: boolean;
  detail: string;
}) {
  if (input.key === "sml_javaws") {
    return input.ok
      ? "เชื่อม SML JavaWS แล้ว ตรวจรายงานทดสอบถัดไป"
      : "กรอก Tomcat URL, port, SMLConfig และ database";
  }
  return input.detail;
}

function isSensitiveWorkbenchKey(key: string) {
  const normalized = key.toLowerCase();
  if (
    normalized === "base_url" ||
    normalized === "webapp_path" ||
    normalized === "endpoint" ||
    normalized === "encrypted_value" ||
    normalized === "channel_access_token" ||
    normalized === "channel_secret" ||
    normalized === "access_token" ||
    normalized === "token" ||
    normalized === "raw_sql" ||
    normalized === "sql" ||
    normalized === "response_body" ||
    normalized === "target_id"
  ) {
    return true;
  }
  return false;
}
