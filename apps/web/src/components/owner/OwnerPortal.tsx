"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import {
  deriveNotificationPeriodRange,
  deriveMorningBriefDateRange,
  getReportCatalogEntry,
  type BusinessSignalThresholdsConfig,
  type BusinessSignalRecord,
  type LineAccessProfileKey,
  type LineChannelRecord,
  type LineDeliveryRecord,
  type LineRecipientRecord,
  type LineTargetRecord,
  type NotificationPeriodPreset,
  type NotificationPeriodStrategy,
  type NotificationDigestMode,
  type NotificationRuleRecord,
  type NotificationRuleRunRecord,
  type OperationalAlertDeliveryRecord,
  type GrossProfitByArCustomerSnapshot,
  type GrossProfitByProductSnapshot,
  type PurchaseGoodsPayablesSnapshot,
  type ReportKey,
  type ReportRunRecord,
  type SalesGoodsServicesSnapshot,
  type Tenant,
  type TenantFeatureFlags,
  type TenantReportRolePermissionRecord,
} from "@ai-bcc/shared";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import { CopyIcon } from "@/icons";
import { AdminSecurityDialogs } from "@/components/command-center/AdminSecurityDialogs";
import {
  buildAdminJsonHeaders,
  buildRememberedAdminJsonHeaders,
  forgetAdminToken,
  requestAdminConfirmation,
} from "@/components/command-center/adminAuth";
import { getCommandCenterApiBaseUrl } from "@/components/command-center/apiBaseUrl";
import {
  formatLineAccessProfile,
  OwnerLineRecipientLibraryPanel,
  OwnerLineTargetsPanel,
} from "./OwnerLineTargetsPanel";
import { OwnerNotificationsContent as OwnerNotificationsContentV2 } from "./notifications/OwnerNotificationsContent";

const API_BASE_URL = getCommandCenterApiBaseUrl();
const defaultReportRange = deriveMorningBriefDateRange();
const OWNER_NOTIFICATION_PERIOD_STRATEGY: NotificationPeriodStrategy =
  "executive_checkpoints";

const JAVA_WS_DATASOURCE_PRESETS = [
  {
    id: "seaandhill-demo",
    label: "Sea & Hill demo",
    description: "147.50.69.68:80 · SMLConfigDEMO.xml · thapput",
    baseUrl: "http://147.50.69.68:80",
    webappPath: "/SMLJavaWebService",
    endpoint: "DotNetFrameWork",
    configFileName: "SMLConfigDEMO.xml",
    database: "thapput",
  },
  {
    id: "demo-3bb",
    label: "3BB demo",
    description: "demserver.3bbddns.com:47308 · SMLConfigDATA.xml · demo",
    baseUrl: "http://demserver.3bbddns.com:47308",
    webappPath: "/SMLJavaWebService",
    endpoint: "DotNetFrameWork",
    configFileName: "SMLConfigDATA.xml",
    database: "demo",
  },
] as const;

type JavaWsDatasourcePreset = (typeof JAVA_WS_DATASOURCE_PRESETS)[number];
type LineChannelScope = NonNullable<LineChannelRecord["scope"]>;

type TenantSummary = {
  tenant: Tenant;
  customer_dashboard_path: string | null;
  access: {
    enabled: boolean;
    status: string;
    message: string;
  };
  health: {
    datasource_configured: boolean;
    line_channels: number;
    line_targets_total: number;
    line_targets_enabled: number;
    users: number;
    latest_report_run_at: string | null;
    latest_report_status: string | null;
    latest_snapshot_at: string | null;
    latest_line_delivery_at: string | null;
    latest_line_delivery_status: string | null;
    notification_rules_total: number;
    notification_rules_enabled: number;
    latest_notification_run_at: string | null;
    latest_notification_run_status: string | null;
    latest_notification_run_error: string | null;
    open_business_signals: number;
    critical_business_signals: number;
    latest_business_signal_at: string | null;
  };
};

function pickDefaultOwnerTenantId(tenants: TenantSummary[]) {
  const preferred =
    tenants.find(
      (item) =>
        item.access.enabled &&
        item.health.datasource_configured &&
        item.health.line_targets_enabled > 0 &&
        Boolean(item.health.latest_snapshot_at),
    ) ??
    tenants.find(
      (item) =>
        item.access.enabled &&
        item.health.datasource_configured &&
        Boolean(item.health.latest_snapshot_at),
    ) ??
    tenants.find(
      (item) => item.access.enabled && item.health.datasource_configured,
    ) ??
    tenants.find((item) => item.access.enabled) ??
    tenants[0];

  return preferred?.tenant.id ?? "";
}

type TenantPatchInput = {
  name: string;
  description: string;
  plan_code: Tenant["planCode"];
  status?: Exclude<Tenant["status"], "cancelled">;
  feature_flags?: Partial<TenantFeatureFlags>;
  business_signal_thresholds?: Partial<BusinessSignalThresholdsConfig>;
  current_period_end: string | null;
  suspended_reason: string | null;
};

type ChunkedReportProgress = {
  run: ReportRunRecord;
  progress_stage: string;
  progress_percent: number;
  chunk_summary: {
    total: number;
    done: number;
    failed: number;
    running: number;
    queued: number;
    rows_processed: number;
    total_units: number;
  };
  elapsed_ms: number;
  can_close_page: boolean;
  next_action_message: string;
};

type TenantDeleteImpact = {
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

type SmlConnectionSummary = TenantSummary & {
  datasource: DatasourceConfigStatus;
  last_test: DatasourceTestResult | null;
};

type StoreSetupReadinessCheck = ReadinessCheck & {
  key: string;
  href: string;
};

type StoreSetupDetail = {
  summary: TenantSummary;
  datasource: DatasourceConfigStatus;
  line_channels: LineChannelRecord[];
  line_targets: LineTargetRecord[];
  notification_rules: OwnerNotificationRule[];
  business_signals: BusinessSignalRecord[];
  readiness: {
    ready: boolean;
    completed: number;
    total: number;
    next_action: StoreSetupReadinessCheck | null;
    checks: StoreSetupReadinessCheck[];
  };
};

type OwnerNotificationRule = NotificationRuleRecord & {
  next_run: {
    date: string;
    time: string;
    timezone: string;
  } | null;
};

type NotificationRuleRunResult = {
  ok: boolean;
  accepted?: boolean;
  reused?: boolean;
  status?: NotificationRuleRunRecord["status"] | "sent" | "processed" | "skipped";
  run_id?: string;
  run?: NotificationRuleRunRecord;
  deliveries?: LineDeliveryRecord[];
  report_run_ids?: string[];
  mode?: "dry_run" | "send";
  error?: string;
};

type ActionResult = {
  tone: "success" | "error" | "warning";
  message: string;
};

type OwnerDataStatus = "checking" | "auth_required" | "ready" | "error";

type DatasourceTestResult = {
  ok: boolean;
  checked_at: string;
  mode: DatasourceKind;
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

type DatasourceKind = "sml_postgres" | "sml_javaws";
type JavaWsAuthMode = "none" | "basic" | "bearer";

type DatasourceConfigStatus = {
  source: "encrypted_store" | "env" | "missing";
  kind: DatasourceKind | null;
  host: string | null;
  port: number | null;
  database: string | null;
  user: string | null;
  password_configured: boolean;
  base_url: string | null;
  webapp_path: string | null;
  endpoint: string | null;
  config_file_name: string | null;
  query_method: string | null;
  auth_mode: JavaWsAuthMode | null;
  auth_configured: boolean;
  encryption_configured: boolean;
  updated_at: string | null;
};

type JavaWsDatabaseDiscoveryResult = {
  ok: boolean;
  checked_at: string;
  mode: "sml_javaws";
  latency_ms: number;
  config_file_name: string;
  databases: {
    code: string;
    name: string;
    database_name: string;
  }[];
  safe_error_message: string | null;
};

type OwnerAuditLogEntry = {
  id?: number;
  tenant_id: string | null;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata_json: Record<string, unknown>;
  created_at: string;
};

type OwnerOperationsStatus = {
  api: {
    ok: boolean;
    service: string;
    system_store: "postgres" | "local-json";
    time: string;
  };
  dashboard: {
    app_base_url_configured: boolean;
    dashboard_url: string | null;
    public_api_base_url_configured: boolean;
  };
  scheduler: {
    enabled: boolean;
    tenant_ids: string[];
    time: string;
    timezone: string;
    mode: "dry_run" | "send";
    force: boolean;
  };
  worker: {
    heartbeat_configured: boolean;
    latest_heartbeat: unknown | null;
    age_seconds: number | null;
    status: string;
  };
  backup: {
    system_store: "postgres" | "local-json";
    configured: boolean;
    last_backup_at: string | null;
    recommendation: string;
  };
  signal_metrics?: {
    open: number;
    critical_open: number;
    generated_recent: number;
    digest_sent_recent: number;
    skipped_permission_recent: number;
    lifecycle_updates_recent: number;
  };
  operational_alerts?: {
    telegram: {
      status: TelegramOperationalAlertStatus;
      deliveries: OperationalAlertDeliveryRecord[];
    };
  };
  production_proof?: {
    window_days: number;
    window_started_at: string;
    generated_at: string;
    active_tenant_count: number;
    eligible_tenant_count: number;
    scheduled_run_count: number;
    scheduled_success_count: number;
    scheduled_warning_count: number;
    scheduled_failed_count: number;
    scheduled_pending_count: number;
    scheduled_success_rate: number | null;
    line_delivery_count: number;
    line_delivery_success_count: number;
    line_delivery_failed_count: number;
    line_delivery_success_rate: number | null;
    javaws_incident_count: number;
    report_failure_count: number;
    heavy_report_success_count: number;
    heavy_report_p50_ms: number | null;
    heavy_report_p90_ms: number | null;
    latest_success_at: string | null;
    latest_problem_at: string | null;
  };
  report_health?: {
    latest_javaws_failure: {
      id: string;
      tenant_id: string;
      report_key: ReportKey;
      status: ReportRunRecord["status"];
      finished_at: string | null;
      failure_kind: string | null;
      failure_phase: string | null;
      failure_metadata_json: Record<string, unknown>;
      safe_error_message: string | null;
    } | null;
    heavy_report_runs: Array<{
      id: string;
      tenant_id: string;
      report_key: ReportKey;
      status: ReportRunRecord["status"];
      started_at: string;
      finished_at: string | null;
      duration_ms: number | null;
      row_count: number;
      failure_kind: string | null;
      failure_phase: string | null;
      safe_error_message: string | null;
    }>;
  };
  audit_logs: OwnerAuditLogEntry[];
  system_config?: SystemConfigStatus;
};

type TelegramOperationalAlertStatus = {
  configured: boolean;
  encryption_configured: boolean;
  verified: boolean;
  bot_username: string | null;
  bot_first_name: string | null;
  updated_at: string | null;
  targets: Array<{
    id: string;
    display_name: string;
    target_id_masked: string;
    enabled: boolean;
    updated_at: string;
  }>;
};

type TelegramChatPreview = {
  chat_id: string;
  chat_id_masked: string;
  display_name: string;
  type: string;
};

type SystemConfigStatus = {
  source: "encrypted_store" | "bootstrap_file" | "env";
  app_base_url: string | null;
  public_api_base_url: string | null;
  report_viewer_link_ttl_hours: number;
  report_viewer_signing_secret_configured: boolean;
  morning_brief_enabled: boolean;
  morning_brief_tenant_ids: string[];
  morning_brief_time: string;
  morning_brief_timezone: string;
  morning_brief_mode: "dry_run" | "send";
  morning_brief_force: boolean;
  worker_id: string;
  worker_heartbeat_token_configured: boolean;
  backup_configured: boolean;
  system_last_backup_at: string | null;
  encryption_configured: boolean;
  updated_at: string | null;
  bootstrap: {
    path: string;
    exists: boolean;
    system_database_configured: boolean;
    secret_key_present: boolean;
    app_base_url_configured: boolean;
    public_api_base_url_configured: boolean;
    report_viewer_signing_secret_configured: boolean;
    read_error: string | null;
  };
  restart_required_for_bootstrap_changes: boolean;
};

type ValidationSignoffResult = {
  status: "accepted" | "difference_found";
  accepted: boolean;
  difference_amount: number;
};

type ReportPermissionCatalogItem = {
  report_key: ReportKey;
  label: string;
  description: string;
  sensitive: boolean;
};

type ReportPermissionRoleItem = {
  access_profile_key: LineAccessProfileKey;
  label: string;
  target_count: number;
};

type ReportPermissionImpact = {
  rule_id: string;
  rule_name: string;
  target_id: string;
  target_display_name: string;
  access_profile_key: LineAccessProfileKey;
  report_key: ReportKey;
  report_label: string;
};

type ReportPermissionsState = {
  tenants: Array<{
    id: string;
    name: string;
    status: Tenant["status"];
  }>;
  selected_tenant_id: string | null;
  reports: ReportPermissionCatalogItem[];
  roles: ReportPermissionRoleItem[];
  permissions: TenantReportRolePermissionRecord[];
  matrix: Partial<Record<LineAccessProfileKey, ReportKey[]>>;
  target_counts: Partial<Record<LineAccessProfileKey, number>>;
  impacted_notification_plans: ReportPermissionImpact[];
  updated_line_targets?: number;
};

export type OwnerPortalSection =
  | "overview"
  | "tenants"
  | "sml-connections"
  | "notifications"
  | "report-permissions"
  | "reports"
  | "line"
  | "audit"
  | "settings";

export default function OwnerPortal({
  section = "overview",
}: {
  section?: OwnerPortalSection;
}) {
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [smlConnections, setSmlConnections] = useState<SmlConnectionSummary[]>(
    [],
  );
  const [storeSetupDetail, setStoreSetupDetail] =
    useState<StoreSetupDetail | null>(null);
  const [lineChannels, setLineChannels] = useState<LineChannelRecord[]>([]);
  const [lineRecipients, setLineRecipients] = useState<LineRecipientRecord[]>([]);
  const [lineTargets, setLineTargets] = useState<LineTargetRecord[]>([]);
  const [notificationRules, setNotificationRules] = useState<
    OwnerNotificationRule[]
  >([]);
  const [notificationRuleRuns, setNotificationRuleRuns] = useState<
    NotificationRuleRunRecord[]
  >([]);
  const [reportPermissions, setReportPermissions] =
    useState<ReportPermissionsState | null>(null);
  const [reportPermissionDraft, setReportPermissionDraft] = useState<
    Partial<Record<LineAccessProfileKey, ReportKey[]>>
  >({});
  const [editingNotificationRuleId, setEditingNotificationRuleId] =
    useState<string | null>(null);
  const [notificationName, setNotificationName] = useState("Daily SML digest");
  const [notificationEnabled, setNotificationEnabled] = useState(false);
  const [notificationPeriodPreset, setNotificationPeriodPreset] =
    useState<NotificationPeriodPreset>("yesterday");
  const [notificationPeriodStrategy, setNotificationPeriodStrategy] =
    useState<NotificationPeriodStrategy>(OWNER_NOTIFICATION_PERIOD_STRATEGY);
  const [notificationDigestMode, setNotificationDigestMode] =
    useState<NotificationDigestMode>("action_only");
  const [notificationWeekdays, setNotificationWeekdays] = useState<number[]>([
    1, 2, 3, 4, 5, 6, 7,
  ]);
  const [notificationTimes, setNotificationTimes] = useState<string[]>(["08:00"]);
  const [notificationTimeInput, setNotificationTimeInput] = useState("08:00");
  const [notificationManualScheduledDate, setNotificationManualScheduledDate] =
    useState(() => toBangkokYmd(new Date()));
  const [notificationManualScheduledTime, setNotificationManualScheduledTime] =
    useState("08:00");
  const [notificationReportKeys, setNotificationReportKeys] = useState<
    ReportKey[]
  >(["sales_goods_services", "purchase_goods_payables"]);
  const [notificationTargetIds, setNotificationTargetIds] = useState<string[]>(
    [],
  );
  const [lastNotificationRunResult, setLastNotificationRunResult] =
    useState<NotificationRuleRunResult | null>(null);
  const [pendingNotificationRunId, setPendingNotificationRunId] =
    useState<string | null>(null);
  const [datasourceTests, setDatasourceTests] = useState<
    Record<string, DatasourceTestResult>
  >({});
  const [datasourceConfig, setDatasourceConfig] =
    useState<DatasourceConfigStatus | null>(null);
  const [javaWsDatabaseDiscovery, setJavaWsDatabaseDiscovery] =
    useState<JavaWsDatabaseDiscoveryResult | null>(null);
  const [javaWsBaseUrl, setJavaWsBaseUrl] = useState("");
  const [javaWsWebappPath, setJavaWsWebappPath] =
    useState("/SMLJavaWebService");
  const [javaWsEndpoint, setJavaWsEndpoint] = useState("DotNetFrameWork");
  const [javaWsConfigFileName, setJavaWsConfigFileName] = useState("");
  const [javaWsDatabase, setJavaWsDatabase] = useState("");
  const [javaWsAuthMode, setJavaWsAuthMode] =
    useState<JavaWsAuthMode>("none");
  const [javaWsAuthUsername, setJavaWsAuthUsername] = useState("");
  const [javaWsAuthSecret, setJavaWsAuthSecret] = useState("");
  const [operationsStatus, setOperationsStatus] =
    useState<OwnerOperationsStatus | null>(null);
  const [systemConfig, setSystemConfig] = useState<SystemConfigStatus | null>(
    null,
  );
  const [systemAppBaseUrl, setSystemAppBaseUrl] = useState("");
  const [systemPublicApiBaseUrl, setSystemPublicApiBaseUrl] = useState("");
  const [systemReportViewerSigningSecret, setSystemReportViewerSigningSecret] =
    useState("");
  const [systemReportViewerLinkTtlHours, setSystemReportViewerLinkTtlHours] =
    useState("72");
  const [systemMorningBriefEnabled, setSystemMorningBriefEnabled] =
    useState(true);
  const [systemMorningBriefTenantIds, setSystemMorningBriefTenantIds] =
    useState("tenant_demo_remote");
  const [systemMorningBriefTime, setSystemMorningBriefTime] = useState("08:00");
  const [systemMorningBriefTimezone, setSystemMorningBriefTimezone] =
    useState("Asia/Bangkok");
  const [systemMorningBriefMode, setSystemMorningBriefMode] =
    useState<"dry_run" | "send">("send");
  const [systemMorningBriefForce, setSystemMorningBriefForce] = useState(false);
  const [systemWorkerId, setSystemWorkerId] =
    useState("worker_notification_rules_1");
  const [systemWorkerHeartbeatToken, setSystemWorkerHeartbeatToken] =
    useState("");
  const [systemBackupConfigured, setSystemBackupConfigured] = useState(false);
  const [systemLastBackupAt, setSystemLastBackupAt] = useState("");
  const [telegramBotTokenInput, setTelegramBotTokenInput] = useState("");
  const [telegramChats, setTelegramChats] = useState<TelegramChatPreview[]>([]);
  const [dataStatus, setDataStatus] =
    useState<OwnerDataStatus>("checking");
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [newTenantName, setNewTenantName] = useState("");
  const [newTenantId, setNewTenantId] = useState("");
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [justCreatedTenantId, setJustCreatedTenantId] = useState<string | null>(null);
  const [reportDateFrom, setReportDateFrom] = useState(
    defaultReportRange.date_from,
  );
  const [reportDateTo, setReportDateTo] = useState(
    defaultReportRange.date_to,
  );
  const [lastManualRun, setLastManualRun] =
    useState<ReportRunRecord | null>(null);
  const [lastManualSnapshot, setLastManualSnapshot] =
    useState<SalesGoodsServicesSnapshot | null>(null);
  const [heavyReportProgress, setHeavyReportProgress] =
    useState<ChunkedReportProgress | null>(null);
  const [pendingHeavyReportRunId, setPendingHeavyReportRunId] =
    useState<string | null>(null);
  const [validationReferenceTotal, setValidationReferenceTotal] = useState("");
  const [validationSignedBy, setValidationSignedBy] = useState("");
  const [validationNote, setValidationNote] = useState("");
  const [validationSignoffResult, setValidationSignoffResult] =
    useState<ValidationSignoffResult | null>(null);
  const [lineChannelName, setLineChannelName] = useState("");
  const [lineChannelShared, setLineChannelShared] = useState(false);
  const [lineTokenConfigured, setLineTokenConfigured] = useState(false);
  const [lineSecretConfigured, setLineSecretConfigured] = useState(false);
  const [lineSecretChannelId, setLineSecretChannelId] = useState("");
  const [lineAccessTokenInput, setLineAccessTokenInput] = useState("");
  const [lineChannelSecretInput, setLineChannelSecretInput] = useState("");
  const [publicOrigin, setPublicOrigin] = useState("");

  const activeCount = useMemo(
    () =>
      tenants.filter((item) =>
        ["trial", "active", "past_due"].includes(item.tenant.status),
      ).length,
    [tenants],
  );
  const suspendedCount = tenants.filter(
    (item) => item.tenant.status === "suspended",
  ).length;
  const selectedTenant = tenants.find(
    (item) => item.tenant.id === selectedTenantId,
  )?.tenant;
  const selectedTenantSummary = tenants.find(
    (item) => item.tenant.id === selectedTenantId,
  );
  const showCancelledTenants =
    section === "overview" ||
    section === "tenants" ||
    section === "audit" ||
    section === "settings";
  const visibleSectionTenants = showCancelledTenants
    ? tenants
    : tenants.filter((item) => item.tenant.status !== "cancelled");
  const visibleSectionSmlConnections = showCancelledTenants
    ? smlConnections
    : smlConnections.filter((item) => item.tenant.status !== "cancelled");
  const selectedTenantLineChannels = useMemo(
    () =>
      selectedTenantId
        ? lineChannels.filter(
            (channel) =>
              channel.tenant_id === selectedTenantId ||
              channel.scope === "owner_shared",
          )
        : lineChannels,
    [lineChannels, selectedTenantId],
  );
  const selectedTenantLineTargets = useMemo(
    () =>
      selectedTenantId
        ? lineTargets.filter((target) => target.tenant_id === selectedTenantId)
        : [],
    [lineTargets, selectedTenantId],
  );
  const sectionMeta = getOwnerSectionMeta(section);
  const selectedTenantIdRef = useRef(selectedTenantId);

  const applySystemConfigState = useCallback((config: SystemConfigStatus) => {
    setSystemConfig(config);
    setSystemAppBaseUrl(config.app_base_url ?? "");
    setSystemPublicApiBaseUrl(config.public_api_base_url ?? "");
    setSystemReportViewerSigningSecret("");
    setSystemReportViewerLinkTtlHours(
      String(config.report_viewer_link_ttl_hours ?? 72),
    );
    setSystemMorningBriefEnabled(config.morning_brief_enabled);
    setSystemMorningBriefTenantIds(config.morning_brief_tenant_ids.join(", "));
    setSystemMorningBriefTime(config.morning_brief_time);
    setSystemMorningBriefTimezone(config.morning_brief_timezone);
    setSystemMorningBriefMode(config.morning_brief_mode);
    setSystemMorningBriefForce(config.morning_brief_force);
    setSystemWorkerId(config.worker_id);
    setSystemWorkerHeartbeatToken("");
    setSystemBackupConfigured(config.backup_configured);
    setSystemLastBackupAt(config.system_last_backup_at ?? "");
  }, []);

  const loadOwnerData = useCallback(
    async ({ promptForToken = true }: { promptForToken?: boolean } = {}) => {
      setResult(null);
      try {
        const headers = promptForToken
          ? await buildAdminJsonHeaders({
              actionLabel: "เปิด Owner Admin Portal",
              description:
                "หน้านี้เห็นทุกร้านและใช้จัดการ subscription/config ระดับระบบ",
            })
          : buildRememberedAdminJsonHeaders();
        if (!headers) {
          setDataStatus("auth_required");
          return;
        }

        const currentTenantId = selectedTenantIdRef.current;
        const [
          storeSetupResponse,
          smlConnectionsResponse,
          channelsResponse,
          lineRecipientsResponse,
          lineTargetsResponse,
          notificationRulesResponse,
          operationsResponse,
          systemConfigResponse,
        ] = await Promise.all([
          fetch(
            `${API_BASE_URL}/api/owner/store-setup${
              currentTenantId
                ? `?tenant_id=${encodeURIComponent(currentTenantId)}`
                : ""
            }`,
            { headers },
          ),
          fetch(`${API_BASE_URL}/api/owner/sml-connections`, { headers }),
          fetch(`${API_BASE_URL}/api/owner/line-channels`, { headers }),
          fetch(`${API_BASE_URL}/api/owner/line-recipients`, { headers }),
          fetch(`${API_BASE_URL}/api/line-targets`),
          fetch(`${API_BASE_URL}/api/owner/notification-rules`, { headers }),
          fetch(`${API_BASE_URL}/api/owner/operations/status`, { headers }),
          fetch(`${API_BASE_URL}/api/owner/system/config`, { headers }),
        ]);

        if (
          storeSetupResponse.status === 401 ||
          storeSetupResponse.status === 403
        ) {
          forgetAdminToken();
          setDataStatus("auth_required");
          setResult({
            tone: "warning",
            message: "Session ผู้ดูแลหมดอายุ กรุณาเข้าสู่ระบบใหม่",
          });
          return;
        }

        if (!storeSetupResponse.ok) {
          const payload = (await storeSetupResponse.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(payload.error || "โหลดภาพรวมร้านค้าไม่สำเร็จ");
        }

        const storeSetupPayload = (await storeSetupResponse.json()) as {
          data: {
            tenants: TenantSummary[];
            selected_tenant_id: string | null;
            selected: StoreSetupDetail | null;
          };
        };
        const smlConnectionsPayload = smlConnectionsResponse.ok
          ? ((await smlConnectionsResponse.json()) as {
              data: SmlConnectionSummary[];
            })
          : { data: [] };
        const channelsPayload = channelsResponse.ok
          ? ((await channelsResponse.json()) as { data: LineChannelRecord[] })
          : { data: [] };
        const lineRecipientsPayload = lineRecipientsResponse.ok
          ? ((await lineRecipientsResponse.json()) as {
              data: LineRecipientRecord[];
            })
          : { data: [] };
        const lineTargetsPayload = lineTargetsResponse.ok
          ? ((await lineTargetsResponse.json()) as { data: LineTargetRecord[] })
          : { data: [] };
        const notificationRulesPayload = notificationRulesResponse.ok
          ? ((await notificationRulesResponse.json()) as {
              data: OwnerNotificationRule[];
              runs?: NotificationRuleRunRecord[];
            })
          : { data: [], runs: [] };
        const operationsPayload = operationsResponse.ok
          ? ((await operationsResponse.json()) as { data: OwnerOperationsStatus })
          : { data: null };
        const systemConfigPayload = systemConfigResponse.ok
          ? ((await systemConfigResponse.json()) as { data: SystemConfigStatus })
          : { data: null };
        setTenants(storeSetupPayload.data.tenants);
        setStoreSetupDetail(storeSetupPayload.data.selected);
        setSmlConnections(smlConnectionsPayload.data);
        setLineChannels(channelsPayload.data);
        setLineRecipients(lineRecipientsPayload.data);
        setLineTargets(lineTargetsPayload.data);
        setNotificationRules(notificationRulesPayload.data);
        setNotificationRuleRuns(notificationRulesPayload.runs ?? []);
        setOperationsStatus(operationsPayload.data);
        if (systemConfigPayload.data) {
          applySystemConfigState(systemConfigPayload.data);
        }
        setDataStatus("ready");
      } catch (error) {
        setDataStatus("error");
        setResult({
          tone: "error",
          message:
            error instanceof Error ? error.message : "โหลด Owner Admin ไม่สำเร็จ",
        });
      }
    },
    [applySystemConfigState],
  );

  const refreshNotificationRuleRuns = useCallback(async (ruleId: string) => {
    const headers = buildRememberedAdminJsonHeaders();
    if (!headers) {
      return;
    }

    const response = await fetch(
      `${API_BASE_URL}/api/owner/notification-rules/${ruleId}/runs`,
      { headers },
    );
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as {
      data?: NotificationRuleRunRecord[];
    };
    const runs = payload.data ?? [];
    setNotificationRuleRuns((current) => [
      ...runs,
      ...current.filter((run) => run.rule_id !== ruleId),
    ]);
  }, []);

  const applyNotificationRuleToForm = useCallback(
    (rule: OwnerNotificationRule) => {
      setEditingNotificationRuleId(rule.id);
      setNotificationName(rule.name);
      setNotificationEnabled(rule.enabled);
      setNotificationPeriodPreset(rule.period_preset);
      setNotificationPeriodStrategy(OWNER_NOTIFICATION_PERIOD_STRATEGY);
      setNotificationDigestMode(rule.digest_mode ?? "action_only");
      setNotificationWeekdays(
        rule.schedule[0]?.weekdays ?? [1, 2, 3, 4, 5, 6, 7],
      );
      setNotificationTimes(rule.schedule[0]?.times ?? ["08:00"]);
      setNotificationTimeInput(rule.schedule[0]?.times?.[0] ?? "08:00");
      setNotificationManualScheduledDate(toBangkokYmd(new Date()));
      setNotificationManualScheduledTime(rule.schedule[0]?.times?.[0] ?? "08:00");
      setNotificationReportKeys(rule.report_keys);
      setNotificationTargetIds(rule.target_ids);
      setLastNotificationRunResult(null);
      setPendingNotificationRunId(null);
    },
    [],
  );

  const resetNotificationRuleForm = useCallback(() => {
    const defaultTargets = selectedTenantLineTargets
      .filter(
        (target) =>
          target.approved &&
          target.enabled &&
          target.allowed_actions.includes("receive_morning_brief"),
      )
      .map((target) => target.id);
    setEditingNotificationRuleId(null);
    setNotificationName("Daily SML digest");
    setNotificationEnabled(false);
    setNotificationPeriodPreset("yesterday");
    setNotificationPeriodStrategy(OWNER_NOTIFICATION_PERIOD_STRATEGY);
    setNotificationDigestMode("action_only");
    setNotificationWeekdays([1, 2, 3, 4, 5, 6, 7]);
    setNotificationTimes(["08:00"]);
    setNotificationTimeInput("08:00");
    setNotificationManualScheduledDate(toBangkokYmd(new Date()));
    setNotificationManualScheduledTime("08:00");
    setNotificationReportKeys(["sales_goods_services", "purchase_goods_payables"]);
    setNotificationTargetIds(defaultTargets);
    setLastNotificationRunResult(null);
    setPendingNotificationRunId(null);
  }, [selectedTenantLineTargets]);

  const loadStoreSetupDetail = useCallback(async (tenantId: string) => {
    const headers = buildRememberedAdminJsonHeaders();
    if (!headers) {
      return;
    }

    const response = await fetch(
      `${API_BASE_URL}/api/owner/store-setup?tenant_id=${encodeURIComponent(
        tenantId,
      )}`,
      { headers },
    );
    if (!response.ok) {
      return;
    }

    const payload = (await response.json()) as {
      data: {
        tenants: TenantSummary[];
        selected: StoreSetupDetail | null;
      };
    };
    setTenants(payload.data.tenants);
    setStoreSetupDetail(payload.data.selected);
  }, []);

  const loadReportPermissions = useCallback(async (tenantId?: string) => {
    const headers = buildRememberedAdminJsonHeaders();
    if (!headers) {
      return;
    }

    const response = await fetch(
      `${API_BASE_URL}/api/owner/report-permissions${
        tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : ""
      }`,
      { headers },
    );
    if (!response.ok) {
      return;
    }

    const payload = (await response.json()) as {
      data: ReportPermissionsState;
    };
    setReportPermissions(payload.data);
    setReportPermissionDraft(payload.data.matrix);
  }, []);

  const loadDatasourceConfig = useCallback(async (tenantId: string) => {
    const headers = buildRememberedAdminJsonHeaders();
    if (!headers) {
      return;
    }

    setDatasourceConfig(null);
    setJavaWsDatabaseDiscovery(null);

    const response = await fetch(
      `${API_BASE_URL}/api/owner/tenants/${tenantId}/datasource/config`,
      { headers },
    );
    if (!response.ok) {
      return;
    }

    const payload = (await response.json()) as {
      data: DatasourceConfigStatus;
    };
    setDatasourceConfig(payload.data);
    setJavaWsDatabaseDiscovery(null);
    setJavaWsBaseUrl(payload.data.base_url ?? "");
    setJavaWsWebappPath(payload.data.webapp_path ?? "/SMLJavaWebService");
    setJavaWsEndpoint(payload.data.endpoint ?? "DotNetFrameWork");
    setJavaWsConfigFileName(payload.data.config_file_name ?? "");
    setJavaWsDatabase(payload.data.database ?? "");
    setJavaWsAuthMode(payload.data.auth_mode ?? "none");
    setJavaWsAuthUsername("");
    setJavaWsAuthSecret("");
  }, []);

  const refreshHeavyReportProgress = useCallback(
    async (tenantId: string, runId: string) => {
      const response = await fetch(
        `${API_BASE_URL}/api/reports/${tenantId}/runs/${runId}/progress`,
        {
          headers: buildRememberedAdminJsonHeaders(),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        data?: ChunkedReportProgress;
        error?: string;
      };
      if (!response.ok || !payload.data) {
        if (response.status === 401 || response.status === 403) {
          forgetAdminToken();
        }
        if (response.status === 404) {
          window.localStorage.removeItem(
            getHeavyReportProgressStorageKey(tenantId),
          );
          setPendingHeavyReportRunId(null);
        }
        return;
      }

      setHeavyReportProgress(payload.data);
      setLastManualRun(payload.data.run);
      if (isTerminalReportRunStatus(payload.data.run.status)) {
        window.localStorage.removeItem(getHeavyReportProgressStorageKey(tenantId));
        setPendingHeavyReportRunId(null);
        setResult({
          tone: payload.data.run.status === "success" ? "success" : "warning",
          message:
            payload.data.run.status === "success"
              ? `${formatOwnerReportLabel(payload.data.run.report_key)} เสร็จแล้ว`
              : payload.data.next_action_message,
        });
        if (payload.data.run.status === "success") {
          await loadOwnerData({ promptForToken: false });
        }
      }
    },
    [loadOwnerData],
  );

  useEffect(() => {
    void loadOwnerData({ promptForToken: false });
  }, [loadOwnerData]);

  useEffect(() => {
    if (!pendingNotificationRunId || !editingNotificationRuleId) {
      return;
    }

    const pendingRun = notificationRuleRuns.find(
      (run) => run.id === pendingNotificationRunId,
    );
    if (
      pendingRun &&
      pendingRun.status !== "queued" &&
      pendingRun.status !== "running"
    ) {
      setPendingNotificationRunId(null);
      setLastNotificationRunResult((current) =>
        current?.run_id === pendingNotificationRunId
          ? {
              ...current,
              ok:
                pendingRun.status === "success" ||
                pendingRun.status === "success_with_warnings" ||
                pendingRun.status === "skipped",
              status: pendingRun.status,
              run: pendingRun,
            }
          : current,
      );
      setResult({
        tone:
          pendingRun.status === "success" ||
          pendingRun.status === "success_with_warnings" ||
          pendingRun.status === "skipped"
            ? "success"
            : "warning",
        message:
          pendingRun.status === "success" ||
          pendingRun.status === "success_with_warnings"
            ? "รันแผนแจ้งเตือนเสร็จแล้ว ตรวจผลล่าสุดในตาราง run"
            : pendingRun.safe_error_message ?? "รันแผนแจ้งเตือนไม่สำเร็จ",
      });
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshNotificationRuleRuns(editingNotificationRuleId);
    }, 2000);
    void refreshNotificationRuleRuns(editingNotificationRuleId);
    return () => window.clearInterval(intervalId);
  }, [
    editingNotificationRuleId,
    notificationRuleRuns,
    pendingNotificationRunId,
    refreshNotificationRuleRuns,
  ]);

  useEffect(() => {
    if (!selectedTenantId) {
      return;
    }
    const storedRunId = window.localStorage.getItem(
      getHeavyReportProgressStorageKey(selectedTenantId),
    );
    if (storedRunId) {
      setPendingHeavyReportRunId(storedRunId);
      return;
    }
    setHeavyReportProgress((current) =>
      current?.run.tenant_id === selectedTenantId ? current : null,
    );
  }, [selectedTenantId]);

  useEffect(() => {
    if (!pendingHeavyReportRunId || !selectedTenantId) {
      return;
    }

    void refreshHeavyReportProgress(selectedTenantId, pendingHeavyReportRunId);
    const intervalId = window.setInterval(() => {
      void refreshHeavyReportProgress(selectedTenantId, pendingHeavyReportRunId);
    }, 2000);
    return () => window.clearInterval(intervalId);
  }, [pendingHeavyReportRunId, refreshHeavyReportProgress, selectedTenantId]);

  useEffect(() => {
    selectedTenantIdRef.current = selectedTenantId;
  }, [selectedTenantId]);

  useEffect(() => {
    setPublicOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!selectedTenantId && tenants[0]) {
      setSelectedTenantId(pickDefaultOwnerTenantId(tenants));
    }
  }, [selectedTenantId, tenants]);

  useEffect(() => {
    if (
      ![
        "overview",
        "tenants",
        "sml-connections",
        "notifications",
        "report-permissions",
        "reports",
        "line",
      ].includes(section) ||
      !tenants.length
    ) {
      return;
    }

    const tenantId = new URLSearchParams(window.location.search).get("tenant");
    if (
      tenantId &&
      tenantId !== selectedTenantId &&
      tenants.some((item) => item.tenant.id === tenantId)
    ) {
      setSelectedTenantId(tenantId);
    }
  }, [section, selectedTenantId, tenants]);

  useEffect(() => {
    if (selectedTenantId) {
      void loadDatasourceConfig(selectedTenantId);
      void loadStoreSetupDetail(selectedTenantId);
      if (section === "report-permissions") {
        void loadReportPermissions(selectedTenantId);
      }
    } else {
      setDatasourceConfig(null);
      setStoreSetupDetail(null);
      setReportPermissions(null);
      setReportPermissionDraft({});
    }
  }, [
    loadDatasourceConfig,
    loadReportPermissions,
    loadStoreSetupDetail,
    section,
    selectedTenantId,
  ]);

  useEffect(() => {
    if (!selectedTenantId) {
      return;
    }

    const currentRule = notificationRules.find(
      (rule) => rule.id === editingNotificationRuleId,
    );
    if (currentRule?.tenant_id === selectedTenantId) {
      return;
    }

    const firstRule = notificationRules.find(
      (rule) => rule.tenant_id === selectedTenantId,
    );
    if (firstRule) {
      applyNotificationRuleToForm(firstRule);
      return;
    }

    resetNotificationRuleForm();
  }, [
    applyNotificationRuleToForm,
    editingNotificationRuleId,
    notificationRules,
    resetNotificationRuleForm,
    selectedTenantId,
  ]);

  useEffect(() => {
    if (!notificationTimes.includes(notificationManualScheduledTime)) {
      setNotificationManualScheduledTime(notificationTimes[0] ?? "08:00");
    }
  }, [notificationManualScheduledTime, notificationTimes]);

  useEffect(() => {
    if (
      selectedTenantLineChannels.length &&
      !selectedTenantLineChannels.some(
        (channel) => channel.id === lineSecretChannelId,
      )
    ) {
      setLineSecretChannelId(selectedTenantLineChannels[0].id);
      return;
    }
    if (!selectedTenantLineChannels.length && lineSecretChannelId) {
      setLineSecretChannelId("");
    }
  }, [lineSecretChannelId, selectedTenantLineChannels]);

  function buildDatasourcePayload() {
    if (!javaWsBaseUrl.trim()) {
      throw new Error("กรุณากรอก Tomcat host/URL และ port ก่อนบันทึก");
    }
    if (!javaWsConfigFileName.trim()) {
      throw new Error("กรุณากรอกชื่อไฟล์ SMLConfigxxxx.xml");
    }
    if (!javaWsDatabase.trim()) {
      throw new Error("กรุณากรอกชื่อ database ของร้าน");
    }

    return {
      kind: "sml_javaws" as const,
      baseUrl: javaWsBaseUrl.trim(),
      webappPath: javaWsWebappPath.trim() || "/SMLJavaWebService",
      endpoint: "DotNetFrameWork" as const,
      configFileName: javaWsConfigFileName.trim(),
      database: javaWsDatabase.trim(),
      queryMethod: "_queryCompress" as const,
      auth:
        javaWsAuthMode === "basic"
          ? {
              mode: "basic" as const,
              username: javaWsAuthUsername.trim(),
              password: javaWsAuthSecret,
            }
          : javaWsAuthMode === "bearer"
            ? {
                mode: "bearer" as const,
                token: javaWsAuthSecret,
              }
            : { mode: "none" as const },
    };
  }

  function buildJavaWsDiscoveryPayload() {
    return {
      kind: "sml_javaws" as const,
      baseUrl: javaWsBaseUrl.trim(),
      webappPath: javaWsWebappPath.trim() || "/SMLJavaWebService",
      endpoint: "DotNetFrameWork" as const,
      configFileName: javaWsConfigFileName.trim(),
      auth:
        javaWsAuthMode === "basic"
          ? {
              mode: "basic" as const,
              username: javaWsAuthUsername.trim(),
              password: javaWsAuthSecret,
            }
          : javaWsAuthMode === "bearer"
            ? {
                mode: "bearer" as const,
                token: javaWsAuthSecret,
              }
            : { mode: "none" as const },
    };
  }

  function applyJavaWsPreset(preset: JavaWsDatasourcePreset) {
    setJavaWsBaseUrl(preset.baseUrl);
    setJavaWsWebappPath(preset.webappPath);
    setJavaWsEndpoint(preset.endpoint);
    setJavaWsConfigFileName(preset.configFileName);
    setJavaWsDatabase(preset.database);
    setJavaWsAuthMode("none");
    setJavaWsAuthUsername("");
    setJavaWsAuthSecret("");
    setJavaWsDatabaseDiscovery(null);
  }

  async function saveDatasourceConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const tenant = selectedTenantSummary?.tenant;
    if (!tenant) {
      setResult({ tone: "warning", message: "กรุณาเลือกร้านค้าก่อนบันทึกการเชื่อม SML" });
      return;
    }

    await runOwnerAction(`datasource-save-${tenant.id}`, async () => {
      const payload = buildDatasourcePayload();
      const confirmed = await requestAdminConfirmation({
        title: "ยืนยันบันทึกการเชื่อม SML",
        message:
          "ระบบจะเข้ารหัส token ของ reverse proxy ถ้ามี และบันทึก audit โดยไม่แสดง secret เต็ม",
        confirmLabel: "บันทึกการเชื่อม",
        details: [
          { label: "ร้านค้า", value: tenant.name },
          {
            label: "วิธีเชื่อม",
            value: "Tomcat JavaWS",
          },
          {
            label: "Tomcat",
            value: payload.baseUrl,
          },
          { label: "Database", value: payload.database },
        ],
      });
      if (!confirmed) {
        return;
      }

      const headers = await buildAdminJsonHeaders({
        actionLabel: `บันทึกการเชื่อม SML ของ ${tenant.name}`,
        description:
          "ใช้สำหรับให้ API/worker อ่านข้อมูล SML ผ่าน Tomcat JavaWS โดย secret จะถูกเข้ารหัสฝั่ง server",
      });
      if (!headers) {
        throw new Error("กรุณาเข้าสู่ระบบผู้ดูแลก่อนบันทึกการเชื่อม SML");
      }

      const response = await fetch(
        `${API_BASE_URL}/api/owner/tenants/${tenant.id}/datasource/config`,
        {
          method: "PUT",
          headers,
          body: JSON.stringify(payload),
        },
      );
      const responsePayload = (await response.json().catch(() => ({}))) as {
        data?: DatasourceConfigStatus;
        error?: string;
      };
      if (!response.ok || !responsePayload.data) {
        throw new Error(responsePayload.error || "บันทึกการเชื่อม SML ไม่สำเร็จ");
      }

      setDatasourceConfig(responsePayload.data);
      setJavaWsAuthSecret("");
      setResult({
        tone: "success",
        message: "บันทึกการเชื่อม SML แบบเข้ารหัสแล้ว",
      });
      await loadOwnerData();
    });
  }

  async function saveSystemConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runOwnerAction("system-config-save", async () => {
      const tenantIds = systemMorningBriefTenantIds
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

      const headers = await buildAdminJsonHeaders({
        actionLabel: "บันทึก System Config",
        description:
          "บันทึก runtime settings ลง encrypted system store โดยไม่เก็บ worker token แบบอ่านได้",
      });
      if (!headers) {
        throw new Error("กรุณาเข้าสู่ระบบผู้ดูแลก่อนบันทึก System Config");
      }

      const response = await fetch(`${API_BASE_URL}/api/owner/system/config`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          app_base_url: systemAppBaseUrl.trim(),
          public_api_base_url: systemPublicApiBaseUrl.trim(),
          report_viewer_signing_secret:
            systemReportViewerSigningSecret.trim() || undefined,
          report_viewer_link_ttl_hours:
            Number(systemReportViewerLinkTtlHours.trim()) || 72,
          morning_brief_enabled: systemMorningBriefEnabled,
          morning_brief_tenant_ids: tenantIds.length
            ? tenantIds
            : ["tenant_demo_remote"],
          morning_brief_time: systemMorningBriefTime,
          morning_brief_timezone: systemMorningBriefTimezone.trim(),
          morning_brief_mode: systemMorningBriefMode,
          morning_brief_force: systemMorningBriefForce,
          worker_id: systemWorkerId.trim(),
          worker_heartbeat_token:
            systemWorkerHeartbeatToken.trim() || undefined,
          backup_configured: systemBackupConfigured,
          system_last_backup_at: systemLastBackupAt.trim() || null,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        data?: SystemConfigStatus;
        error?: string;
      };
      if (!response.ok || !payload.data) {
        throw new Error(payload.error || "บันทึก System Config ไม่สำเร็จ");
      }

      applySystemConfigState(payload.data);
      setResult({
        tone: "success",
        message: "บันทึก System Config ลง encrypted store แล้ว",
      });
      await loadOwnerData();
    });
  }

  async function createTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const tenantName = newTenantName.trim();
    const tenantId = (newTenantId.trim() || slugifyTenantId(tenantName)).trim();
    if (!tenantName || !tenantId) {
      setResult({ tone: "warning", message: "กรุณากรอกชื่อร้านค้า" });
      return;
    }

    await runOwnerAction("create", async () => {
      const headers = await buildAdminJsonHeaders({
        actionLabel: "เพิ่มร้านค้าใหม่",
        description: "สร้างร้านใหม่ในระบบ SaaS pilot",
      });
      if (!headers) {
        throw new Error("กรุณาเข้าสู่ระบบผู้ดูแลก่อนเพิ่มร้านค้า");
      }

      const response = await fetch(`${API_BASE_URL}/api/owner/tenants`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          tenant_id: tenantId,
          name: tenantName,
          status: "trial",
          plan_code: "starter",
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error || "เพิ่มร้านค้าไม่สำเร็จ");
      }

      setNewTenantName("");
      setNewTenantId("");
      setSelectedTenantId(tenantId);
      setJustCreatedTenantId(tenantId);
      setResult({ tone: "success", message: "เพิ่มร้านค้าใหม่แล้ว" });
      await loadOwnerData();
    });
  }

  async function saveTelegramBotToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runOwnerAction("telegram-token-save", async () => {
      if (!telegramBotTokenInput.trim()) {
        throw new Error("กรุณากรอก Telegram bot token ก่อนบันทึก");
      }
      const confirmed = await requestAdminConfirmation({
        title: "ยืนยันบันทึก Telegram bot token",
        message:
          "ระบบจะตรวจสอบ token กับ Telegram และเข้ารหัสเก็บใน secret store โดยไม่แสดง token กลับใน UI",
        confirmLabel: "บันทึก token",
        tone: "primary",
      });
      if (!confirmed) {
        return;
      }
      const headers = await buildAdminJsonHeaders({
        actionLabel: "บันทึก Telegram ops alert token",
        description:
          "ใช้ส่ง operational alert ให้ owner เท่านั้น token จะถูกเข้ารหัสฝั่ง server",
      });
      if (!headers) {
        throw new Error("กรุณาเข้าสู่ระบบผู้ดูแลก่อนบันทึก Telegram token");
      }
      const response = await fetch(
        `${API_BASE_URL}/api/owner/operational-alerts/telegram/secrets`,
        {
          method: "PUT",
          headers,
          body: JSON.stringify({ bot_token: telegramBotTokenInput.trim() }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "บันทึก Telegram token ไม่สำเร็จ");
      }
      setTelegramBotTokenInput("");
      setResult({
        tone: "success",
        message: "ตรวจสอบและบันทึก Telegram bot token แล้ว",
      });
      await loadOwnerData();
    });
  }

  async function loadTelegramChats() {
    await runOwnerAction("telegram-chats-load", async () => {
      const headers = await buildAdminJsonHeaders({
        actionLabel: "โหลด Telegram chats",
        description: "อ่าน recent updates หลังจาก owner ส่ง /start ให้ bot",
      });
      if (!headers) {
        throw new Error("กรุณาเข้าสู่ระบบผู้ดูแลก่อนโหลด Telegram chats");
      }
      const response = await fetch(
        `${API_BASE_URL}/api/owner/operational-alerts/telegram/updates`,
        { headers },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        data?: TelegramChatPreview[];
        error?: string;
      };
      if (!response.ok || !payload.data) {
        throw new Error(payload.error || "โหลด Telegram chats ไม่สำเร็จ");
      }
      setTelegramChats(payload.data);
      setResult({
        tone: payload.data.length ? "success" : "warning",
        message: payload.data.length
          ? "โหลด Telegram chats ล่าสุดแล้ว"
          : "ยังไม่พบ chat ให้ส่ง /start ไปที่ bot แล้วกดโหลดอีกครั้ง",
      });
    });
  }

  async function saveTelegramTarget(chat: TelegramChatPreview) {
    await runOwnerAction(`telegram-target-${chat.chat_id_masked}`, async () => {
      const headers = await buildAdminJsonHeaders({
        actionLabel: "เลือก Telegram alert target",
        description: "เข้ารหัส chat id และใช้เป็นปลายทาง ops alert",
      });
      if (!headers) {
        throw new Error("กรุณาเข้าสู่ระบบผู้ดูแลก่อนเลือก Telegram chat");
      }
      const response = await fetch(
        `${API_BASE_URL}/api/owner/operational-alerts/telegram/targets`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            chat_id: chat.chat_id,
            display_name: chat.display_name,
            enabled: true,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "บันทึก Telegram target ไม่สำเร็จ");
      }
      setResult({
        tone: "success",
        message: `เลือก ${chat.display_name} เป็น Telegram ops target แล้ว`,
      });
      await loadOwnerData();
    });
  }

  async function sendTelegramTestAlert() {
    await runOwnerAction("telegram-test-alert", async () => {
      const headers = await buildAdminJsonHeaders({
        actionLabel: "ส่ง Telegram test alert",
        description: "ส่งข้อความทดสอบไปยัง Telegram ops target ที่เลือกไว้",
      });
      if (!headers) {
        throw new Error("กรุณาเข้าสู่ระบบผู้ดูแลก่อนส่ง test alert");
      }
      const response = await fetch(
        `${API_BASE_URL}/api/owner/operational-alerts/telegram/test`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ message: "Owner UI test" }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "ส่ง Telegram test alert ไม่สำเร็จ");
      }
      setResult({ tone: "success", message: "ส่ง Telegram test alert แล้ว" });
      await loadOwnerData();
    });
  }

  async function runOperationalAlertSmokeTest(alertType: string) {
    await runOwnerAction(`telegram-smoke-${alertType}`, async () => {
      const headers = await buildAdminJsonHeaders({
        actionLabel: "รัน ops alert dry-run",
        description: "บันทึก dry-run delivery โดยไม่ส่ง provider จริง",
      });
      if (!headers) {
        throw new Error("กรุณาเข้าสู่ระบบผู้ดูแลก่อนรัน dry-run");
      }
      const response = await fetch(
        `${API_BASE_URL}/api/owner/operational-alerts/smoke-test`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            alert_type: alertType,
            severity: alertType === "notification_summary" ? "info" : "warning",
            tenant_id: selectedTenantId || undefined,
            scheduled_time: "08:00",
            report_key:
              alertType === "javaws_diagnostic" ? "sales_goods_services" : undefined,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "รัน ops alert dry-run ไม่สำเร็จ");
      }
      setResult({
        tone: "success",
        message: "บันทึก ops alert dry-run แล้ว โดยไม่ได้ส่ง Telegram จริง",
      });
      await loadOwnerData();
    });
  }

  async function createLineChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const displayName = lineChannelName.trim();
    if (!selectedTenantId || !displayName) {
      setResult({
        tone: "warning",
        message: "กรุณาเลือกร้านค้าและกรอกชื่อ LINE OA",
      });
      return;
    }

    await runOwnerAction("create-line-channel", async () => {
      const headers = await buildAdminJsonHeaders({
        actionLabel: "เพิ่ม LINE OA ให้ร้านค้า",
        description:
          "บันทึก LINE OA metadata สำหรับร้านนี้ โดยไม่แสดง token/secret ใน UI",
      });
      if (!headers) {
        throw new Error("กรุณาเข้าสู่ระบบผู้ดูแลก่อนเพิ่ม LINE OA");
      }

      const response = await fetch(`${API_BASE_URL}/api/owner/line-channels`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          tenant_id: selectedTenantId,
          display_name: displayName,
          scope: lineChannelShared ? "owner_shared" : "tenant",
          channel_access_token_configured: lineTokenConfigured,
          channel_secret_configured: lineSecretConfigured,
          enabled: true,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error || "เพิ่ม LINE OA ไม่สำเร็จ");
      }

      setLineChannelName("");
      setLineChannelShared(false);
      setResult({ tone: "success", message: "เพิ่ม LINE OA ให้ร้านค้าแล้ว" });
      await loadOwnerData();
    });
  }

  async function saveLineChannelSecretConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const channel = lineChannels.find((item) => item.id === lineSecretChannelId);
    if (!channel) {
      setResult({ tone: "warning", message: "กรุณาเลือก LINE OA ก่อนบันทึก secret" });
      return;
    }
    if (!lineAccessTokenInput.trim() && !lineChannelSecretInput.trim()) {
      setResult({
        tone: "warning",
        message: "กรุณาใส่ Channel access token หรือ Channel secret อย่างน้อย 1 ค่า",
      });
      return;
    }

    await runOwnerAction(`line-secrets-${channel.id}`, async () => {
      const confirmed = await requestAdminConfirmation({
        title: "ยืนยันบันทึก LINE OA secret",
        message:
          "ระบบจะเข้ารหัส token/secret ก่อนเก็บ และจะไม่แสดงค่าเต็มใน UI หรือ audit log",
        confirmLabel: "บันทึก LINE secret",
        details: [
          { label: "ร้านค้า", value: selectedTenant?.name ?? channel.tenant_id },
          { label: "LINE OA", value: channel.display_name },
          {
            label: "ข้อมูลที่จะบันทึก",
            value: [
              lineAccessTokenInput.trim() ? "Channel access token" : null,
              lineChannelSecretInput.trim() ? "Channel secret" : null,
            ]
              .filter(Boolean)
              .join(", "),
          },
        ],
      });
      if (!confirmed) {
        return;
      }

      const headers = await buildAdminJsonHeaders({
        actionLabel: `บันทึก LINE secret ของ ${channel.display_name}`,
        description:
          "ใช้สำหรับส่งแผนแจ้งเตือนและตรวจ webhook ของ LINE OA นี้",
      });
      if (!headers) {
        throw new Error("กรุณาเข้าสู่ระบบผู้ดูแลก่อนบันทึก LINE secret");
      }

      const response = await fetch(
        `${API_BASE_URL}/api/owner/line-channels/${channel.id}/secrets`,
        {
          method: "PUT",
          headers,
          body: JSON.stringify({
            channel_access_token: lineAccessTokenInput.trim() || undefined,
            channel_secret: lineChannelSecretInput.trim() || undefined,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        data?: LineChannelRecord;
        error?: string;
      };
      if (!response.ok || !payload.data) {
        throw new Error(payload.error || "บันทึก LINE secret ไม่สำเร็จ");
      }

      setLineAccessTokenInput("");
      setLineChannelSecretInput("");
      setResult({ tone: "success", message: "บันทึก LINE secret แบบเข้ารหัสแล้ว" });
      await loadOwnerData();
    });
  }

  async function updateLineChannel(input: {
    channel: LineChannelRecord;
    displayName: string;
    scope: LineChannelScope;
    enabled: boolean;
  }) {
    const displayName = input.displayName.trim();
    if (!displayName) {
      setResult({ tone: "warning", message: "กรุณากรอกชื่อ LINE OA" });
      return;
    }

    await runOwnerAction(`line-channel-update-${input.channel.id}`, async () => {
      const headers = await buildAdminJsonHeaders({
        actionLabel: `แก้ไข LINE OA ${input.channel.display_name}`,
        description:
          "แก้ชื่อ สถานะเปิดใช้งาน และกำหนดว่า LINE OA นี้เป็น OA กลางหรือของร้าน",
      });
      if (!headers) {
        throw new Error("กรุณาเข้าสู่ระบบผู้ดูแลก่อนแก้ไข LINE OA");
      }

      const response = await fetch(
        `${API_BASE_URL}/api/owner/line-channels/${input.channel.id}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            display_name: displayName,
            scope: input.scope,
            enabled: input.enabled,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        data?: LineChannelRecord;
        error?: string;
      };
      if (!response.ok || !payload.data) {
        throw new Error(payload.error || "แก้ไข LINE OA ไม่สำเร็จ");
      }

      setResult({ tone: "success", message: "บันทึกการแก้ไข LINE OA แล้ว" });
      await loadOwnerData();
    });
  }

  async function assignLineRecipientToTenant(input: {
    recipient: LineRecipientRecord;
    lineChannelId: string;
    profileKey: LineAccessProfileKey;
  }) {
    if (!selectedTenantId) {
      setResult({ tone: "warning", message: "กรุณาเลือกร้านค้าก่อนเพิ่มผู้รับ LINE" });
      return;
    }
    if (!input.lineChannelId) {
      setResult({ tone: "warning", message: "กรุณาเลือก LINE OA ที่ใช้ส่งให้ผู้รับนี้" });
      return;
    }

    await runOwnerAction(
      `assign-line-recipient-${selectedTenantId}-${input.recipient.id}`,
      async () => {
        const headers = await buildAdminJsonHeaders({
          actionLabel: "เพิ่มผู้รับ LINE เข้าร้าน",
          description:
            "สร้าง assignment ผู้รับ LINE ให้ร้านนี้ โดยสิทธิ์รายงานจะแยกจากร้านอื่น",
        });
        if (!headers) {
          throw new Error("กรุณาเข้าสู่ระบบผู้ดูแลก่อนเพิ่มผู้รับ LINE เข้าร้าน");
        }

        const response = await fetch(
          `${API_BASE_URL}/api/owner/tenants/${selectedTenantId}/line-target-assignments`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              source_target_id: input.recipient.source_target_id,
              line_channel_id: input.lineChannelId,
              access_profile_key: input.profileKey,
            }),
          },
        );
        const payload = (await response.json().catch(() => ({}))) as {
          data?: LineTargetRecord;
          error?: string;
        };

        if (!response.ok || !payload.data) {
          throw new Error(payload.error || "เพิ่มผู้รับ LINE เข้าร้านไม่สำเร็จ");
        }

        setResult({
          tone: "success",
          message: `${payload.data.display_name}: เพิ่มเป็นผู้รับของร้านนี้แล้ว`,
        });
        await loadOwnerData();
      },
    );
  }

  async function approveLineTarget(
    target: LineTargetRecord,
    profileKey: LineAccessProfileKey,
  ) {
    await runOwnerAction(`approve-line-target-${target.id}`, async () => {
      const headers = await buildAdminJsonHeaders({
        actionLabel: "อนุมัติผู้รับ LINE",
        description:
          "เปิดให้ผู้รับนี้รับแผนแจ้งเตือนตามสิทธิ์ที่เลือก โดยไม่เปิดเผย LINE id เต็ม",
      });
      if (!headers) {
        throw new Error("กรุณาเข้าสู่ระบบผู้ดูแลก่อนอนุมัติผู้รับ LINE");
      }

      const response = await fetch(
        `${API_BASE_URL}/api/line-targets/${target.id}/approve`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            access_profile_key: profileKey,
            enabled: true,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        data?: LineTargetRecord;
        error?: string;
      };

      if (!response.ok || !payload.data) {
        throw new Error(payload.error || "อนุมัติผู้รับ LINE ไม่สำเร็จ");
      }

      setSelectedTenantId(payload.data.tenant_id);
      setResult({
        tone: "success",
        message: `อนุมัติ ${payload.data.display_name} เป็น ${formatLineAccessProfile(payload.data.access_profile_key)} แล้ว`,
      });
      await loadOwnerData();
    });
  }

  async function updateLineTargetProfile(
    target: LineTargetRecord,
    profileKey: LineAccessProfileKey,
  ) {
    await runOwnerAction(
      `line-target-profile-${target.id}-${profileKey}`,
      async () => {
        const headers = await buildAdminJsonHeaders({
          actionLabel: "เปลี่ยนสิทธิ์ผู้รับ LINE",
          description:
            "ปรับสิทธิ์รายงานของปลายทางนี้ เช่น ผู้บริหาร ฝ่ายขาย ปฏิบัติการ หรือพนักงาน",
        });
        if (!headers) {
          throw new Error("กรุณาเข้าสู่ระบบผู้ดูแลก่อนเปลี่ยนสิทธิ์ผู้รับ LINE");
        }

        const response = await fetch(
          `${API_BASE_URL}/api/line-targets/${target.id}`,
          {
            method: "PATCH",
            headers,
            body: JSON.stringify({ access_profile_key: profileKey }),
          },
        );
        const payload = (await response.json().catch(() => ({}))) as {
          data?: LineTargetRecord;
          error?: string;
        };

        if (!response.ok || !payload.data) {
          throw new Error(payload.error || "เปลี่ยนสิทธิ์ผู้รับ LINE ไม่สำเร็จ");
        }

        setResult({
          tone: "success",
          message: `${payload.data.display_name}: ${formatLineAccessProfile(payload.data.access_profile_key)}`,
        });
        await loadOwnerData();
      },
    );
  }

  async function toggleLineTarget(target: LineTargetRecord) {
    await runOwnerAction(`line-target-toggle-${target.id}`, async () => {
      const headers = await buildAdminJsonHeaders({
        actionLabel: target.enabled
          ? "ปิดรับแผนแจ้งเตือน"
          : "เปิดรับแผนแจ้งเตือน",
        description:
          "เปลี่ยนเฉพาะสถานะเปิด/ปิดของปลายทางนี้ ไม่เปลี่ยน profile สิทธิ์รายงาน",
      });
      if (!headers) {
        throw new Error("กรุณาเข้าสู่ระบบผู้ดูแลก่อนเปลี่ยนสถานะผู้รับ LINE");
      }

      const response = await fetch(
        `${API_BASE_URL}/api/line-targets/${target.id}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({ enabled: !target.enabled }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        data?: LineTargetRecord;
        error?: string;
      };

      if (!response.ok || !payload.data) {
        throw new Error(payload.error || "เปลี่ยนสถานะผู้รับ LINE ไม่สำเร็จ");
      }

      setResult({
        tone: "success",
        message: payload.data.enabled
          ? "เปิดรับแผนแจ้งเตือนให้ผู้รับนี้แล้ว"
          : "ปิดรับแผนแจ้งเตือนให้ผู้รับนี้แล้ว",
      });
      await loadOwnerData();
    });
  }

  async function testLineTarget(target: LineTargetRecord) {
    await runOwnerAction(`line-target-test-${target.id}`, async () => {
      const confirmed = await requestAdminConfirmation({
        title: "ยืนยันส่ง LINE test จริง",
        message:
          "ระบบจะส่ง Flex ทดสอบไปยังผู้รับนี้เท่านั้น เพื่อยืนยันว่าผู้รับได้รับข้อความจริง",
        confirmLabel: "ส่งทดสอบ",
        tone: "danger",
        details: [
          { label: "ผู้รับ/ปลายทาง", value: target.display_name },
          { label: "รหัสปลายทาง", value: target.target_id_masked },
          {
            label: "สิทธิ์",
            value: formatLineAccessProfile(target.access_profile_key),
          },
        ],
      });
      if (!confirmed) {
        return;
      }

      const headers = await buildAdminJsonHeaders({
        actionLabel: "ส่ง LINE test จริง",
        description:
          "ใช้ทดสอบเฉพาะปลายทางนี้หลัง owner อนุมัติสิทธิ์แล้ว",
      });
      if (!headers) {
        throw new Error("กรุณาเข้าสู่ระบบผู้ดูแลก่อนส่ง LINE test");
      }

      const response = await fetch(
        `${API_BASE_URL}/api/line-targets/${target.id}/test-send`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ mode: "send" }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        data?: { delivery?: LineDeliveryRecord };
        error?: string;
      };

      if (!response.ok || !payload.data?.delivery) {
        throw new Error(payload.error || "ส่ง LINE test ไม่สำเร็จ");
      }

      setResult({
        tone:
          payload.data.delivery.status === "success" ? "success" : "warning",
        message:
          payload.data.delivery.status === "success"
            ? "ส่ง LINE test สำเร็จ"
            : payload.data.delivery.safe_error_message ??
              "ส่ง LINE test แล้วแต่ยังไม่สำเร็จ",
      });
      await loadOwnerData();
    });
  }

  async function updateLineTargetRecipientEstimate(
    target: LineTargetRecord,
    recipientCountEstimate: number | null,
  ) {
    await runOwnerAction(`line-target-recipient-estimate-${target.id}`, async () => {
      const headers = await buildAdminJsonHeaders({
        actionLabel: "บันทึกจำนวนผู้รับโดยประมาณ",
        description:
          "ใช้ประเมิน LINE quota ต่อเดือนเท่านั้น ไม่กระทบ LINE id หรือสิทธิ์รายงาน",
      });
      if (!headers) {
        throw new Error("กรุณาเข้าสู่ระบบผู้ดูแลก่อนบันทึกจำนวนผู้รับ");
      }

      const response = await fetch(
        `${API_BASE_URL}/api/line-targets/${target.id}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            recipient_count_estimate: recipientCountEstimate,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        data?: LineTargetRecord;
        error?: string;
      };

      if (!response.ok || !payload.data) {
        throw new Error(payload.error || "บันทึกจำนวนผู้รับไม่สำเร็จ");
      }

      setResult({
        tone: "success",
        message: `${payload.data.display_name}: บันทึก quota estimate แล้ว`,
      });
      await loadOwnerData();
    });
  }

  async function updateTenantDetails(tenant: Tenant, input: TenantPatchInput) {
    if (!input.name.trim()) {
      setResult({ tone: "warning", message: "กรุณากรอกชื่อร้านค้า" });
      return;
    }

    if (
      input.status &&
      input.status !== tenant.status &&
      (input.status === "suspended" ||
        tenant.status === "suspended" ||
        tenant.status === "cancelled")
    ) {
      const confirmed = await requestAdminConfirmation({
        title:
          input.status === "suspended"
            ? `ระงับร้าน ${tenant.name}?`
            : `เปิดใช้งานร้าน ${tenant.name}?`,
        message:
          input.status === "suspended"
            ? "ร้านนี้จะถูกบล็อก dashboard และหยุดส่ง LINE จริงจนกว่าจะเปิดใช้งานอีกครั้ง"
            : "ระบบจะไม่เปิดแผนแจ้งเตือนที่เคยถูกปิดกลับให้อัตโนมัติ เพื่อกันการส่ง LINE โดยไม่ตั้งใจ",
        details: [
          { label: "สถานะเดิม", value: formatTenantStatus(tenant.status) },
          { label: "สถานะใหม่", value: formatTenantStatus(input.status) },
        ],
        confirmLabel: "ยืนยัน",
        tone: input.status === "suspended" ? "danger" : "primary",
      });
      if (!confirmed) {
        return;
      }
    }

    await runOwnerAction(`${tenant.id}-save`, async () => {
      const headers = await buildAdminJsonHeaders({
        actionLabel: `แก้ไขร้าน ${tenant.name}`,
        description: "บันทึกชื่อร้าน แพ็กเกจ และสถานะ subscription",
      });
      if (!headers) {
        throw new Error("กรุณาเข้าสู่ระบบผู้ดูแลก่อนแก้ไขร้าน");
      }

      const response = await fetch(
        `${API_BASE_URL}/api/owner/tenants/${tenant.id}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify(input),
        },
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error || "บันทึกร้านไม่สำเร็จ");
      }

      setResult({ tone: "success", message: "บันทึกข้อมูลร้านแล้ว" });
      await loadOwnerData();
      await loadStoreSetupDetail(tenant.id);
    });
  }

  async function updateBusinessSignalStatus(
    signal: BusinessSignalRecord,
    status: BusinessSignalRecord["status"],
  ) {
    const tenant = tenants.find((item) => item.tenant.id === signal.tenant_id)?.tenant;
    await runOwnerAction(`business-signal-${signal.id}-${status}`, async () => {
      const headers = await buildAdminJsonHeaders({
        actionLabel: formatBusinessSignalStatusAction(status),
        description:
          "บันทึกสถานะเรื่องที่ต้องจัดการ เพื่อให้ Owner cockpit และ audit log ตรงกัน",
      });
      if (!headers) {
        throw new Error("กรุณาเข้าสู่ระบบผู้ดูแลก่อนเปลี่ยนสถานะ signal");
      }

      const response = await fetch(
        `${API_BASE_URL}/api/owner/tenants/${signal.tenant_id}/business-signals/${encodeURIComponent(
          signal.id,
        )}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({ status }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        data?: BusinessSignalRecord;
        error?: string;
      };
      if (!response.ok || !payload.data) {
        throw new Error(payload.error || "เปลี่ยนสถานะ signal ไม่สำเร็จ");
      }

      setResult({
        tone: "success",
        message: `${tenant?.name ?? signal.tenant_id}: ${formatBusinessSignalStatusAction(status)}สำเร็จ`,
      });
      await loadStoreSetupDetail(signal.tenant_id);
    });
  }

  async function previewTenantDeleteImpact(tenantId: string) {
    const headers = await buildAdminJsonHeaders({
      actionLabel: "ตรวจผลกระทบก่อนยกเลิกร้าน",
      description:
        "อ่านจำนวนแผนแจ้งเตือน ผู้รับ LINE และ report history ก่อน soft delete",
    });
    if (!headers) {
      throw new Error("กรุณาเข้าสู่ระบบผู้ดูแลก่อนตรวจผลกระทบ");
    }

    const response = await fetch(
      `${API_BASE_URL}/api/owner/tenants/${tenantId}/delete-impact`,
      { headers },
    );
    const payload = (await response.json().catch(() => ({}))) as {
      data?: TenantDeleteImpact;
      error?: string;
    };
    if (!response.ok || !payload.data) {
      throw new Error(payload.error || "โหลดผลกระทบก่อนยกเลิกร้านไม่สำเร็จ");
    }

    return payload.data;
  }

  async function cancelTenant(
    tenant: Tenant,
    input: { confirmName: string; reason: string },
  ) {
    const confirmed = await requestAdminConfirmation({
      title: `ยกเลิกร้าน ${tenant.name}?`,
      message:
        "ระบบจะ soft delete โดยตั้งสถานะเป็นยกเลิก ปิดแผนแจ้งเตือนที่เปิดอยู่ และเก็บ logs, LINE targets, snapshots ไว้ตรวจย้อนหลัง",
      details: [
        { label: "ร้าน", value: tenant.name },
        { label: "ผลหลังยกเลิก", value: "ไม่ส่ง LINE และไม่เปิด dashboard ลูกค้า" },
      ],
      confirmLabel: "ยืนยันยกเลิก",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }

    await runOwnerAction(`${tenant.id}-cancel`, async () => {
      const headers = await buildAdminJsonHeaders({
        actionLabel: `ยกเลิกร้าน ${tenant.name}`,
        description: "Soft delete ร้านและปิดแผนแจ้งเตือนที่ยัง enabled",
      });
      if (!headers) {
        throw new Error("กรุณาเข้าสู่ระบบผู้ดูแลก่อนยกเลิกร้าน");
      }

      const response = await fetch(
        `${API_BASE_URL}/api/owner/tenants/${tenant.id}`,
        {
          method: "DELETE",
          headers,
          body: JSON.stringify({
            confirm_name: input.confirmName,
            reason: input.reason.trim() || undefined,
          }),
        },
      );

      const payload = (await response.json().catch(() => ({}))) as {
        data?: {
          disabled_notification_rules?: number;
          already_cancelled?: boolean;
        };
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "ยกเลิกร้านไม่สำเร็จ");
      }

      setResult({
        tone: "success",
        message: payload.data?.already_cancelled
          ? "ร้านนี้ถูกยกเลิกอยู่แล้ว ระบบตรวจสอบแล้วว่าไม่มี action ซ้ำที่ทำข้อมูลเสีย"
          : `ยกเลิกร้านแล้ว และปิดแผนแจ้งเตือน ${payload.data?.disabled_notification_rules ?? 0} แผน`,
      });
      await loadOwnerData();
      await loadStoreSetupDetail(tenant.id);
    });
  }

  async function updateTenantStatus(
    tenant: Tenant,
    status: Tenant["status"],
  ) {
    if (status === "cancelled") {
      setResult({
        tone: "warning",
        message: "การยกเลิกร้านต้องใช้กล่องยืนยันด้านขวาและพิมพ์ชื่อร้าน",
      });
      return;
    }
    if (status === tenant.status) {
      return;
    }
    if (
      status === "suspended" ||
      tenant.status === "suspended" ||
      tenant.status === "cancelled"
    ) {
      const confirmed = await requestAdminConfirmation({
        title:
          status === "suspended"
            ? `ระงับร้าน ${tenant.name}?`
            : `เปิดใช้งานร้าน ${tenant.name}?`,
        message:
          status === "suspended"
            ? "ร้านนี้จะถูกบล็อก dashboard และหยุดส่ง LINE จริง"
            : "การเปิดร้านกลับจะไม่เปิดแผนแจ้งเตือนเดิมให้อัตโนมัติ",
        details: [
          { label: "สถานะเดิม", value: formatTenantStatus(tenant.status) },
          { label: "สถานะใหม่", value: formatTenantStatus(status) },
        ],
        confirmLabel: "ยืนยัน",
        tone: status === "suspended" ? "danger" : "primary",
      });
      if (!confirmed) {
        return;
      }
    }

    await runOwnerAction(`${tenant.id}-${status}`, async () => {
      const headers = await buildAdminJsonHeaders({
        actionLabel: `เปลี่ยนสถานะร้าน ${tenant.name}`,
        description:
          status === "suspended"
            ? "ร้านนี้จะถูกบล็อก dashboard และหยุดส่ง LINE"
            : "อัปเดตสถานะ subscription ของร้านนี้",
      });
      if (!headers) {
        throw new Error("กรุณาเข้าสู่ระบบผู้ดูแลก่อนเปลี่ยนสถานะร้าน");
      }

      const response = await fetch(
        `${API_BASE_URL}/api/owner/tenants/${tenant.id}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            status,
            suspended_reason:
              status === "suspended" ? "ระงับโดย Owner Admin" : null,
          }),
        },
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error || "เปลี่ยนสถานะร้านไม่สำเร็จ");
      }

      setResult({ tone: "success", message: "อัปเดตสถานะร้านแล้ว" });
      await loadOwnerData();
    });
  }

  async function discoverJavaWsDatabases(tenantId: string) {
    const tenant = tenants.find((item) => item.tenant.id === tenantId)?.tenant;
    if (!tenant) {
      setResult({ tone: "warning", message: "ไม่พบร้านค้าที่ต้องการค้นหา database" });
      return;
    }

    await runOwnerAction(`javaws-databases-${tenantId}`, async () => {
      const payload = buildJavaWsDiscoveryPayload();
      const headers = await buildAdminJsonHeaders({
        actionLabel: `ค้นหา JavaWS database ของ ${tenant.name}`,
        description:
          "เรียก SOAP _getDatabaseList เพื่ออ่านรายชื่อ database จาก config file โดยไม่ส่ง SQL จาก UI",
      });
      if (!headers) {
        throw new Error("กรุณาเข้าสู่ระบบผู้ดูแลก่อนค้นหา JavaWS database");
      }

      const response = await fetch(
        `${API_BASE_URL}/api/owner/tenants/${tenantId}/datasource/javaws/databases`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        },
      );
      const responsePayload = (await response.json().catch(() => ({}))) as {
        data?: JavaWsDatabaseDiscoveryResult;
        error?: string;
      };
      if (!responsePayload.data) {
        throw new Error(responsePayload.error || "ค้นหา JavaWS database ไม่สำเร็จ");
      }

      setJavaWsDatabaseDiscovery(responsePayload.data);
      if (responsePayload.data.databases.length === 1) {
        setJavaWsDatabase(responsePayload.data.databases[0].database_name);
      }
      setResult({
        tone: responsePayload.data.ok ? "success" : "warning",
        message: responsePayload.data.ok
          ? `พบ ${responsePayload.data.databases.length.toLocaleString("th-TH")} database จาก JavaWS`
          : toDatasourceBusinessMessage(responsePayload.data.safe_error_message),
      });

      if (!response.ok) {
        return;
      }
    });
  }

  async function testDatasource(tenantId: string, source: "form" | "saved" = "form") {
    const tenant = tenants.find((item) => item.tenant.id === tenantId)?.tenant;
    if (!tenant) {
      setResult({ tone: "warning", message: "ไม่พบร้านค้าที่ต้องการทดสอบ" });
      return;
    }

    await runOwnerAction(
      source === "saved" ? `datasource-saved-${tenantId}` : `datasource-${tenantId}`,
      async () => {
        const datasourcePayload = source === "form" ? buildDatasourcePayload() : null;
        const headers = await buildAdminJsonHeaders({
          actionLabel:
            source === "saved"
              ? `ทดสอบการเชื่อม SML ที่บันทึกแล้วของ ${tenant.name}`
              : `ทดสอบการเชื่อม SML ของ ${tenant.name}`,
          description:
            source === "saved"
              ? "ตรวจการเชื่อมต่อ SML จาก encrypted store โดยไม่ต้องกรอก secret ซ้ำ"
              : "ตรวจการเชื่อมต่อ SML ผ่าน JavaWS จากค่าที่กรอก โดยไม่แสดง token หรือ credential เต็มใน UI",
        });
        if (!headers) {
          throw new Error("กรุณาเข้าสู่ระบบผู้ดูแลก่อนทดสอบการเชื่อม SML");
        }

        const response = await fetch(
          `${API_BASE_URL}/api/owner/tenants/${tenantId}/datasource/test`,
          {
            method: "POST",
            headers,
            body: datasourcePayload ? JSON.stringify(datasourcePayload) : undefined,
          },
        );
        const payload = (await response.json().catch(() => ({}))) as {
          data?: DatasourceTestResult;
          error?: string;
        };

        if (payload.data) {
          setDatasourceTests((previous) => ({
            ...previous,
            [tenantId]: payload.data as DatasourceTestResult,
          }));
          await loadOwnerData();
          setResult({
            tone: payload.data.ok ? "success" : "warning",
            message: payload.data.ok
              ? `เชื่อมต่อ SML ของ ${tenant.name} สำเร็จ`
              : toDatasourceBusinessMessage(payload.data.safe_error_message),
          });
          return;
        }

        throw new Error(payload.error || "ทดสอบการเชื่อม SML ไม่สำเร็จ");
      },
    );
  }

  async function runSalesReport() {
    const tenant = selectedTenantSummary?.tenant;
    if (!tenant) {
      setResult({ tone: "warning", message: "กรุณาเลือกร้านค้าก่อนรันรายงาน" });
      return;
    }
    if (!reportDateFrom || !reportDateTo || reportDateFrom > reportDateTo) {
      setResult({
        tone: "warning",
        message: "กรุณาเลือกช่วงวันที่ให้ถูกต้อง",
      });
      return;
    }

    await runOwnerAction(`report-run-${tenant.id}`, async () => {
      const confirmed = await requestAdminConfirmation({
        title: "ยืนยันรันรายงาน SML",
        message:
          "ระบบจะ query ฐานข้อมูล SML ของร้านนี้และบันทึก snapshot ล่าสุดให้ dashboard และ LINE ใช้ต่อ",
        confirmLabel: "รันรายงาน",
        details: [
          { label: "ร้านค้า", value: tenant.name },
          {
            label: "รายงาน",
            value: "รายงานขายสินค้าและบริการ",
          },
          {
            label: "ช่วงวันที่",
            value: formatReportPeriod(reportDateFrom, reportDateTo),
          },
        ],
      });
      if (!confirmed) {
        return;
      }

      const headers = await buildAdminJsonHeaders({
        actionLabel: "รันรายงานขายสินค้าและบริการ",
        description:
          "ระบบจะ query ฐาน SML ของร้านนี้ผ่าน JavaWS และบันทึก snapshot ล่าสุด",
      });
      if (!headers) {
        throw new Error("กรุณาเข้าสู่ระบบผู้ดูแลก่อนรันรายงาน");
      }

      const response = await fetch(
        `${API_BASE_URL}/api/reports/${tenant.id}/sales_goods_services/run`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            date_from: reportDateFrom,
            date_to: reportDateTo,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        data?: SalesGoodsServicesSnapshot;
        run?: ReportRunRecord;
        error?: string;
      };

      if (!response.ok || !payload.data) {
        if (response.status === 401 || response.status === 403) {
          forgetAdminToken();
        }
        if (payload.run) {
          setLastManualRun(payload.run);
        }
        throw new Error(payload.error || "รันรายงานไม่สำเร็จ");
      }

      setLastManualSnapshot(payload.data);
      setLastManualRun(payload.run ?? null);
      setValidationSignoffResult(null);
      setResult({
        tone: "success",
        message: `${tenant.name}: รันรายงานสำเร็จ ยอดขาย ${formatCurrency(payload.data.summary.total_sales)} จาก ${payload.data.summary.document_count.toLocaleString("th-TH")} บิล`,
      });
      await loadOwnerData();
    });
  }

  async function runPurchaseReport() {
    const tenant = selectedTenantSummary?.tenant;
    if (!tenant) {
      setResult({ tone: "warning", message: "กรุณาเลือกร้านค้าก่อนรันรายงาน" });
      return;
    }
    if (!reportDateFrom || !reportDateTo || reportDateFrom > reportDateTo) {
      setResult({
        tone: "warning",
        message: "กรุณาเลือกช่วงวันที่ให้ถูกต้อง",
      });
      return;
    }

    await runOwnerAction(`purchase-report-run-${tenant.id}`, async () => {
      const confirmed = await requestAdminConfirmation({
        title: "ยืนยันรันรายงานซื้อ/ตั้งหนี้",
        message:
          "ระบบจะ query ฐานข้อมูล SML ของร้านนี้และบันทึก snapshot รายงานซื้อ/ตั้งหนี้ล่าสุด",
        confirmLabel: "รันรายงานซื้อ",
        details: [
          { label: "ร้านค้า", value: tenant.name },
          { label: "รายงาน", value: "รายงานซื้อสินค้า/ตั้งหนี้" },
          {
            label: "ช่วงวันที่",
            value: formatReportPeriod(reportDateFrom, reportDateTo),
          },
        ],
      });
      if (!confirmed) {
        return;
      }

      const headers = await buildAdminJsonHeaders({
        actionLabel: "รันรายงานซื้อสินค้า/ตั้งหนี้",
        description:
          "ระบบจะ query ฐาน SML ของร้านนี้ผ่าน JavaWS และบันทึก snapshot รายงานซื้อ",
      });
      if (!headers) {
        throw new Error("กรุณาเข้าสู่ระบบผู้ดูแลก่อนรันรายงาน");
      }

      const response = await fetch(
        `${API_BASE_URL}/api/reports/${tenant.id}/purchase_goods_payables/run`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            date_from: reportDateFrom,
            date_to: reportDateTo,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        data?: PurchaseGoodsPayablesSnapshot;
        run?: ReportRunRecord;
        error?: string;
      };

      if (!response.ok || !payload.data) {
        if (response.status === 401 || response.status === 403) {
          forgetAdminToken();
        }
        if (payload.run) {
          setLastManualRun(payload.run);
        }
        throw new Error(payload.error || "รันรายงานซื้อ/ตั้งหนี้ไม่สำเร็จ");
      }

      setLastManualSnapshot(null);
      setLastManualRun(payload.run ?? null);
      setValidationSignoffResult(null);
      setResult({
        tone: "success",
        message: `${tenant.name}: รันรายงานซื้อสำเร็จ ยอดซื้อ ${formatCurrency(payload.data.summary.total_purchase)} จาก ${payload.data.summary.document_count.toLocaleString("th-TH")} เอกสาร`,
      });
      await loadOwnerData();
    });
  }

  async function runGrossProfitReport(
    reportKey: "gross_profit_by_product" | "gross_profit_by_ar_customer",
  ) {
    const tenant = selectedTenantSummary?.tenant;
    if (!tenant) {
      setResult({ tone: "warning", message: "กรุณาเลือกร้านค้าก่อนรันรายงาน" });
      return;
    }
    if (!reportDateFrom || !reportDateTo || reportDateFrom > reportDateTo) {
      setResult({
        tone: "warning",
        message: "กรุณาเลือกช่วงวันที่ให้ถูกต้อง",
      });
      return;
    }

    const reportLabel = formatOwnerReportLabel(reportKey);
    await runOwnerAction(`gross-profit-report-run-${reportKey}-${tenant.id}`, async () => {
      const confirmed = await requestAdminConfirmation({
        title: `ยืนยันรัน${reportLabel}`,
        message:
          "รายงานนี้มีข้อมูลต้นทุนและกำไรขั้นต้น ระบบจะ query ฐาน SML ผ่าน JavaWS และบันทึก snapshot สำหรับสิทธิ์ผู้บริหารเท่านั้น",
        confirmLabel: "รันรายงาน",
        details: [
          { label: "ร้านค้า", value: tenant.name },
          { label: "รายงาน", value: reportLabel },
          {
            label: "ช่วงวันที่",
            value: formatReportPeriod(reportDateFrom, reportDateTo),
          },
          { label: "ข้อมูลอ่อนไหว", value: "มีต้นทุนและ margin" },
        ],
      });
      if (!confirmed) {
        return;
      }

      const headers = await buildAdminJsonHeaders({
        actionLabel: `รัน${reportLabel}`,
        description:
          "ระบบจะ query ฐาน SML ของร้านนี้ผ่าน JavaWS และบันทึก snapshot กำไรขั้นต้น",
      });
      if (!headers) {
        throw new Error("กรุณาเข้าสู่ระบบผู้ดูแลก่อนรันรายงาน");
      }

      const response = await fetch(
        `${API_BASE_URL}/api/reports/${tenant.id}/${reportKey}/run`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            date_from: reportDateFrom,
            date_to: reportDateTo,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        data?: GrossProfitByProductSnapshot | GrossProfitByArCustomerSnapshot;
        run?: ReportRunRecord;
        error?: string;
      };

      if (!response.ok || !payload.data) {
        if (response.status === 401 || response.status === 403) {
          forgetAdminToken();
        }
        if (payload.run) {
          setLastManualRun(payload.run);
        }
        throw new Error(payload.error || `รัน${reportLabel}ไม่สำเร็จ`);
      }

      setLastManualSnapshot(null);
      setLastManualRun(payload.run ?? null);
      setValidationSignoffResult(null);
      setResult({
        tone: "success",
        message: `${tenant.name}: ${reportLabel} สำเร็จ กำไรขั้นต้น ${formatCurrency(payload.data.summary.gross_profit)} จาก ${payload.data.summary.row_count.toLocaleString("th-TH")} รายการ`,
      });
      await loadOwnerData();
    });
  }

  async function runHeavyReportAsync(
    reportKey: "stock_balance" | "ar_customer_movement",
  ) {
    const tenant = selectedTenantSummary?.tenant;
    if (!tenant) {
      setResult({ tone: "warning", message: "กรุณาเลือกร้านค้าก่อนรันรายงาน" });
      return;
    }
    if (!reportDateFrom || !reportDateTo || reportDateFrom > reportDateTo) {
      setResult({
        tone: "warning",
        message: "กรุณาเลือกช่วงวันที่ให้ถูกต้อง",
      });
      return;
    }
    if (!tenant.featureFlags?.sml_chunked_heavy_reports_enabled) {
      setResult({
        tone: "warning",
        message:
          "ร้านนี้ยังไม่ได้เปิด feature flag chunked heavy reports ระบบจึงยังไม่เริ่ม async run",
      });
      return;
    }

    const reportLabel = formatOwnerReportLabel(reportKey);
    await runOwnerAction(`heavy-report-run-${reportKey}-${tenant.id}`, async () => {
      const confirmed = await requestAdminConfirmation({
        title: `ยืนยันรัน${reportLabel}`,
        message:
          "รายงานนี้เป็นรายงานหนัก ระบบจะคิวงานแบบ chunked แล้วอัปเดต progress ให้ดูต่อได้",
        confirmLabel: "เริ่มรัน",
        details: [
          { label: "ร้านค้า", value: tenant.name },
          { label: "รายงาน", value: reportLabel },
          {
            label: "ช่วงวันที่",
            value: formatReportPeriod(reportDateFrom, reportDateTo),
          },
          { label: "หมายเหตุ", value: "ปิดหน้าได้ ระบบยังรันต่อ" },
        ],
      });
      if (!confirmed) {
        return;
      }

      const headers = await buildAdminJsonHeaders({
        actionLabel: `เริ่มรัน${reportLabel}`,
        description:
          "ระบบจะคิว heavy report แบบ chunked เพื่อลด timeout และแสดง progress",
      });
      if (!headers) {
        throw new Error("กรุณาเข้าสู่ระบบผู้ดูแลก่อนรันรายงาน");
      }

      const response = await fetch(
        `${API_BASE_URL}/api/reports/${tenant.id}/${reportKey}/run-async`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            date_from: reportDateFrom,
            date_to: reportDateTo,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        data?: ReportRunRecord;
        duplicate?: boolean;
        progress?: ChunkedReportProgress;
        run?: ReportRunRecord;
        active_run?: ReportRunRecord;
        error?: string;
      };

      if (!response.ok || !payload.data) {
        if (response.status === 401 || response.status === 403) {
          forgetAdminToken();
        }
        if (payload.run ?? payload.active_run) {
          setLastManualRun(payload.run ?? payload.active_run ?? null);
        }
        throw new Error(payload.error || `เริ่มรัน${reportLabel}ไม่สำเร็จ`);
      }

      setLastManualSnapshot(null);
      setLastManualRun(payload.data);
      setValidationSignoffResult(null);
      if (payload.progress) {
        setHeavyReportProgress(payload.progress);
      }
      if (!isTerminalReportRunStatus(payload.data.status)) {
        window.localStorage.setItem(
          getHeavyReportProgressStorageKey(tenant.id),
          payload.data.id,
        );
        setPendingHeavyReportRunId(payload.data.id);
      }
      setResult({
        tone: "success",
        message: payload.duplicate
          ? `${reportLabel}: พบ run เดิมที่กำลังทำงาน จะแสดง progress ต่อจาก run นั้น`
          : `${reportLabel}: เริ่มรันแล้ว ปิดหน้าได้ ระบบยังรันต่อ`,
      });
      await loadOwnerData({ promptForToken: false });
    });
  }

  async function saveValidationSignoff() {
    const tenant = selectedTenantSummary?.tenant;
    if (!tenant || !lastManualSnapshot) {
      setResult({
        tone: "warning",
        message: "กรุณารันรายงานให้สำเร็จก่อนบันทึกการรับรองยอด",
      });
      return;
    }
    if (
      lastManualSnapshot.tenant_id !== tenant.id ||
      lastManualSnapshot.params.date_from !== reportDateFrom ||
      lastManualSnapshot.params.date_to !== reportDateTo
    ) {
      setResult({
        tone: "warning",
        message:
          "snapshot ล่าสุดในหน้านี้ไม่ตรงกับร้านหรือช่วงวันที่ กรุณารันรายงานใหม่ก่อนรับรองยอด",
      });
      return;
    }

    const referenceTotal = Number(validationReferenceTotal);
    if (!Number.isFinite(referenceTotal)) {
      setResult({
        tone: "warning",
        message: "กรุณากรอกยอดจากรายงาน SML เดิมเป็นตัวเลข",
      });
      return;
    }
    if (validationSignedBy.trim().length < 2) {
      setResult({
        tone: "warning",
        message: "กรุณากรอกชื่อผู้ตรวจ/ผู้รับรองยอด",
      });
      return;
    }

    await runOwnerAction(`validation-signoff-${tenant.id}`, async () => {
      const confirmed = await requestAdminConfirmation({
        title: "ยืนยันบันทึกการรับรองยอด",
        message:
          "ระบบจะบันทึกหลักฐานว่า owner/ลูกค้าตรวจเทียบยอดกับรายงาน SML เดิมแล้ว รายการนี้จะถูกเก็บใน audit log",
        confirmLabel: "บันทึกการรับรอง",
        details: [
          { label: "ร้านค้า", value: tenant.name },
          {
            label: "ช่วงวันที่",
            value: formatReportPeriod(reportDateFrom, reportDateTo),
          },
          {
            label: "ยอดระบบ",
            value: `${formatCurrency(lastManualSnapshot.summary.total_sales)} บาท`,
          },
          {
            label: "ยอด SML เดิม",
            value: `${formatCurrency(referenceTotal)} บาท`,
          },
        ],
      });
      if (!confirmed) {
        return;
      }

      const headers = await buildAdminJsonHeaders({
        actionLabel: "บันทึกการรับรองยอด",
        description:
          "ใช้ยืนยันว่า report snapshot รอบนี้ถูกเทียบกับรายงาน SML เดิมแล้ว",
      });
      if (!headers) {
        throw new Error("กรุณาเข้าสู่ระบบผู้ดูแลก่อนบันทึกการรับรองยอด");
      }

      const response = await fetch(
        `${API_BASE_URL}/api/owner/tenants/${tenant.id}/reports/sales_goods_services/validation-signoff`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            run_id: lastManualSnapshot.run_id,
            date_from: reportDateFrom,
            date_to: reportDateTo,
            system_total: lastManualSnapshot.summary.total_sales,
            reference_total: referenceTotal,
            signed_by: validationSignedBy.trim(),
            note: validationNote.trim() || undefined,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        data?: ValidationSignoffResult;
        error?: string;
      };

      if (!response.ok || !payload.data) {
        throw new Error(payload.error || "บันทึกการรับรองยอดไม่สำเร็จ");
      }

      setValidationSignoffResult(payload.data);
      setResult({
        tone: payload.data.accepted ? "success" : "warning",
        message: payload.data.accepted
          ? "บันทึกการรับรองยอดแล้ว: ยอดตรง"
          : `บันทึกแล้ว แต่พบส่วนต่าง ${formatCurrency(payload.data.difference_amount)} บาท`,
      });
      await loadOwnerData();
    });
  }

  function buildNotificationRulePayload() {
    if (!selectedTenantId) {
      throw new Error("กรุณาเลือกร้านค้าก่อนสร้างแผนแจ้งเตือน");
    }
    if (!notificationTimes.length) {
      throw new Error("กรุณาเพิ่มเวลาแจ้งเตือนอย่างน้อย 1 รอบ");
    }
    const invalidTime = notificationTimes.find((time) => !isValidNotificationTime(time));
    if (invalidTime) {
      throw new Error(`เวลาแจ้งเตือนไม่ถูกต้อง: ${invalidTime}`);
    }
    if (notificationTimes.length > 12) {
      throw new Error("ตั้งเวลาแจ้งเตือนได้สูงสุด 12 รอบต่อแผน");
    }
    if (!notificationWeekdays.length) {
      throw new Error("กรุณาเลือกวันที่ต้องการแจ้งเตือน");
    }
    if (!notificationReportKeys.length) {
      throw new Error("กรุณาเลือกรายงานอย่างน้อย 1 รายงาน");
    }
    if (notificationEnabled && !notificationTargetIds.length) {
      throw new Error("กรุณาเลือกปลายทาง LINE อย่างน้อย 1 รายการ");
    }

    return {
      tenant_id: selectedTenantId,
      name: notificationName.trim(),
      enabled: notificationEnabled,
      timezone: "Asia/Bangkok",
      period_preset: notificationPeriodPreset,
      period_strategy: OWNER_NOTIFICATION_PERIOD_STRATEGY,
      digest_mode: notificationDigestMode,
      schedule: [
        {
          weekdays: [...new Set(notificationWeekdays)].sort((a, b) => a - b),
          times: [...new Set(notificationTimes)].sort(),
        },
      ],
      report_keys: notificationReportKeys,
      target_ids: notificationTargetIds,
    };
  }

  async function saveNotificationRule() {
    const tenant = selectedTenantSummary?.tenant;
    if (!tenant) {
      setResult({ tone: "warning", message: "กรุณาเลือกร้านค้าก่อนบันทึกแผนแจ้งเตือน" });
      return;
    }

    await runOwnerAction(
      editingNotificationRuleId
        ? `notification-save-${editingNotificationRuleId}`
        : `notification-create-${tenant.id}`,
      async () => {
        const payload = buildNotificationRulePayload();
        const headers = await buildAdminJsonHeaders({
          actionLabel: editingNotificationRuleId
            ? `แก้แผนแจ้งเตือนของ ${tenant.name}`
            : `สร้างแผนแจ้งเตือนของ ${tenant.name}`,
          description:
            "ระบบจะบันทึกตารางเวลา รายงาน และปลายทาง LINE ลงใน system store โดยไม่ให้ผู้ใช้กรอก raw LINE id",
        });
        if (!headers) {
          throw new Error("กรุณาเข้าสู่ระบบผู้ดูแลก่อนบันทึกแผนแจ้งเตือน");
        }

        const response = await fetch(
          editingNotificationRuleId
            ? `${API_BASE_URL}/api/owner/notification-rules/${editingNotificationRuleId}`
            : `${API_BASE_URL}/api/owner/notification-rules`,
          {
            method: editingNotificationRuleId ? "PATCH" : "POST",
            headers,
            body: JSON.stringify(
              editingNotificationRuleId
                ? {
                    name: payload.name,
                    enabled: payload.enabled,
                    timezone: payload.timezone,
                    period_preset: payload.period_preset,
                    period_strategy: payload.period_strategy,
                    digest_mode: payload.digest_mode,
                    schedule: payload.schedule,
                    report_keys: payload.report_keys,
                    target_ids: payload.target_ids,
                  }
                : payload,
            ),
          },
        );
        const responsePayload = (await response.json().catch(() => ({}))) as {
          data?: OwnerNotificationRule;
          error?: string;
          details?: unknown;
        };
        if (!response.ok || !responsePayload.data) {
          throw new Error(
            responsePayload.error || "บันทึกแผนแจ้งเตือนไม่สำเร็จ",
          );
        }

        applyNotificationRuleToForm(responsePayload.data);
        setResult({
          tone: "success",
          message: `${tenant.name}: บันทึกแผนแจ้งเตือนแล้ว`,
        });
        await loadOwnerData();
      },
    );
  }

  async function executeSelectedNotificationRule(mode: "dry_run" | "send") {
    const tenant = selectedTenantSummary?.tenant;
    if (!tenant || !editingNotificationRuleId) {
      setResult({
        tone: "warning",
        message: "กรุณาบันทึกแผนแจ้งเตือนก่อนทดสอบหรือส่งจริง",
      });
      return;
    }
    const savedRule = notificationRules.find(
      (rule) => rule.id === editingNotificationRuleId,
    );
    if (!savedRule) {
      setResult({
        tone: "warning",
        message: "ไม่พบแผนที่บันทึกไว้ กรุณาบันทึกแผนก่อนทดสอบหรือส่งจริง",
      });
      return;
    }
    if (
      (savedRule.period_strategy ?? OWNER_NOTIFICATION_PERIOD_STRATEGY) !==
      OWNER_NOTIFICATION_PERIOD_STRATEGY
    ) {
      setResult({
        tone: "warning",
        message:
          "แผนนี้ยังใช้การตั้งค่าช่วงข้อมูลแบบเก่า กรุณาบันทึกแผนอีกครั้งก่อนทดสอบหรือส่งจริง",
      });
      return;
    }

    await runOwnerAction(
      `notification-run-${editingNotificationRuleId}-${mode}`,
      async () => {
        const savedSchedule = savedRule.schedule[0] ?? {
          times: [],
          weekdays: [],
        };
        const manualScheduleValidation = validateManualNotificationRunSelection({
          scheduledDate: notificationManualScheduledDate,
          scheduledTime: notificationManualScheduledTime,
          times: savedSchedule.times,
          weekdays: savedSchedule.weekdays,
        });
        if (!manualScheduleValidation.ok) {
          throw new Error(manualScheduleValidation.error);
        }
        const manualPeriod = deriveNotificationPeriodRange({
          periodPreset: savedRule.period_preset,
          periodStrategy: OWNER_NOTIFICATION_PERIOD_STRATEGY,
          scheduledLocalDate: notificationManualScheduledDate,
          scheduledLocalTime: notificationManualScheduledTime,
          timeZone: savedRule.timezone || "Asia/Bangkok",
        });
        if (mode === "send") {
          const confirmed = await requestAdminConfirmation({
            title: "ยืนยันส่งแผนแจ้งเตือนตอนนี้",
            message:
              "ระบบจะรันรายงานสดจากแผนที่บันทึกไว้ แล้วส่ง digest ไปยังปลายทาง LINE ที่เลือก",
            confirmLabel: "ส่งตอนนี้",
            details: [
              { label: "ร้านค้า", value: tenant.name },
              { label: "แผน", value: savedRule.name },
              {
                label: "จำลองรอบ",
                value: `${notificationManualScheduledDate} ${notificationManualScheduledTime}`,
              },
              {
                label: "ช่วงข้อมูล",
                value: formatNotificationPeriodWithTime(
                  manualPeriod.date_from,
                  manualPeriod.date_to,
                  manualPeriod.time_from,
                  manualPeriod.time_to,
                ),
              },
              { label: "โหมด", value: "ส่งจริงผ่าน LINE" },
            ],
          });
          if (!confirmed) {
            return;
          }
        }

        const headers = await buildAdminJsonHeaders({
          actionLabel:
            mode === "send"
              ? `ส่งแผนแจ้งเตือนของ ${tenant.name}`
              : `ทดสอบแผนแจ้งเตือนของ ${tenant.name}`,
          description:
            mode === "send"
              ? "ส่ง digest จริงผ่าน LINE ด้วยแผนที่บันทึกไว้"
              : "dry run จะสร้าง message และบันทึก audit โดยไม่ส่งออก LINE",
        });
        if (!headers) {
          throw new Error("กรุณาเข้าสู่ระบบผู้ดูแลก่อนทดสอบแผนแจ้งเตือน");
        }
        const clientRequestId =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

        const response = await fetch(
          `${API_BASE_URL}/api/owner/notification-rules/${editingNotificationRuleId}/${
            mode === "send" ? "run-now" : "test-run"
          }`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              mode,
              scheduled_local_date: notificationManualScheduledDate,
              scheduled_local_time: notificationManualScheduledTime,
              client_request_id: clientRequestId,
            }),
          },
        );
        const payload = (await response.json().catch(() => ({}))) as {
          data?: NotificationRuleRunResult;
          error?: string;
        };
        if (!response.ok || !payload.data) {
          throw new Error(payload.error || "รันแผนแจ้งเตือนไม่สำเร็จ");
        }

        setLastNotificationRunResult(payload.data);
        setPendingNotificationRunId(payload.data.run_id ?? payload.data.run?.id ?? null);
        setResult({
          tone: "success",
          message:
            mode === "send"
              ? "รับงานส่งจริงแล้ว ระบบกำลังรันรายงานและจะอัปเดตผลอัตโนมัติ"
              : "รับงานทดสอบแล้ว ระบบกำลังรันรายงานและจะอัปเดตผลอัตโนมัติ",
        });
        await refreshNotificationRuleRuns(editingNotificationRuleId);
      },
    );
  }

  function toggleNotificationReportKey(reportKey: ReportKey) {
    setNotificationReportKeys((current) =>
      current.includes(reportKey)
        ? current.filter((item) => item !== reportKey)
        : [...current, reportKey],
    );
  }

  function toggleReportPermission(
    profileKey: LineAccessProfileKey,
    reportKey: ReportKey,
  ) {
    setReportPermissionDraft((current) => {
      const currentReports = current[profileKey] ?? [];
      return {
        ...current,
        [profileKey]: currentReports.includes(reportKey)
          ? currentReports.filter((item) => item !== reportKey)
          : [...currentReports, reportKey],
      };
    });
  }

  async function saveReportPermissions() {
    const tenant = selectedTenantSummary?.tenant;
    if (!tenant || !reportPermissions) {
      setResult({
        tone: "warning",
        message: "กรุณาเลือกร้านค้าก่อนบันทึกสิทธิ์รายงาน",
      });
      return;
    }

    await runOwnerAction(`report-permissions-save-${tenant.id}`, async () => {
      const targetCount = selectedTenantLineTargets.length;
      const confirmed = await requestAdminConfirmation({
        title: "ยืนยันบันทึกสิทธิ์รายงาน",
        message:
          "ระบบจะ sync สิทธิ์รายงานไปยัง LINE ID เดิมของร้านนี้ตาม role ที่ตั้งไว้",
        confirmLabel: "บันทึกสิทธิ์รายงาน",
        details: [
          { label: "ร้านค้า", value: tenant.name },
          { label: "LINE target ที่จะตรวจ sync", value: `${targetCount} ราย` },
          { label: "ขอบเขต", value: "เฉพาะร้านนี้" },
        ],
      });
      if (!confirmed) {
        return;
      }

      const headers = await buildAdminJsonHeaders({
        actionLabel: `บันทึกสิทธิ์รายงานของ ${tenant.name}`,
        description:
          "กำหนดว่าผู้บริหาร ฝ่ายขาย ปฏิบัติการ และพนักงานของร้านนี้ดูรายงานใดได้บ้าง",
      });
      if (!headers) {
        throw new Error("กรุณาเข้าสู่ระบบผู้ดูแลก่อนบันทึกสิทธิ์รายงาน");
      }

      const response = await fetch(
        `${API_BASE_URL}/api/owner/tenants/${tenant.id}/report-permissions`,
        {
          method: "PUT",
          headers,
          body: JSON.stringify({
            permissions: reportPermissions.roles.map((role) => ({
              access_profile_key: role.access_profile_key,
              allowed_report_keys:
                reportPermissionDraft[role.access_profile_key] ?? [],
            })),
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        data?: ReportPermissionsState;
        error?: string;
        impacted_notification_plans?: ReportPermissionImpact[];
      };

      if (!response.ok || !payload.data) {
        const impacted = payload.impacted_notification_plans ?? [];
        throw new Error(
          impacted.length
            ? `${payload.error ?? "บันทึกสิทธิ์รายงานไม่สำเร็จ"}: ${impacted
                .slice(0, 3)
                .map(
                  (item) =>
                    `${item.rule_name} / ${item.target_display_name} / ${item.report_label}`,
                )
                .join(", ")}`
            : payload.error || "บันทึกสิทธิ์รายงานไม่สำเร็จ",
        );
      }

      setReportPermissions(payload.data);
      setReportPermissionDraft(payload.data.matrix);
      setResult({
        tone: "success",
        message: `${tenant.name}: บันทึกสิทธิ์รายงานแล้ว และ sync LINE target ${
          payload.data.updated_line_targets ?? 0
        } ราย`,
      });
      await loadOwnerData({ promptForToken: false });
      await loadReportPermissions(tenant.id);
    });
  }

  function toggleNotificationWeekday(weekday: number) {
    setNotificationWeekdays((current) =>
      current.includes(weekday)
        ? current.filter((item) => item !== weekday)
        : [...current, weekday].sort((a, b) => a - b),
    );
  }

  function toggleNotificationTarget(targetId: string) {
    setNotificationTargetIds((current) =>
      current.includes(targetId)
        ? current.filter((item) => item !== targetId)
        : [...current, targetId],
    );
  }

  function addNotificationTime() {
    if (!isValidNotificationTime(notificationTimeInput)) {
      setResult({ tone: "warning", message: "เวลาแจ้งเตือนต้องอยู่ในรูปแบบ HH:mm" });
      return;
    }
    if (
      !notificationTimes.includes(notificationTimeInput) &&
      notificationTimes.length >= 12
    ) {
      setResult({
        tone: "warning",
        message: "ตั้งเวลาแจ้งเตือนได้สูงสุด 12 รอบต่อแผน",
      });
      return;
    }
    setNotificationTimes((current) => {
      if (current.includes(notificationTimeInput)) {
        return current;
      }
      return [...current, notificationTimeInput].sort();
    });
  }

  function removeNotificationTime(time: string) {
    setNotificationTimes((current) => current.filter((item) => item !== time));
  }

  async function runOwnerAction(name: string, action: () => Promise<void>) {
    setBusy(name);
    try {
      await action();
    } catch (error) {
      setResult({
        tone: "error",
        message:
          error instanceof Error ? error.message : "ทำรายการไม่สำเร็จ",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <AdminSecurityDialogs />

      <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-medium text-brand-500">
              {sectionMeta.eyebrow}
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">
              {sectionMeta.title}
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {sectionMeta.description}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge color={dataStatus === "ready" ? "success" : "light"}>
              ใช้งาน {dataStatus === "ready" ? activeCount : "-"}
            </Badge>
            <Badge color={suspendedCount ? "warning" : "light"}>
              ระงับ {dataStatus === "ready" ? suspendedCount : "-"}
            </Badge>
            <Badge color="light">
              {dataStatus === "ready" ? lineChannels.length : "-"} LINE OA
            </Badge>
            {selectedTenantSummary && section !== "overview" ? (
              <Link
                className="inline-flex h-9 items-center justify-center rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 shadow-xs hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-white/[0.03]"
                href={`/owner?tenant=${encodeURIComponent(
                  selectedTenantSummary.tenant.id,
                )}`}
              >
                แก้ไขร้านนี้
              </Link>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => void loadOwnerData()}>
              รีเฟรช
            </Button>
          </div>
        </div>
      </div>

      {result && (
        <div
          className={`rounded-xl border p-4 text-sm ${
            result.tone === "success"
              ? "border-success-200 bg-success-50 text-success-700"
              : result.tone === "warning"
              ? "border-warning-200 bg-warning-50 text-warning-700"
              : "border-error-200 bg-error-50 text-error-700"
          }`}
        >
          {result.message}
        </div>
      )}

      {dataStatus === "auth_required" ? (
        <OwnerAuthGate onVerify={() => void loadOwnerData({ promptForToken: true })} />
      ) : null}

      {dataStatus === "checking" ? <OwnerLoadingState /> : null}

      {dataStatus === "ready" ? (
        <OwnerSectionContent
          busy={busy}
          createLineChannel={createLineChannel}
          createTenant={createTenant}
          datasourceConfig={datasourceConfig}
          datasourceTests={datasourceTests}
          javaWsDatabaseDiscovery={javaWsDatabaseDiscovery}
          javaWsAuthMode={javaWsAuthMode}
          javaWsAuthSecret={javaWsAuthSecret}
          javaWsAuthUsername={javaWsAuthUsername}
          javaWsBaseUrl={javaWsBaseUrl}
          javaWsConfigFileName={javaWsConfigFileName}
          javaWsDatabase={javaWsDatabase}
          javaWsEndpoint={javaWsEndpoint}
          javaWsWebappPath={javaWsWebappPath}
          heavyReportProgress={heavyReportProgress}
          lastManualRun={lastManualRun}
          lastManualSnapshot={lastManualSnapshot}
          lineAccessTokenInput={lineAccessTokenInput}
          lineChannelName={lineChannelName}
          lineChannelShared={lineChannelShared}
          lineChannelSecretInput={lineChannelSecretInput}
          lineChannels={lineChannels}
          lineRecipients={lineRecipients}
          lineTargets={lineTargets}
          lineSecretChannelId={lineSecretChannelId}
          lineSecretConfigured={lineSecretConfigured}
          lineTokenConfigured={lineTokenConfigured}
          notificationEnabled={notificationEnabled}
          notificationDigestMode={notificationDigestMode}
          notificationManualScheduledDate={notificationManualScheduledDate}
          notificationManualScheduledTime={notificationManualScheduledTime}
          notificationName={notificationName}
          notificationPeriodPreset={notificationPeriodPreset}
          notificationPeriodStrategy={notificationPeriodStrategy}
          notificationReportKeys={notificationReportKeys}
          notificationRuleRuns={notificationRuleRuns}
          notificationRules={notificationRules}
          notificationTargetIds={notificationTargetIds}
          notificationTimeInput={notificationTimeInput}
          notificationTimes={notificationTimes}
          notificationWeekdays={notificationWeekdays}
          reportPermissionDraft={reportPermissionDraft}
          reportPermissions={reportPermissions}
          editingNotificationRuleId={editingNotificationRuleId}
          lastNotificationRunResult={lastNotificationRunResult}
          justCreatedTenantId={justCreatedTenantId}
          newTenantId={newTenantId}
          newTenantName={newTenantName}
          onAssignLineRecipient={assignLineRecipientToTenant}
          onApproveLineTarget={approveLineTarget}
          onSetLineTargetProfile={updateLineTargetProfile}
          onUpdateLineChannel={updateLineChannel}
          onSaveDatasourceConfig={saveDatasourceConfig}
          onSaveLineChannelSecrets={saveLineChannelSecretConfig}
          onSaveNotificationRule={saveNotificationRule}
          onSaveSystemConfig={saveSystemConfig}
          onApplyJavaWsPreset={applyJavaWsPreset}
          onDiscoverJavaWsDatabases={discoverJavaWsDatabases}
          onTestDatasource={testDatasource}
          onTestLineTarget={testLineTarget}
          onLoadTelegramChats={loadTelegramChats}
          onRunOperationalAlertSmokeTest={runOperationalAlertSmokeTest}
          onSaveTelegramBotToken={saveTelegramBotToken}
          onSaveTelegramTarget={saveTelegramTarget}
          onSendTelegramTestAlert={sendTelegramTestAlert}
          onExecuteNotificationRule={executeSelectedNotificationRule}
          onSelectNotificationRule={applyNotificationRuleToForm}
          onNewNotificationRule={resetNotificationRuleForm}
          onSetNotificationReportKeys={setNotificationReportKeys}
          onToggleNotificationReportKey={toggleNotificationReportKey}
          onToggleReportPermission={toggleReportPermission}
          onSaveReportPermissions={saveReportPermissions}
          onToggleNotificationTarget={toggleNotificationTarget}
          onToggleNotificationWeekday={toggleNotificationWeekday}
          onAddNotificationTime={addNotificationTime}
          onRemoveNotificationTime={removeNotificationTime}
          onToggleLineTarget={toggleLineTarget}
          onUpdateLineTargetRecipientEstimate={
            updateLineTargetRecipientEstimate
          }
          onCancelTenant={cancelTenant}
          onPreviewTenantDeleteImpact={previewTenantDeleteImpact}
          onUpdateTenant={updateTenantDetails}
          onUpdateStatus={updateTenantStatus}
          onUpdateBusinessSignalStatus={updateBusinessSignalStatus}
          onSaveValidationSignoff={saveValidationSignoff}
          operationsStatus={operationsStatus}
          publicOrigin={publicOrigin}
          reportDateFrom={reportDateFrom}
          reportDateTo={reportDateTo}
          section={section}
          selectedTenant={selectedTenant}
          selectedTenantId={selectedTenantId}
          selectedTenantLineChannels={selectedTenantLineChannels}
          selectedTenantLineTargets={selectedTenantLineTargets}
          selectedTenantSummary={selectedTenantSummary}
          smlConnections={visibleSectionSmlConnections}
          storeSetupDetail={storeSetupDetail}
          setJavaWsAuthMode={setJavaWsAuthMode}
          setJavaWsAuthSecret={setJavaWsAuthSecret}
          setJavaWsAuthUsername={setJavaWsAuthUsername}
          setJavaWsBaseUrl={setJavaWsBaseUrl}
          setJavaWsConfigFileName={setJavaWsConfigFileName}
          setJavaWsDatabase={setJavaWsDatabase}
          setJavaWsWebappPath={setJavaWsWebappPath}
          setLineAccessTokenInput={setLineAccessTokenInput}
          setLineChannelName={setLineChannelName}
          setLineChannelShared={setLineChannelShared}
          setLineChannelSecretInput={setLineChannelSecretInput}
          setLineSecretChannelId={setLineSecretChannelId}
          setLineSecretConfigured={setLineSecretConfigured}
          setLineTokenConfigured={setLineTokenConfigured}
          setNotificationEnabled={setNotificationEnabled}
          setNotificationDigestMode={setNotificationDigestMode}
          setNotificationManualScheduledDate={setNotificationManualScheduledDate}
          setNotificationManualScheduledTime={setNotificationManualScheduledTime}
          setNotificationName={setNotificationName}
          setNotificationPeriodPreset={setNotificationPeriodPreset}
          setNotificationPeriodStrategy={setNotificationPeriodStrategy}
          setNotificationTimeInput={setNotificationTimeInput}
          setNewTenantId={setNewTenantId}
          setNewTenantName={setNewTenantName}
          setReportDateFrom={setReportDateFrom}
          setReportDateTo={setReportDateTo}
          setSelectedTenantId={setSelectedTenantId}
          setSystemAppBaseUrl={setSystemAppBaseUrl}
          setSystemBackupConfigured={setSystemBackupConfigured}
          setSystemLastBackupAt={setSystemLastBackupAt}
          setSystemMorningBriefEnabled={setSystemMorningBriefEnabled}
          setSystemMorningBriefForce={setSystemMorningBriefForce}
          setSystemMorningBriefMode={setSystemMorningBriefMode}
          setSystemMorningBriefTenantIds={setSystemMorningBriefTenantIds}
          setSystemMorningBriefTime={setSystemMorningBriefTime}
          setSystemMorningBriefTimezone={setSystemMorningBriefTimezone}
          setSystemPublicApiBaseUrl={setSystemPublicApiBaseUrl}
          setSystemReportViewerLinkTtlHours={
            setSystemReportViewerLinkTtlHours
          }
          setSystemReportViewerSigningSecret={
            setSystemReportViewerSigningSecret
          }
          setSystemWorkerHeartbeatToken={setSystemWorkerHeartbeatToken}
          setSystemWorkerId={setSystemWorkerId}
          setTelegramBotTokenInput={setTelegramBotTokenInput}
          tenants={visibleSectionTenants}
          systemAppBaseUrl={systemAppBaseUrl}
          systemBackupConfigured={systemBackupConfigured}
          systemConfig={systemConfig}
          systemLastBackupAt={systemLastBackupAt}
          systemMorningBriefEnabled={systemMorningBriefEnabled}
          systemMorningBriefForce={systemMorningBriefForce}
          systemMorningBriefMode={systemMorningBriefMode}
          systemMorningBriefTenantIds={systemMorningBriefTenantIds}
          systemMorningBriefTime={systemMorningBriefTime}
          systemMorningBriefTimezone={systemMorningBriefTimezone}
          systemPublicApiBaseUrl={systemPublicApiBaseUrl}
          systemReportViewerLinkTtlHours={systemReportViewerLinkTtlHours}
          systemReportViewerSigningSecret={systemReportViewerSigningSecret}
          systemWorkerHeartbeatToken={systemWorkerHeartbeatToken}
          systemWorkerId={systemWorkerId}
          telegramBotTokenInput={telegramBotTokenInput}
          telegramChats={telegramChats}
          validationNote={validationNote}
          validationReferenceTotal={validationReferenceTotal}
          validationSignedBy={validationSignedBy}
          validationSignoffResult={validationSignoffResult}
          setValidationNote={setValidationNote}
          setValidationReferenceTotal={setValidationReferenceTotal}
          setValidationSignedBy={setValidationSignedBy}
          onRunSalesReport={runSalesReport}
          onRunPurchaseReport={runPurchaseReport}
          onRunGrossProfitReport={runGrossProfitReport}
          onRunHeavyReport={runHeavyReportAsync}
        />
      ) : null}

    </div>
  );
}

function OwnerAuthGate({ onVerify }: { onVerify: () => void }) {
  return (
    <section className="rounded-xl border border-warning-200 bg-warning-50 p-5 dark:border-warning-500/30 dark:bg-warning-500/10">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <Badge color="warning">ต้องยืนยันสิทธิ์</Badge>
          <h2 className="mt-3 text-lg font-semibold text-gray-900 dark:text-white">
            ยืนยัน session ผู้ดูแล เพื่อโหลดข้อมูลร้านค้า
          </h2>
          <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-300">
            เพื่อไม่ให้หน้า owner แสดงข้อมูลผิดหรือโหลดค้าง ระบบจะยังไม่แสดง tenant,
            datasource และ LINE config จนกว่าจะยืนยันสิทธิ์ผู้ดูแล
          </p>
        </div>
        <Button onClick={onVerify} size="sm">
          ยืนยันสิทธิ์ผู้ดูแล
        </Button>
      </div>
    </section>
  );
}

function OwnerLoadingState() {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <Badge color="light">กำลังโหลด</Badge>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="h-20 rounded-lg bg-gray-100 dark:bg-white/[0.04]" />
        <div className="h-20 rounded-lg bg-gray-100 dark:bg-white/[0.04]" />
        <div className="h-20 rounded-lg bg-gray-100 dark:bg-white/[0.04]" />
      </div>
    </section>
  );
}

type OwnerSectionContentProps = {
  busy: string | null;
  createLineChannel: (event: FormEvent<HTMLFormElement>) => void;
  createTenant: (event: FormEvent<HTMLFormElement>) => void;
  datasourceConfig: DatasourceConfigStatus | null;
  datasourceTests: Record<string, DatasourceTestResult>;
  javaWsDatabaseDiscovery: JavaWsDatabaseDiscoveryResult | null;
  javaWsAuthMode: JavaWsAuthMode;
  javaWsAuthSecret: string;
  javaWsAuthUsername: string;
  javaWsBaseUrl: string;
  javaWsConfigFileName: string;
  javaWsDatabase: string;
  javaWsEndpoint: string;
  javaWsWebappPath: string;
  justCreatedTenantId: string | null;
  heavyReportProgress: ChunkedReportProgress | null;
  lastManualRun: ReportRunRecord | null;
  lastManualSnapshot: SalesGoodsServicesSnapshot | null;
  lineAccessTokenInput: string;
  lineChannelName: string;
  lineChannelShared: boolean;
  lineChannelSecretInput: string;
  lineChannels: LineChannelRecord[];
  lineRecipients: LineRecipientRecord[];
  lineTargets: LineTargetRecord[];
  lineSecretChannelId: string;
  lineSecretConfigured: boolean;
  lineTokenConfigured: boolean;
  notificationEnabled: boolean;
  notificationDigestMode: NotificationDigestMode;
  notificationManualScheduledDate: string;
  notificationManualScheduledTime: string;
  notificationName: string;
  notificationPeriodPreset: NotificationPeriodPreset;
  notificationPeriodStrategy: NotificationPeriodStrategy;
  notificationReportKeys: ReportKey[];
  notificationRuleRuns: NotificationRuleRunRecord[];
  notificationRules: OwnerNotificationRule[];
  notificationTargetIds: string[];
  notificationTimeInput: string;
  notificationTimes: string[];
  notificationWeekdays: number[];
  reportPermissionDraft: Partial<Record<LineAccessProfileKey, ReportKey[]>>;
  reportPermissions: ReportPermissionsState | null;
  editingNotificationRuleId: string | null;
  lastNotificationRunResult: NotificationRuleRunResult | null;
  newTenantId: string;
  newTenantName: string;
  onAssignLineRecipient: (input: {
    recipient: LineRecipientRecord;
    lineChannelId: string;
    profileKey: LineAccessProfileKey;
  }) => Promise<void>;
  onUpdateLineChannel: (input: {
    channel: LineChannelRecord;
    displayName: string;
    scope: LineChannelScope;
    enabled: boolean;
  }) => Promise<void>;
  onApproveLineTarget: (
    target: LineTargetRecord,
    profileKey: LineAccessProfileKey,
  ) => Promise<void>;
  onSetLineTargetProfile: (
    target: LineTargetRecord,
    profileKey: LineAccessProfileKey,
  ) => Promise<void>;
  onRunGrossProfitReport: (
    reportKey: "gross_profit_by_product" | "gross_profit_by_ar_customer",
  ) => Promise<void>;
  onRunHeavyReport: (
    reportKey: "stock_balance" | "ar_customer_movement",
  ) => Promise<void>;
  onRunPurchaseReport: () => Promise<void>;
  onRunSalesReport: () => Promise<void>;
  onSaveDatasourceConfig: (event: FormEvent<HTMLFormElement>) => void;
  onSaveLineChannelSecrets: (event: FormEvent<HTMLFormElement>) => void;
  onSaveNotificationRule: () => Promise<void>;
  onSaveSystemConfig: (event: FormEvent<HTMLFormElement>) => void;
  onApplyJavaWsPreset: (preset: JavaWsDatasourcePreset) => void;
  onDiscoverJavaWsDatabases: (tenantId: string) => Promise<void>;
  onTestDatasource: (tenantId: string, source?: "form" | "saved") => Promise<void>;
  onTestLineTarget: (target: LineTargetRecord) => Promise<void>;
  onLoadTelegramChats: () => Promise<void>;
  onRunOperationalAlertSmokeTest: (alertType: string) => Promise<void>;
  onSaveTelegramBotToken: (event: FormEvent<HTMLFormElement>) => void;
  onSaveTelegramTarget: (chat: TelegramChatPreview) => Promise<void>;
  onSendTelegramTestAlert: () => Promise<void>;
  onExecuteNotificationRule: (mode: "dry_run" | "send") => Promise<void>;
  onSelectNotificationRule: (rule: OwnerNotificationRule) => void;
  onNewNotificationRule: () => void;
  onSetNotificationReportKeys: (reportKeys: ReportKey[]) => void;
  onToggleNotificationReportKey: (reportKey: ReportKey) => void;
  onToggleReportPermission: (
    profileKey: LineAccessProfileKey,
    reportKey: ReportKey,
  ) => void;
  onSaveReportPermissions: () => Promise<void>;
  onToggleNotificationTarget: (targetId: string) => void;
  onToggleNotificationWeekday: (weekday: number) => void;
  onAddNotificationTime: () => void;
  onRemoveNotificationTime: (time: string) => void;
  onToggleLineTarget: (target: LineTargetRecord) => Promise<void>;
  onUpdateLineTargetRecipientEstimate: (
    target: LineTargetRecord,
    recipientCountEstimate: number | null,
  ) => Promise<void>;
  onCancelTenant: (
    tenant: Tenant,
    input: { confirmName: string; reason: string },
  ) => Promise<void>;
  onPreviewTenantDeleteImpact: (
    tenantId: string,
  ) => Promise<TenantDeleteImpact | null>;
  onUpdateTenant: (tenant: Tenant, input: TenantPatchInput) => Promise<void>;
  onUpdateStatus: (
    tenant: Tenant,
    status: Tenant["status"],
  ) => Promise<void>;
  onUpdateBusinessSignalStatus: (
    signal: BusinessSignalRecord,
    status: BusinessSignalRecord["status"],
  ) => Promise<void>;
  onSaveValidationSignoff: () => Promise<void>;
  operationsStatus: OwnerOperationsStatus | null;
  publicOrigin: string;
  reportDateFrom: string;
  reportDateTo: string;
  section: OwnerPortalSection;
  selectedTenant?: Tenant;
  selectedTenantId: string;
  selectedTenantLineChannels: LineChannelRecord[];
  selectedTenantLineTargets: LineTargetRecord[];
  selectedTenantSummary?: TenantSummary;
  smlConnections: SmlConnectionSummary[];
  storeSetupDetail: StoreSetupDetail | null;
  setJavaWsAuthMode: (value: JavaWsAuthMode) => void;
  setJavaWsAuthSecret: (value: string) => void;
  setJavaWsAuthUsername: (value: string) => void;
  setJavaWsBaseUrl: (value: string) => void;
  setJavaWsConfigFileName: (value: string) => void;
  setJavaWsDatabase: (value: string) => void;
  setJavaWsWebappPath: (value: string) => void;
  setLineAccessTokenInput: (value: string) => void;
  setLineChannelName: (value: string) => void;
  setLineChannelShared: (value: boolean) => void;
  setLineChannelSecretInput: (value: string) => void;
  setLineSecretChannelId: (value: string) => void;
  setLineSecretConfigured: (value: boolean) => void;
  setLineTokenConfigured: (value: boolean) => void;
  setNotificationEnabled: (value: boolean) => void;
  setNotificationDigestMode: (value: NotificationDigestMode) => void;
  setNotificationManualScheduledDate: (value: string) => void;
  setNotificationManualScheduledTime: (value: string) => void;
  setNotificationName: (value: string) => void;
  setNotificationPeriodPreset: (value: NotificationPeriodPreset) => void;
  setNotificationPeriodStrategy: (value: NotificationPeriodStrategy) => void;
  setNotificationTimeInput: (value: string) => void;
  setNewTenantId: (value: string) => void;
  setNewTenantName: (value: string) => void;
  setReportDateFrom: (value: string) => void;
  setReportDateTo: (value: string) => void;
  setSelectedTenantId: (value: string) => void;
  setSystemAppBaseUrl: (value: string) => void;
  setSystemBackupConfigured: (value: boolean) => void;
  setSystemLastBackupAt: (value: string) => void;
  setSystemMorningBriefEnabled: (value: boolean) => void;
  setSystemMorningBriefForce: (value: boolean) => void;
  setSystemMorningBriefMode: (value: "dry_run" | "send") => void;
  setSystemMorningBriefTenantIds: (value: string) => void;
  setSystemMorningBriefTime: (value: string) => void;
  setSystemMorningBriefTimezone: (value: string) => void;
  setSystemPublicApiBaseUrl: (value: string) => void;
  setSystemReportViewerLinkTtlHours: (value: string) => void;
  setSystemReportViewerSigningSecret: (value: string) => void;
  setSystemWorkerHeartbeatToken: (value: string) => void;
  setSystemWorkerId: (value: string) => void;
  setTelegramBotTokenInput: (value: string) => void;
  systemAppBaseUrl: string;
  systemBackupConfigured: boolean;
  systemConfig: SystemConfigStatus | null;
  systemLastBackupAt: string;
  systemMorningBriefEnabled: boolean;
  systemMorningBriefForce: boolean;
  systemMorningBriefMode: "dry_run" | "send";
  systemMorningBriefTenantIds: string;
  systemMorningBriefTime: string;
  systemMorningBriefTimezone: string;
  systemPublicApiBaseUrl: string;
  systemReportViewerLinkTtlHours: string;
  systemReportViewerSigningSecret: string;
  systemWorkerHeartbeatToken: string;
  systemWorkerId: string;
  telegramBotTokenInput: string;
  telegramChats: TelegramChatPreview[];
  setValidationNote: (value: string) => void;
  setValidationReferenceTotal: (value: string) => void;
  setValidationSignedBy: (value: string) => void;
  tenants: TenantSummary[];
  validationNote: string;
  validationReferenceTotal: string;
  validationSignedBy: string;
  validationSignoffResult: ValidationSignoffResult | null;
};

function OwnerSectionContent(props: OwnerSectionContentProps) {
  if (props.section === "overview") {
    return <OwnerOverviewContent {...props} />;
  }
  if (props.section === "tenants") {
    return <OwnerTenantsContent {...props} />;
  }
  if (props.section === "sml-connections") {
    return <OwnerSmlConnectionsContent {...props} />;
  }
  if (props.section === "notifications") {
    return <OwnerNotificationsContentV2 {...props} />;
  }
  if (props.section === "report-permissions") {
    return <OwnerReportPermissionsContent {...props} />;
  }
  if (props.section === "reports") {
    return <OwnerReportsContent {...props} />;
  }
  if (props.section === "line") {
    return <OwnerLineContent {...props} />;
  }
  if (props.section === "audit") {
    return <OwnerAuditContent {...props} />;
  }
  if (props.section === "settings") {
    return <OwnerSettingsContent {...props} />;
  }
  return <OwnerOverviewContent {...props} />;
}

function getOwnerSectionMeta(section: OwnerPortalSection) {
  const meta: Record<
    OwnerPortalSection,
    { eyebrow: string; title: string; description: string }
  > = {
    overview: {
      eyebrow: "Operations Cockpit",
      title: "สถานะร้านและสิ่งที่ต้องทำต่อ",
      description:
        "เปิดหน้านี้แล้วต้องรู้ทันทีว่าร้านไหนพร้อม ร้านไหนมีปัญหา และควรทำอะไรต่อ",
    },
    tenants: {
      eyebrow: "จัดการร้าน",
      title: "ร้านค้าและการใช้งาน",
      description:
        "เพิ่มร้าน ดูสถานะบริการ เช็คความพร้อม และเปิดรายงานลูกค้า",
    },
    "sml-connections": {
      eyebrow: "SML JavaWS",
      title: "เชื่อม SML ผ่าน Tomcat JavaWS",
      description:
        "กรอก Tomcat URL, port, SMLConfig และ database ต่อร้าน แล้วทดสอบก่อนใช้งานจริง",
    },
    notifications: {
      eyebrow: "แผนแจ้งเตือน",
      title: "แผนแจ้งเตือน LINE ต่อร้าน",
      description:
        "ตั้งว่าร้านไหนส่งรายงานอะไร เวลาไหน และส่งให้ผู้รับ LINE ใด",
    },
    "report-permissions": {
      eyebrow: "สิทธิ์รายงาน",
      title: "สิทธิ์รายงานตาม Role",
      description:
        "กำหนดต่อร้านว่า role ใดดูรายงานใดได้ แล้ว sync ไปยัง LINE ID ของร้านนั้น",
    },
    reports: {
      eyebrow: "รายงาน",
      title: "รายงานและ snapshot",
      description:
        "ติดตามรายงานล่าสุดต่อร้าน และรันรายงานเมื่อจำเป็น",
    },
    line: {
      eyebrow: "LINE OA",
      title: "LINE OA และผู้รับรายงาน",
      description:
        "จัดการ LINE OA กลางหรือ OA ของร้าน ผู้รับรายคน กลุ่มทีมงาน สิทธิ์รายงาน และส่งทดสอบ",
    },
    audit: {
      eyebrow: "ประวัติ",
      title: "ประวัติระบบ",
      description:
        "ตรวจรอบรายงานล่าสุด การส่ง LINE ล่าสุด และจุดที่ต้อง trace ต่อ",
    },
    settings: {
      eyebrow: "ตั้งค่า",
      title: "ตั้งค่าระบบ",
      description:
        "แก้ runtime settings และตรวจ bootstrap file โดยไม่ต้องฝังค่าใหม่ใน env",
    },
  };

  return meta[section];
}

function OwnerStatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
      <p className="text-xs font-medium uppercase text-gray-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-gray-900 dark:text-white">
        {value}
      </p>
    </div>
  );
}

function OwnerPanelHeader({
  actionHref,
  actionLabel,
  description,
  title,
}: {
  actionHref?: string;
  actionLabel?: string;
  description: string;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-3 p-5 md:flex-row md:items-start md:justify-between">
      <div>
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">
          {title}
        </h2>
        <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
          {description}
        </p>
      </div>
      {actionHref && actionLabel ? (
        <Link
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 shadow-xs hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-white/[0.03]"
          href={actionHref}
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}

function OwnerOverviewContent({
  tenants,
  onUpdateBusinessSignalStatus,
  operationsStatus,
  selectedTenantId,
  selectedTenantSummary,
  setSelectedTenantId,
  storeSetupDetail,
}: OwnerSectionContentProps) {
  const visibleTenants = tenants.filter(
    (item) => item.tenant.status !== "cancelled",
  );
  const cockpitTenants = visibleTenants.length ? visibleTenants : tenants;
  const selected =
    selectedTenantSummary ??
    cockpitTenants.find((item) => item.tenant.id === selectedTenantId) ??
    cockpitTenants[0];
  const nextAction = buildOwnerNextAction(cockpitTenants, operationsStatus);

  return (
    <div className="space-y-4">
      <OwnerCockpitStatusBar
        operationsStatus={operationsStatus}
        tenants={cockpitTenants}
      />

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <OwnerNextActionPanel action={nextAction} />

          <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
            <OwnerPanelHeader
              title="Store Health Matrix"
              description="สรุปความพร้อมของร้าน active, รอบแจ้งเตือนล่าสุด และ incident ที่ต้องเห็นก่อนรอบถัดไป"
              actionHref="/owner/audit"
              actionLabel="ดูหลักฐาน"
            />
            <StoreHealthMatrix
              operationsStatus={operationsStatus}
              selectedTenantId={selected?.tenant.id ?? selectedTenantId}
              setSelectedTenantId={setSelectedTenantId}
              tenants={cockpitTenants}
            />
          </div>
        </div>

        <SelectedTenantCockpitDetail
          onUpdateBusinessSignalStatus={onUpdateBusinessSignalStatus}
          operationsStatus={operationsStatus}
          selectedTenant={selected}
          storeSetupDetail={storeSetupDetail}
        />
      </section>

      <OwnerProofEvidenceStrip
        operationsStatus={operationsStatus}
        tenants={cockpitTenants}
      />
    </div>
  );
}

type OwnerBadgeTone = "success" | "warning" | "error" | "info" | "light";

type OwnerNextAction = {
  actionLabel: string;
  description: string;
  href: string;
  tenantName?: string;
  title: string;
  tone: OwnerBadgeTone;
};

type OwnerProofVerdict = {
  actionLabel: string;
  description: string;
  href: string;
  label: string;
  title: string;
  tone: OwnerBadgeTone;
};

type OwnerPilotProofPackage = {
  buyerPromise: string;
  caveat: string;
  headline: string;
  proofLine: string;
};

type OwnerProofCopyStatus = "idle" | "success" | "manual";

type OwnerPilotLaunchAction = {
  actionLabel: string;
  description: string;
  href: string;
  label: string;
  title: string;
  tone: OwnerBadgeTone;
};

type OwnerPilotSalesKit = {
  buyerFit: string;
  headline: string;
  message: string;
  nextStep: string;
  objections: string[];
  offer: string;
  proofBoundary: string;
  tone: OwnerBadgeTone;
};

type OwnerPilotQualification = {
  avoid: string[];
  decisionSignal: string;
  evidenceToCapture: string[];
  label: string;
  minimumScope: string;
  title: string;
  tone: OwnerBadgeTone;
  whoToApproach: string;
};

function OwnerCockpitStatusBar({
  operationsStatus,
  tenants,
}: {
  operationsStatus: OwnerOperationsStatus | null;
  tenants: TenantSummary[];
}) {
  const status = buildOwnerCockpitStatus(tenants, operationsStatus);
  const latestRound = getLatestNotificationRound(tenants);
  const telegramStatus = operationsStatus?.operational_alerts?.telegram.status;
  const telegramReady =
    Boolean(telegramStatus?.configured && telegramStatus.verified) &&
    Boolean(telegramStatus?.targets.some((target) => target.enabled));

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1.8fr)] xl:items-center">
        <div>
          <Badge color={status.tone}>{status.label}</Badge>
          <h2 className="mt-3 text-lg font-semibold text-gray-900 dark:text-white">
            {status.title}
          </h2>
          <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-400">
            {status.description}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <HealthFact
            label="ร้าน active"
            value={`${tenants.filter((item) => item.access.enabled).length}/${tenants.length}`}
          />
          <HealthFact
            label="รอบล่าสุด"
            value={
              latestRound
                ? `${latestRound.tenantName} · ${formatRunStatus(latestRound.status)}`
                : "ยังไม่มีรอบ"
            }
          />
          <HealthFact
            label="Worker"
            value={formatWorkerStatus(operationsStatus?.worker.status ?? "missing")}
          />
          <HealthFact
            label="Telegram ops"
            value={telegramReady ? "พร้อมแจ้งเตือน" : "ยังไม่พร้อม"}
          />
        </div>
      </div>
    </section>
  );
}

function OwnerNextActionPanel({ action }: { action: OwnerNextAction }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge color={action.tone}>สิ่งที่ต้องทำต่อ</Badge>
            {action.tenantName ? <Badge color="light">{action.tenantName}</Badge> : null}
          </div>
          <h2 className="mt-3 text-lg font-semibold text-gray-900 dark:text-white">
            {action.title}
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-600 dark:text-gray-400">
            {action.description}
          </p>
        </div>
        <Link
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600"
          href={action.href}
        >
          {action.actionLabel}
        </Link>
      </div>
    </section>
  );
}

function StoreHealthMatrix({
  operationsStatus,
  selectedTenantId,
  setSelectedTenantId,
  tenants,
}: {
  operationsStatus: OwnerOperationsStatus | null;
  selectedTenantId: string;
  setSelectedTenantId: (tenantId: string) => void;
  tenants: TenantSummary[];
}) {
  if (!tenants.length) {
    return (
      <div className="border-t border-gray-100 p-5 text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
        ยังไม่มีร้านค้า เพิ่มร้านแรก แล้วเชื่อม SML JavaWS ก่อนตั้งแผนแจ้งเตือน
      </div>
    );
  }

  return (
    <div className="border-t border-gray-100 dark:border-gray-800">
      <div className="hidden grid-cols-[minmax(180px,1.3fr)_100px_110px_120px_130px_120px_110px_110px] gap-3 px-4 py-3 text-xs font-medium uppercase text-gray-400 lg:grid">
        <span>ร้าน</span>
        <span>SML</span>
        <span>LINE</span>
        <span>แผน</span>
        <span>รอบล่าสุด</span>
        <span>Incident</span>
        <span>Signals</span>
        <span>Proof</span>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {tenants.map((item) => (
          <StoreHealthMatrixRow
            item={item}
            key={item.tenant.id}
            latestJavaWsFailure={operationsStatus?.report_health?.latest_javaws_failure ?? null}
            onSelectTenant={setSelectedTenantId}
            selected={item.tenant.id === selectedTenantId}
          />
        ))}
      </div>
    </div>
  );
}

function StoreHealthMatrixRow({
  item,
  latestJavaWsFailure,
  onSelectTenant,
  selected,
}: {
  item: TenantSummary;
  latestJavaWsFailure:
    | NonNullable<OwnerOperationsStatus["report_health"]>["latest_javaws_failure"]
    | null;
  onSelectTenant: (tenantId: string) => void;
  selected: boolean;
}) {
  const health = buildStoreHealthCells(item, latestJavaWsFailure);

  return (
    <button
      className={`block w-full text-left transition hover:bg-gray-50 dark:hover:bg-white/[0.03] ${
        selected ? "bg-brand-50/60 dark:bg-brand-500/10" : ""
      }`}
      onClick={() => onSelectTenant(item.tenant.id)}
      type="button"
    >
      <div className="grid gap-3 p-4 lg:grid-cols-[minmax(180px,1.3fr)_100px_110px_120px_130px_120px_110px_110px] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-gray-900 dark:text-white">
              {item.tenant.name}
            </p>
            <Badge color={tenantStatusTone(item.tenant.status)}>
              {formatTenantStatus(item.tenant.status)}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {health.nextStep.description}
          </p>
        </div>
        <StoreHealthCell label="SML" tone={health.sml.tone} value={health.sml.label} />
        <StoreHealthCell label="LINE" tone={health.line.tone} value={health.line.label} />
        <StoreHealthCell
          label="แผน"
          tone={health.schedule.tone}
          value={health.schedule.label}
        />
        <StoreHealthCell
          label="รอบล่าสุด"
          tone={health.latestRun.tone}
          value={health.latestRun.label}
        />
        <StoreHealthCell
          label="Incident"
          tone={health.incident.tone}
          value={health.incident.label}
        />
        <StoreHealthCell
          label="Signals"
          tone={health.signals.tone}
          value={health.signals.label}
        />
        <StoreHealthCell label="Proof" tone={health.proof.tone} value={health.proof.label} />
      </div>
    </button>
  );
}

function StoreHealthCell({
  label,
  tone,
  value,
}: {
  label: string;
  tone: OwnerBadgeTone;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 lg:block">
      <span className="text-xs text-gray-500 dark:text-gray-400 lg:hidden">
        {label}
      </span>
      <Badge color={tone}>{value}</Badge>
    </div>
  );
}

function SelectedTenantCockpitDetail({
  onUpdateBusinessSignalStatus,
  operationsStatus,
  selectedTenant,
  storeSetupDetail,
}: {
  onUpdateBusinessSignalStatus: (
    signal: BusinessSignalRecord,
    status: BusinessSignalRecord["status"],
  ) => Promise<void>;
  operationsStatus: OwnerOperationsStatus | null;
  selectedTenant?: TenantSummary;
  storeSetupDetail: StoreSetupDetail | null;
}) {
  if (!selectedTenant) {
    return (
      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <Badge color="light">ยังไม่มีร้าน</Badge>
        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
          เพิ่มร้านแรก แล้วเชื่อม SML JavaWS ก่อนตั้งแผนแจ้งเตือน
        </p>
      </section>
    );
  }

  const apiDetail =
    storeSetupDetail?.summary.tenant.id === selectedTenant.tenant.id
      ? storeSetupDetail
      : null;
  const readiness = apiDetail
    ? buildReadinessFromStoreSetup(apiDetail)
    : getTenantReadiness(selectedTenant);
  const nextStep = getStoreSetupNextStep(
    selectedTenant,
    readiness.items,
    apiDetail,
  );
  const latestJavaWsFailure =
    operationsStatus?.report_health?.latest_javaws_failure?.tenant_id ===
    selectedTenant.tenant.id
      ? operationsStatus.report_health.latest_javaws_failure
      : null;
  const latestHeavyReport = operationsStatus?.report_health?.heavy_report_runs
    .filter((run) => run.tenant_id === selectedTenant.tenant.id)
    .sort((a, b) => getTimeMs(b.started_at) - getTimeMs(a.started_at))[0];

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Badge color={readiness.tone}>{readiness.label}</Badge>
          <h2 className="mt-3 text-base font-semibold text-gray-900 dark:text-white">
            {selectedTenant.tenant.name}
          </h2>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            {nextStep.description}
          </p>
        </div>
        <Link
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
          href={nextStep.href}
        >
          {nextStep.actionLabel}
        </Link>
      </div>

      <div className="mt-4 grid gap-2">
        <DetailRow
          label="แจ้งเตือนล่าสุด"
          value={
            selectedTenant.health.latest_notification_run_at
              ? `${formatRunStatus(selectedTenant.health.latest_notification_run_status)} · ${formatDateTime(selectedTenant.health.latest_notification_run_at)}`
              : "ยังไม่มีรอบ"
          }
        />
        <DetailRow
          label="LINE ล่าสุด"
          value={
            selectedTenant.health.latest_line_delivery_at
              ? `${formatLineDeliveryStatus(selectedTenant.health.latest_line_delivery_status)} · ${formatDateTime(selectedTenant.health.latest_line_delivery_at)}`
              : "ยังไม่มี delivery"
          }
        />
        <DetailRow
          label="JavaWS ล่าสุด"
          value={
            latestJavaWsFailure
              ? `${formatOwnerReportLabel(latestJavaWsFailure.report_key)} · ${formatJavaWsFailurePhase(latestJavaWsFailure.failure_phase)}`
              : "ไม่พบ incident ล่าสุด"
          }
        />
        <DetailRow
          label="Heavy report"
          value={
            latestHeavyReport
              ? `${formatOwnerReportLabel(latestHeavyReport.report_key)} · ${formatRunStatus(latestHeavyReport.status)} · ${
                  latestHeavyReport.duration_ms
                    ? formatElapsedMs(latestHeavyReport.duration_ms)
                    : "ยังไม่ทราบเวลา"
                }`
              : "ยังไม่มี heavy run ล่าสุด"
          }
        />
      </div>

      <div className="mt-4 grid gap-2">
        {readiness.items.slice(0, 4).map((check) => (
          <ReadinessRow item={check} key={check.label} />
        ))}
      </div>

      {apiDetail?.business_signals.length ? (
        <div className="mt-4 rounded-lg border border-warning-200 bg-warning-50 p-3 dark:border-warning-500/30 dark:bg-warning-500/10">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-warning-800 dark:text-warning-100">
                เรื่องที่เปิดอยู่
              </p>
              <p className="mt-1 text-xs leading-5 text-warning-700 dark:text-warning-200/80">
                จาก snapshot ล่าสุด ไม่ดึง SML เพิ่มตอนเปิดหน้านี้
              </p>
            </div>
            <Badge
              color={
                apiDetail.summary.health.critical_business_signals > 0
                  ? "error"
                  : "warning"
              }
            >
              {apiDetail.summary.health.open_business_signals} เรื่อง
            </Badge>
          </div>
          <div className="mt-3 grid gap-2">
            {apiDetail.business_signals.slice(0, 3).map((signal) => (
              <BusinessSignalCompactRow
                key={signal.id}
                onUpdateStatus={onUpdateBusinessSignalStatus}
                signal={signal}
              />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function OwnerProofEvidenceStrip({
  operationsStatus,
  tenants,
}: {
  operationsStatus: OwnerOperationsStatus | null;
  tenants: TenantSummary[];
}) {
  const activeTenants = tenants.filter((item) => item.access.enabled);
  const proofReady = activeTenants.filter(
    (item) =>
      item.health.latest_notification_run_status === "success" &&
      item.health.latest_line_delivery_status === "success",
  ).length;
  const lineReady = activeTenants.filter(
    (item) => item.health.latest_line_delivery_status === "success",
  ).length;
  const latestAlert =
    operationsStatus?.operational_alerts?.telegram.deliveries[0] ?? null;
  const latestFailure = operationsStatus?.report_health?.latest_javaws_failure ?? null;
  const proof = operationsStatus?.production_proof ?? null;
  const verdict = buildProductionProofVerdict(proof, activeTenants.length);
  const pilotProofPackage = buildPilotProofPackage(proof, verdict);
  const proofRecoveryLine = buildProofRecoveryLine(proof);
  const pilotProofShareText = buildPilotProofShareText(
    pilotProofPackage,
    verdict,
    proof,
  );
  const pilotLaunchActions = buildPilotLaunchActions({
    activeTenants,
    operationsStatus,
    proof,
    verdict,
  });
  const pilotSalesKit = buildPilotSalesKit({
    activeTenants,
    proof,
    proofPackage: pilotProofPackage,
    verdict,
  });
  const pilotQualification = buildPilotQualification({
    activeTenants,
    proof,
    verdict,
  });
  const pilotSalesKitShareText = buildPilotSalesKitShareText(
    pilotSalesKit,
    pilotQualification,
  );
  const [copyStatus, setCopyStatus] = useState<OwnerProofCopyStatus>("idle");
  const [salesKitCopyStatus, setSalesKitCopyStatus] =
    useState<OwnerProofCopyStatus>("idle");
  const manualCopyTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const manualSalesKitTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scheduledProofValue = proof
    ? proof.scheduled_run_count > 0
      ? `${proof.scheduled_success_count.toLocaleString("th-TH")}/${proof.scheduled_run_count.toLocaleString("th-TH")} สำเร็จ`
      : "ยังไม่มีรอบ"
    : `${proofReady}/${activeTenants.length}`;
  const lineProofValue = proof
    ? proof.line_delivery_count > 0
      ? `${proof.line_delivery_success_count.toLocaleString("th-TH")}/${proof.line_delivery_count.toLocaleString("th-TH")} ส่งสำเร็จ`
      : "ยังไม่มี delivery"
    : `${lineReady}/${activeTenants.length} ส่งสำเร็จ`;
  const copyButtonLabel =
    copyStatus === "success"
      ? "คัดลอกแล้ว"
      : copyStatus === "manual"
      ? "ลองคัดลอกอีกครั้ง"
      : "คัดลอก";
  const salesKitCopyButtonLabel =
    salesKitCopyStatus === "success"
      ? "คัดลอกแล้ว"
      : salesKitCopyStatus === "manual"
      ? "เลือกข้อความเอง"
      : "คัดลอกข้อความขาย";

  useEffect(() => {
    if (copyStatus !== "success") {
      return;
    }
    const timeout = window.setTimeout(() => setCopyStatus("idle"), 2200);
    return () => window.clearTimeout(timeout);
  }, [copyStatus]);

  useEffect(() => {
    if (salesKitCopyStatus !== "success") {
      return;
    }
    const timeout = window.setTimeout(() => setSalesKitCopyStatus("idle"), 2200);
    return () => window.clearTimeout(timeout);
  }, [salesKitCopyStatus]);

  useEffect(() => {
    if (copyStatus !== "manual") {
      return;
    }
    manualCopyTextareaRef.current?.focus();
    manualCopyTextareaRef.current?.select();
  }, [copyStatus]);

  useEffect(() => {
    if (salesKitCopyStatus !== "manual") {
      return;
    }
    manualSalesKitTextareaRef.current?.focus();
    manualSalesKitTextareaRef.current?.select();
  }, [salesKitCopyStatus]);

  async function handleCopyPilotProof() {
    try {
      await copyTextToClipboard(pilotProofShareText);
      setCopyStatus("success");
    } catch {
      setCopyStatus("manual");
    }
  }

  async function handleCopyPilotSalesKit() {
    try {
      await copyTextToClipboard(pilotSalesKitShareText);
      setSalesKitCopyStatus("success");
    } catch {
      setSalesKitCopyStatus("manual");
    }
  }

  return (
    <section
      className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]"
      id="owner-pilot-proof"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            หลักฐาน production proof ล่าสุด
          </h2>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            ใช้ดูว่ารอบจริง 7 วันล่าสุดมีรายงาน, LINE delivery, incident และ ops alert ครบหรือไม่
          </p>
        </div>
        <Link
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
          href="/owner/audit"
        >
          เปิด audit
        </Link>
      </div>
      <div
        className={`mt-4 border-l-4 pl-4 ${ownerProofVerdictAccentClass(
          verdict.tone,
        )}`}
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <Badge color={verdict.tone}>{verdict.label}</Badge>
            <h3 className="mt-2 text-base font-semibold text-gray-900 dark:text-white">
              {verdict.title}
            </h3>
            <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-400">
              {verdict.description}
            </p>
          </div>
          <Link
            className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
            href={verdict.href}
          >
            {verdict.actionLabel}
          </Link>
        </div>
      </div>
      <div className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-medium uppercase text-gray-400">
                ชุด proof สำหรับ pilot
              </p>
              <button
                aria-label="คัดลอก proof สำหรับ pilot"
                className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition ${
                  copyStatus === "success"
                    ? "border-success-200 bg-success-50 text-success-700 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-300"
                    : copyStatus === "manual"
                    ? "border-warning-200 bg-warning-50 text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-300"
                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                }`}
                onClick={() => void handleCopyPilotProof()}
                type="button"
              >
                <CopyIcon className="size-4" />
                {copyButtonLabel}
              </button>
            </div>
            <p className="mt-1 text-sm font-semibold leading-6 text-gray-900 dark:text-white">
              {pilotProofPackage.headline}
            </p>
            {copyStatus === "manual" ? (
              <div className="mt-3">
                <p className="mb-1 text-xs leading-5 text-warning-700 dark:text-warning-300">
                  Browser บล็อกการคัดลอกอัตโนมัติ เลือกข้อความไว้ให้แล้ว กด Ctrl/Cmd+C ได้เลย
                </p>
                <textarea
                  ref={manualCopyTextareaRef}
                  className="h-28 w-full resize-none rounded-lg border border-warning-200 bg-warning-50 p-2 text-xs leading-5 text-gray-800 outline-none focus:border-warning-400 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-gray-100"
                  onFocus={(event) => event.currentTarget.select()}
                  readOnly
                  value={pilotProofShareText}
                />
              </div>
            ) : null}
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              หลักฐานคุยกับลูกค้า
            </p>
            <p className="mt-1 text-sm leading-6 text-gray-700 dark:text-gray-300">
              {pilotProofPackage.proofLine}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              ข้อเสนอและข้อควรพูดตรง ๆ
            </p>
            <p className="mt-1 text-sm leading-6 text-gray-700 dark:text-gray-300">
              {pilotProofPackage.buyerPromise} {pilotProofPackage.caveat}
            </p>
          </div>
        </div>
      </div>
      <div className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                Sales kit สำหรับคุยลูกค้า
              </p>
              <Badge color={pilotSalesKit.tone}>
                {pilotSalesKit.tone === "success"
                  ? "พร้อมส่ง"
                  : pilotSalesKit.tone === "warning"
                  ? "ส่งแบบมี caveat"
                  : "รอ proof"}
              </Badge>
            </div>
            <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
              ข้อความนี้ใช้คุยกับเจ้าของร้านหรือผู้บริหาร โดยยึดจาก proof ล่าสุดและไม่ใส่ข้อมูลลับของลูกค้า
            </p>
          </div>
          <button
            aria-label="คัดลอก sales kit สำหรับลูกค้า"
            className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition ${
              salesKitCopyStatus === "success"
                ? "border-success-200 bg-success-50 text-success-700 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-300"
                : salesKitCopyStatus === "manual"
                ? "border-warning-200 bg-warning-50 text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-300"
                : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
            }`}
            onClick={() => void handleCopyPilotSalesKit()}
            type="button"
          >
            <CopyIcon className="size-4" />
            {salesKitCopyButtonLabel}
          </button>
        </div>
        <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.4fr)_minmax(0,1fr)]">
          <div>
            <p className="text-xs font-medium uppercase text-gray-400">
              Positioning
            </p>
            <p className="mt-1 text-sm font-semibold leading-6 text-gray-900 dark:text-white">
              {pilotSalesKit.headline}
            </p>
            <p className="mt-2 text-xs leading-5 text-gray-500 dark:text-gray-400">
              {pilotSalesKit.offer}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase text-gray-400">
              ข้อความส่งลูกค้า
            </p>
            <p className="mt-1 whitespace-pre-line text-sm leading-6 text-gray-700 dark:text-gray-300">
              {pilotSalesKit.message}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase text-gray-400">
              พูดตรง ๆ ก่อนปิด pilot
            </p>
            <p className="mt-1 text-sm leading-6 text-gray-700 dark:text-gray-300">
              {pilotSalesKit.proofBoundary}
            </p>
            <ul className="mt-2 space-y-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
              {pilotSalesKit.objections.map((item) => (
                <li key={item}>• {item}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                Pilot qualification
              </p>
              <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                ใช้เลือกคนคุยและกันการขายเกิน proof ที่ระบบมีจริงตอนนี้
              </p>
            </div>
            <Badge color={pilotQualification.tone}>
              {pilotQualification.label}
            </Badge>
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                {pilotQualification.title}
              </p>
              <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                {pilotQualification.whoToApproach}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <HealthFact
                label="Minimum pilot"
                value={pilotQualification.minimumScope}
              />
              <HealthFact
                label="Decision signal"
                value={pilotQualification.decisionSignal}
              />
            </div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase text-gray-400">
                เก็บ proof หลังรอบจริง
              </p>
              <ul className="mt-1 space-y-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                {pilotQualification.evidenceToCapture.map((item) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-gray-400">
                ยังไม่ควรขายกับ
              </p>
              <ul className="mt-1 space-y-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                {pilotQualification.avoid.map((item) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs leading-5 text-gray-500 dark:text-gray-400">
          Next step: {pilotSalesKit.nextStep}
        </p>
        {salesKitCopyStatus === "manual" ? (
          <div className="mt-3">
            <p className="mb-1 text-xs leading-5 text-warning-700 dark:text-warning-300">
              Browser บล็อกการคัดลอกอัตโนมัติ เลือกข้อความไว้ให้แล้ว กด Ctrl/Cmd+C ได้เลย
            </p>
            <textarea
              ref={manualSalesKitTextareaRef}
              className="h-36 w-full resize-none rounded-lg border border-warning-200 bg-warning-50 p-2 text-xs leading-5 text-gray-800 outline-none focus:border-warning-400 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-gray-100"
              onFocus={(event) => event.currentTarget.select()}
              readOnly
              value={pilotSalesKitShareText}
            />
          </div>
        ) : null}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <HealthFact
          label="Coverage"
          value={
            proof
              ? `${proof.eligible_tenant_count}/${proof.active_tenant_count} ร้าน`
              : `${proofReady}/${activeTenants.length}`
          }
        />
        <HealthFact
          label="รอบ 7 วัน"
          value={scheduledProofValue}
        />
        <HealthFact
          label="LINE proof"
          value={lineProofValue}
        />
        <HealthFact
          label="Heavy p90"
          value={
            proof?.heavy_report_p90_ms != null
              ? formatElapsedMs(proof.heavy_report_p90_ms)
              : "ยังไม่มีข้อมูล"
          }
        />
        <HealthFact
          label="Report failed"
          value={
            proof
              ? `${proof.report_failure_count.toLocaleString("th-TH")} ครั้ง`
              : latestFailure
              ? `${formatJavaWsFailurePhase(latestFailure.failure_phase)} · ${
                  latestFailure.finished_at
                    ? formatDateTime(latestFailure.finished_at)
                    : formatOwnerReportLabel(latestFailure.report_key)
                }`
              : "ไม่พบล่าสุด"
          }
        />
        <HealthFact
          label="Ops alert"
          value={
            latestAlert
              ? `${formatOperationalAlertStatus(latestAlert.status)} · ${latestAlert.alert_type}`
              : "ยังไม่มี delivery"
          }
        />
      </div>
      {proof ? (
        <p className="mt-3 text-xs leading-5 text-gray-500 dark:text-gray-400">
          อัปเดตล่าสุด {formatDateTime(proof.generated_at)} · success rate รอบแจ้งเตือน{" "}
          {formatProofRate(proof.scheduled_success_rate)} · LINE{" "}
          {formatProofRate(proof.line_delivery_success_rate)}
        </p>
      ) : null}
      <div className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">
              Next actions สำหรับเปิด pilot
            </p>
            <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
              ใช้ตัดสินใจว่าจะ demo, รอดูรอบจริง หรือแก้ operational gap ก่อนคุยลูกค้า
            </p>
          </div>
          <Badge color={verdict.tone}>{verdict.label}</Badge>
        </div>
        <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
          {pilotLaunchActions.map((action) => (
            <div
              className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              key={action.title}
            >
              <div className="min-w-0">
                <Badge color={action.tone}>{action.label}</Badge>
                <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
                  {action.title}
                </p>
                <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                  {action.description}
                </p>
              </div>
              <Link
                className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                href={action.href}
              >
                {action.actionLabel}
              </Link>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <HealthFact
          label="Business signals"
          value={
            operationsStatus?.signal_metrics
              ? `${operationsStatus.signal_metrics.open.toLocaleString("th-TH")} เปิดอยู่`
              : "ยังไม่มีข้อมูล"
          }
        />
        <HealthFact
          label="Problem ล่าสุด"
          value={
            proof?.latest_problem_at
              ? formatDateTime(proof.latest_problem_at)
              : "ไม่พบในรอบล่าสุด"
          }
        />
        <HealthFact
          label="Clean target"
          value={proofRecoveryLine}
        />
      </div>
    </section>
  );
}

type TenantListFilter =
  | "active_flow"
  | "all"
  | "active"
  | "trial"
  | "suspended"
  | "cancelled";

const TENANT_LIST_FILTERS: Array<{
  label: string;
  value: TenantListFilter;
}> = [
  { label: "ใช้งาน/ทดลอง", value: "active_flow" },
  { label: "ทั้งหมด", value: "all" },
  { label: "ใช้งาน", value: "active" },
  { label: "ทดลองใช้", value: "trial" },
  { label: "ระงับ", value: "suspended" },
  { label: "ยกเลิก", value: "cancelled" },
];

function OwnerTenantsContent({
  busy,
  createTenant,
  datasourceConfig,
  datasourceTests,
  justCreatedTenantId,
  newTenantId,
  newTenantName,
  onCancelTenant,
  onPreviewTenantDeleteImpact,
  onTestDatasource,
  onUpdateTenant,
  onUpdateStatus,
  selectedTenantId,
  selectedTenantSummary,
  setNewTenantId,
  setNewTenantName,
  setSelectedTenantId,
  tenants,
}: OwnerSectionContentProps) {
  const [tenantFilter, setTenantFilter] =
    useState<TenantListFilter>("active_flow");
  const justCreatedTenant = justCreatedTenantId
    ? tenants.find((item) => item.tenant.id === justCreatedTenantId)?.tenant
    : null;
  const filteredTenants = tenants.filter((item) =>
    matchesTenantListFilter(item.tenant.status, tenantFilter),
  );
  const tenantOptions = filteredTenants.length ? filteredTenants : tenants;
  const tenantCounts = TENANT_LIST_FILTERS.reduce(
    (acc, item) => ({
      ...acc,
      [item.value]: tenants.filter((tenant) =>
        matchesTenantListFilter(tenant.tenant.status, item.value),
      ).length,
    }),
    {} as Record<TenantListFilter, number>,
  );

  return (
    <div className="space-y-4">
      <OwnerSetupPanel
        busy={busy}
        createTenant={createTenant}
        newTenantId={newTenantId}
        newTenantName={newTenantName}
        setNewTenantId={setNewTenantId}
        setNewTenantName={setNewTenantName}
      />

      {justCreatedTenant ? (
        <div className="rounded-xl border border-brand-200 bg-brand-50 p-4 dark:border-brand-500/30 dark:bg-brand-500/10">
          <p className="text-sm font-semibold text-brand-700 dark:text-brand-300">
            เพิ่ม {justCreatedTenant.name} แล้ว, ขั้นต่อไปคือเชื่อม SML ผ่าน JavaWS
          </p>
          <p className="mt-1 text-xs leading-5 text-brand-600 dark:text-brand-400">
            เลือกร้านนี้ด้านล่าง แล้วเปิดหน้า SML Connections เพื่อใส่ Tomcat, config file และ database
          </p>
        </div>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_520px]">
        <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="flex flex-col gap-3 p-5 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                ร้านค้าและสิทธิ์การใช้งาน
              </h2>
                <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
                ระงับร้านเพื่อหยุดส่ง LINE ชั่วคราว หรือยกเลิกร้านแบบ soft delete
                เพื่อเก็บประวัติไว้ตรวจย้อนหลัง
              </p>
            </div>
            <select
              className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              onChange={(event) => setSelectedTenantId(event.target.value)}
              value={selectedTenantId}
            >
              {tenantOptions.map((item) => (
                <option key={item.tenant.id} value={item.tenant.id}>
                  {item.tenant.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-gray-100 px-5 py-3 dark:border-gray-800">
            {TENANT_LIST_FILTERS.map((item) => (
              <button
                className={`h-9 rounded-lg border px-3 text-sm font-medium transition ${
                  tenantFilter === item.value
                    ? "border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300"
                    : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-white/[0.03]"
                }`}
                key={item.value}
                onClick={() => setTenantFilter(item.value)}
                type="button"
              >
                {item.label} {tenantCounts[item.value]}
              </button>
            ))}
          </div>

          <div className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-800 dark:border-gray-800">
            {filteredTenants.length ? (
              filteredTenants.map((item) => (
                <TenantCard
                  busy={busy}
                  datasourceTest={datasourceTests[item.tenant.id]}
                  item={item}
                  key={item.tenant.id}
                  onSelectTenant={setSelectedTenantId}
                  onUpdateStatus={onUpdateStatus}
                  selected={item.tenant.id === selectedTenantId}
                />
              ))
            ) : (
              <p className="p-5 text-sm text-gray-500 dark:text-gray-400">
                ไม่มีร้านใน filter นี้
              </p>
            )}
          </div>
        </div>

        <TenantDetailPanel
          busy={busy}
          datasourceConfig={datasourceConfig}
          datasourceTest={
            selectedTenantId ? datasourceTests[selectedTenantId] : undefined
          }
          item={selectedTenantSummary}
          onCancelTenant={onCancelTenant}
          onPreviewTenantDeleteImpact={onPreviewTenantDeleteImpact}
          onTestDatasource={onTestDatasource}
          onUpdateTenant={onUpdateTenant}
          onUpdateStatus={onUpdateStatus}
        />
      </section>
    </div>
  );
}

type SmlConnectionFilter =
  | "all"
  | "needs_config"
  | "javaws"
  | "test_failed"
  | "ready";

const SML_CONNECTION_FILTERS: Array<{
  label: string;
  value: SmlConnectionFilter;
}> = [
  { label: "ทั้งหมด", value: "all" },
  { label: "ต้องตั้งค่า", value: "needs_config" },
  { label: "JavaWS", value: "javaws" },
  { label: "ทดสอบไม่ผ่าน", value: "test_failed" },
  { label: "พร้อมใช้", value: "ready" },
];

function OwnerSmlConnectionsContent({
  busy,
  datasourceConfig,
  datasourceTests,
  javaWsAuthMode,
  javaWsAuthSecret,
  javaWsAuthUsername,
  javaWsBaseUrl,
  javaWsConfigFileName,
  javaWsDatabase,
  javaWsDatabaseDiscovery,
  javaWsEndpoint,
  javaWsWebappPath,
  onApplyJavaWsPreset,
  onDiscoverJavaWsDatabases,
  onSaveDatasourceConfig,
  onTestDatasource,
  selectedTenantId,
  selectedTenantSummary,
  setJavaWsAuthMode,
  setJavaWsAuthSecret,
  setJavaWsAuthUsername,
  setJavaWsBaseUrl,
  setJavaWsConfigFileName,
  setJavaWsDatabase,
  setJavaWsWebappPath,
  setSelectedTenantId,
  smlConnections,
  tenants,
}: OwnerSectionContentProps) {
  const [filter, setFilter] = useState<SmlConnectionFilter>("all");
  const connectionRows =
    smlConnections.length > 0
      ? smlConnections
      : tenants.map((item) => ({
          ...item,
          datasource: buildFallbackDatasourceStatus(item),
          last_test: null,
        }));
  const selectedRow = connectionRows.find(
    (item) => item.tenant.id === selectedTenantId,
  );
  const selectedTenant = selectedTenantSummary ?? selectedRow;
  const selectedDatasource = datasourceConfig ?? selectedRow?.datasource ?? null;
  const selectedTest = selectedTenantId
    ? datasourceTests[selectedTenantId] ?? selectedRow?.last_test ?? undefined
    : undefined;
  const filteredRows = connectionRows.filter((item) =>
    matchesSmlConnectionFilter(item, datasourceTests[item.tenant.id], filter),
  );
  const counts = buildSmlConnectionCounts(connectionRows, datasourceTests);
  const datasourceBusy = selectedTenantId
    ? busy === `datasource-${selectedTenantId}`
    : false;
  const savedDatasourceBusy = selectedTenantId
    ? busy === `datasource-saved-${selectedTenantId}`
    : false;
  const discoveryBusy = selectedTenantId
    ? busy === `javaws-databases-${selectedTenantId}`
    : false;

  return (
    <div className="space-y-4">
      <section className="grid gap-3 md:grid-cols-4">
        <OwnerStatCard
          label="ร้านทั้งหมด"
          value={counts.all.toLocaleString("th-TH")}
        />
        <OwnerStatCard
          label="ต้องตั้งค่า"
          value={counts.needs_config.toLocaleString("th-TH")}
        />
        <OwnerStatCard
          label="Tomcat JavaWS"
          value={counts.javaws.toLocaleString("th-TH")}
        />
        <OwnerStatCard
          label="พร้อมใช้"
          value={counts.ready.toLocaleString("th-TH")}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(420px,1.2fr)]">
        <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                  ร้านที่ต้องเชื่อม SML
                </h2>
                <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
                  เลือกร้านทางซ้าย แล้วกรอก Tomcat URL, port, SMLConfig และ database ทางขวา
                </p>
              </div>
              <Badge color={counts.test_failed ? "warning" : "light"}>
                ทดสอบไม่ผ่าน {counts.test_failed.toLocaleString("th-TH")}
              </Badge>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {SML_CONNECTION_FILTERS.map((item) => (
                <button
                  className={`h-9 rounded-lg border px-3 text-sm font-medium transition ${
                    filter === item.value
                      ? "border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300"
                      : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-white/[0.03]"
                  }`}
                  key={item.value}
                  onClick={() => setFilter(item.value)}
                  type="button"
                >
                  {item.label} {counts[item.value].toLocaleString("th-TH")}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-800 dark:border-gray-800">
            {filteredRows.length ? (
              filteredRows.map((item) => (
                <SmlConnectionTenantRow
                  datasourceTest={datasourceTests[item.tenant.id] ?? item.last_test ?? undefined}
                  item={item}
                  key={item.tenant.id}
                  onSelectTenant={setSelectedTenantId}
                  selected={item.tenant.id === selectedTenantId}
                />
              ))
            ) : (
              <p className="p-5 text-sm text-gray-500 dark:text-gray-400">
                ไม่มีร้านใน filter นี้
              </p>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {selectedTenant ? (
            <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                      {selectedTenant.tenant.name}
                    </h2>
                    <Badge color={tenantStatusTone(selectedTenant.tenant.status)}>
                      {formatTenantStatus(selectedTenant.tenant.status)}
                    </Badge>
                    <Badge color={datasourceStatusTone(selectedDatasource)}>
                      {formatDatasourceSource(selectedDatasource)}
                    </Badge>
                  </div>
                  <p className="mt-1 break-words text-sm leading-6 text-gray-500 dark:text-gray-400">
                    {selectedTenant.tenant.id} · ฐานข้อมูล{" "}
                    {selectedDatasource?.database ??
                      (selectedTenant.tenant.databaseName || "ยังไม่ระบุ")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={datasourceBusy}
                    size="sm"
                    variant="outline"
                    onClick={() => void onTestDatasource(selectedTenant.tenant.id)}
                  >
                    {datasourceBusy ? "กำลังทดสอบ..." : "ทดสอบค่าที่กรอก"}
                  </Button>
                  <Button
                    disabled={
                      savedDatasourceBusy ||
                      !selectedDatasource ||
                      selectedDatasource.source === "missing" ||
                      selectedDatasource.kind !== "sml_javaws"
                    }
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void onTestDatasource(selectedTenant.tenant.id, "saved")
                    }
                  >
                    {savedDatasourceBusy ? "กำลังทดสอบ..." : "ทดสอบค่าที่บันทึก"}
                  </Button>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <HealthFact
                  label="วิธีเชื่อม"
                  value={formatDatasourceMode(selectedDatasource?.kind)}
                />
                <HealthFact
                  label="สถานะค่า"
                  value={formatDatasourceSource(selectedDatasource)}
                />
                <HealthFact
                  label="การยืนยันตัวตน"
                  value={
                    selectedDatasource?.password_configured ||
                    selectedDatasource?.auth_configured
                      ? "ตั้งแล้ว"
                      : "ไม่ใช้ auth"
                  }
                />
              </div>

              <DatasourceTestSummary result={selectedTest} />
            </section>
          ) : (
	            <section className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-500 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-400">
	              เลือกร้านทางซ้ายเพื่อเริ่มตั้งค่า SML JavaWS
	            </section>
          )}

          {selectedTenant ? (
            <DatasourceConfigPanel
              autoOpen
              busy={busy === `datasource-save-${selectedTenant.tenant.id}`}
              discoveryBusy={discoveryBusy}
              config={selectedDatasource}
              javaWsAuthMode={javaWsAuthMode}
              javaWsAuthSecret={javaWsAuthSecret}
              javaWsAuthUsername={javaWsAuthUsername}
              javaWsBaseUrl={javaWsBaseUrl}
              javaWsConfigFileName={javaWsConfigFileName}
              javaWsDatabaseDiscovery={javaWsDatabaseDiscovery}
              javaWsDatabase={javaWsDatabase}
              javaWsEndpoint={javaWsEndpoint}
              javaWsWebappPath={javaWsWebappPath}
              onJavaWsAuthModeChange={setJavaWsAuthMode}
              onJavaWsAuthSecretChange={setJavaWsAuthSecret}
              onJavaWsAuthUsernameChange={setJavaWsAuthUsername}
              onJavaWsBaseUrlChange={setJavaWsBaseUrl}
              onJavaWsConfigFileNameChange={setJavaWsConfigFileName}
              onJavaWsDatabaseChange={setJavaWsDatabase}
              onJavaWsWebappPathChange={setJavaWsWebappPath}
              onApplyJavaWsPreset={onApplyJavaWsPreset}
              onDiscoverJavaWsDatabases={() =>
                void onDiscoverJavaWsDatabases(selectedTenant.tenant.id)
              }
              onSubmit={onSaveDatasourceConfig}
            />
          ) : null}
        </div>
      </section>
    </div>
  );
}

function OwnerReportPermissionsContent({
  busy,
  onSaveReportPermissions,
  onToggleReportPermission,
  reportPermissionDraft,
  reportPermissions,
  selectedTenantId,
  setSelectedTenantId,
  tenants,
}: OwnerSectionContentProps) {
  const selectedTenant = tenants.find(
    (item) => item.tenant.id === selectedTenantId,
  );
  const saveBusy = busy === `report-permissions-save-${selectedTenantId}`;
  const totalTargets = reportPermissions?.roles.reduce(
    (sum, role) => sum + role.target_count,
    0,
  ) ?? 0;

  if (!reportPermissions) {
    return (
      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <Badge color="light">กำลังโหลด</Badge>
        <h2 className="mt-3 text-base font-semibold text-gray-900 dark:text-white">
          โหลดสิทธิ์รายงานของร้าน
        </h2>
        <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
          ถ้ายังไม่ขึ้น กรุณาเลือกร้านค้าทางซ้ายหรือกดรีเฟรชหน้า Owner อีกครั้ง
        </p>
      </section>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(260px,0.72fr)_minmax(0,1.28fr)]">
      <section className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <OwnerPanelHeader
          title="ร้านค้า"
          description="สิทธิ์รายงานตั้งแยกต่อร้านและ sync เฉพาะ LINE ID ของร้านนั้น"
        />
        <div className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-800 dark:border-gray-800">
          {tenants.map((item) => (
            <button
              className={`w-full p-4 text-left transition ${
                item.tenant.id === selectedTenantId
                  ? "bg-brand-50/70 dark:bg-brand-500/10"
                  : "hover:bg-gray-50 dark:hover:bg-white/[0.03]"
              }`}
              key={item.tenant.id}
              onClick={() => setSelectedTenantId(item.tenant.id)}
              type="button"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                    {item.tenant.name}
                  </p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {item.health.line_targets_enabled}/
                    {item.health.line_targets_total} ผู้รับ LINE พร้อมใช้งาน
                  </p>
                </div>
                <Badge color={item.tenant.id === selectedTenantId ? "success" : "light"}>
                  {item.tenant.id === selectedTenantId ? "กำลังแก้" : "เลือก"}
                </Badge>
              </div>
            </button>
          ))}
        </div>
      </section>

      <div className="space-y-4">
        <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <Badge color="info">{selectedTenant?.tenant.name ?? "เลือกร้าน"}</Badge>
              <h2 className="mt-3 text-lg font-semibold text-gray-900 dark:text-white">
                Matrix สิทธิ์รายงานตาม Role
              </h2>
              <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
                ติ๊กว่า role ไหนดูรายงานไหนได้บ้าง แล้วระบบจะ sync ไปยัง LINE ID เดิมของร้านนี้
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge color="light">{reportPermissions.reports.length} รายงาน</Badge>
              <Badge color="light">{totalTargets} LINE targets</Badge>
            </div>
          </div>

          {reportPermissions.impacted_notification_plans.length ? (
            <div className="mt-4 rounded-lg border border-warning-200 bg-warning-50 p-3 text-sm leading-6 text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-300">
              มีแผนแจ้งเตือนที่สิทธิ์ปัจจุบันไม่สอดคล้องกันแล้ว:
              {" "}
              {reportPermissions.impacted_notification_plans
                .slice(0, 3)
                .map((item) => item.rule_name)
                .join(", ")}
            </div>
          ) : null}

          <div className="mt-5 hidden overflow-x-auto rounded-lg border border-gray-100 dark:border-gray-800 lg:block">
            <table className="min-w-full divide-y divide-gray-100 text-sm dark:divide-gray-800">
              <thead className="bg-gray-50 text-left dark:bg-white/[0.02]">
                <tr>
                  <th className="w-[34%] px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">
                    รายงาน
                  </th>
                  {reportPermissions.roles.map((role) => (
                    <th
                      className="px-3 py-3 text-center font-semibold text-gray-700 dark:text-gray-300"
                      key={role.access_profile_key}
                    >
                      <span className="block">{role.label}</span>
                      <span className="mt-1 block text-xs font-normal text-gray-500 dark:text-gray-400">
                        {role.target_count} LINE ID
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {reportPermissions.reports.map((report) => (
                  <tr key={report.report_key}>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-gray-900 dark:text-white">
                          {report.label}
                        </span>
                        {report.sensitive ? (
                          <Badge color="warning">ข้อมูลต้นทุน</Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 max-w-[56ch] text-xs leading-5 text-gray-500 dark:text-gray-400">
                        {report.description}
                      </p>
                    </td>
                    {reportPermissions.roles.map((role) => {
                      const checked = Boolean(
                        reportPermissionDraft[
                          role.access_profile_key
                        ]?.includes(report.report_key),
                      );
                      return (
                        <td
                          className="px-3 py-3 text-center align-top"
                          key={role.access_profile_key}
                        >
                          <label className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-white/[0.03]">
                            <input
                              checked={checked}
                              className="h-4 w-4 rounded border-gray-300 text-brand-600"
                              onChange={() =>
                                onToggleReportPermission(
                                  role.access_profile_key,
                                  report.report_key,
                                )
                              }
                              type="checkbox"
                            />
                          </label>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-5 space-y-3 lg:hidden">
            {reportPermissions.reports.map((report) => (
              <div
                className="rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]"
                key={report.report_key}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">
                    {report.label}
                  </p>
                  {report.sensitive ? <Badge color="warning">ข้อมูลต้นทุน</Badge> : null}
                </div>
                <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                  {report.description}
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {reportPermissions.roles.map((role) => {
                    const checked = Boolean(
                      reportPermissionDraft[role.access_profile_key]?.includes(
                        report.report_key,
                      ),
                    );
                    return (
                      <label
                        className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-900"
                        key={role.access_profile_key}
                      >
                        <span className="min-w-0">
                          <span className="block font-medium text-gray-800 dark:text-white/90">
                            {role.label}
                          </span>
                          <span className="block text-xs text-gray-500 dark:text-gray-400">
                            {role.target_count} LINE ID
                          </span>
                        </span>
                        <input
                          checked={checked}
                          className="h-4 w-4 shrink-0 rounded border-gray-300 text-brand-600"
                          onChange={() =>
                            onToggleReportPermission(
                              role.access_profile_key,
                              report.report_key,
                            )
                          }
                          type="checkbox"
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-col gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02] sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-6 text-gray-600 dark:text-gray-300">
              เมื่อบันทึก ระบบจะอัปเดตสิทธิ์รายงานของ LINE ID ทุกตัวในร้านนี้ตาม role
            </p>
            <Button
              disabled={!selectedTenantId || saveBusy}
              onClick={() => void onSaveReportPermissions()}
              size="sm"
            >
              {saveBusy ? "กำลังบันทึก..." : "บันทึกและ sync LINE"}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}

function OwnerReportsContent({
  busy,
  heavyReportProgress,
  lastManualRun,
  lastManualSnapshot,
  onRunHeavyReport,
  onRunPurchaseReport,
  onRunSalesReport,
  onRunGrossProfitReport,
  onSaveValidationSignoff,
  reportDateFrom,
  reportDateTo,
  selectedTenantId,
  selectedTenantSummary,
  setReportDateFrom,
  setReportDateTo,
  setSelectedTenantId,
  setValidationNote,
  setValidationReferenceTotal,
  setValidationSignedBy,
  tenants,
  validationNote,
  validationReferenceTotal,
  validationSignedBy,
  validationSignoffResult,
}: OwnerSectionContentProps) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
      <section className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <OwnerPanelHeader
          title="รายงานที่เปิดใช้ใน pilot"
          description="รอบนี้มี 4 รายงาน: ขาย, ซื้อ/ตั้งหนี้, กำไรขั้นต้นสินค้า และกำไรขั้นต้นลูกหนี้ โดยรายงานกำไรมีข้อมูลต้นทุนจึงควรให้เฉพาะผู้บริหาร"
        />
        <div className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-800 dark:border-gray-800">
          {tenants.map((item) => (
            <ReportTenantRow
              item={item}
              key={item.tenant.id}
              onSelectTenant={setSelectedTenantId}
              selected={item.tenant.id === selectedTenantId}
            />
          ))}
        </div>
      </section>

      <OwnerReportRunnerPanel
        busy={busy}
        dateFrom={reportDateFrom}
        dateTo={reportDateTo}
        heavyReportProgress={heavyReportProgress}
        lastRun={lastManualRun}
        lastSnapshot={lastManualSnapshot}
        onDateFromChange={setReportDateFrom}
        onDateToChange={setReportDateTo}
        onRun={onRunSalesReport}
        onRunHeavyReport={onRunHeavyReport}
        onRunGrossProfit={onRunGrossProfitReport}
        onRunPurchase={onRunPurchaseReport}
        onSaveValidationSignoff={onSaveValidationSignoff}
        selectedTenant={selectedTenantSummary}
        selectedTenantId={selectedTenantId}
        setSelectedTenantId={setSelectedTenantId}
        setValidationNote={setValidationNote}
        setValidationReferenceTotal={setValidationReferenceTotal}
        setValidationSignedBy={setValidationSignedBy}
        tenants={tenants}
        validationNote={validationNote}
        validationReferenceTotal={validationReferenceTotal}
        validationSignedBy={validationSignedBy}
        validationSignoffResult={validationSignoffResult}
      />
    </div>
  );
}

function OwnerLineContent({
  busy,
  createLineChannel,
  lineAccessTokenInput,
  lineChannelName,
  lineChannelShared,
  lineChannelSecretInput,
  lineChannels,
  lineRecipients,
  lineSecretConfigured,
  lineSecretChannelId,
  lineTokenConfigured,
  onAssignLineRecipient,
  onApproveLineTarget,
  onSaveLineChannelSecrets,
  onSetLineTargetProfile,
  onTestLineTarget,
  onToggleLineTarget,
  onUpdateLineChannel,
  onUpdateLineTargetRecipientEstimate,
  publicOrigin,
  selectedTenant,
  selectedTenantId,
  selectedTenantLineChannels,
  selectedTenantLineTargets,
  setLineAccessTokenInput,
  setLineChannelName,
  setLineChannelShared,
  setLineChannelSecretInput,
  setLineSecretChannelId,
  setLineSecretConfigured,
  setLineTokenConfigured,
  setSelectedTenantId,
  tenants,
}: OwnerSectionContentProps) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
      <div className="space-y-4">
        <section className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <OwnerPanelHeader
          actionHref={`/owner/report-permissions?tenant=${encodeURIComponent(
            selectedTenantId,
          )}`}
          actionLabel="แก้สิทธิ์รายงาน"
          title="LINE OA และผู้รับรายงาน"
          description="รวมสถานะ LINE ต่อร้าน เลือกร้านแล้วจัดการผู้บริหารรายคน กลุ่มทีมงาน และสิทธิ์รับแผนแจ้งเตือน"
        />
          <div className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-800 dark:border-gray-800">
            {tenants.map((item) => (
              <LineTenantRow
                item={item}
                key={item.tenant.id}
                onSelectTenant={setSelectedTenantId}
                selected={item.tenant.id === selectedTenantId}
              />
            ))}
          </div>
        </section>

        <OwnerLineRecipientLibraryPanel
          busy={busy}
          lineChannels={selectedTenantLineChannels}
          onAssign={onAssignLineRecipient}
          recipients={lineRecipients}
          selectedTenantId={selectedTenantId}
          selectedTenantName={selectedTenant?.name ?? "ร้านที่เลือก"}
          selectedTenantTargets={selectedTenantLineTargets}
        />

        <OwnerLineTargetsPanel
          busy={busy}
          lineChannels={lineChannels}
          onApprove={onApproveLineTarget}
          onSetProfile={onSetLineTargetProfile}
          onTestSend={onTestLineTarget}
          onToggleEnabled={onToggleLineTarget}
          onUpdateRecipientEstimate={onUpdateLineTargetRecipientEstimate}
          targets={selectedTenantLineTargets}
          tenantName={selectedTenant?.name ?? "ร้านที่เลือก"}
        />
      </div>

      <div className="space-y-4">
        <LineOnboardingGuide
          publicOrigin={publicOrigin}
          tenantName={selectedTenant?.name ?? "ร้านที่เลือก"}
        />
        <LineChannelPanel
          busy={busy}
          createLineChannel={createLineChannel}
          lineAccessTokenInput={lineAccessTokenInput}
          lineChannelName={lineChannelName}
          lineChannelShared={lineChannelShared}
          lineChannelSecretInput={lineChannelSecretInput}
          lineSecretChannelId={lineSecretChannelId}
          lineSecretConfigured={lineSecretConfigured}
          lineTokenConfigured={lineTokenConfigured}
          onSaveLineChannelSecrets={onSaveLineChannelSecrets}
          onUpdateLineChannel={onUpdateLineChannel}
          selectedTenant={selectedTenant}
          selectedTenantId={selectedTenantId}
          selectedTenantLineChannels={selectedTenantLineChannels}
          setLineAccessTokenInput={setLineAccessTokenInput}
          setLineChannelName={setLineChannelName}
          setLineChannelShared={setLineChannelShared}
          setLineChannelSecretInput={setLineChannelSecretInput}
          setLineSecretChannelId={setLineSecretChannelId}
          setLineSecretConfigured={setLineSecretConfigured}
          setLineTokenConfigured={setLineTokenConfigured}
          setSelectedTenantId={setSelectedTenantId}
          tenants={tenants}
        />
      </div>
    </div>
  );
}

function OwnerAuditContent({
  busy,
  onLoadTelegramChats,
  onRunOperationalAlertSmokeTest,
  onSaveTelegramBotToken,
  onSaveTelegramTarget,
  onSendTelegramTestAlert,
  operationsStatus,
  setTelegramBotTokenInput,
  telegramBotTokenInput,
  telegramChats,
  tenants,
}: OwnerSectionContentProps) {
  return (
    <div className="space-y-4">
      <OperationsStatusPanel operationsStatus={operationsStatus} />
      <TelegramOpsPanel
        busy={busy}
        operationsStatus={operationsStatus}
        telegramBotTokenInput={telegramBotTokenInput}
        telegramChats={telegramChats}
        setTelegramBotTokenInput={setTelegramBotTokenInput}
        onLoadTelegramChats={onLoadTelegramChats}
        onRunOperationalAlertSmokeTest={onRunOperationalAlertSmokeTest}
        onSaveTelegramBotToken={onSaveTelegramBotToken}
        onSaveTelegramTarget={onSaveTelegramTarget}
        onSendTelegramTestAlert={onSendTelegramTestAlert}
      />

      <section className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <OwnerPanelHeader
          title="ประวัติระบบล่าสุด"
          description="มุมมอง logs แบบ owner: รอบรายงาน การส่ง LINE และ audit ล่าสุดต่อร้าน"
        />
        <div className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-800 dark:border-gray-800">
          {tenants.map((item) => (
            <AuditTenantRow item={item} key={item.tenant.id} />
          ))}
        </div>
      </section>

      <AuditLogPanel auditLogs={operationsStatus?.audit_logs ?? []} />
    </div>
  );
}

function OwnerSettingsContent({
  busy,
  onSaveSystemConfig,
  operationsStatus,
  setSystemAppBaseUrl,
  setSystemBackupConfigured,
  setSystemLastBackupAt,
  setSystemPublicApiBaseUrl,
  setSystemReportViewerLinkTtlHours,
  setSystemReportViewerSigningSecret,
  setSystemWorkerHeartbeatToken,
  setSystemWorkerId,
  systemAppBaseUrl,
  systemBackupConfigured,
  systemConfig,
  systemLastBackupAt,
  systemPublicApiBaseUrl,
  systemReportViewerLinkTtlHours,
  systemReportViewerSigningSecret,
  systemWorkerHeartbeatToken,
  systemWorkerId,
}: OwnerSectionContentProps) {
  const config = systemConfig ?? operationsStatus?.system_config ?? null;
  const saveBusy = busy === "system-config-save";

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
              Runtime settings
            </h2>
            <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
              ค่าเหล่านี้บันทึกใน encrypted system store และไม่ต้องแก้ env สำหรับการใช้งานประจำ
            </p>
          </div>
          <Badge color={config?.source === "encrypted_store" ? "success" : "warning"}>
            {formatSystemConfigSource(config?.source)}
          </Badge>
        </div>

        <form
          className="mt-5 space-y-5 border-t border-gray-100 pt-5 dark:border-gray-800"
          onSubmit={onSaveSystemConfig}
        >
          {!config?.encryption_configured ? (
            <p className="rounded-lg border border-warning-200 bg-warning-50 p-3 text-sm leading-6 text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-300">
              ยังไม่มี secret key ใน bootstrap config จึงยังบันทึก runtime secret ลง encrypted store ไม่ได้
            </p>
          ) : null}

          <SystemSetupChecklist config={config} />

          <div className="grid gap-3 md:grid-cols-2">
            <OwnerTextInput
              description="ใช้สร้างลิงก์ dashboard ที่ส่งใน LINE Flex ต้องเป็น URL ที่ผู้รับเปิดจากมือถือได้"
              label="App base URL"
              onChange={setSystemAppBaseUrl}
              placeholder="https://app.example.com"
              value={systemAppBaseUrl}
            />
            <OwnerTextInput
              description="ใช้เมื่อ webhook หรือ public callback ต้องชี้ API แยกจากหน้าเว็บ ถ้าใช้ same-origin ให้กรอก URL เว็บหลักได้"
              label="Public API base URL"
              onChange={setSystemPublicApiBaseUrl}
              placeholder="https://api.example.com"
              value={systemPublicApiBaseUrl}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <OwnerTextInput
              description={
                config?.report_viewer_signing_secret_configured
                  ? "ตั้งค่าแล้ว ใส่ค่าใหม่เฉพาะเมื่อต้องการหมุน secret เพื่อเซ็นลิงก์ dashboard จาก LINE"
                  : "ใช้เซ็นลิงก์ dashboard จาก LINE เพื่อป้องกันลิงก์ปลอม ต้องยาวอย่างน้อย 32 ตัวอักษร"
              }
              label="Report signing secret"
              onChange={setSystemReportViewerSigningSecret}
              placeholder={
                config?.report_viewer_signing_secret_configured
                  ? "ใส่ใหม่เฉพาะเมื่อต้องการเปลี่ยน secret"
                  : "กรอก secret 32 ตัวอักษรขึ้นไป"
              }
              type="password"
              value={systemReportViewerSigningSecret}
            />
            <OwnerTextInput
              description="กำหนดอายุลิงก์ dashboard ที่ส่งจาก LINE หน่วยเป็นชั่วโมง ค่าแนะนำคือ 72"
              label="Report link TTL (hours)"
              onChange={setSystemReportViewerLinkTtlHours}
              placeholder="72"
              value={systemReportViewerLinkTtlHours}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <OwnerTextInput
              description="ชื่อ worker ที่ใช้บันทึก heartbeat และ trace งานเบื้องหลัง"
              label="Worker ID"
              onChange={setSystemWorkerId}
              placeholder="worker_notification_rules_1"
              value={systemWorkerId}
            />
            <OwnerTextInput
              description="token สำหรับให้ worker เรียก API tick/heartbeat ระบบจะไม่แสดงค่ากลับมา"
              label="Worker heartbeat token"
              onChange={setSystemWorkerHeartbeatToken}
              placeholder={
                config?.worker_heartbeat_token_configured
                  ? "ใส่ใหม่เฉพาะเมื่อต้องการเปลี่ยน token"
                  : "ใส่ token สำหรับ worker heartbeat"
              }
              type="password"
              value={systemWorkerHeartbeatToken}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-3 text-sm text-gray-700 dark:border-gray-800 dark:text-gray-300">
              <input
                checked={systemBackupConfigured}
                className="h-4 w-4 rounded border-gray-300 text-brand-500"
                onChange={(event) =>
                  setSystemBackupConfigured(event.target.checked)
                }
                type="checkbox"
              />
              <span>
                <span className="block font-medium">Backup configured</span>
                <span className="block text-xs leading-5 text-gray-500 dark:text-gray-400">
                  ใช้บอกว่า System DB มีแผนสำรองและ restore test แล้ว
                </span>
              </span>
            </label>
            <OwnerTextInput
              description="เวลาสำรองข้อมูลล่าสุด เพื่อให้ admin เห็นว่า production ยังถูกดูแลอยู่"
              label="Last backup at"
              onChange={setSystemLastBackupAt}
              placeholder="2026-06-01T08:00:00.000Z"
              value={systemLastBackupAt}
            />
          </div>

          <Button
            disabled={saveBusy || !config?.encryption_configured}
            size="sm"
          >
            {saveBusy ? "กำลังบันทึก..." : "บันทึก System Config"}
          </Button>
        </form>
      </section>

      <SystemBootstrapPanel config={config} />
    </div>
  );
}

function SystemSetupChecklist({ config }: { config: SystemConfigStatus | null }) {
  const items = [
    {
      label: "System DB พร้อม",
      ok: Boolean(config?.bootstrap.system_database_configured),
      detail: "ใช้เก็บร้านค้า, LINE, แผนแจ้งเตือน, logs และ encrypted secrets",
    },
    {
      label: "Encryption key พร้อม",
      ok: Boolean(config?.encryption_configured),
      detail: "ใช้เข้ารหัส token, secret และ config สำคัญก่อนบันทึกใน DB",
    },
    {
      label: "App base URL พร้อม",
      ok: Boolean(config?.app_base_url),
      detail: "ใช้สร้างลิงก์ dashboard ที่ส่งให้ผู้รับทาง LINE",
    },
    {
      label: "Report signing พร้อม",
      ok: Boolean(config?.report_viewer_signing_secret_configured),
      detail: "ใช้เซ็นลิงก์ dashboard เพื่อป้องกันการเปิดรายงานด้วยลิงก์ปลอม",
    },
    {
      label: "Worker token พร้อม",
      ok: Boolean(config?.worker_heartbeat_token_configured),
      detail: "ใช้ยืนยัน worker ที่เรียก tick แผนแจ้งเตือนจาก DB",
    },
  ];

  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
        System Setup Checklist
      </h3>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {items.map((item) => (
          <div
            className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900"
            key={item.label}
          >
            <div className="flex items-start gap-2">
              <Badge color={item.ok ? "success" : "warning"}>
                {item.ok ? "พร้อม" : "ต้องกรอก"}
              </Badge>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                  {item.label}
                </p>
                <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                  {item.detail}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SystemBootstrapPanel({
  config,
}: {
  config: SystemConfigStatus | null;
}) {
  const bootstrap = config?.bootstrap;
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            Bootstrap file
          </h2>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            ใช้เฉพาะค่าที่ระบบต้องรู้ก่อนเปิด system store เช่น DB URL และ master secret key
          </p>
        </div>
        <Badge color={bootstrap?.exists ? "success" : "warning"}>
          {bootstrap?.exists ? "พบไฟล์" : "ยังไม่พบไฟล์"}
        </Badge>
      </div>

      <div className="mt-4 space-y-3">
        <HealthFact label="Path" value={bootstrap?.path ?? "-"} />
        <HealthFact
          label="System DB"
          value={bootstrap?.system_database_configured ? "configured" : "missing"}
        />
        <HealthFact
          label="Secret key"
          value={bootstrap?.secret_key_present ? "present" : "missing"}
        />
        <HealthFact
          label="Report signing"
          value={
            bootstrap?.report_viewer_signing_secret_configured
              ? "bootstrap fallback"
              : config?.report_viewer_signing_secret_configured
                ? "encrypted store"
                : "missing"
          }
        />
        <HealthFact
          label="Config source"
          value={formatSystemConfigSource(config?.source)}
        />
      </div>

      {bootstrap?.read_error ? (
        <p className="mt-4 rounded-lg border border-error-200 bg-error-50 p-3 text-sm leading-6 text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300">
          {bootstrap.read_error}
        </p>
      ) : null}
      <p className="mt-4 rounded-lg border border-warning-100 bg-warning-50 p-3 text-xs leading-5 text-warning-700 dark:border-warning-500/20 dark:bg-warning-500/10 dark:text-warning-300">
        ค่า bootstrap ที่เปลี่ยนแล้วมีผลหลัง restart service ส่วน runtime settings ในหน้านี้อ่านจาก encrypted store
      </p>
    </section>
  );
}

function OperationsStatusPanel({
  operationsStatus,
}: {
  operationsStatus: OwnerOperationsStatus | null;
}) {
  if (!operationsStatus) {
    return (
      <section className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-500 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-400">
        ยังโหลด monitoring status ไม่สำเร็จ กดรีเฟรชอีกครั้งหรือตรวจ session ผู้ดูแล
      </section>
    );
  }

  const workerTone =
    operationsStatus.worker.status === "ok"
      ? "success"
      : operationsStatus.worker.status === "missing"
        ? "warning"
        : "warning";
  const backupTone = operationsStatus.backup.configured ? "success" : "warning";

  return (
    <section className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <OwnerPanelHeader
        title="Monitoring / Backup readiness"
        description="ดูสถานะ API, worker สำหรับแผนแจ้งเตือน และแผน backup ก่อนเรียกว่าพร้อม production"
      />
      <div className="grid gap-3 border-t border-gray-100 p-4 dark:border-gray-800 md:grid-cols-2 xl:grid-cols-4">
        <HealthFact
          label="System store"
          value={
            operationsStatus.api.system_store === "postgres"
              ? "PostgreSQL"
              : "Local JSON"
          }
        />
        <HealthFact
          label="Notification rules"
          value={
            operationsStatus.scheduler.enabled
              ? "DB-backed"
              : "ยังไม่พร้อม"
          }
        />
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
          <p className="text-xs text-gray-500 dark:text-gray-400">Worker</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-900 dark:text-white">
              {formatWorkerStatus(operationsStatus.worker.status)}
            </span>
            <Badge color={workerTone}>{operationsStatus.worker.age_seconds ?? "-"}s</Badge>
          </div>
        </div>
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
          <p className="text-xs text-gray-500 dark:text-gray-400">Backup</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-900 dark:text-white">
              {operationsStatus.backup.configured ? "ตั้งค่าแล้ว" : "ยังต้องตั้ง"}
            </span>
            <Badge color={backupTone}>
              {operationsStatus.backup.last_backup_at
                ? formatDateTime(operationsStatus.backup.last_backup_at)
                : "ไม่มีเวลา backup"}
            </Badge>
          </div>
        </div>
      </div>
      {!operationsStatus.backup.configured ? (
        <p className="border-t border-warning-100 bg-warning-50 px-4 py-3 text-sm leading-6 text-warning-700 dark:border-warning-500/20 dark:bg-warning-500/10 dark:text-warning-300">
          {operationsStatus.backup.recommendation}
        </p>
      ) : null}
      {operationsStatus.report_health?.latest_javaws_failure ? (
        <div className="border-t border-gray-100 p-4 dark:border-gray-800">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            JavaWS failure ล่าสุด
          </p>
          <div className="mt-2 grid gap-2 text-sm text-gray-600 dark:text-gray-300 md:grid-cols-4">
            <span>{operationsStatus.report_health.latest_javaws_failure.tenant_id}</span>
            <span>{operationsStatus.report_health.latest_javaws_failure.report_key}</span>
            <span>
              {operationsStatus.report_health.latest_javaws_failure.failure_kind ?? "-"}
            </span>
            <span>
              phase:{" "}
              {operationsStatus.report_health.latest_javaws_failure.failure_phase ?? "-"}
            </span>
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {operationsStatus.report_health.latest_javaws_failure.safe_error_message}
          </p>
        </div>
      ) : null}
      {operationsStatus.report_health?.heavy_report_runs?.length ? (
        <div className="border-t border-gray-100 p-4 dark:border-gray-800">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            Heavy report duration ล่าสุด
          </p>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {operationsStatus.report_health.heavy_report_runs.slice(0, 4).map((run) => (
              <div
                className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm dark:border-gray-800 dark:bg-white/[0.02]"
                key={run.id}
              >
                <p className="font-medium text-gray-900 dark:text-white">
                  {run.tenant_id}
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {run.report_key}
                </p>
                <p className="mt-2 text-gray-700 dark:text-gray-300">
                  {run.duration_ms === null
                    ? "-"
                    : `${Math.round(run.duration_ms / 1000).toLocaleString("th-TH")}s`}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function TelegramOpsPanel({
  busy,
  operationsStatus,
  telegramBotTokenInput,
  telegramChats,
  setTelegramBotTokenInput,
  onLoadTelegramChats,
  onRunOperationalAlertSmokeTest,
  onSaveTelegramBotToken,
  onSaveTelegramTarget,
  onSendTelegramTestAlert,
}: {
  busy: string | null;
  operationsStatus: OwnerOperationsStatus | null;
  telegramBotTokenInput: string;
  telegramChats: TelegramChatPreview[];
  setTelegramBotTokenInput: (value: string) => void;
  onLoadTelegramChats: () => Promise<void>;
  onRunOperationalAlertSmokeTest: (alertType: string) => Promise<void>;
  onSaveTelegramBotToken: (event: FormEvent<HTMLFormElement>) => void;
  onSaveTelegramTarget: (chat: TelegramChatPreview) => Promise<void>;
  onSendTelegramTestAlert: () => Promise<void>;
}) {
  const telegram = operationsStatus?.operational_alerts?.telegram ?? null;
  const status = telegram?.status ?? null;
  const deliveries = telegram?.deliveries ?? [];
  const hasTarget = Boolean(status?.targets.some((target) => target.enabled));
  const savingToken = busy === "telegram-token-save";
  const loadingChats = busy === "telegram-chats-load";
  const sendingTest = busy === "telegram-test-alert";

  return (
    <section className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <OwnerPanelHeader
        title="Telegram ops alert"
        description="ตั้งค่าแจ้งเตือน operational ให้ owner ใช้ติดตาม JavaWS, LINE delivery และ worker health"
      />
      <div className="grid gap-4 border-t border-gray-100 p-4 dark:border-gray-800 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <HealthFact
              label="Bot token"
              value={
                status?.configured
                  ? status.bot_username
                    ? `@${status.bot_username}`
                    : "ตั้งค่าแล้ว"
                  : "ยังไม่ตั้ง"
              }
            />
            <HealthFact
              label="Encryption"
              value={status?.encryption_configured ? "พร้อม" : "ยังไม่พร้อม"}
            />
            <HealthFact
              label="Targets"
              value={`${status?.targets.filter((target) => target.enabled).length ?? 0}`}
            />
          </div>

          <form className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]" onSubmit={onSaveTelegramBotToken}>
            <label className="block">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                Bot token
              </span>
              <input
                className="mt-1 h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 shadow-xs outline-none focus:border-brand-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                placeholder="วาง token ใหม่หลัง rotate แล้ว"
                type="password"
                value={telegramBotTokenInput}
                onChange={(event) => setTelegramBotTokenInput(event.target.value)}
              />
            </label>
            <div className="flex items-end">
              <Button disabled={savingToken || !telegramBotTokenInput.trim()} size="sm">
                {savingToken ? "กำลังบันทึก" : "บันทึก token"}
              </Button>
            </div>
          </form>

          <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  Recent Telegram chats
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  ส่ง /start ให้ bot ก่อน แล้วกดโหลด chats เพื่อเลือกปลายทาง
                </p>
              </div>
              <Button
                disabled={loadingChats || !status?.configured}
                size="sm"
                variant="outline"
                onClick={() => void onLoadTelegramChats()}
              >
                {loadingChats ? "กำลังโหลด" : "โหลด chats"}
              </Button>
            </div>
            <div className="mt-3 space-y-2">
              {telegramChats.length ? (
                telegramChats.map((chat) => (
                  <div
                    className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900"
                    key={chat.chat_id}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                        {chat.display_name}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {chat.type} · {chat.chat_id_masked}
                      </p>
                    </div>
                    <Button
                      disabled={Boolean(busy)}
                      size="sm"
                      variant="outline"
                      onClick={() => void onSaveTelegramTarget(chat)}
                    >
                      เลือก
                    </Button>
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  ยังไม่มี chat ให้เลือก
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <Button
            disabled={sendingTest || !status?.configured || !hasTarget}
            size="sm"
            onClick={() => void onSendTelegramTestAlert()}
          >
            {sendingTest ? "กำลังส่ง" : "ส่ง test alert"}
          </Button>
          <div className="grid gap-2">
            {[
              ["incident_dry_run", "Incident dry-run"],
              ["javaws_diagnostic", "JavaWS diagnostic"],
              ["heavy_report_slow", "Slow heavy report"],
              ["notification_summary", "Summary"],
            ].map(([alertType, label]) => (
              <Button
                disabled={Boolean(busy)}
                key={alertType}
                size="sm"
                variant="outline"
                onClick={() => void onRunOperationalAlertSmokeTest(alertType)}
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              Deliveries ล่าสุด
            </p>
            <div className="mt-3 space-y-2">
              {deliveries.slice(0, 5).map((delivery) => (
                <div className="text-xs text-gray-600 dark:text-gray-300" key={delivery.id}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{delivery.alert_type}</span>
                    <Badge color={delivery.status === "success" ? "success" : delivery.status === "failed" ? "error" : "warning"}>
                      {delivery.status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-gray-400">
                    {formatDateTime(delivery.created_at)} · {delivery.target_id_masked ?? "-"}
                  </p>
                </div>
              ))}
              {!deliveries.length ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  ยังไม่มี delivery
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function AuditLogPanel({ auditLogs }: { auditLogs: OwnerAuditLogEntry[] }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <OwnerPanelHeader
        title="Audit log ล่าสุด"
        description="หลักฐานการรันรายงาน การส่ง LINE การอนุมัติผู้รับ และการรับรองยอด"
      />
      <div className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-800 dark:border-gray-800">
        {auditLogs.length ? (
          auditLogs.slice(0, 12).map((entry) => (
            <div
              className="grid min-w-0 gap-3 p-4 lg:grid-cols-[180px_minmax(0,1fr)]"
              key={`${entry.id ?? entry.created_at}-${entry.action}-${entry.target_id ?? ""}`}
            >
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold text-gray-900 dark:text-white">
                  {formatAuditAction(entry.action)}
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {formatDateTime(entry.created_at)}
                </p>
              </div>
              <div className="min-w-0 text-sm leading-6 text-gray-600 dark:text-gray-400">
                <p className="break-words">
                  ร้าน: {entry.tenant_id ?? "-"} · {entry.target_type}:{" "}
                  <span className="break-all">{entry.target_id ?? "-"}</span>
                </p>
                <p className="break-words text-xs text-gray-500 dark:text-gray-500">
                  {formatAuditMetadata(entry.metadata_json)}
                </p>
                <div className="mt-2 flex min-w-0">
                  <span
                    className={`min-w-0 rounded-full px-2.5 py-0.5 text-sm font-medium ${auditActionToneClass(
                      entry.action,
                    )}`}
                  >
                    <span className="break-all">{entry.action}</span>
                  </span>
                </div>
              </div>
            </div>
          ))
        ) : (
          <p className="p-5 text-sm text-gray-500 dark:text-gray-400">
            ยังไม่มี audit log ล่าสุดให้แสดง
          </p>
        )}
      </div>
    </section>
  );
}

function OwnerReportRunnerPanel({
  busy,
  dateFrom,
  dateTo,
  heavyReportProgress,
  lastRun,
  lastSnapshot,
  onDateFromChange,
  onDateToChange,
  onRun,
  onRunHeavyReport,
  onRunGrossProfit,
  onRunPurchase,
  onSaveValidationSignoff,
  selectedTenant,
  selectedTenantId,
  setSelectedTenantId,
  setValidationNote,
  setValidationReferenceTotal,
  setValidationSignedBy,
  tenants,
  validationNote,
  validationReferenceTotal,
  validationSignedBy,
  validationSignoffResult,
}: {
  busy: string | null;
  dateFrom: string;
  dateTo: string;
  heavyReportProgress: ChunkedReportProgress | null;
  lastRun: ReportRunRecord | null;
  lastSnapshot: SalesGoodsServicesSnapshot | null;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onRun: () => Promise<void>;
  onRunHeavyReport: (
    reportKey: "stock_balance" | "ar_customer_movement",
  ) => Promise<void>;
  onRunGrossProfit: (
    reportKey: "gross_profit_by_product" | "gross_profit_by_ar_customer",
  ) => Promise<void>;
  onRunPurchase: () => Promise<void>;
  onSaveValidationSignoff: () => Promise<void>;
  selectedTenant?: TenantSummary;
  selectedTenantId: string;
  setSelectedTenantId: (value: string) => void;
  setValidationNote: (value: string) => void;
  setValidationReferenceTotal: (value: string) => void;
  setValidationSignedBy: (value: string) => void;
  tenants: TenantSummary[];
  validationNote: string;
  validationReferenceTotal: string;
  validationSignedBy: string;
  validationSignoffResult: ValidationSignoffResult | null;
}) {
  const isRunning = busy === `report-run-${selectedTenantId}`;
  const isPurchaseRunning = busy === `purchase-report-run-${selectedTenantId}`;
  const isGrossProductRunning =
    busy === `gross-profit-report-run-gross_profit_by_product-${selectedTenantId}`;
  const isGrossArRunning =
    busy === `gross-profit-report-run-gross_profit_by_ar_customer-${selectedTenantId}`;
  const isStockHeavyStarting =
    busy === `heavy-report-run-stock_balance-${selectedTenantId}`;
  const isArMovementHeavyStarting =
    busy === `heavy-report-run-ar_customer_movement-${selectedTenantId}`;
  const activeHeavyProgress =
    heavyReportProgress?.run.tenant_id === selectedTenantId &&
    !isTerminalReportRunStatus(heavyReportProgress.run.status)
      ? heavyReportProgress
      : null;
  const chunkedHeavyEnabled = Boolean(
    selectedTenant?.tenant.featureFlags?.sml_chunked_heavy_reports_enabled,
  );
  const anyReportRunning =
    isRunning ||
    isPurchaseRunning ||
    isGrossProductRunning ||
    isGrossArRunning ||
    isStockHeavyStarting ||
    isArMovementHeavyStarting;
  const selectedSnapshotMatches =
    lastSnapshot?.tenant_id === selectedTenantId &&
    lastSnapshot.params.date_from === dateFrom &&
    lastSnapshot.params.date_to === dateTo;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-gray-400">
            Manual report run
          </p>
          <h2 className="mt-1 text-base font-semibold text-gray-900 dark:text-white">
            รันรายงานแบบผู้ดูแล
          </h2>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            ใช้ approved SQL เดียวกับ dashboard/LINE และบันทึก snapshot ที่ trace ได้
          </p>
        </div>
        <Badge color={selectedTenant?.access.enabled ? "success" : "warning"}>
          {selectedTenant?.access.enabled ? "พร้อมรัน" : "ควรตรวจสถานะร้าน"}
        </Badge>
      </div>

      <div className="mt-5 space-y-4 border-t border-gray-100 pt-5 dark:border-gray-800">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          ร้านค้า
          <select
            className="mt-1 h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            onChange={(event) => setSelectedTenantId(event.target.value)}
            value={selectedTenantId}
          >
            {tenants.map((item) => (
              <option key={item.tenant.id} value={item.tenant.id}>
                {item.tenant.name}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            จากวันที่
            <input
              className="mt-1 h-11 w-full rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 dark:border-gray-700 dark:text-white"
              onChange={(event) => onDateFromChange(event.target.value)}
              type="date"
              value={dateFrom}
            />
          </label>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            ถึงวันที่
            <input
              className="mt-1 h-11 w-full rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 dark:border-gray-700 dark:text-white"
              onChange={(event) => onDateToChange(event.target.value)}
              type="date"
              value={dateTo}
            />
          </label>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            className="w-full"
            disabled={anyReportRunning || !selectedTenantId}
            onClick={() => void onRun()}
            size="sm"
          >
            {isRunning ? "กำลังรันรายงานขาย..." : "รันรายงานขาย"}
          </Button>
          <Button
            className="w-full"
            disabled={anyReportRunning || !selectedTenantId}
            onClick={() => void onRunPurchase()}
            size="sm"
            variant="outline"
          >
            {isPurchaseRunning ? "กำลังรันรายงานซื้อ..." : "รันรายงานซื้อ/ตั้งหนี้"}
          </Button>
          <Button
            className="w-full"
            disabled={anyReportRunning || !selectedTenantId}
            onClick={() => void onRunGrossProfit("gross_profit_by_product")}
            size="sm"
            variant="outline"
          >
            {isGrossProductRunning
              ? "กำลังรันกำไรสินค้า..."
              : "รันกำไรขั้นต้นสินค้า"}
          </Button>
          <Button
            className="w-full"
            disabled={anyReportRunning || !selectedTenantId}
            onClick={() => void onRunGrossProfit("gross_profit_by_ar_customer")}
            size="sm"
            variant="outline"
          >
            {isGrossArRunning
              ? "กำลังรันกำไรลูกหนี้..."
              : "รันกำไรขั้นต้นลูกหนี้"}
          </Button>
          <Button
            className="w-full"
            disabled={
              anyReportRunning ||
              !selectedTenantId ||
              !chunkedHeavyEnabled ||
              Boolean(activeHeavyProgress)
            }
            onClick={() => void onRunHeavyReport("stock_balance")}
            size="sm"
            variant="outline"
          >
            {isStockHeavyStarting
              ? "กำลังเริ่มสต็อก..."
              : "รันสต็อกคงเหลือ async"}
          </Button>
          <Button
            className="w-full"
            disabled={
              anyReportRunning ||
              !selectedTenantId ||
              !chunkedHeavyEnabled ||
              Boolean(activeHeavyProgress)
            }
            onClick={() => void onRunHeavyReport("ar_customer_movement")}
            size="sm"
            variant="outline"
          >
            {isArMovementHeavyStarting
              ? "กำลังเริ่มลูกหนี้..."
              : "รันเคลื่อนไหวลูกหนี้ async"}
          </Button>
        </div>

        <p className="rounded-xl border border-warning-100 bg-warning-50 px-3 py-2 text-xs leading-5 text-warning-700 dark:border-warning-500/20 dark:bg-warning-500/10 dark:text-warning-300">
          รายงานกำไรขั้นต้นมีข้อมูลต้นทุนและ margin ควรเปิดสิทธิ์เฉพาะ role ผู้บริหารในเมนูสิทธิ์รายงาน
          {chunkedHeavyEnabled
            ? " · รายงานหนักแบบ async ปิดหน้าได้ ระบบยังรันต่อ"
            : " · รายงานหนักแบบ async ต้องเปิด feature flag ก่อนใช้งาน"}
        </p>

        {heavyReportProgress?.run.tenant_id === selectedTenantId ? (
          <ChunkedReportProgressCard progress={heavyReportProgress} />
        ) : null}

        <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
          <p className="text-xs font-semibold uppercase text-gray-400">
            Snapshot ล่าสุดของร้านที่เลือก
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <HealthFact
              label="รายงานล่าสุด"
              value={
                selectedTenant?.health.latest_snapshot_at
                  ? formatDateTime(selectedTenant.health.latest_snapshot_at)
                  : "ยังไม่มี"
              }
            />
            <HealthFact
              label="สถานะล่าสุด"
              value={formatRunStatus(selectedTenant?.health.latest_report_status ?? null)}
            />
          </div>
        </div>

        {lastRun ? (
          <div
            className={`rounded-xl border p-3 text-sm ${
              lastRun.status === "success"
                ? "border-success-100 bg-success-50 text-success-700 dark:border-success-500/20 dark:bg-success-500/10 dark:text-success-300"
                : "border-warning-100 bg-warning-50 text-warning-700 dark:border-warning-500/20 dark:bg-warning-500/10 dark:text-warning-300"
            }`}
          >
            <p className="font-semibold">ผลรันล่าสุดในหน้านี้</p>
            <p className="mt-1 text-xs leading-5">
              {formatRunStatus(lastRun.status)} ·{" "}
              {formatReportPeriod(lastRun.params.date_from, lastRun.params.date_to)}
              {lastRun.safe_error_message ? ` · ${lastRun.safe_error_message}` : ""}
            </p>
          </div>
        ) : null}

        {selectedSnapshotMatches && lastSnapshot ? (
          <dl className="grid gap-2 sm:grid-cols-2">
            <HealthFact
              label="ยอดขายสุทธิ"
              value={formatCurrency(lastSnapshot.summary.total_sales)}
            />
            <HealthFact
              label="บิลขาย"
              value={`${lastSnapshot.summary.document_count.toLocaleString("th-TH")} ใบ`}
            />
            <HealthFact
              label="รายการขาย"
              value={`${lastSnapshot.summary.line_count.toLocaleString("th-TH")} รายการ`}
            />
            <HealthFact
              label="Trust"
              value={formatQualityStatus(lastSnapshot.quality_status)}
            />
          </dl>
        ) : (
          <p className="rounded-xl border border-dashed border-gray-200 p-3 text-xs leading-5 text-gray-500 dark:border-gray-800 dark:text-gray-400">
            หลังรันสำเร็จ ระบบจะแสดงยอดขายและจำนวนบิลของช่วงวันที่นี้ตรงนี้ทันที
          </p>
        )}

        <ValidationSignoffPanel
          busy={busy === `validation-signoff-${selectedTenantId}`}
          dateFrom={dateFrom}
          dateTo={dateTo}
          lastSnapshot={selectedSnapshotMatches ? lastSnapshot : null}
          onSave={onSaveValidationSignoff}
          referenceTotal={validationReferenceTotal}
          result={validationSignoffResult}
          signedBy={validationSignedBy}
          note={validationNote}
          setNote={setValidationNote}
          setReferenceTotal={setValidationReferenceTotal}
          setSignedBy={setValidationSignedBy}
        />
      </div>
    </section>
  );
}

function ChunkedReportProgressCard({
  progress,
}: {
  progress: ChunkedReportProgress;
}) {
  const percent = Math.max(0, Math.min(100, progress.progress_percent ?? 0));
  const isDone = isTerminalReportRunStatus(progress.run.status);
  const toneClass =
    progress.run.status === "failed"
      ? "border-error-100 bg-error-50 text-error-700 dark:border-error-500/20 dark:bg-error-500/10 dark:text-error-300"
      : progress.run.status === "success"
        ? "border-success-100 bg-success-50 text-success-700 dark:border-success-500/20 dark:bg-success-500/10 dark:text-success-300"
        : "border-brand-100 bg-brand-50 text-brand-700 dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-brand-300";

  return (
    <div className={`rounded-xl border p-3 text-sm ${toneClass}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-semibold">
            {formatOwnerReportLabel(progress.run.report_key)}
          </p>
          <p className="mt-1 text-xs leading-5">
            {formatRunStatus(progress.run.status)} ·{" "}
            {formatChunkedProgressStage(progress.progress_stage)} ·{" "}
            {formatReportPeriod(
              progress.run.params.date_from,
              progress.run.params.date_to,
            )}
          </p>
        </div>
        <Badge color={isDone ? (progress.run.status === "success" ? "success" : "warning") : "info"}>
          {percent}%
        </Badge>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/70 dark:bg-gray-900/50">
        <div
          className="h-full rounded-full bg-brand-500 transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <HealthFact
          label="Chunks"
          value={`${progress.chunk_summary.done}/${progress.chunk_summary.total}`}
        />
        <HealthFact
          label="Rows"
          value={progress.chunk_summary.rows_processed.toLocaleString("th-TH")}
        />
        <HealthFact
          label="Elapsed"
          value={formatElapsedMs(progress.elapsed_ms)}
        />
        <HealthFact
          label="Run ID"
          value={progress.run.id}
        />
      </div>
      <p className="mt-3 text-xs leading-5">{progress.next_action_message}</p>
    </div>
  );
}

function ValidationSignoffPanel({
  busy,
  dateFrom,
  dateTo,
  lastSnapshot,
  note,
  onSave,
  referenceTotal,
  result,
  signedBy,
  setNote,
  setReferenceTotal,
  setSignedBy,
}: {
  busy: boolean;
  dateFrom: string;
  dateTo: string;
  lastSnapshot: SalesGoodsServicesSnapshot | null;
  note: string;
  onSave: () => Promise<void>;
  referenceTotal: string;
  result: ValidationSignoffResult | null;
  signedBy: string;
  setNote: (value: string) => void;
  setReferenceTotal: (value: string) => void;
  setSignedBy: (value: string) => void;
}) {
  const systemTotal = lastSnapshot?.summary.total_sales ?? null;
  const referenceValue = Number(referenceTotal);
  const hasReference = Number.isFinite(referenceValue);
  const difference =
    systemTotal !== null && hasReference
      ? Math.round((systemTotal - referenceValue + Number.EPSILON) * 100) / 100
      : null;
  const isAccepted = difference !== null && Math.abs(difference) <= 0.01;

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-gray-400">
            Validation sign-off
          </p>
          <h3 className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
            รับรองยอดเทียบกับรายงาน SML เดิม
          </h3>
          <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
            ใช้เป็นหลักฐาน pilot ว่าลูกค้า/owner ตรวจยอดแล้ว ก่อนเปิดใช้รายเดือน
          </p>
        </div>
        <Badge color={isAccepted ? "success" : result ? "warning" : "light"}>
          {isAccepted ? "ยอดตรง" : result ? "มีส่วนต่าง" : "รอรับรอง"}
        </Badge>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <HealthFact
          label="ยอดจาก AI Business"
          value={
            systemTotal !== null
              ? `${formatCurrency(systemTotal)} บาท`
              : "รันรายงานก่อน"
          }
        />
        <HealthFact
          label="ช่วงวันที่"
          value={formatReportPeriod(dateFrom, dateTo)}
        />
      </div>

      <div className="mt-3 grid gap-3">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          ยอดจากรายงาน SML เดิม
          <input
            className="mt-1 h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            inputMode="decimal"
            onChange={(event) => setReferenceTotal(event.target.value)}
            placeholder="เช่น 87106503.67"
            value={referenceTotal}
          />
        </label>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          ผู้ตรวจ/ผู้รับรองยอด
          <input
            className="mt-1 h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            onChange={(event) => setSignedBy(event.target.value)}
            placeholder="ชื่อผู้ตรวจ หรือชื่อลูกค้าที่รับรอง"
            value={signedBy}
          />
        </label>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          หมายเหตุ
          <textarea
            className="mt-1 min-h-20 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            onChange={(event) => setNote(event.target.value)}
            placeholder="เช่น เทียบกับรายงานขายสินค้าและบริการเดิมแล้ว"
            value={note}
          />
        </label>
      </div>

      {difference !== null ? (
        <p
          className={`mt-3 rounded-lg border p-3 text-sm ${
            isAccepted
              ? "border-success-100 bg-success-50 text-success-700 dark:border-success-500/20 dark:bg-success-500/10 dark:text-success-300"
              : "border-warning-100 bg-warning-50 text-warning-700 dark:border-warning-500/20 dark:bg-warning-500/10 dark:text-warning-300"
          }`}
        >
          {isAccepted
            ? "ยอดตรงตามรายงาน SML เดิม สามารถบันทึกการรับรองได้"
            : `พบส่วนต่าง ${formatCurrency(difference)} บาท ควรตรวจช่วงวันที่หรือเงื่อนไขรายงานก่อนเซ็นรับ`}
        </p>
      ) : null}

      <Button
        className="mt-3 w-full"
        disabled={busy || !lastSnapshot}
        onClick={() => void onSave()}
        size="sm"
        variant={isAccepted ? "primary" : "outline"}
      >
        {busy ? "กำลังบันทึก..." : "บันทึกการรับรองยอด"}
      </Button>
    </div>
  );
}

function ReportTenantRow({
  item,
  onSelectTenant,
  selected,
}: {
  item: TenantSummary;
  onSelectTenant: (tenantId: string) => void;
  selected: boolean;
}) {
  return (
    <div
      className={`grid gap-3 p-4 lg:grid-cols-[minmax(180px,1fr)_140px_170px_110px] lg:items-center ${
        selected ? "bg-brand-50/40 dark:bg-brand-500/[0.08]" : ""
      }`}
    >
      <div className="min-w-0">
        <p className="font-semibold text-gray-900 dark:text-white">
          {item.tenant.name}
        </p>
        <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
          sales_goods_services · ฐาน {item.tenant.databaseName || "-"}
        </p>
      </div>
      <CompactFact
        label="สถานะรัน"
        value={formatRunStatus(item.health.latest_report_status)}
      />
      <CompactFact
        label="Snapshot ล่าสุด"
        value={
          item.health.latest_snapshot_at
            ? formatDateTime(item.health.latest_snapshot_at)
            : "ยังไม่มี"
        }
      />
      <div className="flex gap-2 lg:justify-end">
        <Button
          disabled={selected}
          size="sm"
          variant="outline"
          onClick={() => onSelectTenant(item.tenant.id)}
        >
          {selected ? "เลือกอยู่" : "จัดการ"}
        </Button>
      </div>
    </div>
  );
}

function LineTenantRow({
  item,
  onSelectTenant,
  selected,
}: {
  item: TenantSummary;
  onSelectTenant: (tenantId: string) => void;
  selected: boolean;
}) {
  const lineReady =
    item.health.line_channels > 0 && item.health.line_targets_enabled > 0;
  return (
    <div
      className={`grid gap-3 p-4 lg:grid-cols-[minmax(180px,1fr)_120px_130px_140px_110px] lg:items-center ${
        selected ? "bg-brand-50/40 dark:bg-brand-500/[0.08]" : ""
      }`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-gray-900 dark:text-white">
            {item.tenant.name}
          </p>
          <Badge color={lineReady ? "success" : "warning"}>
            {lineReady ? "พร้อมส่ง" : "ต้องตั้งค่า"}
          </Badge>
        </div>
        <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
	          แผนแจ้งเตือน · {item.tenant.id}
        </p>
      </div>
      <CompactFact
        label="LINE OA"
        value={`${item.health.line_channels} ช่องทาง`}
      />
      <CompactFact
        label="ปลายทางที่เปิดรับ"
        value={`${item.health.line_targets_enabled}/${item.health.line_targets_total} ปลายทาง`}
      />
      <CompactFact
        label="ส่งล่าสุด"
        value={
          item.health.latest_line_delivery_at
            ? formatDateTime(item.health.latest_line_delivery_at)
            : "ยังไม่มี"
        }
      />
      <div className="flex lg:justify-end">
        <Button
          disabled={selected}
          size="sm"
          variant="outline"
          onClick={() => onSelectTenant(item.tenant.id)}
        >
          {selected ? "เลือกอยู่" : "จัดการ"}
        </Button>
      </div>
    </div>
  );
}

function AuditTenantRow({ item }: { item: TenantSummary }) {
  return (
    <div className="grid gap-3 p-4 lg:grid-cols-[minmax(180px,1fr)_170px_170px_140px] lg:items-center">
      <div className="min-w-0">
        <p className="font-semibold text-gray-900 dark:text-white">
          {item.tenant.name}
        </p>
        <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
          {item.tenant.id}
        </p>
      </div>
      <CompactFact
        label="รันรายงานล่าสุด"
        value={
          item.health.latest_report_run_at
            ? formatDateTime(item.health.latest_report_run_at)
            : "ยังไม่มี"
        }
      />
      <CompactFact
        label="ส่ง LINE ล่าสุด"
        value={
          item.health.latest_line_delivery_at
            ? formatDateTime(item.health.latest_line_delivery_at)
            : "ยังไม่มี"
        }
      />
      <Badge color={item.health.latest_line_delivery_status === "success" ? "success" : "light"}>
        {formatLineDeliveryStatus(item.health.latest_line_delivery_status)}
      </Badge>
    </div>
  );
}

function buildOwnerCockpitStatus(
  tenants: TenantSummary[],
  operationsStatus: OwnerOperationsStatus | null,
): {
  description: string;
  label: string;
  title: string;
  tone: OwnerBadgeTone;
} {
  const activeTenants = tenants.filter((item) => item.access.enabled);
  const latestJavaWsFailure = operationsStatus?.report_health?.latest_javaws_failure;
  if (latestJavaWsFailure) {
    const tenantName =
      tenants.find((item) => item.tenant.id === latestJavaWsFailure.tenant_id)
        ?.tenant.name ?? "บางร้าน";
    return {
      description: `${tenantName} มี JavaWS ${formatJavaWsFailurePhase(
        latestJavaWsFailure.failure_phase,
      )} จากรายงานล่าสุด ต้องดู audit ก่อนใช้ยอดรอบนั้น`,
      label: "ต้องแก้ก่อนรอบถัดไป",
      title: "พบ incident จาก SML JavaWS",
      tone: "error",
    };
  }

  if (operationsStatus && operationsStatus.worker.status !== "ok") {
    return {
      description: `worker ${formatWorkerStatus(
        operationsStatus.worker.status,
      )} อาจทำให้รอบแจ้งเตือนไม่ถูกประมวลผลตามเวลา`,
      label: "ต้องตรวจระบบ",
      title: "Worker ยังไม่ปกติ",
      tone: "error",
    };
  }

  const failedTenant = activeTenants.find(
    (item) =>
      item.health.latest_notification_run_status === "failed" ||
      item.health.latest_report_status === "failed" ||
      item.health.latest_line_delivery_status === "failed",
  );
  if (failedTenant) {
    return {
      description: `${failedTenant.tenant.name} มีรายงานหรือ LINE delivery ล่าสุดล้มเหลว ต้องเปิด audit เพื่อดูสาเหตุและสถานะ incident`,
      label: "ต้องตรวจรอบล่าสุด",
      title: "รอบแจ้งเตือนยังไม่สมบูรณ์",
      tone: "error",
    };
  }

  const missingPrerequisite = activeTenants.find(
    (item) =>
      !item.health.datasource_configured ||
      item.health.line_targets_enabled === 0 ||
      item.health.notification_rules_enabled === 0,
  );
  if (missingPrerequisite) {
    return {
      description: `${missingPrerequisite.tenant.name} ยังมี prerequisite ไม่ครบสำหรับส่งรายงานผู้บริหารอัตโนมัติ`,
      label: "ต้องตั้งค่าเพิ่ม",
      title: "ยังมีร้านที่ไม่พร้อมส่งรอบถัดไป",
      tone: "warning",
    };
  }

  return {
    description: `${activeTenants.length} ร้าน active พร้อมสำหรับรอบแจ้งเตือนถัดไป และยังควรดู audit หลังรอบจริงเสมอ`,
    label: "พร้อมส่งรอบถัดไป",
    title: "ระบบหลักพร้อมใช้งาน",
    tone: "success",
  };
}

function buildProductionProofVerdict(
  proof: OwnerOperationsStatus["production_proof"] | null | undefined,
  activeTenantCount: number,
): OwnerProofVerdict {
  if (!proof) {
    return {
      actionLabel: "เปิด audit",
      description:
        "ยังไม่มีข้อมูลสรุปรอบจริงล่าสุดในหน้านี้ ให้ดู audit เพื่อยืนยันว่ารอบแจ้งเตือนและ LINE delivery ทำงานสำเร็จแล้ว",
      href: "/owner/audit",
      label: "รอ proof",
      title: "ยังสรุปความพร้อม pilot ไม่ได้",
      tone: "warning",
    };
  }

  if (proof.eligible_tenant_count <= 0) {
    return {
      actionLabel: "ตรวจร้านค้า",
      description:
        "ยังไม่มีร้านที่อยู่ใน coverage สำหรับรอบ production proof จึงยังไม่ควรใช้ข้อมูลนี้ประกอบการ demo หรือเปิด pilot",
      href: "/owner",
      label: "ยังไม่พร้อม",
      title: "ยังไม่มีร้านพร้อมเข้ารอบจริง",
      tone: "error",
    };
  }

  if (proof.scheduled_run_count <= 0) {
    return {
      actionLabel: "เปิด audit",
      description: `${proof.eligible_tenant_count.toLocaleString(
        "th-TH",
      )}/${Math.max(activeTenantCount, proof.active_tenant_count).toLocaleString(
        "th-TH",
      )} ร้านอยู่ใน coverage แล้ว แต่ยังไม่มีรอบแจ้งเตือนจริงในช่วง ${proof.window_days.toLocaleString(
        "th-TH",
      )} วันล่าสุด`,
      href: "/owner/audit",
      label: "รอรอบจริง",
      title: "ต้องมี delivery จริงก่อนใช้เป็นหลักฐานขาย",
      tone: "warning",
    };
  }

  if (proof.scheduled_pending_count > 0) {
    return {
      actionLabel: "ดูสถานะรอบ",
      description: `มีรอบแจ้งเตือนกำลังทำงาน ${proof.scheduled_pending_count.toLocaleString(
        "th-TH",
      )} รอบ รอให้จบก่อนสรุปว่ารอบนี้ผ่านหรือมี incident`,
      href: "/owner/audit",
      label: "กำลังรัน",
      title: "ยังไม่ควรตัดสินจากตัวเลขระหว่างรอบ",
      tone: "info",
    };
  }

  if (proof.report_failure_count > 0 || proof.scheduled_failed_count > 0) {
    const latestProblem = proof.latest_problem_at
      ? `ล่าสุด ${formatDateTime(proof.latest_problem_at)}`
      : "ยังไม่พบเวลาล่าสุด";
    return {
      actionLabel: "เปิด audit",
      description: `พร้อมใช้ demo แบบมี caveat แต่ควรรอดู clean rounds ก่อนเปิดร้านใหม่ เพราะ ${proof.window_days.toLocaleString(
        "th-TH",
      )} วันล่าสุดมี report failed ${proof.report_failure_count.toLocaleString(
        "th-TH",
      )} ครั้ง และ notification failed ${proof.scheduled_failed_count.toLocaleString(
        "th-TH",
      )} ครั้ง (${latestProblem})`,
      href: "/owner/audit",
      label: "พร้อม demo มี caveat",
      title: "ยังควรรอดูรอบที่ไม่มี failed ใหม่",
      tone: "warning",
    };
  }

  if (
    proof.line_delivery_count <= 0 ||
    proof.line_delivery_failed_count > 0 ||
    (proof.line_delivery_success_rate !== null &&
      proof.line_delivery_success_rate < 0.98)
  ) {
    return {
      actionLabel: "ตรวจ LINE",
      description: `รายงานสร้างได้ แต่หลักฐาน LINE delivery ยังไม่แน่นพอ: ${proof.line_delivery_success_count.toLocaleString(
        "th-TH",
      )}/${Math.max(1, proof.line_delivery_count).toLocaleString(
        "th-TH",
      )} ส่งสำเร็จในช่วง ${proof.window_days.toLocaleString("th-TH")} วันล่าสุด`,
      href: "/owner/audit",
      label: "ตรวจ delivery",
      title: "ต้องยืนยันเส้นทางส่งผู้บริหารก่อน pilot",
      tone: "warning",
    };
  }

  if (proof.heavy_report_p90_ms !== null && proof.heavy_report_p90_ms >= 300000) {
    return {
      actionLabel: "ดู heavy report",
      description: `heavy report p90 อยู่ที่ ${formatElapsedMs(
        proof.heavy_report_p90_ms,
      )} ถึงยังสำเร็จ แต่ควรตรวจ performance ก่อนเพิ่ม tenant หรือเพิ่มรอบแจ้งเตือน`,
      href: "/owner/audit",
      label: "ควรดู performance",
      title: "ระบบผ่านแต่ heavy report เริ่มช้า",
      tone: "warning",
    };
  }

  if (
    proof.scheduled_success_rate !== null &&
    proof.scheduled_success_rate >= 0.98 &&
    proof.line_delivery_success_rate !== null &&
    proof.line_delivery_success_rate >= 0.98
  ) {
    return {
      actionLabel: "ดูหลักฐานล่าสุด",
      description: `${proof.eligible_tenant_count.toLocaleString(
        "th-TH",
      )}/${proof.active_tenant_count.toLocaleString(
        "th-TH",
      )} ร้านอยู่ใน coverage, รอบแจ้งเตือนและ LINE delivery ผ่านเกณฑ์ในช่วง ${proof.window_days.toLocaleString(
        "th-TH",
      )} วันล่าสุด ใช้เป็นหลักฐาน pilot ได้`,
      href: "/owner/audit",
      label: "พร้อม pilot",
      title: "พร้อมใช้เป็น production proof",
      tone: "success",
    };
  }

  return {
    actionLabel: "ดู audit",
    description:
      "มีหลักฐาน production proof แล้ว แต่ success rate ยังไม่ถึงเกณฑ์ 98% ให้ดูรายละเอียดรอบล่าสุดก่อนใช้เป็นหลักฐานเปิด pilot",
    href: "/owner/audit",
    label: "เก็บ proof ต่อ",
    title: "มี proof แต่ยังควรดูรอบถัดไปเพิ่ม",
    tone: "info",
  };
}

function buildPilotProofPackage(
  proof: OwnerOperationsStatus["production_proof"] | null | undefined,
  verdict: OwnerProofVerdict,
): OwnerPilotProofPackage {
  if (!proof) {
    return {
      buyerPromise:
        "ยังไม่ควรใช้เป็นข้อความขายจนกว่าจะเห็นรอบแจ้งเตือนและ LINE delivery จริง",
      caveat: "เปิด audit เพื่อดูหลักฐานล่าสุดก่อนคุย pilot.",
      headline: "ยังไม่มี proof package สำหรับลูกค้า",
      proofLine: "ยังไม่มีข้อมูล 7 วันล่าสุดจาก production proof",
    };
  }

  const scheduledRate = formatProofRate(proof.scheduled_success_rate);
  const lineRate = formatProofRate(proof.line_delivery_success_rate);
  const heavyP90 =
    proof.heavy_report_p90_ms !== null
      ? formatElapsedMs(proof.heavy_report_p90_ms)
      : "ยังไม่มีค่า p90";
  const latestProblem = proof.latest_problem_at
    ? formatDateTime(proof.latest_problem_at)
    : "ยังไม่พบเวลาล่าสุด";
  const coverage = `${proof.eligible_tenant_count.toLocaleString(
    "th-TH",
  )}/${proof.active_tenant_count.toLocaleString("th-TH")} ร้าน`;
  const proofLine = `${proof.window_days.toLocaleString(
    "th-TH",
  )} วันล่าสุด: coverage ${coverage}, รอบแจ้งเตือนสำเร็จ ${scheduledRate}, LINE สำเร็จ ${lineRate}, heavy report p90 ${heavyP90}.`;
  const recoveryLine = buildProofRecoveryLine(proof);

  if (verdict.tone === "success") {
    return {
      buyerPromise:
        "เสนอเป็น pilot ผู้บริหารที่ได้รายงาน SML อัตโนมัติพร้อมหลักฐาน delivery และ audit",
      caveat: "ยังต้องติดตามรอบจริงต่อเนื่องก่อนขยายหลาย tenant.",
      headline: "พร้อมใช้เป็น proof สำหรับเปิด pilot",
      proofLine,
    };
  }

  if (proof.report_failure_count > 0 || proof.scheduled_failed_count > 0) {
    return {
      buyerPromise:
        "ใช้ demo ได้ในฐานะระบบรายงานผู้บริหารที่มี audit และแจ้ง incident แทนการปล่อยให้ยอดผิดเงียบ",
      caveat: `ต้องพูดตรง ๆ ว่ายังมี failed ${proof.report_failure_count.toLocaleString(
        "th-TH",
      )} ครั้งในช่วงนี้ ล่าสุด ${latestProblem}. ${recoveryLine}`,
      headline: "มี proof สำหรับ demo แต่ยังไม่ควรขายว่าไร้ incident",
      proofLine,
    };
  }

  if (
    proof.line_delivery_count <= 0 ||
    proof.line_delivery_failed_count > 0 ||
    (proof.line_delivery_success_rate !== null &&
      proof.line_delivery_success_rate < 0.98)
  ) {
    return {
      buyerPromise:
        "รายงานสร้างได้แล้ว แต่ต้องพิสูจน์เส้นทางส่งถึงผู้บริหารให้แน่นก่อนขายเป็น managed alert",
      caveat: "รอดู LINE delivery ให้ผ่านเกณฑ์ก่อนใช้เป็น pilot proof.",
      headline: "ตัวรายงานพร้อม แต่ delivery proof ยังไม่แน่น",
      proofLine,
    };
  }

  if (proof.heavy_report_p90_ms !== null && proof.heavy_report_p90_ms >= 300000) {
    return {
      buyerPromise:
        "เสนอ value เรื่องไม่ต้องให้คนดึงรายงานหนักเอง แต่ต้องกำหนด SLA รอบหนักให้ชัด",
      caveat: "ควรลดเวลารัน heavy report ก่อนเพิ่มรอบถี่หรือ tenant ใหม่.",
      headline: "พิสูจน์ระบบได้ แต่ performance ยังเป็นเงื่อนไขขาย",
      proofLine,
    };
  }

  return {
    buyerPromise:
      "ใช้เล่า value ได้ว่าเจ้าของร้านเห็นรายงาน SML และสถานะส่ง LINE จากระบบเดียว",
    caveat: "เก็บ clean rounds เพิ่มเพื่อทำให้ข้อความขายแข็งแรงขึ้น.",
    headline: "มี proof แล้ว แต่ควรเก็บหลักฐานเพิ่ม",
    proofLine,
  };
}

function buildPilotSalesKit({
  activeTenants,
  proof,
  proofPackage,
  verdict,
}: {
  activeTenants: TenantSummary[];
  proof: OwnerOperationsStatus["production_proof"] | null | undefined;
  proofPackage: OwnerPilotProofPackage;
  verdict: OwnerProofVerdict;
}): OwnerPilotSalesKit {
  const readyTenantNames = activeTenants
    .filter(
      (item) =>
        isPilotCoverageTenant(item) &&
        item.health.latest_notification_run_status === "success" &&
        item.health.latest_line_delivery_status === "success",
    )
    .map((item) => item.tenant.name);
  const readyTenantLine = readyTenantNames.length
    ? `ตอนนี้มีตัวอย่างจาก ${formatTenantNameList(readyTenantNames)} ที่ใช้เป็นเรื่องเล่า demo ได้`
    : "ตอนนี้ควรเลือก demo tenant หลักและรันรอบจริงให้ผ่านก่อนใช้เป็นตัวอย่างลูกค้า";
  const headline =
    "รายงานผู้บริหารจาก SML อัตโนมัติ พร้อม audit และแจ้ง incident เมื่อระบบต้นทางผิดปกติ";
  const buyerFit =
    "เหมาะกับร้านที่ใช้ SML อยู่แล้วและผู้บริหารต้องรอดูยอดจากทีมงานทุกเช้า/เย็น";
  const objections = [
    "ไม่แทนการตรวจบัญชีปิดงบ แต่ช่วยให้เห็นยอดดำเนินงานตามรอบ",
    "ถ้า SML JavaWS ตอบผิดรูปแบบ ระบบต้องแจ้ง incident แทนการสรุปยอด",
    "เริ่มจาก 1-2 ร้านหรือสาขาที่ datasource และ LINE พร้อมก่อน",
  ];
  const recoveryLine = buildProofRecoveryLine(proof);

  if (!proof || verdict.tone === "error") {
    return {
      buyerFit,
      headline,
      message:
        "ตอนนี้ AI-BCC ยังไม่ควรถูกใช้เป็นข้อความขายเต็ม เพราะยังไม่มี proof production ที่พอจะยืนยันรอบแจ้งเตือนจริงได้ครบ\n\nสิ่งที่ควรคุยกับลูกค้าตอนนี้คือ demo แนวทาง: ระบบจะดึงรายงานจาก SML ตามรอบ ส่งให้ผู้บริหารผ่าน LINE และมี audit/incident notice เมื่อระบบต้นทางตอบผิดปกติ",
      nextStep:
        "ตั้งค่า SML JavaWS, LINE target และ notification rule ให้ครบ แล้วรอดูรอบจริงอย่างน้อย 1 รอบก่อนส่งข้อเสนอ pilot",
      objections,
      offer:
        "ยังไม่ควรเสนอเป็น paid pilot จนกว่าจะมีรอบจริงและ delivery proof ที่ตรวจย้อนหลังได้",
      proofBoundary: proofPackage.caveat,
      tone: "error",
    };
  }

  if (verdict.tone === "success") {
    return {
      buyerFit,
      headline,
      message: `สวัสดีครับ ผมอยากชวนลอง AI-BCC เป็น pilot สำหรับรายงานผู้บริหารจาก SML\n\nระบบจะดึงรายงานตามรอบ ส่งสรุปให้ผู้บริหารผ่าน LINE และเก็บ audit ว่ารายงานรันเมื่อไร ส่งสำเร็จไหม ถ้า SML/LINE มีปัญหา ระบบจะแจ้ง incident แทนการสรุปยอดที่ไม่น่าเชื่อถือ\n\nหลักฐานล่าสุด: ${proofPackage.proofLine}\n\n${readyTenantLine}`,
      nextStep:
        "เลือก 1 ร้าน/สาขาที่ SML และ LINE พร้อม เปิดรอบแจ้งเตือนจริง แล้วใช้ audit หลังรอบเป็นหลักฐานตัดสินใจต่อ",
      objections,
      offer:
        "เสนอเป็น pilot ผู้บริหารที่ต้องการลดงานดึงรายงานเอง และต้องการหลักฐาน delivery/audit ที่ตรวจย้อนหลังได้",
      proofBoundary:
        "ยังควรพูดว่าระบบอยู่ช่วง pilot และต้องติดตามรอบจริงต่อเนื่องก่อนขยายหลาย tenant",
      tone: "success",
    };
  }

  return {
    buyerFit,
    headline,
    message: `สวัสดีครับ ตอนนี้ AI-BCC พร้อมใช้ demo แบบมี caveat สำหรับร้านที่ใช้ SML และอยากให้ผู้บริหารได้รับรายงานอัตโนมัติ\n\nระบบช่วยดึงรายงานตามรอบ ส่ง LINE ให้ผู้บริหาร และมี audit/incident notice เมื่อ SML หรือช่องทางส่งมีปัญหา จุดสำคัญคือไม่ปล่อยให้ยอดที่อ่านไม่ได้ถูกสรุปเป็นยอดธุรกิจ\n\nหลักฐานล่าสุด: ${proofPackage.proofLine}\n\n${readyTenantLine}`,
    nextStep:
      `ใช้ demo กับ tenant ที่พร้อมก่อน แล้วรอดู clean round ถัดไปก่อนบอกลูกค้าว่าพร้อมขายเต็ม ${recoveryLine}`,
    objections,
    offer:
      "ใช้เปิดบทสนทนาและ demo ได้ แต่ควรขายแบบ pilot ที่ owner ติดตามผลจริง ไม่ใช่คำมั่นว่าไม่มี incident",
    proofBoundary: `${proofPackage.caveat} ${recoveryLine}`,
    tone: "warning",
  };
}

function buildProofRecoveryLine(
  proof: OwnerOperationsStatus["production_proof"] | null | undefined,
) {
  if (!proof) {
    return "รอรอบจริง";
  }
  if (
    !proof.latest_problem_at ||
    (proof.report_failure_count <= 0 && proof.scheduled_failed_count <= 0)
  ) {
    return "ไม่มี failed ในหน้าต่าง proof ล่าสุด";
  }

  const latestProblemAt = new Date(proof.latest_problem_at);
  const generatedAt = new Date(proof.generated_at);
  if (
    Number.isNaN(latestProblemAt.getTime()) ||
    Number.isNaN(generatedAt.getTime())
  ) {
    return "รอดู clean round ถัดไป";
  }

  const windowMs = proof.window_days * 24 * 60 * 60 * 1000;
  const clearsAt = new Date(latestProblemAt.getTime() + windowMs);
  const remainingMs = clearsAt.getTime() - generatedAt.getTime();
  if (remainingMs <= 0) {
    return "รอ refresh proof รอบถัดไป";
  }

  const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
  return `ถ้าไม่มี failed ใหม่ caveat จะหลุดหลัง ${formatDateTime(
    clearsAt.toISOString(),
  )} (${remainingDays.toLocaleString("th-TH")} วัน)`;
}

function buildPilotQualification({
  activeTenants,
  proof,
  verdict,
}: {
  activeTenants: TenantSummary[];
  proof: OwnerOperationsStatus["production_proof"] | null | undefined;
  verdict: OwnerProofVerdict;
}): OwnerPilotQualification {
  const readyTenantNames = activeTenants
    .filter(
      (item) =>
        isPilotCoverageTenant(item) &&
        item.health.datasource_configured &&
        item.health.line_targets_enabled > 0 &&
        item.health.notification_rules_enabled > 0 &&
        item.health.latest_notification_run_status === "success" &&
        item.health.latest_line_delivery_status === "success",
    )
    .map((item) => item.tenant.name);
  const readyTenantLine = readyTenantNames.length
    ? `เริ่มจากร้านที่มีหลักฐานแล้ว เช่น ${formatTenantNameList(
        readyTenantNames,
      )} แล้วค่อยขยายหลังรอบจริงนิ่ง`
    : "เริ่มจากร้านที่ SML datasource, LINE target และแผนแจ้งเตือนพร้อมครบก่อน";
  const commonEvidence = [
    "notification run จบสำเร็จตามเวลา",
    "report run มี row count และ snapshot ที่ตรวจย้อนหลังได้",
    "LINE delivery หรือ incident notice ถูกส่งตามผลจริง",
  ];
  const commonAvoid = [
    "ร้านที่ยังไม่มี SML datasource, LINE target หรือแผนแจ้งเตือนครบ",
    "ลูกค้าที่ต้องการยอด realtime หรือใช้แทนงานบัญชีปิดงบ",
    "เคสที่ต้องใช้ integration อื่นนอก SML reports ในรอบ pilot นี้",
  ];

  if (!proof || verdict.tone === "error") {
    return {
      avoid: commonAvoid,
      decisionSignal: "มีรอบจริงอย่างน้อย 1 รอบ",
      evidenceToCapture: [
        "SML JavaWS health ผ่าน",
        "LINE target เปิดรับรายงาน",
        "notification rule ถูกเปิดและมี run id",
      ],
      label: "รอ proof",
      minimumScope: "ยังไม่เสนอ paid pilot",
      title: "ใช้คุยเป็น demo แนวทางก่อน ยังไม่ควรปิด pilot",
      tone: "error",
      whoToApproach:
        "คุยกับคนที่อยากเห็นภาพระบบก่อนเท่านั้น และบอกชัดว่ายังต้องมีรอบจริงสำเร็จก่อนเปิดใช้จริงกับผู้บริหาร",
    };
  }

  if (proof.report_failure_count > 0 || proof.scheduled_failed_count > 0) {
    return {
      avoid: commonAvoid,
      decisionSignal: "2 clean rounds หรือถึง Clean target",
      evidenceToCapture: [
        ...commonEvidence,
        buildProofRecoveryLine(proof),
      ],
      label: "pilot แบบมี caveat",
      minimumScope: "1 ร้าน, 2 รอบ, 2 รายงาน",
      title: "เลือกเจ้าของร้านที่รับ pilot แบบโปร่งใสได้",
      tone: "warning",
      whoToApproach:
        `${readyTenantLine} เหมาะกับผู้บริหารที่อยากลดงานดึงรายงานเอง แต่รับได้ว่าช่วง pilot จะมี incident notice หาก SML/LINE ผิดปกติ`,
    };
  }

  if (verdict.tone === "success") {
    return {
      avoid: commonAvoid,
      decisionSignal: "7 วันผ่านเกณฑ์ 98%+",
      evidenceToCapture: [
        ...commonEvidence,
        "ผู้บริหารยืนยันว่าอ่านรายงานได้จริงและลดงาน follow-up กับทีม",
      ],
      label: "พร้อมเปิด pilot",
      minimumScope: "1-2 ร้าน, 7 วัน",
      title: "ชวนร้าน SML ที่มี pain รายงานประจำวันได้เลย",
      tone: "success",
      whoToApproach:
        `${readyTenantLine} เหมาะกับร้านที่ผู้บริหารรอรายงานเช้า/เย็นจากทีมงานและอยากมี audit ว่าส่งถึงจริง`,
    };
  }

  return {
    avoid: commonAvoid,
    decisionSignal: "รอบถัดไปต้องสำเร็จครบ",
    evidenceToCapture: commonEvidence,
    label: "เก็บ proof เพิ่ม",
    minimumScope: "1 ร้าน, 1 รอบก่อน",
    title: "ใช้ demo ได้ แต่ยังควรเก็บหลักฐานก่อนปิดดีล",
    tone: verdict.tone === "warning" ? "warning" : "info",
    whoToApproach:
      `${readyTenantLine} เหมาะกับลูกค้าที่อยากลองก่อนและยอมให้ตัดสินจาก audit หลังรอบจริง`,
  };
}

function buildPilotSalesKitShareText(
  salesKit: OwnerPilotSalesKit,
  qualification: OwnerPilotQualification,
) {
  return [
    "AI-BCC Sales Kit",
    `Positioning: ${salesKit.headline}`,
    `เหมาะกับ: ${salesKit.buyerFit}`,
    `ข้อเสนอ: ${salesKit.offer}`,
    "",
    "ข้อความส่งลูกค้า:",
    salesKit.message,
    "",
    `พูดตรง ๆ: ${salesKit.proofBoundary}`,
    "ข้อควรระวัง:",
    ...salesKit.objections.map((item) => `- ${item}`),
    "",
    "Pilot qualification:",
    `- สถานะ: ${qualification.label} - ${qualification.title}`,
    `- คนที่ควรคุย: ${qualification.whoToApproach}`,
    `- Minimum scope: ${qualification.minimumScope}`,
    `- Decision signal: ${qualification.decisionSignal}`,
    "Proof ที่ต้องเก็บ:",
    ...qualification.evidenceToCapture.map((item) => `- ${item}`),
    "ยังไม่ควรขายกับ:",
    ...qualification.avoid.map((item) => `- ${item}`),
    "",
    `Next step: ${salesKit.nextStep}`,
  ].join("\n");
}

function buildPilotLaunchActions({
  activeTenants,
  operationsStatus,
  proof,
  verdict,
}: {
  activeTenants: TenantSummary[];
  operationsStatus: OwnerOperationsStatus | null;
  proof: OwnerOperationsStatus["production_proof"] | null | undefined;
  verdict: OwnerProofVerdict;
}): OwnerPilotLaunchAction[] {
  const actions: OwnerPilotLaunchAction[] = [];
  const pilotTenants = activeTenants.filter(isPilotCoverageTenant);
  const blockedTenant = pilotTenants.find(
    (item) =>
      !item.health.datasource_configured ||
      item.health.line_targets_enabled === 0 ||
      item.health.notification_rules_enabled === 0,
  );
  const readyTenants = pilotTenants.filter(
    (item) =>
      item.health.datasource_configured &&
      item.health.line_targets_enabled > 0 &&
      item.health.notification_rules_enabled > 0 &&
      item.health.latest_notification_run_status === "success" &&
      item.health.latest_line_delivery_status === "success",
  );

  if (blockedTenant) {
    actions.push({
      actionLabel: "เปิดร้านนี้",
      description: buildBlockedPilotTenantDescription(blockedTenant),
      href: buildPilotTenantSetupHref(blockedTenant),
      label: "ลด risk ก่อน",
      title: `ปิด gap ของ ${blockedTenant.tenant.name}`,
      tone: "warning",
    });
  } else if (readyTenants.length > 0) {
    actions.push({
      actionLabel: "ดูหลักฐาน",
      description: `${formatTenantNameList(
        readyTenants.map((item) => item.tenant.name),
      )} มี datasource, LINE target, แผนแจ้งเตือน และรอบล่าสุดสำเร็จ ใช้เป็น demo หลักได้`,
      href: "/owner/audit",
      label: "ใช้ demo ได้",
      title: "เลือก tenant ที่พร้อมเป็นเรื่องเล่าแรก",
      tone: verdict.tone === "error" ? "warning" : "success",
    });
  } else {
    actions.push({
      actionLabel: "ตรวจร้านค้า",
      description:
        "ยังไม่มี tenant ใน coverage ที่มีรอบแจ้งเตือนและ LINE delivery ล่าสุดสำเร็จครบ ให้เลือก demo tenant หลักแล้วรันรอบจริงก่อน",
      href: "/owner",
      label: "ต้องมีตัวอย่างจริง",
      title: "สร้าง tenant ตัวอย่างที่มีหลักฐานครบ",
      tone: "warning",
    });
  }

  if (!proof || proof.scheduled_run_count <= 0) {
    actions.push({
      actionLabel: "เปิดแผนแจ้งเตือน",
      description:
        "proof ยังไม่มีรอบจริงในช่วงล่าสุด จึงยังไม่ควรใช้ข้อความขายเรื่อง automation จนกว่าจะมี delivery ที่ตรวจย้อนกลับได้",
      href: "/owner/notifications",
      label: "รอข้อมูลจริง",
      title: "รันรอบแจ้งเตือนจริงก่อนใช้เป็น sales proof",
      tone: "warning",
    });
  } else if (proof.scheduled_pending_count > 0) {
    actions.push({
      actionLabel: "ดูสถานะรอบ",
      description: `มีรอบแจ้งเตือนกำลังทำงาน ${proof.scheduled_pending_count.toLocaleString(
        "th-TH",
      )} รอบ รอให้จบก่อนสรุปว่าสำเร็จหรือเป็น incident`,
      href: "/owner/audit",
      label: "กำลังรัน",
      title: "อย่าใช้ตัวเลขระหว่างรอบเป็นข้อสรุป",
      tone: "info",
    });
  } else if (proof.report_failure_count > 0 || proof.scheduled_failed_count > 0) {
    actions.push({
      actionLabel: "เปิด audit",
      description: `ใช้ demo ได้แบบโปร่งใส แต่ยังต้องบอก caveat: ${proof.window_days.toLocaleString(
        "th-TH",
      )} วันล่าสุดมี report failed ${proof.report_failure_count.toLocaleString(
        "th-TH",
      )} ครั้ง และ notification failed ${proof.scheduled_failed_count.toLocaleString(
        "th-TH",
      )} ครั้ง`,
      href: "/owner/audit",
      label: "พูด caveat",
      title: "รอดู clean round ถัดไปก่อนบอกว่าพร้อมขายเต็ม",
      tone: "warning",
    });
  } else {
    actions.push({
      actionLabel: "ไปที่ proof",
      description: `รอบแจ้งเตือน ${formatProofRate(
        proof.scheduled_success_rate,
      )} และ LINE ${formatProofRate(
        proof.line_delivery_success_rate,
      )} ในช่วง ${proof.window_days.toLocaleString(
        "th-TH",
      )} วันล่าสุด ใช้เป็นข้อความเปิด pilot ได้`,
      href: "/owner#owner-pilot-proof",
      label: "พร้อมคุย",
      title: "ใช้ proof package เป็นข้อความคุยลูกค้า",
      tone: "success",
    });
  }

  const telegramStatus = operationsStatus?.operational_alerts?.telegram.status;
  const telegramReady =
    Boolean(telegramStatus?.configured) &&
    Boolean(telegramStatus?.verified) &&
    telegramStatus?.targets.some((target) => target.enabled) === true;
  if (telegramReady) {
    actions.push({
      actionLabel: "เปิด Ops / Logs",
      description:
        "Telegram ops alert พร้อมเป็น safety net ให้ owner เห็น incident, worker stale, LINE fail และ summary รอบแจ้งเตือน",
      href: "/owner/audit",
      label: "safety net พร้อม",
      title: "คง operational alert ไว้คู่กับ LINE ผู้บริหาร",
      tone: "success",
    });
  } else {
    actions.push({
      actionLabel: "ตั้งค่า Telegram",
      description:
        "ก่อนเปิด pilot ควรมี ops alert ถึง owner เพื่อไม่ให้ incident ของ SML/LINE เงียบอยู่หลังบ้าน",
      href: "/owner/audit",
      label: "กันพลาด",
      title: "เปิด Telegram ops alert ให้ครบ",
      tone: "warning",
    });
  }

  return actions.slice(0, 3);
}

function isPilotCoverageTenant(item: TenantSummary) {
  return (
    item.health.datasource_configured ||
    item.health.line_targets_enabled > 0 ||
    item.health.notification_rules_enabled > 0
  );
}

function buildBlockedPilotTenantDescription(item: TenantSummary) {
  if (!item.health.datasource_configured) {
    return "ยังไม่พร้อมเพราะ SML datasource ไม่ครบหรือยังไม่ผ่าน health resolver";
  }
  if (item.health.line_targets_enabled === 0) {
    return "ยังไม่มีผู้รับ LINE ที่เปิดใช้งาน จึงยังพิสูจน์ delivery ถึงผู้บริหารไม่ได้";
  }
  if (item.health.notification_rules_enabled === 0) {
    return "ยังไม่มีแผนแจ้งเตือนที่เปิดใช้งาน จึงยังไม่มีรอบจริงให้ตรวจย้อนหลัง";
  }
  return "ยังมี prerequisite ของ pilot ไม่ครบ ต้องตรวจร้านนี้ก่อนใช้รวมใน coverage";
}

function buildPilotTenantSetupHref(item: TenantSummary) {
  const tenantId = encodeURIComponent(item.tenant.id);
  if (!item.health.datasource_configured) {
    return `/owner/sml-connections?tenant=${tenantId}`;
  }
  if (item.health.line_targets_enabled === 0) {
    return `/owner/line?tenant=${tenantId}`;
  }
  if (item.health.notification_rules_enabled === 0) {
    return `/owner/notifications?tenant=${tenantId}`;
  }
  return `/owner?tenant=${tenantId}`;
}

function formatTenantNameList(names: string[]) {
  if (names.length <= 2) {
    return names.join(" และ ");
  }
  return `${names.slice(0, 2).join(" และ ")} +อีก ${(names.length - 2).toLocaleString(
    "th-TH",
  )} ร้าน`;
}

function buildPilotProofShareText(
  proofPackage: OwnerPilotProofPackage,
  verdict: OwnerProofVerdict,
  proof: OwnerOperationsStatus["production_proof"] | null | undefined,
) {
  const lines = [
    "AI-BCC Pilot Proof",
    `สถานะ: ${verdict.label} - ${verdict.title}`,
    `สรุป: ${proofPackage.headline}`,
    `หลักฐาน: ${proofPackage.proofLine}`,
    `ข้อเสนอ: ${proofPackage.buyerPromise}`,
    `ข้อควรพูดตรง ๆ: ${proofPackage.caveat}`,
  ];
  if (proof) {
    lines.push(
      `อัปเดตล่าสุด: ${formatDateTime(proof.generated_at)} (${proof.window_days.toLocaleString(
        "th-TH",
      )} วันล่าสุด)`,
    );
  }
  return lines.join("\n");
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Some browser contexts expose Clipboard API but still block writes.
      // Fall through to the legacy copy command before showing manual copy UI.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  try {
    const copied =
      typeof document.execCommand === "function" &&
      document.execCommand("copy");
    if (!copied) {
      throw new Error("copy command failed");
    }
  } finally {
    document.body.removeChild(textarea);
  }
}

function ownerProofVerdictAccentClass(tone: OwnerBadgeTone) {
  if (tone === "success") {
    return "border-success-500";
  }
  if (tone === "warning") {
    return "border-warning-500";
  }
  if (tone === "error") {
    return "border-error-500";
  }
  if (tone === "info") {
    return "border-brand-500";
  }
  return "border-gray-300 dark:border-gray-700";
}

function buildOwnerNextAction(
  tenants: TenantSummary[],
  operationsStatus: OwnerOperationsStatus | null,
): OwnerNextAction {
  const activeTenants = tenants.filter((item) => item.tenant.status !== "cancelled");
  const latestJavaWsFailure = operationsStatus?.report_health?.latest_javaws_failure;
  if (latestJavaWsFailure) {
    const tenant = tenants.find(
      (item) => item.tenant.id === latestJavaWsFailure.tenant_id,
    );
    return {
      actionLabel: "เปิด audit",
      description: `รายงาน ${formatOwnerReportLabel(
        latestJavaWsFailure.report_key,
      )} ตอบกลับจาก JavaWS แต่แปลงผลไม่สำเร็จใน phase ${formatJavaWsFailurePhase(
        latestJavaWsFailure.failure_phase,
      )}`,
      href: "/owner/audit",
      tenantName: tenant?.tenant.name,
      title: "ตรวจ JavaWS incident ล่าสุด",
      tone: "error",
    };
  }

  if (operationsStatus && operationsStatus.worker.status !== "ok") {
    return {
      actionLabel: "ดูสถานะระบบ",
      description: `สถานะ worker คือ ${formatWorkerStatus(
        operationsStatus.worker.status,
      )} ถ้าไม่ปกติ รอบแจ้งเตือนอาจไม่เริ่มหรือไม่จบตามเวลา`,
      href: "/owner/audit",
      title: "ตรวจ worker ก่อนรอบถัดไป",
      tone: "error",
    };
  }

  const blockedTenant = activeTenants.find((item) => !item.access.enabled);
  if (blockedTenant) {
    return {
      actionLabel: "แก้สถานะร้าน",
      description: blockedTenant.access.message,
      href: `/owner?tenant=${encodeURIComponent(blockedTenant.tenant.id)}`,
      tenantName: blockedTenant.tenant.name,
      title: "เปิดสิทธิ์ร้านให้พร้อมใช้งาน",
      tone: "error",
    };
  }

  const missingDatasource = activeTenants.find(
    (item) => !item.health.datasource_configured,
  );
  if (missingDatasource) {
    return {
      actionLabel: "ตรวจ SML",
      description:
        "ยังไม่ได้ตั้งค่า SML JavaWS หรือ datasource ยังไม่พร้อม จึงยังไม่ควรเปิดรอบแจ้งเตือนจริง",
      href: `/owner/sml-connections?tenant=${encodeURIComponent(
        missingDatasource.tenant.id,
      )}`,
      tenantName: missingDatasource.tenant.name,
      title: "เชื่อม SML JavaWS ให้ผ่านก่อน",
      tone: "warning",
    };
  }

  const failedRoundTenant = activeTenants.find(
    (item) =>
      item.health.latest_notification_run_status === "failed" ||
      item.health.latest_report_status === "failed",
  );
  if (failedRoundTenant) {
    return {
      actionLabel: "เปิด audit",
      description:
        failedRoundTenant.health.latest_notification_run_error ??
        "รอบรายงานล่าสุดล้มเหลว ต้องดูรายละเอียดก่อนสรุปยอดให้ผู้บริหาร",
      href: "/owner/audit",
      tenantName: failedRoundTenant.tenant.name,
      title: "ตรวจรอบรายงานที่ล้มเหลว",
      tone: "error",
    };
  }

  const lineProblemTenant = activeTenants.find(
    (item) =>
      item.health.line_channels === 0 ||
      item.health.line_targets_enabled === 0 ||
      item.health.latest_line_delivery_status === "failed",
  );
  if (lineProblemTenant) {
    return {
      actionLabel: "ตรวจ LINE",
      description:
        lineProblemTenant.health.latest_line_delivery_status === "failed"
          ? "LINE delivery ล่าสุดส่งไม่สำเร็จ ต้องดูผู้รับ/สิทธิ์/ช่องทางก่อนรอบถัดไป"
          : "ยังไม่มี LINE OA หรือผู้รับที่เปิดรับรายงานผู้บริหาร",
      href: `/owner/line?tenant=${encodeURIComponent(lineProblemTenant.tenant.id)}`,
      tenantName: lineProblemTenant.tenant.name,
      title: "ทำให้เส้นทางส่ง LINE พร้อม",
      tone: "warning",
    };
  }

  const missingScheduleTenant = activeTenants.find(
    (item) => item.health.notification_rules_enabled === 0,
  );
  if (missingScheduleTenant) {
    return {
      actionLabel: "ตั้งแจ้งเตือน",
      description:
        "ร้านนี้พร้อมดึงรายงานและมีผู้รับแล้ว แต่ยังไม่มีแผนแจ้งเตือนที่เปิดใช้งาน",
      href: `/owner/notifications?tenant=${encodeURIComponent(
        missingScheduleTenant.tenant.id,
      )}`,
      tenantName: missingScheduleTenant.tenant.name,
      title: "สร้างแผนส่งรายงานอัตโนมัติ",
      tone: "warning",
    };
  }

  const criticalSignalTenant = activeTenants.find(
    (item) => item.health.critical_business_signals > 0,
  );
  if (criticalSignalTenant) {
    return {
      actionLabel: "เปิดรายละเอียดร้าน",
      description: `${criticalSignalTenant.health.critical_business_signals} เรื่องควรตรวจทันทีจาก snapshot ล่าสุด`,
      href: `/owner?tenant=${encodeURIComponent(criticalSignalTenant.tenant.id)}`,
      tenantName: criticalSignalTenant.tenant.name,
      title: "จัดการ business signal ที่ยังเปิดอยู่",
      tone: "error",
    };
  }

  const missingProofTenant = activeTenants.find(
    (item) =>
      item.health.latest_notification_run_status !== "success" ||
      item.health.latest_line_delivery_status !== "success",
  );
  if (missingProofTenant) {
    return {
      actionLabel: "ดู audit",
      description:
        "ยังไม่มีหลักฐาน production proof ครบทั้ง notification run และ LINE delivery สำเร็จ",
      href: "/owner/audit",
      tenantName: missingProofTenant.tenant.name,
      title: "ตรวจ proof ของรอบล่าสุด",
      tone: "info",
    };
  }

  return {
    actionLabel: "ดูรอบล่าสุด",
    description:
      "ร้าน active มี prerequisite ครบและมี proof ล่าสุดแล้ว รอตรวจรอบแจ้งเตือนถัดไปหลังส่งจริง",
    href: "/owner/audit",
    title: "พร้อมรอบถัดไป",
    tone: "success",
  };
}

function buildStoreHealthCells(
  item: TenantSummary,
  latestJavaWsFailure:
    | NonNullable<OwnerOperationsStatus["report_health"]>["latest_javaws_failure"]
    | null,
) {
  const readiness = getTenantReadiness(item);
  const nextStep = getTenantNextStep(item, readiness.items);
  const latestRunStatus =
    item.health.latest_notification_run_status ?? item.health.latest_report_status;
  const hasIncident =
    latestJavaWsFailure?.tenant_id === item.tenant.id ||
    item.health.latest_notification_run_status === "failed" ||
    item.health.latest_report_status === "failed" ||
    item.health.latest_line_delivery_status === "failed";

  return {
    nextStep,
    sml: {
      label: item.health.datasource_configured ? "พร้อม" : "ต้องตั้ง",
      tone: item.health.datasource_configured
        ? ("success" as const)
        : ("warning" as const),
    },
    line: {
      label:
        item.health.line_targets_enabled > 0
          ? `${item.health.line_targets_enabled} ผู้รับ`
          : item.health.line_channels > 0
            ? "รอผู้รับ"
            : "ยังไม่มี",
      tone:
        item.health.line_targets_enabled > 0
          ? ("success" as const)
          : item.health.line_channels > 0
            ? ("warning" as const)
            : ("error" as const),
    },
    schedule: {
      label:
        item.health.notification_rules_enabled > 0
          ? `${item.health.notification_rules_enabled} แผน`
          : "ยังไม่มี",
      tone:
        item.health.notification_rules_enabled > 0
          ? ("success" as const)
          : ("warning" as const),
    },
    latestRun: {
      label: formatRunStatus(latestRunStatus),
      tone:
        latestRunStatus === "success"
          ? ("success" as const)
          : latestRunStatus === "failed"
            ? ("error" as const)
            : ("light" as const),
    },
    incident: {
      label: hasIncident ? "มี" : "ไม่มี",
      tone: hasIncident ? ("error" as const) : ("success" as const),
    },
    signals: {
      label:
        item.health.open_business_signals > 0
          ? `${item.health.open_business_signals} เปิด`
          : "ไม่มี",
      tone:
        item.health.critical_business_signals > 0
          ? ("error" as const)
          : item.health.open_business_signals > 0
            ? ("warning" as const)
            : ("success" as const),
    },
    proof: {
      label:
        item.health.latest_notification_run_status === "success" &&
        item.health.latest_line_delivery_status === "success"
          ? "ครบ"
          : item.health.latest_notification_run_at
            ? "ต้องตรวจ"
            : "รอรอบ",
      tone:
        item.health.latest_notification_run_status === "success" &&
        item.health.latest_line_delivery_status === "success"
          ? ("success" as const)
          : item.health.latest_notification_run_at
            ? ("warning" as const)
            : ("light" as const),
    },
  };
}

function getLatestNotificationRound(tenants: TenantSummary[]) {
  return tenants
    .filter((item) => item.health.latest_notification_run_at)
    .map((item) => ({
      at: item.health.latest_notification_run_at ?? "",
      status: item.health.latest_notification_run_status,
      tenantName: item.tenant.name,
    }))
    .sort((a, b) => getTimeMs(b.at) - getTimeMs(a.at))[0];
}

function getTimeMs(value: string | null | undefined) {
  if (!value) {
    return 0;
  }
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function formatJavaWsFailurePhase(phase: string | null | undefined) {
  const labels: Record<string, string> = {
    timeout: "timeout",
    unreachable: "ติดต่อไม่ได้",
    operation_missing: "ไม่พบ operation",
    http_error: "HTTP error",
    soap_fault: "SOAP fault",
    soap_parse_failed: "อ่าน SOAP ไม่ได้",
    missing_return: "ไม่มีผลลัพธ์กลับมา",
    non_base64_return: "ผลลัพธ์ไม่ใช่ base64",
    invalid_zip: "zip เปิดไม่ได้",
    empty_zip: "zip ว่าง",
    xml_parse_failed: "อ่าน XML ไม่ได้",
    missing_resultset: "ไม่พบ resultset",
    invalid_resultset: "resultset ผิดรูปแบบ",
    unknown: "ยังไม่ทราบ phase",
  };
  return labels[phase ?? "unknown"] ?? "ยังไม่ทราบ phase";
}

function formatOperationalAlertStatus(status: OperationalAlertDeliveryRecord["status"]) {
  if (status === "success") {
    return "ส่งสำเร็จ";
  }
  if (status === "failed") {
    return "ส่งไม่สำเร็จ";
  }
  if (status === "dry_run") {
    return "dry-run";
  }
  if (status === "skipped") {
    return "ข้าม";
  }
  return status;
}

function formatRunStatus(status: string | null) {
  if (status === "success") {
    return "สำเร็จ";
  }
  if (status === "success_with_warnings") {
    return "สำเร็จพร้อมข้อสังเกต";
  }
  if (status === "failed") {
    return "ล้มเหลว";
  }
  if (status === "queued") {
    return "รอคิว";
  }
  if (status === "running") {
    return "กำลังรัน";
  }
  return "ยังไม่มี";
}

function isTerminalReportRunStatus(status: string | null) {
  return status === "success" || status === "failed";
}

function formatChunkedProgressStage(stage: string | null) {
  if (stage === "queued") {
    return "รอคิว";
  }
  if (stage === "claimed") {
    return "รับงานแล้ว";
  }
  if (stage === "preflight") {
    return "เตรียม chunks";
  }
  if (stage === "running_chunk") {
    return "กำลังประมวลผล chunks";
  }
  if (stage === "summarizing") {
    return "กำลังสรุปผล";
  }
  if (stage === "completed") {
    return "เสร็จแล้ว";
  }
  if (stage === "failed") {
    return "ล้มเหลว";
  }
  return "กำลังทำงาน";
}

function formatElapsedMs(value: number) {
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) {
    return `${seconds} วินาที`;
  }
  return `${minutes} นาที ${seconds.toString().padStart(2, "0")} วินาที`;
}

function formatProofRate(value: number | null) {
  if (value === null) {
    return "ยังไม่มีข้อมูล";
  }
  return `${Math.round(value * 100).toLocaleString("th-TH")}%`;
}

function getHeavyReportProgressStorageKey(tenantId: string) {
  return `ai-bcc:owner:chunked-heavy-report:${tenantId}`;
}

function formatWorkerStatus(status: string) {
  if (status === "ok") {
    return "ปกติ";
  }
  if (status === "stale") {
    return "heartbeat เก่า";
  }
  if (status === "missing") {
    return "ยังไม่พบ heartbeat";
  }
  if (status === "warning") {
    return "ควรตรวจ";
  }
  if (status === "error") {
    return "ผิดพลาด";
  }
  return status;
}

function formatAuditAction(action: string) {
  const labels: Record<string, string> = {
    datasource_test_succeeded: "ทดสอบ SML สำเร็จ",
    datasource_test_failed: "ทดสอบ SML ไม่สำเร็จ",
    line_channel_created: "เพิ่ม LINE OA",
    line_channel_updated: "แก้ไข LINE OA",
    line_channel_secrets_updated: "บันทึก LINE secret",
    line_target_assigned: "เพิ่มผู้รับเข้าร้าน",
    line_target_assignment_updated: "อัปเดตผู้รับเข้าร้าน",
    line_target_approved: "อนุมัติผู้รับ LINE",
    line_target_updated: "แก้สิทธิ์ผู้รับ LINE",
    line_delivery_succeeded: "ส่ง LINE สำเร็จ",
    line_delivery_failed: "ส่ง LINE ไม่สำเร็จ",
    morning_brief_report_run_requested: "รันแผนแจ้งเตือน",
    report_run_requested: "รันรายงาน",
    report_run_succeeded: "รันรายงานสำเร็จ",
    report_run_failed: "รันรายงานไม่สำเร็จ",
    report_validation_signed_off: "รับรองยอดรายงาน",
    owner_tenant_created: "เพิ่มร้านค้า",
    owner_tenant_updated: "แก้ไขร้านค้า",
  };
  return labels[action] ?? action;
}

function auditActionTone(action: string): "success" | "warning" | "error" | "light" {
  if (action.includes("failed")) {
    return "error";
  }
  if (action.includes("signed_off") || action.includes("succeeded")) {
    return "success";
  }
  if (action.includes("updated") || action.includes("requested")) {
    return "warning";
  }
  return "light";
}

function auditActionToneClass(action: string) {
  const tone = auditActionTone(action);
  const classes = {
    error: "bg-error-50 text-error-600 dark:bg-error-500/15 dark:text-error-500",
    light: "bg-gray-100 text-gray-700 dark:bg-white/5 dark:text-white/80",
    success:
      "bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-500",
    warning:
      "bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-orange-400",
  };
  return classes[tone];
}

function formatAuditMetadata(metadata: Record<string, unknown>) {
  const keys = [
    "safe_error_message",
    "date_from",
    "date_to",
    "difference_amount",
    "accepted",
    "access_profile_key",
    "enabled",
  ];
  const parts = keys
    .filter((key) => metadata[key] !== undefined && metadata[key] !== null)
    .map((key) => `${key}: ${String(metadata[key])}`);
  return parts.length ? parts.join(" · ") : "ไม่มี metadata เพิ่มเติม";
}

function OwnerSetupPanel({
  busy,
  createTenant,
  newTenantId,
  newTenantName,
  setNewTenantId,
  setNewTenantName,
}: {
  busy: string | null;
  createTenant: (event: FormEvent<HTMLFormElement>) => void;
  newTenantId: string;
  newTenantName: string;
  setNewTenantId: (value: string) => void;
  setNewTenantName: (value: string) => void;
}) {
  return (
    <details className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <summary className="cursor-pointer list-none">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <Badge color="primary">เพิ่มร้านค้า</Badge>
            <h2 className="mt-2 text-base font-semibold text-gray-900 dark:text-white">
              สร้างร้านใหม่
            </h2>
            <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
              เปิดเฉพาะตอน onboard ร้านใหม่ แล้วทำต่อที่ SML, LINE และแผนแจ้งเตือน
            </p>
          </div>
          <Badge color="light">tenant_id แก้ไม่ได้หลังสร้าง</Badge>
        </div>
      </summary>

      <form
        className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800"
        onSubmit={createTenant}
      >
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1">
            <input
              className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 dark:border-gray-700 dark:text-white"
              onChange={(event) => {
                setNewTenantName(event.target.value);
                setNewTenantId("");
              }}
              placeholder="ชื่อร้านค้า เช่น ABC Shop"
              value={newTenantName}
            />
            {newTenantName.trim() ? (
              <p className="px-1 text-xs text-gray-400 dark:text-gray-500">
                รหัสร้าน:{" "}
                <span className="font-mono font-medium text-gray-600 dark:text-gray-300">
                  {newTenantId.trim() || slugifyTenantId(newTenantName)}
                </span>
                {!newTenantId.trim() && (
                  <button
                    className="ml-2 text-brand-500 hover:underline"
                    type="button"
                    onClick={() =>
                      setNewTenantId(slugifyTenantId(newTenantName))
                    }
                  >
                    แก้ไขเอง
                  </button>
                )}
              </p>
            ) : null}
            {newTenantId.trim() ? (
              <input
                className="h-9 w-full rounded-lg border border-gray-300 bg-transparent px-3 font-mono text-xs text-gray-800 dark:border-gray-700 dark:text-white"
	                onChange={(event) => setNewTenantId(event.target.value)}
	                placeholder="tenant_id"
                value={newTenantId}
              />
            ) : null}
          </div>
          <Button disabled={busy === "create" || !newTenantName.trim()} size="sm">
            เพิ่มร้านค้า
          </Button>
        </div>
      </form>
    </details>
  );
}

function LineChannelPanel({
  busy,
  createLineChannel,
  lineAccessTokenInput,
  lineChannelName,
  lineChannelShared,
  lineChannelSecretInput,
  lineSecretChannelId,
  lineSecretConfigured,
  lineTokenConfigured,
  onSaveLineChannelSecrets,
  onUpdateLineChannel,
  selectedTenant,
  selectedTenantId,
  selectedTenantLineChannels,
  setLineAccessTokenInput,
  setLineChannelName,
  setLineChannelShared,
  setLineChannelSecretInput,
  setLineSecretChannelId,
  setLineSecretConfigured,
  setLineTokenConfigured,
  setSelectedTenantId,
  tenants,
}: {
  busy: string | null;
  createLineChannel: (event: FormEvent<HTMLFormElement>) => void;
  lineAccessTokenInput: string;
  lineChannelName: string;
  lineChannelShared: boolean;
  lineChannelSecretInput: string;
  lineSecretChannelId: string;
  lineSecretConfigured: boolean;
  lineTokenConfigured: boolean;
  onSaveLineChannelSecrets: (event: FormEvent<HTMLFormElement>) => void;
  onUpdateLineChannel: (input: {
    channel: LineChannelRecord;
    displayName: string;
    scope: LineChannelScope;
    enabled: boolean;
  }) => Promise<void>;
  selectedTenant?: Tenant;
  selectedTenantId: string;
  selectedTenantLineChannels: LineChannelRecord[];
  setLineAccessTokenInput: (value: string) => void;
  setLineChannelName: (value: string) => void;
  setLineChannelShared: (value: boolean) => void;
  setLineChannelSecretInput: (value: string) => void;
  setLineSecretChannelId: (value: string) => void;
  setLineSecretConfigured: (value: boolean) => void;
  setLineTokenConfigured: (value: boolean) => void;
  setSelectedTenantId: (value: string) => void;
  tenants: TenantSummary[];
}) {
  return (
    <details className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <summary className="cursor-pointer list-none">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
              LINE OA ของร้าน
            </h2>
            <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
              เพิ่ม LINE OA metadata เมื่อพร้อมผูกช่องทางจริง
            </p>
          </div>
          <Badge color="light">
            {selectedTenantLineChannels.length} ช่องทาง
          </Badge>
        </div>
      </summary>

      <form
        className="mt-5 border-t border-gray-100 pt-5 dark:border-gray-800"
        onSubmit={createLineChannel}
      >
        <div className="space-y-3">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            ร้านค้า
            <select
              className="mt-1 h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              onChange={(event) => setSelectedTenantId(event.target.value)}
              value={selectedTenantId}
            >
              {tenants.map((item) => (
                <option key={item.tenant.id} value={item.tenant.id}>
                  {item.tenant.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            ชื่อ LINE OA
            <input
              className="mt-1 h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 dark:border-gray-700 dark:text-white"
              onChange={(event) => setLineChannelName(event.target.value)}
              placeholder="เช่น AI Business Center Demo"
              value={lineChannelName}
            />
          </label>

          <label className="flex items-start gap-3 rounded-lg border border-brand-100 bg-brand-50 p-3 text-sm text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200">
            <input
              checked={lineChannelShared}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-500"
              onChange={(event) => setLineChannelShared(event.target.checked)}
              type="checkbox"
            />
            <span>
              ใช้เป็น LINE OA กลาง ให้ร้านอื่นเลือกใช้ได้เมื่อยังไม่มี OA ของตัวเอง
            </span>
          </label>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm text-gray-600 dark:border-gray-800 dark:bg-white/[0.02] dark:text-gray-400">
              <input
                checked={lineTokenConfigured}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-500"
                onChange={(event) =>
                  setLineTokenConfigured(event.target.checked)
                }
                type="checkbox"
              />
              <span>มี Channel access token แล้ว</span>
            </label>
            <label className="flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm text-gray-600 dark:border-gray-800 dark:bg-white/[0.02] dark:text-gray-400">
              <input
                checked={lineSecretConfigured}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-500"
                onChange={(event) =>
                  setLineSecretConfigured(event.target.checked)
                }
                type="checkbox"
              />
              <span>มี Channel secret สำหรับ webhook แล้ว</span>
            </label>
          </div>

          <Button disabled={busy === "create-line-channel"} size="sm">
            เพิ่ม LINE OA
          </Button>
        </div>
      </form>

      <form
        className="mt-5 border-t border-gray-100 pt-5 dark:border-gray-800"
        onSubmit={onSaveLineChannelSecrets}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">
              บันทึก token/secret แบบเข้ารหัส
            </p>
            <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
              ใช้เมื่อสร้าง LINE OA แล้ว ต้องการให้ระบบส่งแผนแจ้งเตือนและรับ
              webhook ของช่องทางนี้
            </p>
          </div>
          <Badge color="light">masked</Badge>
        </div>

        <div className="mt-3 space-y-3">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            เลือก LINE OA
            <select
              className="mt-1 h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              onChange={(event) => setLineSecretChannelId(event.target.value)}
              value={lineSecretChannelId}
            >
              {selectedTenantLineChannels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.display_name}
                  {channel.scope === "owner_shared" ? " · LINE OA กลาง" : ""}
                </option>
              ))}
            </select>
          </label>
          <OwnerTextInput
            label="Channel access token"
            onChange={setLineAccessTokenInput}
            placeholder="ใส่ token ใหม่เฉพาะตอนตั้งค่าหรือเปลี่ยน token"
            type="password"
            value={lineAccessTokenInput}
          />
          <OwnerTextInput
            label="Channel secret"
            onChange={setLineChannelSecretInput}
            placeholder="ใส่ secret ใหม่เฉพาะตอนตั้งค่าหรือเปลี่ยน secret"
            type="password"
            value={lineChannelSecretInput}
          />
          <Button
            disabled={
              busy === `line-secrets-${lineSecretChannelId}` ||
              !lineSecretChannelId ||
              (!lineAccessTokenInput.trim() && !lineChannelSecretInput.trim())
            }
            size="sm"
          >
            {busy === `line-secrets-${lineSecretChannelId}`
              ? "กำลังบันทึก..."
              : "บันทึก LINE secret"}
          </Button>
        </div>
      </form>

      <div className="mt-5 border-t border-gray-100 pt-4 dark:border-gray-800">
        <p className="text-xs font-semibold uppercase text-gray-400">
          LINE OA ที่ใช้กับ {selectedTenant?.name ?? "ร้านนี้"}
        </p>
        <div className="mt-3 space-y-2">
          {selectedTenantLineChannels.length ? (
            selectedTenantLineChannels.map((channel) => (
              <LineChannelEditableCard
                busy={busy}
                channel={channel}
                key={channel.id}
                onUpdateLineChannel={onUpdateLineChannel}
              />
            ))
          ) : (
            <p className="rounded-lg border border-dashed border-gray-200 p-4 text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
              ยังไม่มี LINE OA สำหรับร้านนี้
            </p>
          )}
        </div>
      </div>
    </details>
  );
}

function LineChannelEditableCard({
  busy,
  channel,
  onUpdateLineChannel,
}: {
  busy: string | null;
  channel: LineChannelRecord;
  onUpdateLineChannel: (input: {
    channel: LineChannelRecord;
    displayName: string;
    scope: LineChannelScope;
    enabled: boolean;
  }) => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(channel.display_name);
  const [scope, setScope] = useState<LineChannelScope>(
    channel.scope ?? "tenant",
  );
  const [enabled, setEnabled] = useState(channel.enabled);

  useEffect(() => {
    setDisplayName(channel.display_name);
    setScope(channel.scope ?? "tenant");
    setEnabled(channel.enabled);
  }, [channel.display_name, channel.enabled, channel.scope]);

  const updateBusyKey = `line-channel-update-${channel.id}`;
  const trimmedDisplayName = displayName.trim();
  const dirty =
    trimmedDisplayName !== channel.display_name ||
    scope !== (channel.scope ?? "tenant") ||
    enabled !== channel.enabled;
  const isEnvChannel = channel.source === "env";

  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
      <div className="flex flex-wrap items-center gap-2">
        <Badge color={enabled ? "success" : "warning"}>
          {enabled ? "เปิดใช้" : "ปิด"}
        </Badge>
        <Badge color={scope === "owner_shared" ? "info" : "light"}>
          {scope === "owner_shared" ? "LINE OA กลาง" : "OA ร้าน"}
        </Badge>
        <Badge
          color={channel.channel_access_token_configured ? "success" : "warning"}
        >
          {channel.channel_access_token_configured ? "มี token" : "ขาด token"}
        </Badge>
        <Badge
          color={channel.channel_secret_configured ? "success" : "warning"}
        >
          {channel.channel_secret_configured ? "มี secret" : "ขาด secret"}
        </Badge>
      </div>

      <div className="mt-3 space-y-3">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          ชื่อ LINE OA
          <input
            className="mt-1 h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            disabled={isEnvChannel}
            onChange={(event) => setDisplayName(event.target.value)}
            value={displayName}
          />
        </label>

        <label className="flex items-start gap-3 rounded-lg border border-brand-100 bg-brand-50 p-3 text-sm text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200">
          <input
            checked={scope === "owner_shared"}
            className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-500"
            disabled={isEnvChannel}
            onChange={(event) =>
              setScope(event.target.checked ? "owner_shared" : "tenant")
            }
            type="checkbox"
          />
          <span className="leading-5">
            ใช้เป็น LINE OA กลาง ให้ร้านอื่นเลือกใช้ได้เมื่อยังไม่มี OA
            ของตัวเอง
          </span>
        </label>

        <label className="flex items-start gap-3 rounded-lg border border-gray-100 bg-white p-3 text-sm text-gray-600 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-400">
          <input
            checked={enabled}
            className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-500"
            disabled={isEnvChannel}
            onChange={(event) => setEnabled(event.target.checked)}
            type="checkbox"
          />
          <span className="leading-5">
            เปิดใช้งานช่องทางนี้สำหรับส่งแผนแจ้งเตือน
          </span>
        </label>

        <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">
          {scope === "owner_shared"
            ? "ร้านอื่นจะเห็น LINE OA นี้ในคลังกลาง และเลือกผู้รับจากช่องทางนี้เข้าร้านได้"
            : "LINE OA นี้ใช้เป็นช่องทางของร้านที่สร้างไว้เท่านั้น"}{" "}
          ถ้ายังขาด token ต้องบันทึก Channel access token ก่อนจึงส่งจริงได้
        </p>

        {isEnvChannel ? (
          <p className="rounded-lg border border-warning-200 bg-warning-50 p-3 text-xs leading-5 text-warning-700">
            ช่องทางนี้มาจาก env fallback จึงแก้ metadata จาก UI ไม่ได้
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] uppercase tracking-wide text-gray-400">
            ที่มา: {channel.source}
          </p>
          <Button
            disabled={
              isEnvChannel ||
              busy === updateBusyKey ||
              !dirty ||
              !trimmedDisplayName
            }
            onClick={() =>
              void onUpdateLineChannel({
                channel,
                displayName: trimmedDisplayName,
                scope,
                enabled,
              })
            }
            size="sm"
          >
            {busy === updateBusyKey ? "กำลังบันทึก..." : "บันทึกการแก้ไข"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DatasourceConfigPanel({
  autoOpen,
  busy,
  discoveryBusy,
  config,
  javaWsAuthMode,
  javaWsAuthSecret,
  javaWsAuthUsername,
  javaWsBaseUrl,
  javaWsConfigFileName,
  javaWsDatabaseDiscovery,
  javaWsDatabase,
  javaWsEndpoint,
  javaWsWebappPath,
  onJavaWsAuthModeChange,
  onJavaWsAuthSecretChange,
  onJavaWsAuthUsernameChange,
  onJavaWsBaseUrlChange,
  onJavaWsConfigFileNameChange,
  onJavaWsDatabaseChange,
  onJavaWsWebappPathChange,
  onApplyJavaWsPreset,
  onDiscoverJavaWsDatabases,
  onSubmit,
}: {
  autoOpen?: boolean;
  busy: boolean;
  discoveryBusy: boolean;
  config: DatasourceConfigStatus | null;
  javaWsAuthMode: JavaWsAuthMode;
  javaWsAuthSecret: string;
  javaWsAuthUsername: string;
  javaWsBaseUrl: string;
  javaWsConfigFileName: string;
  javaWsDatabaseDiscovery: JavaWsDatabaseDiscoveryResult | null;
  javaWsDatabase: string;
  javaWsEndpoint: string;
  javaWsWebappPath: string;
  onJavaWsAuthModeChange: (value: JavaWsAuthMode) => void;
  onJavaWsAuthSecretChange: (value: string) => void;
  onJavaWsAuthUsernameChange: (value: string) => void;
  onJavaWsBaseUrlChange: (value: string) => void;
  onJavaWsConfigFileNameChange: (value: string) => void;
  onJavaWsDatabaseChange: (value: string) => void;
  onJavaWsWebappPathChange: (value: string) => void;
  onApplyJavaWsPreset: (preset: JavaWsDatasourcePreset) => void;
  onDiscoverJavaWsDatabases: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (autoOpen && detailsRef.current) {
      detailsRef.current.open = true;
      detailsRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [autoOpen]);

  const sourceLabel =
    config?.source === "encrypted_store"
      ? "บันทึกในระบบแล้ว"
      : config?.source === "env"
        ? "อ่านจาก env server"
        : "ยังไม่ตั้งค่า";
  const modeLabel = "Tomcat JavaWS";
  const secretRequired = javaWsAuthMode !== "none";
  const secretValue = javaWsAuthSecret;
  const tomcatUrl = parseTomcatBaseUrl(javaWsBaseUrl);
  const updateTomcatBaseUrl = (
    patch: Partial<{ host: string; port: string; protocol: "http" | "https" }>,
  ) => {
    onJavaWsBaseUrlChange(
      buildTomcatBaseUrl({
        host: patch.host ?? tomcatUrl.host,
        port: patch.port ?? tomcatUrl.port,
        protocol: patch.protocol ?? tomcatUrl.protocol,
      }),
    );
  };

  return (
    <details ref={detailsRef} className="mt-4 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <summary className="cursor-pointer list-none">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">
              เชื่อม SML ผ่าน Tomcat JavaWS
            </p>
            <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
              กรอก 4 ค่าหลักของร้าน: Tomcat, port, SMLConfig และ database
            </p>
          </div>
          <Badge color={config?.password_configured ? "success" : "warning"}>
            {sourceLabel}
          </Badge>
        </div>
      </summary>

      <form className="mt-4 space-y-3" onSubmit={onSubmit}>
        {!config?.encryption_configured ? (
          <p className="rounded-lg border border-warning-200 bg-warning-50 p-3 text-xs leading-5 text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-300">
            Server ยังไม่มี secret key ใน bootstrap config จึงยังบันทึก password/token
            ลง encrypted store ไม่ได้
          </p>
        ) : null}
        {config?.source === "env" ? (
          <p className="rounded-lg border border-warning-200 bg-warning-50 p-3 text-xs leading-5 text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-300">
            ร้านนี้ยังมีค่าเก่าที่ไม่ได้อยู่ใน JavaWS flow ใหม่ กรุณาบันทึกค่า JavaWS เพื่อเริ่มใช้งานใหม่
          </p>
        ) : null}

        <div className="rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-sm text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300">
          SML ของร้านค้าใช้ JavaWS เท่านั้น ระบบจะไม่ขอ user/password ของฐานข้อมูล PostgreSQL
        </div>
        {config?.kind && config.kind !== "sml_javaws" ? (
          <div className="rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 text-xs leading-5 text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-300">
            พบค่าเชื่อมต่อแบบเก่า กรุณากรอก JavaWS ใหม่ ร้านนี้จะยังไม่พร้อมส่งแจ้งเตือนจนกว่าจะบันทึกและทดสอบผ่าน
          </div>
        ) : null}

        <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                กรอกเร็ว
              </p>
              <div className="mt-2 grid gap-2 2xl:grid-cols-2">
                {JAVA_WS_DATASOURCE_PRESETS.map((preset) => (
                  <button
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-sm transition hover:border-brand-300 hover:text-brand-600 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-brand-500 dark:hover:text-brand-300"
                    key={preset.id}
                    onClick={() => onApplyJavaWsPreset(preset)}
                    type="button"
                  >
                    <span className="font-semibold text-gray-900 dark:text-white">
                      {preset.label}
                    </span>
                    <span className="mt-1 block break-words text-xs leading-5 text-gray-500 dark:text-gray-400">
                      {preset.description}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_110px]">
              <OwnerTextInput
                description="เครื่องที่เปิด Tomcat ของ SML JavaWS จะกรอกเป็น IP, host หรือ URL เต็มก็ได้"
                label="Tomcat host / URL"
                onChange={(value) => updateTomcatBaseUrl({ host: value })}
                placeholder="147.50.69.68 หรือ demserver.3bbddns.com"
                value={tomcatUrl.host}
              />
              <OwnerTextInput
                description="port ที่ Tomcat เปิดให้เรียก SMLJavaWebService เช่น 80, 8080 หรือ port ที่ SML DEV แจ้ง"
                label="Port"
                onChange={(value) => updateTomcatBaseUrl({ port: value })}
                placeholder="8080"
                value={tomcatUrl.port}
              />
            </div>
            <p className="break-words rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs leading-5 text-gray-500 dark:border-gray-800 dark:bg-white/[0.02] dark:text-gray-400">
              Base URL: {javaWsBaseUrl || "ยังไม่ได้ระบุ Tomcat URL"}
            </p>
            <OwnerTextInput
              description="ไฟล์ config ที่ JavaWS ใช้เลือก connection ของ SML เช่น SMLConfigDATA.xml"
              label="SMLConfig file"
              onChange={onJavaWsConfigFileNameChange}
              placeholder="SMLConfigDATA.xml"
              value={javaWsConfigFileName}
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <button
                className="inline-flex h-10 items-center justify-center rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-white/[0.03]"
                disabled={
                  discoveryBusy ||
                  !javaWsBaseUrl.trim() ||
                  !javaWsConfigFileName.trim()
                }
                onClick={onDiscoverJavaWsDatabases}
                type="button"
              >
                {discoveryBusy ? "กำลังค้นหา..." : "ค้นหา database จาก JavaWS"}
              </button>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                ใช้ `_getDatabaseList`
              </span>
            </div>

            <JavaWsDatabaseDiscoverySummary
              discovery={javaWsDatabaseDiscovery}
              onSelectDatabase={onJavaWsDatabaseChange}
            />

            {javaWsDatabaseDiscovery?.databases.length ? (
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                ชื่อฐานข้อมูล
                <select
                  className="mt-1 h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                  onChange={(event) => onJavaWsDatabaseChange(event.target.value)}
                  value={javaWsDatabase}
                >
                  <option value="">เลือก database</option>
                  {javaWsDatabaseDiscovery.databases.map((row) => (
                    <option
                      key={`${row.database_name}-${row.code}`}
                      value={row.database_name}
                    >
                      {row.database_name}
                      {row.name && row.name !== row.database_name
                        ? ` · ${row.name}`
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <OwnerTextInput
                description="ชื่อฐานข้อมูล SML ที่ต้องการดึงรายงานของร้านนี้"
                label="ชื่อฐานข้อมูล"
                onChange={onJavaWsDatabaseChange}
                placeholder="sml1_2026"
                value={javaWsDatabase}
              />
            )}
            <details className="rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
              <summary className="cursor-pointer text-sm font-semibold text-gray-700 dark:text-gray-300">
                ตั้งค่าขั้นสูง
              </summary>
              <div className="mt-3 space-y-3">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Protocol
                  <select
                    className="mt-1 h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                    onChange={(event) =>
                      updateTomcatBaseUrl({
                        protocol: event.target.value as "http" | "https",
                      })
                    }
                    value={tomcatUrl.protocol}
                  >
                    <option value="http">http</option>
                    <option value="https">https</option>
                  </select>
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <OwnerTextInput
                    label="Webapp path"
                    onChange={onJavaWsWebappPathChange}
                    placeholder="/SMLJavaWebService"
                    value={javaWsWebappPath}
                  />
                  <div className="rounded-lg border border-gray-100 bg-white p-3 text-sm dark:border-gray-800 dark:bg-gray-900">
                    <p className="font-medium text-gray-700 dark:text-gray-300">
                      Endpoint
                    </p>
                    <p className="mt-1 font-semibold text-gray-900 dark:text-white">
                      {javaWsEndpoint || "DotNetFrameWork"}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                      JavaWS v1 ใช้ endpoint นี้เป็นค่ามาตรฐาน
                    </p>
                  </div>
                </div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Auth หลัง reverse proxy (ถ้ามี)
                  <select
                    className="mt-1 h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                    onChange={(event) =>
                      onJavaWsAuthModeChange(event.target.value as JavaWsAuthMode)
                    }
                    value={javaWsAuthMode}
                  >
                    <option value="none">ไม่ใช้ auth</option>
                    <option value="basic">Basic auth</option>
                    <option value="bearer">Bearer token</option>
                  </select>
                </label>
                {javaWsAuthMode === "basic" ? (
                  <OwnerTextInput
                    label="Auth username"
                    onChange={onJavaWsAuthUsernameChange}
                    placeholder="proxy-user"
                    value={javaWsAuthUsername}
                  />
                ) : null}
                {javaWsAuthMode !== "none" ? (
                  <OwnerTextInput
                    label={javaWsAuthMode === "basic" ? "Auth password" : "Bearer token"}
                    onChange={onJavaWsAuthSecretChange}
                    placeholder={
                      config?.auth_configured
                        ? "ใส่ใหม่เฉพาะเมื่อต้องการเปลี่ยน secret"
                        : "ใส่ secret สำหรับ reverse proxy"
                    }
                    type="password"
                    value={javaWsAuthSecret}
                  />
                ) : null}
              </div>
            </details>

        <div className="flex flex-col gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span>
            สถานะปัจจุบัน: {sourceLabel} · {modeLabel}
            {config?.updated_at ? ` · ${formatDateTime(config.updated_at)}` : ""}
          </span>
          <span>
            Audit จะเก็บ Tomcat/base URL และ database เท่านั้น ไม่เก็บ token แบบอ่านได้
          </span>
        </div>

        <Button
          disabled={
            busy ||
            !config?.encryption_configured ||
            (secretRequired && !secretValue.trim())
          }
          size="sm"
        >
          {busy ? "กำลังบันทึก..." : "บันทึกการเชื่อม SML"}
        </Button>
      </form>
    </details>
  );
}

function JavaWsDatabaseDiscoverySummary({
  discovery,
  onSelectDatabase,
}: {
  discovery: JavaWsDatabaseDiscoveryResult | null;
  onSelectDatabase: (databaseName: string) => void;
}) {
  if (!discovery) {
    return null;
  }

  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
      <div className="flex flex-wrap items-center gap-2">
        <Badge color={discovery.ok ? "success" : "warning"}>
          {discovery.ok ? "ค้นหาสำเร็จ" : "ต้องตรวจสอบ"}
        </Badge>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {discovery.config_file_name} · {discovery.latency_ms} ms ·{" "}
          {formatDateTime(discovery.checked_at)}
        </span>
      </div>
      {discovery.safe_error_message ? (
        <p className="mt-2 text-xs leading-5 text-warning-700 dark:text-warning-300">
          {toDatasourceBusinessMessage(discovery.safe_error_message)}
        </p>
      ) : null}
      {discovery.databases.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {discovery.databases.slice(0, 8).map((row) => (
            <button
              className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-brand-300 hover:text-brand-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-brand-500 dark:hover:text-brand-300"
              key={`${row.database_name}-${row.code}`}
              onClick={() => onSelectDatabase(row.database_name)}
              type="button"
            >
              {row.database_name}
            </button>
          ))}
          {discovery.databases.length > 8 ? (
            <span className="px-2 py-1.5 text-xs text-gray-500 dark:text-gray-400">
              +{(discovery.databases.length - 8).toLocaleString("th-TH")}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function OwnerTextInput({
  description,
  label,
  onChange,
  placeholder,
  type = "text",
  value,
}: {
  description?: string;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "password";
  value: string;
}) {
  return (
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
      {label}
      <input
        className="mt-1 h-10 w-full rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 dark:border-gray-700 dark:text-white"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        value={value}
      />
      {description ? (
        <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">
          {description}
        </span>
      ) : null}
    </label>
  );
}

function TenantCard({
  item,
  busy,
  selected,
  datasourceTest,
  onSelectTenant,
  onUpdateStatus,
}: {
  item: TenantSummary;
  busy: string | null;
  selected: boolean;
  datasourceTest?: DatasourceTestResult;
  onSelectTenant: (tenantId: string) => void;
  onUpdateStatus: (tenant: Tenant, status: Tenant["status"]) => Promise<void>;
}) {
  const tenant = item.tenant;
  const readiness = getTenantReadiness(item, datasourceTest);
  return (
    <div
      className={`bg-white p-4 transition-colors dark:bg-white/[0.02] ${
        selected
          ? "bg-brand-50/40 dark:bg-brand-500/[0.08]"
          : "hover:bg-gray-50 dark:hover:bg-white/[0.04]"
      }`}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
              {tenant.name}
            </h3>
            <Badge color={tenantStatusTone(tenant.status)}>
              {formatTenantStatus(tenant.status)}
            </Badge>
            <Badge color="light">{tenant.planCode}</Badge>
            <Badge color={readiness.tone}>
              {readiness.label}
            </Badge>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {tenant.id} · ฐานข้อมูล {tenant.databaseName || "ยังไม่ตั้งค่า"}
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {item.access.message}
          </p>

          <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2 2xl:grid-cols-4">
            <CompactFact
              label="SML"
              value={
                datasourceTest
                  ? datasourceTest.ok
                    ? "ทดสอบผ่าน"
                    : "ต้องตรวจ"
                  : item.health.datasource_configured
                    ? "พร้อม"
                    : "ยังไม่พร้อม"
              }
            />
            <CompactFact
              label="LINE"
              value={`${item.health.line_channels} OA · ${item.health.line_targets_enabled}/${item.health.line_targets_total} ปลายทาง`}
            />
            <CompactFact
              label="รายงานล่าสุด"
              value={
                item.health.latest_snapshot_at
                  ? formatDateTime(item.health.latest_snapshot_at)
                  : "ยังไม่มี"
              }
            />
            <CompactFact label="รายงานลูกค้า" value={item.customer_dashboard_path ?? "-"} />
          </dl>
        </div>
        <div className="flex flex-wrap gap-2 xl:max-w-[260px] xl:justify-end">
          <Button
            disabled={selected}
            size="sm"
            variant="outline"
            onClick={() => onSelectTenant(tenant.id)}
          >
            {selected ? "กำลังแก้ไข" : "แก้ไข"}
          </Button>
          {item.customer_dashboard_path ? (
            <Link
              className="inline-flex h-9 items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 shadow-xs hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-white/[0.03]"
              href={item.customer_dashboard_path}
              rel="noreferrer"
              target="_blank"
            >
              เปิดรายงาน
            </Link>
          ) : null}
          <Button
            disabled={busy === `${tenant.id}-active` || tenant.status === "active"}
            size="sm"
            variant="outline"
            onClick={() => void onUpdateStatus(tenant, "active")}
          >
            {tenant.status === "cancelled" ? "เปิดกลับ" : "เปิด"}
          </Button>
          {tenant.status !== "cancelled" ? (
            <Button
              disabled={
                busy === `${tenant.id}-suspended` ||
                tenant.status === "suspended"
              }
              size="sm"
              variant="outline"
              onClick={() => void onUpdateStatus(tenant, "suspended")}
            >
              ระงับ
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SmlConnectionTenantRow({
  datasourceTest,
  item,
  onSelectTenant,
  selected,
}: {
  datasourceTest?: DatasourceTestResult;
  item: SmlConnectionSummary;
  onSelectTenant: (tenantId: string) => void;
  selected: boolean;
}) {
  const datasource = item.datasource;
  const testTone = datasourceTest
    ? datasourceTest.ok
      ? "success"
      : "error"
    : datasourceStatusTone(datasource);
  const modeLabel =
    datasource.kind === "sml_javaws"
      ? `${datasource.base_url ?? "Tomcat"} · ${datasource.config_file_name ?? "SMLConfig"}`
      : datasource.kind
        ? "ต้องตั้งค่า SML JavaWS ใหม่"
        : item.health.datasource_configured
          ? "มี config เดิม, กดเลือกเพื่อตรวจ"
          : "ยังไม่ตั้งค่า";

  return (
    <button
      className={`block w-full px-4 py-4 text-left transition ${
        selected
          ? "bg-brand-50/70 dark:bg-brand-500/[0.08]"
          : "bg-white hover:bg-gray-50 dark:bg-transparent dark:hover:bg-white/[0.03]"
      }`}
      onClick={() => onSelectTenant(item.tenant.id)}
      type="button"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-gray-900 dark:text-white">
              {item.tenant.name}
            </p>
            <Badge color={tenantStatusTone(item.tenant.status)}>
              {formatTenantStatus(item.tenant.status)}
            </Badge>
            <Badge color={datasourceStatusTone(datasource)}>
              {formatDatasourceSource(datasource)}
            </Badge>
          </div>
          <p className="mt-1 break-words text-xs leading-5 text-gray-500 dark:text-gray-400">
            {item.tenant.id} · {modeLabel}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          <Badge color={testTone}>
            {datasourceTest
              ? datasourceTest.ok
                ? `${datasourceTest.latency_ms} ms`
                : "ทดสอบไม่ผ่าน"
              : datasource.kind
                ? formatDatasourceMode(datasource.kind)
                : "ยังไม่ทดสอบ"}
          </Badge>
          <Badge color={item.health.latest_snapshot_at ? "success" : "light"}>
            {item.health.latest_snapshot_at ? "มี snapshot" : "ยังไม่มี snapshot"}
          </Badge>
        </div>
      </div>
    </button>
  );
}

function TenantDetailPanel({
  item,
  busy,
  datasourceConfig,
  datasourceTest,
  onCancelTenant,
  onPreviewTenantDeleteImpact,
  onTestDatasource,
  onUpdateTenant,
  onUpdateStatus,
}: {
  item?: TenantSummary;
  busy: string | null;
  datasourceConfig: DatasourceConfigStatus | null;
  datasourceTest?: DatasourceTestResult;
  onCancelTenant: (
    tenant: Tenant,
    input: { confirmName: string; reason: string },
  ) => Promise<void>;
  onPreviewTenantDeleteImpact: (
    tenantId: string,
  ) => Promise<TenantDeleteImpact | null>;
  onTestDatasource: (tenantId: string, source?: "form" | "saved") => Promise<void>;
  onUpdateTenant: (tenant: Tenant, input: TenantPatchInput) => Promise<void>;
  onUpdateStatus: (tenant: Tenant, status: Tenant["status"]) => Promise<void>;
}) {
  const tenant = item?.tenant;
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPlanCode, setEditPlanCode] =
    useState<Tenant["planCode"]>("starter");
  const [editStatus, setEditStatus] = useState<Tenant["status"]>("trial");
  const [editBusinessSignalsEnabled, setEditBusinessSignalsEnabled] =
    useState(true);
  const [editLineActionDigestV2Enabled, setEditLineActionDigestV2Enabled] =
    useState(false);
  const [
    editLineHeavyReportFallbackEnabled,
    setEditLineHeavyReportFallbackEnabled,
  ] = useState(true);
  const [
    editLineReportFailureIncidentEnabled,
    setEditLineReportFailureIncidentEnabled,
  ] = useState(false);
  const [
    editSmlChunkedHeavyReportsEnabled,
    setEditSmlChunkedHeavyReportsEnabled,
  ] = useState(false);
  const [editDemoModeEnabled, setEditDemoModeEnabled] = useState(false);
  const [editLowGrossMarginPercent, setEditLowGrossMarginPercent] =
    useState("5");
  const [editSalesDropPercent, setEditSalesDropPercent] = useState("20");
  const [editSalesDropAmount, setEditSalesDropAmount] = useState("1000");
  const [editPurchaseConcentrationPercent, setEditPurchaseConcentrationPercent] =
    useState("80");
  const [editMissingBranchAmount, setEditMissingBranchAmount] = useState("0");
  const [editNegativeGrossProfitAmount, setEditNegativeGrossProfitAmount] =
    useState("0");
  const [editNoSalesEnabled, setEditNoSalesEnabled] = useState(true);
  const [editCurrentPeriodEnd, setEditCurrentPeriodEnd] = useState("");
  const [editSuspendedReason, setEditSuspendedReason] = useState("");
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteImpact, setDeleteImpact] = useState<TenantDeleteImpact | null>(
    null,
  );
  const [deleteImpactError, setDeleteImpactError] = useState<string | null>(
    null,
  );
  const [deleteImpactLoading, setDeleteImpactLoading] = useState(false);

  useEffect(() => {
    if (!tenant) {
      return;
    }
    setEditName(tenant.name);
    setEditDescription(tenant.description ?? "");
    setEditPlanCode(tenant.planCode);
    setEditStatus(tenant.status);
    const featureFlags = getTenantUiFeatureFlags(tenant);
    setEditBusinessSignalsEnabled(featureFlags.business_signals_enabled);
    setEditLineActionDigestV2Enabled(featureFlags.line_action_digest_v2_enabled);
    setEditLineHeavyReportFallbackEnabled(
      featureFlags.line_heavy_report_fallback_enabled,
    );
    setEditLineReportFailureIncidentEnabled(
      featureFlags.line_report_failure_incident_enabled,
    );
    setEditSmlChunkedHeavyReportsEnabled(
      featureFlags.sml_chunked_heavy_reports_enabled,
    );
    setEditDemoModeEnabled(featureFlags.demo_mode_enabled);
    const thresholds = getTenantBusinessSignalThresholds(tenant);
    setEditLowGrossMarginPercent(String(thresholds.low_gross_margin_percent));
    setEditSalesDropPercent(String(thresholds.sales_drop_percent));
    setEditSalesDropAmount(String(thresholds.sales_drop_amount));
    setEditPurchaseConcentrationPercent(
      String(thresholds.purchase_concentration_percent),
    );
    setEditMissingBranchAmount(String(thresholds.missing_branch_amount));
    setEditNegativeGrossProfitAmount(
      String(thresholds.negative_gross_profit_amount),
    );
    setEditNoSalesEnabled(thresholds.no_sales_enabled);
    setEditCurrentPeriodEnd(toDatetimeLocalValue(tenant.currentPeriodEnd));
    setEditSuspendedReason(tenant.suspendedReason ?? "");
    setDeleteConfirmName("");
    setDeleteReason("");
    setDeleteImpact(null);
    setDeleteImpactError(null);
  }, [tenant]);

  if (!item) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-500 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-400">
        เลือกร้านค้าเพื่อดูรายละเอียดการตั้งค่า
      </div>
    );
  }

  if (!tenant) {
    return null;
  }

  const savedDatasourceBusy = busy === `datasource-saved-${tenant.id}`;
  const readiness = getTenantReadiness(item, datasourceTest);
  const saveBusy = busy === `${tenant.id}-save`;
  const cancelBusy = busy === `${tenant.id}-cancel`;
  const thresholdValidation = validateTenantThresholdInputs({
    lowGrossMarginPercent: editLowGrossMarginPercent,
    salesDropPercent: editSalesDropPercent,
    salesDropAmount: editSalesDropAmount,
    purchaseConcentrationPercent: editPurchaseConcentrationPercent,
    missingBranchAmount: editMissingBranchAmount,
    negativeGrossProfitAmount: editNegativeGrossProfitAmount,
  });
  const canCancel =
    tenant.status !== "cancelled" &&
    deleteConfirmName.trim() === tenant.name.trim() &&
    (!deleteImpact || deleteImpact.can_cancel);

  async function handlePreviewDeleteImpact() {
    if (!tenant) {
      return;
    }
    setDeleteImpactLoading(true);
    setDeleteImpactError(null);
    try {
      const impact = await onPreviewTenantDeleteImpact(tenant.id);
      setDeleteImpact(impact);
    } catch (error) {
      setDeleteImpactError(
        error instanceof Error
          ? error.message
          : "โหลดผลกระทบก่อนยกเลิกร้านไม่สำเร็จ",
      );
    } finally {
      setDeleteImpactLoading(false);
    }
  }

  async function handleSaveTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenant) {
      return;
    }
    if (!thresholdValidation.ok) {
      return;
    }
    await onUpdateTenant(tenant, {
      name: editName.trim(),
      description: editDescription.trim(),
      plan_code: editPlanCode,
      status: editStatus === "cancelled" ? undefined : editStatus,
      feature_flags: {
        business_signals_enabled: editBusinessSignalsEnabled,
        line_action_digest_v2_enabled: editLineActionDigestV2Enabled,
        line_heavy_report_fallback_enabled:
          editLineHeavyReportFallbackEnabled,
        line_report_failure_incident_enabled:
          editLineReportFailureIncidentEnabled,
        sml_chunked_heavy_reports_enabled:
          editSmlChunkedHeavyReportsEnabled,
        demo_mode_enabled: editDemoModeEnabled,
      },
      business_signal_thresholds: {
        low_gross_margin_percent: thresholdValidation.values.lowGrossMarginPercent,
        sales_drop_percent: thresholdValidation.values.salesDropPercent,
        sales_drop_amount: thresholdValidation.values.salesDropAmount,
        purchase_concentration_percent:
          thresholdValidation.values.purchaseConcentrationPercent,
        missing_branch_amount: thresholdValidation.values.missingBranchAmount,
        negative_gross_profit_amount:
          thresholdValidation.values.negativeGrossProfitAmount,
        no_sales_enabled: editNoSalesEnabled,
      },
      current_period_end: fromDatetimeLocalValue(editCurrentPeriodEnd),
      suspended_reason:
        editStatus === "suspended"
          ? editSuspendedReason.trim() || "ระงับโดย Owner Admin"
          : null,
    });
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-gray-400">
            ร้านที่กำลังจัดการ
          </p>
          <h2 className="mt-1 text-base font-semibold text-gray-900 dark:text-white">
            {tenant.name}
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {tenant.id}
          </p>
        </div>
        <Badge color={tenantStatusTone(tenant.status)}>
          {formatTenantStatus(tenant.status)}
        </Badge>
      </div>

      <form
        className="mt-4 space-y-4 rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]"
        onSubmit={handleSaveTenant}
      >
        <div className="grid gap-3">
          <label className="space-y-1 text-sm">
            <span className="font-medium text-gray-700 dark:text-gray-300">
              ชื่อร้าน
            </span>
            <input
              className="h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              onChange={(event) => setEditName(event.target.value)}
              value={editName}
            />
            <span className="block text-xs leading-5 text-gray-500 dark:text-gray-400">
              ใช้แสดงใน Owner UI, LINE message และ dashboard ลูกค้า
            </span>
          </label>

          <label className="space-y-1 text-sm">
            <span className="font-medium text-gray-700 dark:text-gray-300">
              คำอธิบาย
            </span>
            <textarea
              className="min-h-20 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              onChange={(event) => setEditDescription(event.target.value)}
              placeholder="โน้ตภายใน เช่น contact, branch, สถานะ rollout"
              value={editDescription}
            />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="font-medium text-gray-700 dark:text-gray-300">
              แพ็กเกจ
            </span>
            <select
              className="h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              onChange={(event) =>
                setEditPlanCode(event.target.value as Tenant["planCode"])
              }
              value={editPlanCode}
            >
              <option value="starter">starter</option>
              <option value="business">business</option>
              <option value="pro">pro</option>
            </select>
          </label>

          <label className="space-y-1 text-sm">
            <span className="font-medium text-gray-700 dark:text-gray-300">
              สถานะร้าน
            </span>
            <select
              className="h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              onChange={(event) =>
                setEditStatus(event.target.value as Tenant["status"])
              }
              value={editStatus}
            >
              {tenant.status === "cancelled" ? (
                <option value="cancelled">ยกเลิก</option>
              ) : null}
              <option value="trial">ทดลองใช้</option>
              <option value="active">ใช้งาน</option>
              <option value="past_due">ค้างชำระ</option>
              <option value="suspended">ระงับ</option>
            </select>
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="font-medium text-gray-700 dark:text-gray-300">
              สิ้นสุดรอบปัจจุบัน
            </span>
            <input
              className="h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              onChange={(event) => setEditCurrentPeriodEnd(event.target.value)}
              type="datetime-local"
              value={editCurrentPeriodEnd}
            />
            <span className="block text-xs leading-5 text-gray-500 dark:text-gray-400">
              ใช้ดูรอบ subscription ภายใน ยังไม่ใช่ระบบ billing อัตโนมัติ
            </span>
          </label>

          <label className="space-y-1 text-sm">
            <span className="font-medium text-gray-700 dark:text-gray-300">
              เหตุผลระงับ
            </span>
            <input
              className="h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              disabled={editStatus !== "suspended"}
              onChange={(event) => setEditSuspendedReason(event.target.value)}
              placeholder="ใช้เมื่อสถานะเป็นระงับ"
              value={editSuspendedReason}
            />
          </label>
        </div>

        <div className="grid gap-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900/40">
          <label className="flex min-w-0 gap-3 rounded-lg border border-gray-100 p-3 text-sm dark:border-gray-800">
            <input
              checked={editBusinessSignalsEnabled}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-500"
              onChange={(event) => {
                setEditBusinessSignalsEnabled(event.target.checked);
                if (!event.target.checked) {
                  setEditLineActionDigestV2Enabled(false);
                }
              }}
              type="checkbox"
            />
            <span className="min-w-0">
              <span className="block font-medium text-gray-800 dark:text-gray-200">
                เปิด Business Signals
              </span>
              <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">
                ใช้ rule จากรายงานเพื่อจับยอดตก กำไรรั่ว และคุณภาพข้อมูลของร้านนี้
              </span>
            </span>
          </label>

          <label className="flex min-w-0 gap-3 rounded-lg border border-gray-100 p-3 text-sm dark:border-gray-800">
            <input
              checked={editLineActionDigestV2Enabled}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-500"
              disabled={!editBusinessSignalsEnabled}
              onChange={(event) =>
                setEditLineActionDigestV2Enabled(event.target.checked)
              }
              type="checkbox"
            />
            <span className="min-w-0">
              <span className="block font-medium text-gray-800 dark:text-gray-200">
                ส่ง LINE แบบเรื่องที่ต้องทำ
              </span>
              <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">
                ถ้าเปิด แผนแจ้งเตือนจะส่งเฉพาะ signal สำคัญสูงสุด 3 เรื่องต่อรอบ และ fallback เป็นรายงานเดิมเมื่อไม่มีเรื่องต้องดู
              </span>
            </span>
          </label>

          <label className="flex min-w-0 gap-3 rounded-lg border border-gray-100 p-3 text-sm dark:border-gray-800">
            <input
              checked={editDemoModeEnabled}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-500"
              onChange={(event) => setEditDemoModeEnabled(event.target.checked)}
              type="checkbox"
            />
            <span className="min-w-0">
              <span className="block font-medium text-gray-800 dark:text-gray-200">
                Demo Mode
              </span>
              <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">
                ใช้ติดป้ายข้อมูลตัวอย่างสำหรับงานขายหรือทดสอบ ห้ามใช้แทนข้อมูลร้านจริง
              </span>
            </span>
          </label>

          <label className="flex min-w-0 gap-3 rounded-lg border border-gray-100 p-3 text-sm dark:border-gray-800">
            <input
              checked={editLineHeavyReportFallbackEnabled}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-500"
              onChange={(event) =>
                setEditLineHeavyReportFallbackEnabled(event.target.checked)
              }
              type="checkbox"
            />
            <span className="min-w-0">
              <span className="block font-medium text-gray-800 dark:text-gray-200">
                กันรายงานหนักล้มทั้ง LINE
              </span>
              <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">
                ถ้าสต็อกคงเหลือช้าเกินไป จะส่งรายงานอื่นต่อพร้อมการ์ดแจ้งสถานะ
              </span>
            </span>
          </label>

          <label className="flex min-w-0 gap-3 rounded-lg border border-gray-100 p-3 text-sm dark:border-gray-800">
            <input
              checked={editLineReportFailureIncidentEnabled}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-500"
              onChange={(event) =>
                setEditLineReportFailureIncidentEnabled(event.target.checked)
              }
              type="checkbox"
            />
            <span className="min-w-0">
              <span className="block font-medium text-gray-800 dark:text-gray-200">
                แจ้ง SML ล้มแทนรายงาน
              </span>
              <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">
                ถ้ารอบแจ้งเตือน retry แล้วยังดึง SML ไม่ได้ จะส่ง LINE แจ้งปัญหา server ให้กลุ่มเดิม
              </span>
            </span>
          </label>

          <label className="flex min-w-0 gap-3 rounded-lg border border-gray-100 p-3 text-sm dark:border-gray-800">
            <input
              checked={editSmlChunkedHeavyReportsEnabled}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-500"
              onChange={(event) =>
                setEditSmlChunkedHeavyReportsEnabled(event.target.checked)
              }
              type="checkbox"
            />
            <span className="min-w-0">
              <span className="block font-medium text-gray-800 dark:text-gray-200">
                SML chunked heavy reports
              </span>
              <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">
                เปิดเฉพาะ tenant demo ก่อนเพื่อรันสต็อกและลูกหนี้แบบ async
              </span>
            </span>
          </label>
        </div>

        <details
          className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900/40"
          open={!thresholdValidation.ok || undefined}
        >
          <summary className="cursor-pointer list-none">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                  เกณฑ์แจ้งเตือนขั้นสูง
                </p>
                <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                  ใช้ค่า default ได้ก่อน เปิดเมื่ออยากปรับ signal ต่อร้าน
                </p>
              </div>
              <Badge color="light">ต่อร้าน</Badge>
            </div>
          </summary>

          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <ThresholdInput
              description="ถ้า gross margin ต่ำกว่าค่านี้ ระบบจะเตือนว่ากำไรบางมุมต่ำกว่าปกติ"
              label="Margin ต่ำกว่า (%)"
              max={100}
              min={0}
              onChange={setEditLowGrossMarginPercent}
              value={editLowGrossMarginPercent}
            />
            <ThresholdInput
              description="ถ้ายอดขายลดลงจากวันก่อนหน้าเกินเปอร์เซ็นต์นี้ และเกินยอดขั้นต่ำ จะขึ้น signal"
              label="ยอดขายตก (%)"
              max={100}
              min={0}
              onChange={setEditSalesDropPercent}
              value={editSalesDropPercent}
            />
            <ThresholdInput
              description="ยอดขายตกต้องมากกว่าค่านี้ด้วย เพื่อไม่เตือนเรื่องเล็กเกินไป"
              label="ยอดขายตกขั้นต่ำ (บาท)"
              min={0}
              onChange={setEditSalesDropAmount}
              value={editSalesDropAmount}
            />
            <ThresholdInput
              description="ถ้าผู้จำหน่ายรายเดียวกินสัดส่วนเกินค่านี้ ระบบจะเตือนเรื่องยอดซื้อกระจุก"
              label="ยอดซื้อกระจุก (%)"
              max={100}
              min={0}
              onChange={setEditPurchaseConcentrationPercent}
              value={editPurchaseConcentrationPercent}
            />
            <ThresholdInput
              description="ยอดขายไม่ระบุสาขาต้องมากกว่าค่านี้จึงเตือน ลดเสียงรบกวนจากยอดเล็ก"
              label="ไม่ระบุสาขาขั้นต่ำ (บาท)"
              min={0}
              onChange={setEditMissingBranchAmount}
              value={editMissingBranchAmount}
            />
            <ThresholdInput
              description="0 = ไม่ตั้งขั้นต่ำ ถ้าตั้ง 1,000 จะไม่ส่งกำไรติดลบเล็ก ๆ เข้า LINE"
              label="กำไรติดลบขั้นต่ำ (บาท)"
              min={0}
              onChange={setEditNegativeGrossProfitAmount}
              value={editNegativeGrossProfitAmount}
            />
            <label className="flex min-h-11 min-w-0 gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm dark:border-gray-800 dark:bg-white/[0.02]">
              <input
                checked={editNoSalesEnabled}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-500"
                onChange={(event) => setEditNoSalesEnabled(event.target.checked)}
                type="checkbox"
              />
              <span className="min-w-0">
                <span className="block font-medium text-gray-800 dark:text-gray-200">
                  เตือนเมื่อไม่พบยอดขาย
                </span>
                <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">
                  ใช้กับร้านที่ควรมีการขายทุกวัน ถ้าร้านหยุดบางวันสามารถปิดได้
                </span>
              </span>
            </label>
          </div>
          {!thresholdValidation.ok ? (
            <p className="mt-3 rounded-lg border border-error-200 bg-error-50 px-3 py-2 text-xs leading-5 text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300">
              {thresholdValidation.message}
            </p>
          ) : null}
        </details>

        <div className="flex flex-wrap gap-2">
          <Button
            disabled={saveBusy || !editName.trim() || !thresholdValidation.ok}
            size="sm"
          >
            {saveBusy ? "กำลังบันทึก..." : "บันทึกข้อมูลร้าน"}
          </Button>
          {tenant.status === "cancelled" ? (
            <Button
              disabled={busy === `${tenant.id}-active`}
              size="sm"
              type="button"
              variant="outline"
              onClick={() => void onUpdateStatus(tenant, "active")}
            >
              เปิดใช้งานร้านอีกครั้ง
            </Button>
          ) : null}
        </div>
      </form>

      <dl className="mt-4 divide-y divide-gray-100 rounded-lg border border-gray-100 dark:divide-gray-800 dark:border-gray-800">
        <DetailRow label="แพ็กเกจ" value={tenant.planCode} />
        <DetailRow
          label="Dashboard ลูกค้า"
          value={item.customer_dashboard_path ?? "ยังไม่มี slug"}
        />
        <DetailRow
          label="ฐานข้อมูล SML"
          value={tenant.databaseName || "ยังไม่ระบุ"}
        />
        <DetailRow
          label="สถานะบริการ"
          value={item.access.enabled ? "เปิดใช้งาน" : "ถูกบล็อก"}
        />
      </dl>

      <details className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
        <summary className="cursor-pointer list-none">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                เช็กลิสต์ความพร้อม
              </p>
              <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                เปิดดูเฉพาะตอนเตรียม rollout ร้านนี้
              </p>
            </div>
            <Badge color={readiness.tone}>{readiness.label}</Badge>
          </div>
        </summary>
        <div className="mt-3 grid gap-2">
          {readiness.items.map((check) => (
            <ReadinessRow key={check.label} item={check} />
          ))}
        </div>
      </details>

      <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">
              เชื่อม SML
            </p>
            <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
              กรอก Tomcat URL, port, SMLConfig และ database ผ่านหน้าเชื่อม SML
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              className="inline-flex h-9 items-center justify-center rounded-lg border border-brand-200 bg-brand-50 px-3 text-sm font-semibold text-brand-700 hover:bg-brand-100 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300"
              href={`/owner/sml-connections?tenant=${encodeURIComponent(tenant.id)}`}
            >
              ตั้งค่า SML
            </Link>
            <Button
              disabled={
                savedDatasourceBusy ||
                !datasourceConfig ||
                datasourceConfig.source === "missing"
              }
              size="sm"
              variant="outline"
              onClick={() => void onTestDatasource(tenant.id, "saved")}
            >
              {savedDatasourceBusy ? "กำลังทดสอบ..." : "ทดสอบค่าที่บันทึก"}
            </Button>
          </div>
        </div>
        <DatasourceTestSummary result={datasourceTest} />
      </div>

      <details className="mt-4 rounded-lg border border-error-200 bg-error-50 p-3 dark:border-error-500/30 dark:bg-error-500/10">
        <summary className="cursor-pointer list-none">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-error-700 dark:text-error-300">
                Danger zone: ยกเลิกร้าน
              </p>
              <p className="mt-1 text-xs leading-5 text-error-700/80 dark:text-error-200">
                เปิดเฉพาะเมื่อต้องการ soft delete ร้าน ระบบไม่ลบ snapshot, LINE targets หรือ audit logs
              </p>
            </div>
            <Badge color="error">ต้องยืนยันชื่อร้าน</Badge>
          </div>
        </summary>

        <div className="mt-3 flex justify-end">
          <Button
            disabled={deleteImpactLoading}
            size="sm"
            type="button"
            variant="outline"
            onClick={() => void handlePreviewDeleteImpact()}
          >
            {deleteImpactLoading ? "กำลังตรวจ..." : "ดูผลกระทบ"}
          </Button>
        </div>

        {deleteImpactError ? (
          <p className="mt-3 rounded-lg border border-error-200 bg-white p-3 text-sm text-error-700 dark:border-error-500/30 dark:bg-gray-900 dark:text-error-300">
            {deleteImpactError}
          </p>
        ) : null}

        {deleteImpact ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <HealthFact
              label="แผนแจ้งเตือนที่จะถูกปิด"
              value={`${deleteImpact.notification_rules_enabled}/${deleteImpact.notification_rules_total} แผน`}
            />
            <HealthFact
              label="ผู้รับ LINE ที่เก็บไว้"
              value={`${deleteImpact.line_targets_enabled}/${deleteImpact.line_targets_total} ผู้รับ`}
            />
            <HealthFact
              label="ประวัติรายงานล่าสุด"
              value={
                deleteImpact.latest_snapshot_at
                  ? formatDateTime(deleteImpact.latest_snapshot_at)
                  : "ยังไม่มี snapshot"
              }
            />
            <HealthFact
              label="Dashboard path"
              value={deleteImpact.dashboard_path ?? "ยังไม่มี"}
            />
          </div>
        ) : null}

        {deleteImpact?.blockers.length ? (
          <div className="mt-3 space-y-2">
            {deleteImpact.blockers.map((blocker) => (
              <p
                className="rounded-lg border border-warning-200 bg-warning-50 p-3 text-sm text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-300"
                key={blocker.reason}
              >
                {blocker.message} ({blocker.count})
              </p>
            ))}
          </div>
        ) : null}

        <div className="mt-3 space-y-2">
          <input
            className="h-11 w-full rounded-lg border border-error-200 bg-white px-3 text-sm text-gray-800 dark:border-error-500/30 dark:bg-gray-900 dark:text-white"
            disabled={tenant.status === "cancelled"}
            onChange={(event) => setDeleteConfirmName(event.target.value)}
            placeholder={`พิมพ์ชื่อร้านให้ตรง: ${tenant.name}`}
            value={deleteConfirmName}
          />
          <textarea
            className="min-h-20 w-full rounded-lg border border-error-200 bg-white px-3 py-2 text-sm text-gray-800 dark:border-error-500/30 dark:bg-gray-900 dark:text-white"
            disabled={tenant.status === "cancelled"}
            onChange={(event) => setDeleteReason(event.target.value)}
            placeholder="เหตุผลภายใน เช่น ลูกค้ายกเลิก pilot"
            value={deleteReason}
          />
          <Button
            disabled={cancelBusy || !canCancel}
            size="sm"
            type="button"
            variant="outline"
            onClick={() =>
              void onCancelTenant(tenant, {
                confirmName: deleteConfirmName,
                reason: deleteReason,
              })
            }
          >
            {tenant.status === "cancelled"
              ? "ร้านนี้ถูกยกเลิกแล้ว"
              : cancelBusy
                ? "กำลังยกเลิก..."
                : "ยกเลิกร้าน"}
          </Button>
        </div>
      </details>
    </div>
  );
}

function LineOnboardingGuide({
  publicOrigin,
  tenantName,
}: {
  publicOrigin: string;
  tenantName: string;
}) {
  const webhookUrl = publicOrigin
    ? `${publicOrigin}/api/line/webhook`
    : "/api/line/webhook";

  return (
    <details className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <summary className="cursor-pointer list-none">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-gray-400">
              วิธีเริ่มรับแจ้งเตือนผ่าน LINE OA
            </p>
            <h2 className="mt-1 text-base font-semibold text-gray-900 dark:text-white">
              วิธีให้ {tenantName} เริ่มรับแผนแจ้งเตือน
            </h2>
            <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
              ผู้บริหาร add OA → พิมพ์ test ส่วนตัว → owner อนุมัติสิทธิ์
            </p>
          </div>
          <Badge color="light">ไม่ auto-enable ปลายทางใหม่</Badge>
        </div>
      </summary>

      <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
          Webhook URL สำหรับ trycloudflare รอบนี้
        </p>
        <p className="mt-2 break-all rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-white">
          {webhookUrl}
        </p>
      </div>

      <div className="mt-4 space-y-2">
        {[
          "เพิ่มหรือเลือก LINE OA ของร้านใน LINE Developers",
          "ตั้ง Webhook URL และเปิด Use webhook",
          "ให้ผู้บริหาร add OA เป็นเพื่อน แล้วพิมพ์ test แบบส่วนตัว",
          "ถ้าต้องใช้กลุ่ม ให้ดึง OA เข้ากลุ่มและพิมพ์ test ในกลุ่มนั้น",
          "กลับมาหน้า LINE OA/ผู้รับรายงาน แล้วอนุมัติ profile เช่น ผู้บริหาร หรือฝ่ายขาย",
          "กดส่งทดสอบเฉพาะปลายทางก่อนเปิดแผนแจ้งเตือนประจำวัน",
        ].map((step, index) => (
          <div
            className="flex gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]"
            key={step}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
              {index + 1}
            </span>
            <p className="text-sm leading-6 text-gray-700 dark:text-gray-300">
              {step}
            </p>
          </div>
        ))}
      </div>
    </details>
  );
}

function DatasourceTestSummary({
  result,
}: {
  result?: DatasourceTestResult;
}) {
  if (!result) {
    return (
      <p className="mt-4 rounded-lg border border-dashed border-gray-200 p-3 text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
        ยังไม่ได้ทดสอบในรอบนี้ กด “ทดสอบ SML” เพื่อเช็ค connection จริงจาก server
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge color={result.ok ? "success" : "warning"}>
          {result.ok ? "เชื่อมต่อได้" : "ควรตรวจสอบ"}
        </Badge>
        <Badge color="light">{formatDatasourceMode(result.mode)}</Badge>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          ตรวจล่าสุด {formatDateTime(result.checked_at)} · {result.latency_ms} ms
        </span>
      </div>
      {result.safe_error_message ? (
        <p className="rounded-lg border border-warning-200 bg-warning-50 p-3 text-sm text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-300">
          {toDatasourceBusinessMessage(result.safe_error_message)}
        </p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <HealthFact
          label="Database"
          value={result.database_name ?? "ไม่ทราบชื่อ"}
        />
        <HealthFact
          label="ผู้ใช้"
          value={result.user_name_masked ?? "JavaWS"}
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {Object.entries(result.required_tables).map(([table, ok]) => (
          <div
            className="rounded-lg border border-gray-100 bg-white p-3 text-sm dark:border-gray-800 dark:bg-gray-900"
            key={table}
          >
            <p className="font-semibold text-gray-900 dark:text-white">
              {table}
            </p>
            <p
              className={`mt-1 text-xs ${
                ok ? "text-success-600" : "text-warning-600"
              }`}
            >
              {ok ? "พบตาราง" : "ไม่พบตาราง"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function HealthFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
        {value}
      </p>
    </div>
  );
}

function CompactFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="mt-0.5 truncate font-semibold text-gray-900 dark:text-white">
        {value}
      </dd>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 px-3 py-2.5 text-sm">
      <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="min-w-0 truncate font-semibold text-gray-900 dark:text-white">
        {value}
      </dd>
    </div>
  );
}

function ThresholdInput({
  description,
  label,
  max,
  min,
  onChange,
  value,
}: {
  description: string;
  label: string;
  max?: number;
  min?: number;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="block min-w-0 rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm dark:border-gray-800 dark:bg-white/[0.02]">
      <span className="font-medium text-gray-700 dark:text-gray-300">
        {label}
      </span>
      <input
        className="mt-2 h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
        inputMode="decimal"
        max={max}
        min={min}
        onChange={(event) => onChange(event.target.value)}
        type="number"
        value={value}
      />
      <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">
        {description}
      </span>
    </label>
  );
}

type ReadinessCheck = {
  ok: boolean;
  label: string;
  detail: string;
};

function ReadinessRow({ item }: { item: ReadinessCheck }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
      <div>
        <p className="text-sm font-semibold text-gray-900 dark:text-white">
          {item.label}
        </p>
        <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
          {item.detail}
        </p>
      </div>
      <Badge color={item.ok ? "success" : "warning"}>
        {item.ok ? "พร้อม" : "ต้องทำ"}
      </Badge>
    </div>
  );
}

function BusinessSignalCompactRow({
  onUpdateStatus,
  signal,
}: {
  onUpdateStatus: (
    signal: BusinessSignalRecord,
    status: BusinessSignalRecord["status"],
  ) => Promise<void>;
  signal: BusinessSignalRecord;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-warning-100 bg-white p-3 dark:border-warning-500/20 dark:bg-gray-900/70">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold text-gray-900 dark:text-white">
            {signal.title}
          </p>
          <p className="mt-1 break-words text-xs leading-5 text-gray-600 dark:text-gray-300">
            {signal.insight}
          </p>
        </div>
        <Badge color={businessSignalTone(signal.severity)}>
          {formatBusinessSignalSeverity(signal.severity)}
        </Badge>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span>{formatBusinessSignalCategory(signal.category)}</span>
        <span>·</span>
        <span>{formatOwnerReportLabel(signal.source_report_key)}</span>
        {signal.amount_impact !== null ? (
          <>
            <span>·</span>
            <span>{formatCurrency(signal.amount_impact)}</span>
          </>
        ) : null}
      </div>
      <p className="mt-2 break-words text-xs font-medium leading-5 text-warning-700 dark:text-warning-200">
        ควรทำต่อ: {signal.recommended_action}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className="min-h-9 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
          onClick={() => void onUpdateStatus(signal, "acknowledged")}
          type="button"
        >
          รับทราบ
        </button>
        <button
          className="min-h-9 rounded-lg border border-success-200 bg-success-50 px-3 text-xs font-semibold text-success-700 hover:bg-success-100 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-300"
          onClick={() => void onUpdateStatus(signal, "resolved")}
          type="button"
        >
          แก้แล้ว
        </button>
        <button
          className="min-h-9 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
          onClick={() => void onUpdateStatus(signal, "dismissed")}
          type="button"
        >
          ซ่อนรอบนี้
        </button>
        <Link
          className="inline-flex min-h-9 items-center rounded-lg border border-brand-200 bg-brand-50 px-3 text-xs font-semibold text-brand-700 hover:bg-brand-100 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300"
          href={`/owner/reports?tenant=${encodeURIComponent(
            signal.tenant_id,
          )}&report=${encodeURIComponent(signal.source_report_key)}`}
        >
          เปิดรายงานต้นทาง
        </Link>
      </div>
    </div>
  );
}

function buildFallbackDatasourceStatus(item: TenantSummary): DatasourceConfigStatus {
  return {
    source: "missing",
    kind: null,
    host: null,
    port: null,
    database: item.tenant.databaseName || null,
    user: null,
    password_configured: item.health.datasource_configured,
    base_url: null,
    webapp_path: null,
    endpoint: null,
    config_file_name: null,
    query_method: null,
    auth_mode: null,
    auth_configured: false,
    encryption_configured: false,
    updated_at: null,
  };
}

function matchesSmlConnectionFilter(
  item: SmlConnectionSummary,
  datasourceTest: DatasourceTestResult | undefined,
  filter: SmlConnectionFilter,
) {
  if (filter === "all") {
    return true;
  }
  if (filter === "needs_config") {
    return !item.health.datasource_configured || item.datasource.source === "missing";
  }
  if (filter === "javaws") {
    return item.datasource.kind === "sml_javaws";
  }
  if (filter === "test_failed") {
    return datasourceTest?.ok === false;
  }
  return (
    item.health.datasource_configured &&
    item.datasource.source !== "missing" &&
    datasourceTest?.ok !== false
  );
}

function buildSmlConnectionCounts(
  items: SmlConnectionSummary[],
  datasourceTests: Record<string, DatasourceTestResult>,
): Record<SmlConnectionFilter, number> {
  return SML_CONNECTION_FILTERS.reduce(
    (counts, item) => ({
      ...counts,
      [item.value]: items.filter((row) =>
        matchesSmlConnectionFilter(
          row,
          datasourceTests[row.tenant.id] ?? row.last_test ?? undefined,
          item.value,
        ),
      ).length,
    }),
    {
      all: 0,
      needs_config: 0,
      javaws: 0,
      test_failed: 0,
      ready: 0,
    } satisfies Record<SmlConnectionFilter, number>,
  );
}

function datasourceStatusTone(config: DatasourceConfigStatus | null | undefined) {
  if (!config || config.source === "missing") {
    return "warning" as const;
  }
  if (config.kind && config.kind !== "sml_javaws") {
    return "error" as const;
  }
  if (config.source === "env") {
    return "warning" as const;
  }
  return "success" as const;
}

function formatDatasourceSource(
  config: DatasourceConfigStatus | null | undefined,
) {
  if (!config || config.source === "missing") {
    return "ยังไม่ตั้งค่า";
  }
  if (config.kind && config.kind !== "sml_javaws") {
    return "ต้องตั้ง JavaWS ใหม่";
  }
  if (config.source === "env") {
    return "ค่าเก่า";
  }
  return "บันทึกแล้ว";
}

function parseTomcatBaseUrl(value: string): {
  host: string;
  port: string;
  protocol: "http" | "https";
} {
  const trimmed = value.trim();
  if (!trimmed) {
    return { host: "", port: "", protocol: "http" };
  }

  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol === "https:" ? "https" : "http";
    return {
      host: parsed.hostname,
      port: parsed.port || (protocol === "https" ? "443" : "80"),
      protocol,
    };
  } catch {
    const protocol = trimmed.startsWith("https://") ? "https" : "http";
    const withoutProtocol = trimmed.replace(/^https?:\/\//, "");
    const hostPort = withoutProtocol.split(/[/?#]/)[0] ?? "";
    const [host, port] = hostPort.split(":");
    return {
      host: host ?? "",
      port: port ?? "",
      protocol,
    };
  }
}

function buildTomcatBaseUrl({
  host,
  port,
  protocol,
}: {
  host: string;
  port: string;
  protocol: "http" | "https";
}) {
  const safeHost = host
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/[/?#].*$/, "");
  const safePort = port.trim();

  if (!safeHost) {
    return "";
  }

  return `${protocol}://${safeHost}${safePort ? `:${safePort}` : ""}`;
}

function getTenantReadiness(
  item: TenantSummary,
  datasourceTest?: DatasourceTestResult,
) {
  const hasLineRoute =
    item.health.line_channels > 0 && item.health.line_targets_enabled > 0;
  const checks: ReadinessCheck[] = [
    {
      ok: item.access.enabled,
      label: "Subscription เปิดใช้งาน",
      detail: item.access.enabled
        ? "ลูกค้าเข้า dashboard และ worker ส่ง LINE ได้ตามสิทธิ์"
        : item.access.message,
    },
    {
      ok: datasourceTest ? datasourceTest.ok : item.health.datasource_configured,
      label: "SML JavaWS เชื่อมได้",
      detail: datasourceTest
        ? datasourceTest.ok
          ? `ทดสอบผ่าน ${datasourceTest.latency_ms} ms`
          : toDatasourceBusinessMessage(datasourceTest.safe_error_message)
        : item.health.datasource_configured
          ? "มีค่า JavaWS แล้ว ควรกดทดสอบก่อน rollout"
          : "ยังไม่ได้ตั้งค่า SML JavaWS สำหรับร้านนี้",
    },
    {
      ok: datasourceTest
        ? datasourceTest.required_tables.erp_branch_list
        : item.health.datasource_configured,
      label: "มี branch master",
      detail: datasourceTest
        ? datasourceTest.required_tables.erp_branch_list
          ? "พบ erp_branch_list สำหรับแปลงรหัสสาขาเป็นชื่อสาขา"
          : "ไม่พบ erp_branch_list ระบบจะ fallback เป็นรหัสสาขาจาก SML"
        : "กดทดสอบ SML เพื่อยืนยันตาราง erp_branch_list",
    },
    {
      ok: Boolean(item.health.latest_snapshot_at),
      label: "มีรายงานล่าสุด",
      detail: item.health.latest_snapshot_at
        ? `ล่าสุด ${formatDateTime(item.health.latest_snapshot_at)}`
        : "ยังไม่มี snapshot ให้ลูกค้าดู",
    },
    {
      ok: item.health.line_channels > 0,
      label: "LINE OA ลงทะเบียนแล้ว",
      detail: item.health.line_channels
        ? `${item.health.line_channels} LINE OA`
        : "ยังไม่มี LINE OA metadata สำหรับร้านนี้",
    },
    {
      ok: item.health.line_targets_enabled > 0,
      label: "มีผู้รับ LINE ที่อนุมัติแล้ว",
      detail: `${item.health.line_targets_enabled}/${item.health.line_targets_total} ผู้รับเปิดรับแผนแจ้งเตือน`,
    },
    {
      ok: item.health.notification_rules_enabled > 0,
      label: "มีแผนแจ้งเตือน",
      detail: item.health.notification_rules_enabled
        ? `${item.health.notification_rules_enabled}/${item.health.notification_rules_total} แผนเปิดใช้งาน`
        : "ยังไม่ได้ตั้งว่าจะส่งรายงานอะไร เวลาไหน และให้ปลายทางใด",
    },
    {
      ok: hasLineRoute && item.health.latest_line_delivery_status === "success",
      label: "ส่ง LINE ทดสอบสำเร็จ",
      detail: !hasLineRoute
        ? "ต้องตั้ง LINE OA และอนุมัติผู้รับก่อน จึงค่อยนับผลส่งทดสอบ"
        : item.health.latest_line_delivery_at
        ? `${formatLineDeliveryStatus(item.health.latest_line_delivery_status)} · ${formatDateTime(item.health.latest_line_delivery_at)}`
        : "ยังไม่มี delivery log สำเร็จ",
    },
  ];
  const readyCount = checks.filter((check) => check.ok).length;
  const tone =
    readyCount === checks.length
      ? ("success" as const)
      : readyCount >= 4
        ? ("warning" as const)
        : ("error" as const);

  return {
    items: checks,
    readyCount,
    tone,
    label:
      readyCount === checks.length
        ? "พร้อมใช้งาน"
        : `${readyCount}/${checks.length} พร้อม`,
  };
}

function buildReadinessFromStoreSetup(detail: StoreSetupDetail) {
  const checks = detail.readiness.checks.map((check) => ({
    ok: check.ok,
    label: check.label,
    detail: check.detail,
  }));
  const readyCount = detail.readiness.completed;
  const total = detail.readiness.total || checks.length;
  const tone =
    detail.readiness.ready
      ? ("success" as const)
      : readyCount >= Math.max(1, Math.ceil(total / 2))
        ? ("warning" as const)
        : ("error" as const);

  return {
    items: checks,
    readyCount,
    tone,
    label: detail.readiness.ready ? "พร้อมใช้งาน" : `${readyCount}/${total} พร้อม`,
  };
}

function getStoreSetupNextStep(
  item: TenantSummary,
  checks: ReadinessCheck[],
  detail: StoreSetupDetail | null,
) {
  if (detail?.readiness.next_action) {
    return {
      actionLabel: detail.readiness.next_action.label,
      description: detail.readiness.next_action.detail,
      href: detail.readiness.next_action.href,
    };
  }

  return getTenantNextStep(item, checks);
}

function getTenantNextStep(item: TenantSummary, checks: ReadinessCheck[]) {
  const firstMissing = checks.find((check) => !check.ok);
  if (!firstMissing) {
    return {
      actionLabel: "เปิดรายงานลูกค้า",
      description: "ร้านนี้พร้อมใช้งานแล้ว ตรวจหน้าลูกค้าได้เลย",
      href: item.customer_dashboard_path ?? "/app",
    };
  }

  if (firstMissing.label.includes("Subscription")) {
    return {
      actionLabel: "เปิดร้าน",
      description: "ร้านถูกบล็อกหรือยังไม่เปิดใช้งาน ต้องแก้สถานะก่อน",
      href: "/owner",
    };
  }
  if (firstMissing.label.includes("SML")) {
    return {
      actionLabel: "ตรวจ SML",
      description: "ต้องตั้งค่าและทดสอบ SML JavaWS ก่อนรันรายงานหรือส่งให้ลูกค้า",
      href: `/owner/sml-connections?tenant=${encodeURIComponent(item.tenant.id)}`,
    };
  }
  if (firstMissing.label.includes("รายงาน")) {
    return {
      actionLabel: "รันรายงาน",
      description: "ยังไม่มี snapshot ล่าสุดสำหรับ dashboard และ LINE",
      href: "/owner/reports",
    };
  }
  if (firstMissing.label.includes("LINE")) {
    return {
      actionLabel: "ตั้ง LINE",
      description: "ต้องเพิ่ม LINE OA หรืออนุมัติผู้รับแผนแจ้งเตือน",
      href: "/owner/line",
    };
  }
  if (firstMissing.label.includes("แผนแจ้งเตือน")) {
    return {
      actionLabel: "ตั้งแจ้งเตือน",
      description: "ต้องสร้างแผนแจ้งเตือนก่อนให้ worker ส่งตามเวลา",
      href: `/owner/notifications?tenant=${encodeURIComponent(item.tenant.id)}`,
    };
  }

  return {
    actionLabel: "ดูรายละเอียด",
    description: firstMissing.detail,
    href: "/owner",
  };
}

function formatLineDeliveryStatus(status: string | null) {
  if (status === "success") {
    return "ส่งสำเร็จ";
  }
  if (status === "failed") {
    return "ส่งไม่สำเร็จ";
  }
  if (status === "skipped") {
    return "ข้ามการส่ง";
  }
  return "ยังไม่ทราบสถานะ";
}

function formatNotificationPeriodWithTime(
  dateFrom: string,
  dateTo: string,
  timeFrom?: string | null,
  timeTo?: string | null,
) {
  const startTime = timeFrom ?? "00:00";
  const endTime = timeTo ?? "23:59";
  return `${dateFrom} ${startTime} ถึง ${dateTo} ${endTime}`;
}

function isValidNotificationTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isValidNotificationDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function validateManualNotificationRunSelection(input: {
  scheduledDate: string;
  scheduledTime: string;
  times: string[];
  weekdays: number[];
}): { ok: true } | { ok: false; error: string } {
  if (!isValidNotificationDate(input.scheduledDate)) {
    return { ok: false, error: "กรุณาเลือกวันที่รอบแจ้งเตือน" };
  }
  if (!isValidNotificationTime(input.scheduledTime)) {
    return { ok: false, error: "กรุณาเลือกเวลาแจ้งเตือน" };
  }
  if (!input.times.includes(input.scheduledTime)) {
    return {
      ok: false,
      error: "เวลานี้ไม่ได้อยู่ในรอบเวลาแจ้งเตือนของแผน",
    };
  }
  if (!input.weekdays.includes(isoWeekdayFromYmd(input.scheduledDate))) {
    return { ok: false, error: "วันที่นี้ไม่ได้อยู่ในวันที่ส่งของแผน" };
  }
  return { ok: true };
}

function toBangkokYmd(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isoWeekdayFromYmd(ymd: string) {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function matchesTenantListFilter(
  status: Tenant["status"],
  filter: TenantListFilter,
) {
  if (filter === "all") {
    return true;
  }
  if (filter === "active_flow") {
    return status !== "cancelled";
  }
  return status === filter;
}

function tenantStatusTone(status: Tenant["status"]) {
  if (status === "active" || status === "trial") {
    return "success" as const;
  }
  if (status === "past_due") {
    return "warning" as const;
  }
  if (status === "suspended" || status === "cancelled") {
    return "error" as const;
  }
  return "light" as const;
}

function formatTenantStatus(status: Tenant["status"]) {
  const labels: Record<Tenant["status"], string> = {
    trial: "ทดลองใช้",
    active: "ใช้งาน",
    past_due: "ค้างชำระ",
    suspended: "ระงับ",
    cancelled: "ยกเลิก",
  };
  return labels[status];
}

function getTenantUiFeatureFlags(tenant: Tenant) {
  return {
    business_signals_enabled:
      tenant.featureFlags?.business_signals_enabled ?? true,
    line_action_digest_v2_enabled:
      tenant.featureFlags?.line_action_digest_v2_enabled ?? false,
    line_heavy_report_fallback_enabled:
      tenant.featureFlags?.line_heavy_report_fallback_enabled ?? true,
    line_report_failure_incident_enabled:
      tenant.featureFlags?.line_report_failure_incident_enabled ?? false,
    sml_chunked_heavy_reports_enabled:
      tenant.featureFlags?.sml_chunked_heavy_reports_enabled ?? false,
    demo_mode_enabled: tenant.featureFlags?.demo_mode_enabled ?? false,
  };
}

function getTenantBusinessSignalThresholds(
  tenant: Tenant,
): BusinessSignalThresholdsConfig {
  return {
    low_gross_margin_percent:
      tenant.businessSignalThresholds?.low_gross_margin_percent ?? 5,
    sales_drop_percent: tenant.businessSignalThresholds?.sales_drop_percent ?? 20,
    sales_drop_amount: tenant.businessSignalThresholds?.sales_drop_amount ?? 1000,
    purchase_concentration_percent:
      tenant.businessSignalThresholds?.purchase_concentration_percent ?? 80,
    missing_branch_amount:
      tenant.businessSignalThresholds?.missing_branch_amount ?? 0,
    negative_gross_profit_amount:
      tenant.businessSignalThresholds?.negative_gross_profit_amount ?? 0,
    no_sales_enabled: tenant.businessSignalThresholds?.no_sales_enabled ?? true,
  };
}

function validateTenantThresholdInputs(input: {
  lowGrossMarginPercent: string;
  salesDropPercent: string;
  salesDropAmount: string;
  purchaseConcentrationPercent: string;
  missingBranchAmount: string;
  negativeGrossProfitAmount: string;
}):
  | {
      ok: true;
      values: {
        lowGrossMarginPercent: number;
        salesDropPercent: number;
        salesDropAmount: number;
        purchaseConcentrationPercent: number;
        missingBranchAmount: number;
        negativeGrossProfitAmount: number;
      };
    }
  | { ok: false; message: string } {
  const lowGrossMarginPercent = parseThresholdNumber(
    "Margin ต่ำกว่า (%)",
    input.lowGrossMarginPercent,
    { min: 0, max: 100 },
  );
  const salesDropPercent = parseThresholdNumber(
    "ยอดขายตก (%)",
    input.salesDropPercent,
    { min: 0, max: 100 },
  );
  const salesDropAmount = parseThresholdNumber(
    "ยอดขายตกขั้นต่ำ (บาท)",
    input.salesDropAmount,
    { min: 0 },
  );
  const purchaseConcentrationPercent = parseThresholdNumber(
    "ยอดซื้อกระจุก (%)",
    input.purchaseConcentrationPercent,
    { min: 0, max: 100 },
  );
  const missingBranchAmount = parseThresholdNumber(
    "ไม่ระบุสาขาขั้นต่ำ (บาท)",
    input.missingBranchAmount,
    { min: 0 },
  );
  const negativeGrossProfitAmount = parseThresholdNumber(
    "กำไรติดลบขั้นต่ำ (บาท)",
    input.negativeGrossProfitAmount,
    { min: 0 },
  );
  if (!lowGrossMarginPercent.ok) {
    return { ok: false, message: lowGrossMarginPercent.message };
  }
  if (!salesDropPercent.ok) {
    return { ok: false, message: salesDropPercent.message };
  }
  if (!salesDropAmount.ok) {
    return { ok: false, message: salesDropAmount.message };
  }
  if (!purchaseConcentrationPercent.ok) {
    return { ok: false, message: purchaseConcentrationPercent.message };
  }
  if (!missingBranchAmount.ok) {
    return { ok: false, message: missingBranchAmount.message };
  }
  if (!negativeGrossProfitAmount.ok) {
    return { ok: false, message: negativeGrossProfitAmount.message };
  }
  return {
    ok: true,
    values: {
      lowGrossMarginPercent: lowGrossMarginPercent.value,
      salesDropPercent: salesDropPercent.value,
      salesDropAmount: salesDropAmount.value,
      purchaseConcentrationPercent: purchaseConcentrationPercent.value,
      missingBranchAmount: missingBranchAmount.value,
      negativeGrossProfitAmount: negativeGrossProfitAmount.value,
    },
  };
}

function parseThresholdNumber(
  label: string,
  value: string,
  limits: { min: number; max?: number },
):
  | { ok: true; value: number }
  | { ok: false; message: string } {
  const parsed = Number(value);
  if (!value.trim() || !Number.isFinite(parsed)) {
    return { ok: false, message: `${label} ต้องเป็นตัวเลข` };
  }
  if (parsed < limits.min) {
    return {
      ok: false,
      message: `${label} ต้องไม่น้อยกว่า ${limits.min.toLocaleString("th-TH")}`,
    };
  }
  if (limits.max !== undefined && parsed > limits.max) {
    return {
      ok: false,
      message: `${label} ต้องไม่เกิน ${limits.max.toLocaleString("th-TH")}`,
    };
  }
  return { ok: true, value: parsed };
}

function businessSignalTone(severity: BusinessSignalRecord["severity"]) {
  if (severity === "critical") {
    return "error" as const;
  }
  if (severity === "warning") {
    return "warning" as const;
  }
  return "light" as const;
}

function formatBusinessSignalSeverity(
  severity: BusinessSignalRecord["severity"],
) {
  if (severity === "critical") {
    return "ควรตรวจทันที";
  }
  if (severity === "warning") {
    return "มีข้อสังเกต";
  }
  return "ข้อมูลประกอบ";
}

function formatBusinessSignalStatusAction(
  status: BusinessSignalRecord["status"],
) {
  if (status === "acknowledged") {
    return "รับทราบ";
  }
  if (status === "resolved") {
    return "บันทึกว่าแก้แล้ว";
  }
  if (status === "dismissed") {
    return "ซ่อนรอบนี้";
  }
  return "เปิดกลับ";
}

function formatBusinessSignalCategory(
  category: BusinessSignalRecord["category"],
) {
  const labels: Record<BusinessSignalRecord["category"], string> = {
    sales: "ยอดขาย",
    profit: "กำไร",
    purchase: "ซื้อ/ตั้งหนี้",
    stock: "สต็อก",
    ar: "ลูกหนี้",
    data_quality: "คุณภาพข้อมูล",
  };
  return labels[category];
}

function formatCurrency(value: number) {
  return `${value.toLocaleString("th-TH", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })} บาท`;
}

function formatOwnerReportLabel(reportKey: ReportKey) {
  return getReportCatalogEntry(reportKey).label;
}

function formatReportPeriod(dateFrom: string, dateTo: string) {
  if (dateFrom === dateTo) {
    return dateFrom;
  }
  return `${dateFrom} ถึง ${dateTo}`;
}

function formatQualityStatus(status: SalesGoodsServicesSnapshot["quality_status"]) {
  if (status === "valid") {
    return "พร้อมใช้";
  }
  if (status === "reconciled_with_warning") {
    return "ควรตรวจยอด";
  }
  if (status === "failed") {
    return "ไม่สำเร็จ";
  }
  if (status === "stale") {
    return "ข้อมูลเก่า";
  }
  return "บางส่วน";
}

function formatDatasourceMode(mode: DatasourceKind | null | undefined) {
  if (mode === "sml_javaws") {
    return "Tomcat JavaWS";
  }
  if (mode === "sml_postgres") {
    return "ต้องตั้ง JavaWS ใหม่";
  }
  return "ยังไม่ตั้งค่า";
}

function formatSystemConfigSource(source: SystemConfigStatus["source"] | undefined) {
  if (source === "encrypted_store") {
    return "Encrypted store";
  }
  if (source === "bootstrap_file") {
    return "Bootstrap file";
  }
  return "Env fallback";
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

function toDatetimeLocalValue(value: string | null) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const localOffsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - localOffsetMs).toISOString().slice(0, 16);
}

function fromDatetimeLocalValue(value: string) {
  if (!value.trim()) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function slugifyTenantId(value: string) {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized ? `tenant_${normalized}` : "";
}

function toDatasourceBusinessMessage(value: string | null) {
  if (!value) {
    return "เชื่อมต่อได้";
  }
  if (value.includes("not configured")) {
    return "ยังไม่ได้ตั้งค่า SML JavaWS สำหรับร้านนี้";
  }
  if (value.includes("authentication")) {
    return "ข้อมูล auth ไม่ถูกต้อง กรุณาตรวจ reverse proxy auth ถ้ามี";
  }
  if (value.includes("timed out")) {
    return "ติดต่อ Tomcat JavaWS ช้าเกินเวลาที่กำหนด";
  }
  if (value.includes("unreachable")) {
    return value.includes("JavaWS")
      ? "ติดต่อ Tomcat JavaWS ไม่ได้ กรุณาตรวจ base URL, port Tomcat, VPN หรือ allowlist"
      : "ติดต่อ SML ไม่ได้ กรุณาตรวจ host, port หรือ network/VPN";
  }
  if (value.includes("WSDL operation")) {
    return "ไม่พบ endpoint หรือ SOAP operation กรุณาตรวจ webapp path และ DotNetFrameWork บน Tomcat";
  }
  if (value.includes("unreadable response")) {
    return "JavaWS ตอบกลับอ่านไม่ได้ กรุณาตรวจ config file name, database name และสิทธิ์ query";
  }
  if (value.includes("no database rows")) {
    return "เชื่อม Tomcat ได้ แต่ config file นี้ไม่คืนรายชื่อ database กรุณาตรวจ config file name หรือเลือกกรอก database เอง";
  }
  if (value.includes("required SML tables")) {
    return "เชื่อมต่อได้ แต่ยังไม่พบตาราง SML ที่รายงานนี้ต้องใช้ครบ";
  }
  return "ทดสอบ SML JavaWS ไม่สำเร็จ กรุณาตรวจ Tomcat URL, port, SMLConfig และ database";
}
