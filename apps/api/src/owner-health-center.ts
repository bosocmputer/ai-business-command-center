import {
  getReportCatalogEntry,
  type AiAdvisorRunRecord,
  type AiUsageLedgerRecord,
  type LineDeliveryRecord,
  type MetricSnapshotRecord,
  type NotificationReportResult,
  type NotificationRuleRecord,
  type NotificationRuleRunRecord,
  type ReportRunRecord,
  type Tenant,
  type TenantAiProfileRecord,
  type TenantId,
  type WorkerHeartbeatRecord,
} from "@ai-bcc/shared";

export type OwnerHealthSeverity = "critical" | "warning" | "ok" | "info";

export type OwnerHealthCenterTenantSource = {
  tenant: Tenant;
  datasource_configured: boolean;
  line_targets_total: number;
  line_targets_enabled: number;
  ai_profile: TenantAiProfileRecord | null;
};

export type OwnerHealthCenterInput = {
  now: Date;
  window_hours: 24 | 72 | 168;
  tenants: OwnerHealthCenterTenantSource[];
  worker_heartbeat: WorkerHeartbeatRecord | null;
  notification_rules: NotificationRuleRecord[];
  notification_runs: NotificationRuleRunRecord[];
  line_deliveries: LineDeliveryRecord[];
  report_runs: ReportRunRecord[];
  ai_runs: AiAdvisorRunRecord[];
  ai_usage: AiUsageLedgerRecord[];
  metric_snapshots: MetricSnapshotRecord[];
};

export type OwnerV2HealthCenterPayload = {
  overall: {
    status: OwnerHealthSeverity;
    label: string;
    critical_count: number;
    warning_count: number;
    generated_at: string;
    window_hours: 24 | 72 | 168;
  };
  summary: {
    tenant_count: number;
    tenant_ok_count: number;
    tenant_warning_count: number;
    tenant_critical_count: number;
    line_failed_count: number;
    ai_ceo_warning_count: number;
    worker_stale: boolean;
  };
  tenants: OwnerHealthTenant[];
  incidents: OwnerHealthIncident[];
};

export type OwnerHealthTenant = {
  tenant_id: TenantId;
  tenant_name: string;
  status: OwnerHealthSeverity;
  status_label: string;
  plan_code: Tenant["planCode"];
  line: {
    status: OwnerHealthSeverity;
    label: string;
    enabled_targets: number;
    total_targets: number;
    latest_delivery_at: string | null;
    latest_delivery_status: string | null;
  };
  notification: {
    status: OwnerHealthSeverity;
    label: string;
    enabled_rules: number;
    latest_run_at: string | null;
    latest_run_status: string | null;
    latest_run_mode: string | null;
  };
  ai_ceo: {
    status: OwnerHealthSeverity;
    label: string;
    enabled: boolean;
    latest_run_at: string | null;
    latest_run_status: string | null;
    model_id: string | null;
    window_tokens: number;
    window_cost_usd: number;
    action_hint: string | null;
  };
  reports: {
    status: OwnerHealthSeverity;
    label: string;
    latest_run_at: string | null;
    latest_run_status: string | null;
    failed_count: number;
    warning_count: number;
  };
  datasource: {
    status: OwnerHealthSeverity;
    label: string;
    configured: boolean;
  };
  actions: Array<{
    label: string;
    href: string;
  }>;
};

export type OwnerHealthIncident = {
  id: string;
  severity: Exclude<OwnerHealthSeverity, "ok">;
  severity_label: string;
  tenant_id: TenantId | null;
  tenant_name: string | null;
  title: string;
  detail: string;
  action_label: string;
  action_href: string;
  occurred_at: string | null;
  system_area: "system" | "line" | "notification" | "ai_ceo" | "report" | "datasource";
};

const SUCCESS_LIKE = new Set(["success", "success_with_warnings"]);

export function buildOwnerHealthCenterPayload(
  input: OwnerHealthCenterInput,
): OwnerV2HealthCenterPayload {
  const generatedAt = input.now.toISOString();
  const workerStatus = classifyWorker(input.worker_heartbeat, input.now);
  const incidents: OwnerHealthIncident[] = [];

  if (workerStatus.status === "critical" || workerStatus.status === "warning") {
    incidents.push({
      id: `system-worker-${workerStatus.status}`,
      severity: workerStatus.status,
      severity_label: severityLabel(workerStatus.status),
      tenant_id: null,
      tenant_name: null,
      title: "ระบบประมวลผลรอบแจ้งเตือนมีปัญหา",
      detail: workerStatus.label,
      action_label: "ตรวจระบบ",
      action_href: "/owner-v2/ops",
      occurred_at: input.worker_heartbeat?.checked_at ?? generatedAt,
      system_area: "system",
    });
  }

  const tenants = input.tenants.map((source) => {
    const tenantPayload = buildTenantHealth({
      source,
      input,
      workerStatus: workerStatus.status,
    });
    incidents.push(...tenantPayload.incidents);
    return tenantPayload.tenant;
  });

  const boundedIncidents = sortIncidents(incidents).slice(0, 20);
  const criticalCount = boundedIncidents.filter(
    (incident) => incident.severity === "critical",
  ).length;
  const warningCount = boundedIncidents.filter(
    (incident) => incident.severity === "warning",
  ).length;
  const tenantCriticalCount = tenants.filter(
    (tenant) => tenant.status === "critical",
  ).length;
  const tenantWarningCount = tenants.filter(
    (tenant) => tenant.status === "warning",
  ).length;
  const overallStatus: OwnerHealthSeverity =
    criticalCount > 0 || tenantCriticalCount > 0
      ? "critical"
      : warningCount > 0 || tenantWarningCount > 0
        ? "warning"
        : "ok";

  return {
    overall: {
      status: overallStatus,
      label:
        overallStatus === "critical"
          ? "มีเรื่องต้องแก้"
          : overallStatus === "warning"
            ? "มีเรื่องควรตรวจ"
            : "วันนี้ระบบปกติ",
      critical_count: criticalCount,
      warning_count: warningCount,
      generated_at: generatedAt,
      window_hours: input.window_hours,
    },
    summary: {
      tenant_count: tenants.length,
      tenant_ok_count: tenants.filter((tenant) => tenant.status === "ok").length,
      tenant_warning_count: tenantWarningCount,
      tenant_critical_count: tenantCriticalCount,
      line_failed_count: input.line_deliveries.filter(
        (delivery) =>
          delivery.delivery_type === "notification_rule" &&
          delivery.status === "failed",
      ).length,
      ai_ceo_warning_count: tenants.filter(
        (tenant) => tenant.ai_ceo.status === "warning",
      ).length,
      worker_stale: workerStatus.status === "critical",
    },
    tenants,
    incidents: boundedIncidents,
  };
}

export function explainAiCeoSafeError(
  safeErrorMessage: string | null | undefined,
) {
  const message = safeErrorMessage ?? "";
  if (message.includes("HTTP 402") || message.includes("เครดิต OpenRouter")) {
    return "เครดิต OpenRouter ไม่พอ ให้เติมเครดิตหรือเปลี่ยน API key/model แล้วกด dry-run ทดสอบ";
  }
  if (message.includes("HTTP 429") || message.includes("จำกัดความถี่")) {
    return "OpenRouter จำกัดความถี่ ให้รอ rate limit คลายตัว หรือกระจายรอบส่ง/เปลี่ยน model";
  }
  if (message.includes("รูปแบบ") || message.includes("JSON")) {
    return "AI ตอบรูปแบบไม่ตรง schema ให้ลองเปลี่ยน model หรือปรับ prompt แล้ว dry-run";
  }
  if (message.toLowerCase().includes("timeout") || message.includes("provider")) {
    return "AI provider ตอบช้าหรือ timeout ให้ลองใหม่หรือเปลี่ยน model";
  }
  if (message.includes("API key") || message.includes("ไม่มีสิทธิ์")) {
    return "ตรวจ OpenRouter API key และสิทธิ์ model ในหน้า AI CEO";
  }
  return message.trim()
    ? "AI CEO มีข้อผิดพลาด ให้เปิดหน้า AI CEO เพื่อตรวจ model/key/prompt แล้ว dry-run"
    : null;
}

function buildTenantHealth(input: {
  source: OwnerHealthCenterTenantSource;
  input: OwnerHealthCenterInput;
  workerStatus: OwnerHealthSeverity;
}): { tenant: OwnerHealthTenant; incidents: OwnerHealthIncident[] } {
  const { source } = input;
  const tenantId = source.tenant.id;
  const tenantName = source.tenant.name;
  const rules = input.input.notification_rules.filter(
    (rule) => rule.tenant_id === tenantId,
  );
  const enabledRules = rules.filter((rule) => rule.enabled);
  const notificationRuns = input.input.notification_runs.filter(
    (run) => run.tenant_id === tenantId,
  );
  const lineDeliveries = input.input.line_deliveries.filter(
    (delivery) =>
      delivery.tenant_id === tenantId &&
      delivery.delivery_type === "notification_rule",
  );
  const reportRuns = input.input.report_runs.filter(
    (run) => run.tenant_id === tenantId,
  );
  const aiRuns = input.input.ai_runs.filter((run) => run.tenant_id === tenantId);
  const aiUsage = input.input.ai_usage.filter(
    (usage) => usage.tenant_id === tenantId,
  );
  const metricSnapshots = input.input.metric_snapshots.filter(
    (snapshot) => snapshot.tenant_id === tenantId,
  );

  const latestNotificationRun = latestByTime(notificationRuns, notificationRunTime);
  const latestLineDelivery = latestByTime(lineDeliveries, lineDeliveryTime);
  const latestReportRun = latestByTime(reportRuns, reportRunTime);
  const latestAiRun = latestByTime(aiRuns, aiRunTime);
  const incidents: OwnerHealthIncident[] = [];

  const datasourceStatus: OwnerHealthSeverity = source.datasource_configured
    ? "ok"
    : "critical";
  if (!source.datasource_configured) {
    incidents.push(
      incident({
        id: `${tenantId}-datasource-missing`,
        severity: "critical",
        tenantId,
        tenantName,
        title: "ยังไม่ได้เชื่อมแหล่งข้อมูล SML",
        detail: "ร้านนี้ยังไม่มี datasource ที่พร้อมใช้ จึงเสี่ยงรันรายงานไม่ได้",
        actionLabel: "ตั้งค่า SML",
        actionHref: storePath(tenantId, "sml"),
        occurredAt: input.input.now.toISOString(),
        systemArea: "datasource",
      }),
    );
  }

  const lineStatus = classifyLine({
    enabledTargets: source.line_targets_enabled,
    latestDelivery: latestLineDelivery,
  });
  if (source.line_targets_enabled === 0) {
    incidents.push(
      incident({
        id: `${tenantId}-line-target-missing`,
        severity: "critical",
        tenantId,
        tenantName,
        title: "ยังไม่มีผู้รับ LINE ที่พร้อมส่ง",
        detail: "ต้องมีผู้รับที่อนุมัติและเปิดรับรายงานก่อนรอบแจ้งเตือนจริง",
        actionLabel: "ตั้งค่า LINE",
        actionHref: storePath(tenantId, "line"),
        occurredAt: input.input.now.toISOString(),
        systemArea: "line",
      }),
    );
  } else if (latestLineDelivery?.status === "failed") {
    incidents.push(
      incident({
        id: `${tenantId}-line-delivery-failed-${latestLineDelivery.id}`,
        severity: "critical",
        tenantId,
        tenantName,
        title: "ส่ง LINE ไม่สำเร็จ",
        detail:
          latestLineDelivery.safe_error_message ??
          "รอบล่าสุดมี delivery ที่ส่ง LINE ไม่สำเร็จ",
        actionLabel: "ตรวจแผนแจ้งเตือน",
        actionHref: storePath(tenantId, "notifications"),
        occurredAt: lineDeliveryTime(latestLineDelivery),
        systemArea: "line",
      }),
    );
  }

  const notificationStatus = classifyNotification({
    enabledRules: enabledRules.length,
    latestRun: latestNotificationRun,
  });
  if (enabledRules.length === 0) {
    incidents.push(
      incident({
        id: `${tenantId}-notification-rule-missing`,
        severity: "critical",
        tenantId,
        tenantName,
        title: "ยังไม่มีแผนแจ้งเตือนที่เปิดใช้งาน",
        detail: "ร้านนี้ยังไม่มี schedule สำหรับส่งรายงานผู้บริหารทาง LINE",
        actionLabel: "ตั้งค่าแจ้งเตือน",
        actionHref: storePath(tenantId, "notifications"),
        occurredAt: input.input.now.toISOString(),
        systemArea: "notification",
      }),
    );
  } else if (
    latestNotificationRun?.status === "failed" ||
    latestNotificationRun?.status === "skipped"
  ) {
    incidents.push(
      incident({
        id: `${tenantId}-notification-failed-${latestNotificationRun.id}`,
        severity: "critical",
        tenantId,
        tenantName,
        title: "รอบแจ้งเตือนล่าสุดไม่สำเร็จ",
        detail:
          latestNotificationRun.safe_error_message ??
          "รอบแจ้งเตือนล่าสุดไม่จบเป็นสถานะสำเร็จ",
        actionLabel: "ดูแผนแจ้งเตือน",
        actionHref: storePath(tenantId, "notifications"),
        occurredAt: notificationRunTime(latestNotificationRun),
        systemArea: "notification",
      }),
    );
  } else if (latestNotificationRun?.status === "success_with_warnings") {
    incidents.push(
      incident({
        id: `${tenantId}-notification-warning-${latestNotificationRun.id}`,
        severity: "warning",
        tenantId,
        tenantName,
        title: "รอบแจ้งเตือนสำเร็จแต่มีข้อควรตรวจ",
        detail: "ระบบส่งรายงานได้ แต่มีบางรายงานหรือข้อมูลที่ควรตรวจสอบ",
        actionLabel: "ดูแผนแจ้งเตือน",
        actionHref: storePath(tenantId, "notifications"),
        occurredAt: notificationRunTime(latestNotificationRun),
        systemArea: "notification",
      }),
    );
  }

  const reportClassification = classifyReports({
    latestRun: latestReportRun,
    reportRuns,
    metricSnapshots,
    notificationRuns,
  });
  for (const reportIncident of reportClassification.incidents) {
    incidents.push(
      incident({
        ...reportIncident,
        tenantId,
        tenantName,
        actionHref: storePath(tenantId, "reports"),
      }),
    );
  }

  const aiClassification = classifyAiCeo({
    aiEnabled: Boolean(source.ai_profile?.ai_enabled),
    latestRun: latestAiRun,
    aiUsage,
  });
  if (aiClassification.incident) {
    incidents.push(
      incident({
        ...aiClassification.incident,
        tenantId,
        tenantName,
        actionHref: storePath(tenantId, "ai-ceo"),
      }),
    );
  }

  const tenantStatus = highestSeverity([
    input.workerStatus === "critical" ? "critical" : "ok",
    datasourceStatus,
    lineStatus.status,
    notificationStatus.status,
    reportClassification.status,
    aiClassification.status,
  ]);

  return {
    tenant: {
      tenant_id: tenantId,
      tenant_name: tenantName,
      status: tenantStatus,
      status_label: severityLabel(tenantStatus),
      plan_code: source.tenant.planCode,
      line: {
        status: lineStatus.status,
        label: lineStatus.label,
        enabled_targets: source.line_targets_enabled,
        total_targets: source.line_targets_total,
        latest_delivery_at: latestLineDelivery
          ? lineDeliveryTime(latestLineDelivery)
          : null,
        latest_delivery_status: latestLineDelivery?.status ?? null,
      },
      notification: {
        status: notificationStatus.status,
        label: notificationStatus.label,
        enabled_rules: enabledRules.length,
        latest_run_at: latestNotificationRun
          ? notificationRunTime(latestNotificationRun)
          : null,
        latest_run_status: latestNotificationRun?.status ?? null,
        latest_run_mode: latestNotificationRun?.mode ?? null,
      },
      ai_ceo: {
        status: aiClassification.status,
        label: aiClassification.label,
        enabled: Boolean(source.ai_profile?.ai_enabled),
        latest_run_at: latestAiRun ? aiRunTime(latestAiRun) : null,
        latest_run_status: latestAiRun?.status ?? null,
        model_id: latestAiRun?.model_id ?? source.ai_profile?.selected_model_id ?? null,
        window_tokens: aiClassification.windowTokens,
        window_cost_usd: aiClassification.windowCostUsd,
        action_hint: aiClassification.actionHint,
      },
      reports: {
        status: reportClassification.status,
        label: reportClassification.label,
        latest_run_at: latestReportRun ? reportRunTime(latestReportRun) : null,
        latest_run_status: latestReportRun?.status ?? null,
        failed_count: reportClassification.failedCount,
        warning_count: reportClassification.warningCount,
      },
      datasource: {
        status: datasourceStatus,
        label: source.datasource_configured ? "เชื่อม SML แล้ว" : "ยังไม่ได้เชื่อม SML",
        configured: source.datasource_configured,
      },
      actions: [
        { label: "ตั้งค่า LINE", href: storePath(tenantId, "line") },
        { label: "ตั้งค่า AI CEO", href: storePath(tenantId, "ai-ceo") },
        { label: "ดูแผนแจ้งเตือน", href: storePath(tenantId, "notifications") },
        { label: "ดูรายงาน", href: storePath(tenantId, "reports") },
        { label: "ตรวจระบบร้าน", href: `/owner-v2/stores/${encodeURIComponent(tenantId)}` },
      ],
    },
    incidents,
  };
}

function classifyWorker(
  heartbeat: WorkerHeartbeatRecord | null,
  now: Date,
): { status: OwnerHealthSeverity; label: string } {
  if (!heartbeat) {
    return { status: "critical", label: "ยังไม่พบ heartbeat จากระบบประมวลผล" };
  }
  const ageSeconds = Math.floor(
    (now.getTime() - new Date(heartbeat.checked_at).getTime()) / 1000,
  );
  if (!Number.isFinite(ageSeconds) || ageSeconds < 0 || ageSeconds > 600) {
    return { status: "critical", label: "ระบบประมวลผลเงียบเกิน 10 นาที" };
  }
  if (ageSeconds > 120 || heartbeat.status !== "ok") {
    return { status: "warning", label: "ระบบประมวลผลช้าหรือมีข้อควรตรวจ" };
  }
  return { status: "ok", label: "ระบบประมวลผลทำงานปกติ" };
}

function classifyLine(input: {
  enabledTargets: number;
  latestDelivery: LineDeliveryRecord | null;
}) {
  if (input.enabledTargets <= 0) {
    return { status: "critical" as const, label: "ยังไม่มีผู้รับพร้อมส่ง" };
  }
  if (input.latestDelivery?.status === "failed") {
    return { status: "critical" as const, label: "ส่ง LINE ล่าสุดไม่สำเร็จ" };
  }
  if (input.latestDelivery?.status === "success") {
    return { status: "ok" as const, label: "ส่ง LINE ล่าสุดสำเร็จ" };
  }
  return { status: "info" as const, label: "ยังไม่มี delivery ในช่วงนี้" };
}

function classifyNotification(input: {
  enabledRules: number;
  latestRun: NotificationRuleRunRecord | null;
}) {
  if (input.enabledRules <= 0) {
    return { status: "critical" as const, label: "ยังไม่มีแผนเปิดใช้งาน" };
  }
  if (input.latestRun?.status === "failed" || input.latestRun?.status === "skipped") {
    return { status: "critical" as const, label: "รอบล่าสุดไม่สำเร็จ" };
  }
  if (input.latestRun?.status === "success_with_warnings") {
    return { status: "warning" as const, label: "สำเร็จแต่มีข้อควรตรวจ" };
  }
  if (input.latestRun?.status === "success") {
    return { status: "ok" as const, label: "รอบล่าสุดสำเร็จ" };
  }
  return { status: "info" as const, label: "ยังไม่มีรอบในช่วงนี้" };
}

function classifyReports(input: {
  latestRun: ReportRunRecord | null;
  reportRuns: ReportRunRecord[];
  metricSnapshots: MetricSnapshotRecord[];
  notificationRuns: NotificationRuleRunRecord[];
}) {
  const failedRuns = input.reportRuns.filter((run) => run.status === "failed");
  const warningMetricSnapshots = input.metricSnapshots.filter((snapshot) =>
    ["partial", "reconciled_with_warning", "stale"].includes(
      snapshot.quality_status,
    ),
  );
  const warningResults = input.notificationRuns.flatMap((run) =>
    (run.report_results ?? []).filter((result) =>
      reportResultHasWarning(result),
    ),
  );
  const warningCount = warningMetricSnapshots.length + warningResults.length;
  const incidents: Array<Omit<IncidentInput, "tenantId" | "tenantName">> = [];

  if (failedRuns.length) {
    const failedRun = failedRuns[0];
    incidents.push({
      id: `report-failed-${failedRun.id}`,
      severity: "critical",
      title: "มีรายงานรันไม่สำเร็จ",
      detail:
        failedRun.safe_error_message ??
        `${reportLabel(failedRun.report_key)} รันไม่สำเร็จในช่วงที่เลือก`,
      actionLabel: "ดูรายงาน",
      actionHref: "",
      occurredAt: reportRunTime(failedRun),
      systemArea: "report",
    });
  }

  if (warningCount > 0) {
    const firstWarning = warningMetricSnapshots[0] ?? null;
    const firstWarningResult = warningResults[0] ?? null;
    const title = firstWarningResult
      ? `${reportLabel(firstWarningResult.report_key)} มีข้อควรตรวจ`
      : "รายงานมีข้อควรตรวจ";
    incidents.push({
      id: `report-warning-${firstWarning?.id ?? firstWarningResult?.run_id ?? "latest"}`,
      severity: "warning",
      title,
      detail: "ระบบส่งรายงานได้ แต่คุณภาพข้อมูลหรือการ reconcile มีข้อควรตรวจ",
      actionLabel: "ดูรายงาน",
      actionHref: "",
      occurredAt: firstWarning?.created_at ?? null,
      systemArea: "report",
    });
  }

  if (failedRuns.length) {
    return {
      status: "critical" as const,
      label: "มีรายงานล้มเหลว",
      failedCount: failedRuns.length,
      warningCount,
      incidents,
    };
  }
  if (warningCount > 0 || input.latestRun?.status === "running") {
    return {
      status: "warning" as const,
      label: warningCount > 0 ? "มีรายงานควรตรวจ" : "รายงานกำลังรัน",
      failedCount: 0,
      warningCount,
      incidents,
    };
  }
  if (input.latestRun?.status === "success") {
    return {
      status: "ok" as const,
      label: "รายงานล่าสุดสำเร็จ",
      failedCount: 0,
      warningCount: 0,
      incidents,
    };
  }
  return {
    status: "info" as const,
    label: "ยังไม่มีรายงานในช่วงนี้",
    failedCount: 0,
    warningCount: 0,
    incidents,
  };
}

function classifyAiCeo(input: {
  aiEnabled: boolean;
  latestRun: AiAdvisorRunRecord | null;
  aiUsage: AiUsageLedgerRecord[];
}) {
  const windowTokens = input.aiUsage.reduce(
    (total, item) => total + item.input_tokens + item.output_tokens,
    0,
  );
  const windowCostUsd = input.aiUsage.reduce(
    (total, item) => total + item.cost_estimate_usd,
    0,
  );

  if (!input.aiEnabled) {
    return {
      status: "info" as const,
      label: "ยังไม่ได้เปิด AI CEO",
      windowTokens,
      windowCostUsd,
      actionHint: null,
      incident: null,
    };
  }

  const actionHint = explainAiCeoSafeError(input.latestRun?.safe_error_message);
  if (
    input.latestRun?.safe_error_message ||
    (input.latestRun &&
      input.latestRun.status !== "success" &&
      input.latestRun.status !== "success_with_warnings")
  ) {
    return {
      status: "warning" as const,
      label: "AI CEO มีข้อควรตรวจ",
      windowTokens,
      windowCostUsd,
      actionHint,
      incident: {
        id: `ai-ceo-warning-${input.latestRun?.id ?? "latest"}`,
        severity: "warning" as const,
        title: "AI CEO มีข้อควรตรวจ",
        detail:
          actionHint ??
          "AI CEO ไม่ได้จบรอบล่าสุดแบบสำเร็จ แต่รายงาน LINE ยังสามารถส่งต่อได้",
        actionLabel: "ตั้งค่า AI CEO",
        actionHref: "",
        occurredAt: input.latestRun ? aiRunTime(input.latestRun) : null,
        systemArea: "ai_ceo" as const,
      },
    };
  }

  if (input.latestRun?.status === "success_with_warnings") {
    return {
      status: "warning" as const,
      label: "AI CEO สำเร็จพร้อมข้อสังเกต",
      windowTokens,
      windowCostUsd,
      actionHint: null,
      incident: {
        id: `ai-ceo-warning-${input.latestRun.id}`,
        severity: "warning" as const,
        title: "AI CEO สำเร็จพร้อมข้อสังเกต",
        detail: "AI CEO สร้างคำแนะนำได้ แต่มีข้อควรตรวจในรอบล่าสุด",
        actionLabel: "ตั้งค่า AI CEO",
        actionHref: "",
        occurredAt: aiRunTime(input.latestRun),
        systemArea: "ai_ceo" as const,
      },
    };
  }

  return {
    status: input.latestRun ? ("ok" as const) : ("info" as const),
    label: input.latestRun ? "AI CEO ทำงานปกติ" : "ยังไม่มีรอบ AI CEO ในช่วงนี้",
    windowTokens,
    windowCostUsd,
    actionHint: null,
    incident: null,
  };
}

function reportResultHasWarning(result: NotificationReportResult) {
  return (
    result.status === "success_with_warning" ||
    Boolean(result.degraded_reason?.trim())
  );
}

function incident(input: IncidentInput): OwnerHealthIncident {
  return {
    id: input.id,
    severity: input.severity,
    severity_label: severityLabel(input.severity),
    tenant_id: input.tenantId,
    tenant_name: input.tenantName,
    title: stripTechnicalText(input.title),
    detail: stripTechnicalText(input.detail),
    action_label: input.actionLabel,
    action_href: input.actionHref,
    occurred_at: input.occurredAt,
    system_area: input.systemArea,
  };
}

type IncidentInput = {
  id: string;
  severity: Exclude<OwnerHealthSeverity, "ok">;
  tenantId: TenantId | null;
  tenantName: string | null;
  title: string;
  detail: string;
  actionLabel: string;
  actionHref: string;
  occurredAt: string | null;
  systemArea: OwnerHealthIncident["system_area"];
};

function highestSeverity(values: OwnerHealthSeverity[]): OwnerHealthSeverity {
  if (values.includes("critical")) {
    return "critical";
  }
  if (values.includes("warning")) {
    return "warning";
  }
  if (values.includes("ok")) {
    return "ok";
  }
  return "info";
}

function severityLabel(severity: OwnerHealthSeverity) {
  if (severity === "critical") {
    return "ต้องแก้";
  }
  if (severity === "warning") {
    return "ควรตรวจ";
  }
  if (severity === "ok") {
    return "ปกติ";
  }
  return "ข้อมูล";
}

function sortIncidents(incidents: OwnerHealthIncident[]) {
  const severityScore: Record<OwnerHealthIncident["severity"], number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };
  return [...incidents].sort((left, right) => {
    const severityDiff = severityScore[left.severity] - severityScore[right.severity];
    if (severityDiff !== 0) {
      return severityDiff;
    }
    return (right.occurred_at ?? "").localeCompare(left.occurred_at ?? "");
  });
}

function latestByTime<T>(items: T[], getTime: (item: T) => string | null) {
  return [...items]
    .filter((item) => Boolean(getTime(item)))
    .sort((left, right) => (getTime(right) ?? "").localeCompare(getTime(left) ?? ""))[0] ?? null;
}

function notificationRunTime(run: NotificationRuleRunRecord) {
  return run.finished_at ?? run.started_at ?? run.queued_at ?? run.created_at;
}

function lineDeliveryTime(delivery: LineDeliveryRecord) {
  return delivery.sent_at ?? delivery.created_at;
}

function reportRunTime(run: ReportRunRecord) {
  return run.finished_at ?? run.started_at ?? run.queued_at ?? null;
}

function aiRunTime(run: AiAdvisorRunRecord) {
  return run.finished_at ?? run.started_at ?? run.created_at;
}

function reportLabel(reportKey: ReportRunRecord["report_key"]) {
  return getReportCatalogEntry(reportKey).shortLabel;
}

function storePath(tenantId: TenantId, page: string) {
  return `/owner-v2/stores/${encodeURIComponent(tenantId)}/${page}`;
}

function stripTechnicalText(value: string) {
  return value
    .replace(/\b[a-z]+(?:_[a-z0-9]+)+\b/g, "รายการระบบ")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "ค่าระบบ")
    .trim();
}
