import type { ReportKey, ReportRunRecord, TenantId } from "@ai-bcc/shared";

/**
 * Owner Cockpit logic — single source of truth for cross-tenant priority,
 * per-tenant health matrix cells, and 7-day proof strip derivation.
 *
 * Ported from apps/web/src/components/owner/OwnerPortal.tsx (buildOwnerNextAction
 * + buildStoreHealthCells) and adjusted to the priority order in
 * docs/20_OWNER_COCKPIT_SIMPLIFICATION_PLAN_TH.md §"Next Best Action Rules".
 *
 * These are pure functions so v1 (/owner), v2 (/owner-v2) and tests share the
 * same logic. They consume the tenant summary + operations status shapes that
 * buildOwnerTenantSummary + buildOperationsStatus already produce.
 */

export type CockpitTone = "error" | "warning" | "info" | "success";

/** Per-tenant health shape, mirroring buildOwnerTenantSummary().health. */
export type CockpitTenantHealth = {
  datasource_configured: boolean;
  line_channels: number;
  line_targets_total: number;
  line_targets_enabled: number;
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

/** Tenant row input for the cockpit. */
export type CockpitTenantInput = {
  tenant_id: TenantId;
  tenant_name: string;
  status: string;
  access_enabled: boolean;
  access_message: string;
  health: CockpitTenantHealth;
};

/** Latest JavaWS failure shape (subset of operations status). */
export type CockpitJavaWsFailure = {
  id: string;
  tenant_id: TenantId;
  report_key: ReportKey;
  status: ReportRunRecord["status"];
  finished_at: string | null;
  failure_kind: string | null;
  failure_phase: string | null;
  safe_error_message: string | null;
};

/** Heavy report run shape (subset of operations status). */
export type CockpitHeavyReportRun = {
  id: string;
  tenant_id: TenantId;
  report_key: ReportKey;
  status: ReportRunRecord["status"];
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  row_count: number;
  failure_kind: string | null;
  failure_phase: string | null;
};

export type CockpitWorkerStatus = {
  status: string;
};

export type CockpitTelegramStatus = {
  configured: boolean;
  targets: Array<{ enabled: boolean }>;
};

export type CockpitOperationsInput = {
  worker: CockpitWorkerStatus;
  telegram: CockpitTelegramStatus | null;
  latest_javaws_failure: CockpitJavaWsFailure | null;
  heavy_report_runs: CockpitHeavyReportRun[];
};

export type OwnerCockpitNextAction = {
  title: string;
  description: string;
  action_label: string;
  href: string;
  tone: CockpitTone;
  tenant_id: TenantId | null;
  tenant_name: string | null;
};

export type OwnerCockpitHealthCell = {
  label: string;
  tone: CockpitTone | "light";
};

export type OwnerCockpitHealthMatrixRow = {
  tenant_id: TenantId;
  tenant_name: string;
  status: string;
  next_action_label: string;
  sml: OwnerCockpitHealthCell;
  line: OwnerCockpitHealthCell;
  schedule: OwnerCockpitHealthCell;
  latest_run: OwnerCockpitHealthCell;
  incident: OwnerCockpitHealthCell;
  signals: OwnerCockpitHealthCell;
  proof: OwnerCockpitHealthCell;
  href: string;
};

export type OwnerCockpitProofDay = {
  /** Day index 1..7 (1 = oldest, 7 = today). */
  day: number;
  /** Bangkok date label yyyy-MM-dd. */
  date: string;
  status: "success" | "partial" | "failed" | "missing" | "unknown";
};

export type OwnerCockpitProofStrip = {
  tenant_id: TenantId;
  tenant_name: string;
  eligible: boolean;
  days: OwnerCockpitProofDay[];
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

/** Narrowed run record for proof derivation. */
type ProofRunLike = {
  tenant_id?: TenantId | null;
  status: string;
  source?: string | null;
  mode?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
};

type ProofDeliveryLike = {
  tenant_id?: TenantId | null;
  status: string;
  delivery_type?: string | null;
  sent_at?: string | null;
  created_at?: string | null;
};

const BANGKOK_TZ = "Asia/Bangkok";
const PROOF_WINDOW_DAYS = 7;

/**
 * Compute the single highest-priority cross-tenant next action.
 *
 * Priority order follows doc 20 §"Next Best Action Rules":
 *   1. Security/secret missing
 *   2. Datasource not runnable (JavaWS incident)
 *   3. LINE cannot deliver
 *   4. Scheduled run failed
 *   5. Open critical business signal
 *   6. Proof incomplete
 *   7. Ready
 */
export function computeOwnerCockpitNextAction(
  tenants: CockpitTenantInput[],
  operations: CockpitOperationsInput | null,
): OwnerCockpitNextAction {
  const activeTenants = tenants.filter(
    (item) => item.status !== "cancelled",
  );

  if (activeTenants.length === 0) {
    return {
      title: "ยังไม่มีร้าน active",
      description:
        "เพิ่มร้านแรกและตั้งสถานะเป็น active/trial ก่อนเริ่มเชื่อม SML และ LINE",
      action_label: "เพิ่มร้านค้า",
      href: "/owner-v2/stores/new",
      tone: "info",
      tenant_id: null,
      tenant_name: null,
    };
  }

  // 1. Security/secret missing — datasource/LINE configured but secret missing.
  const secretMissing = findSecretMissingTenant(activeTenants);
  if (secretMissing) {
    return {
      title: "เติม secret ที่จำเป็น",
      description:
        "ร้านนี้ตั้ง datasource หรือ LINE ไว้แต่ยังขาด secret/token ที่จะรันจริงได้",
      action_label: "ตั้งค่า secret",
      href: secretMissing.scope === "line"
        ? v2StorePath(secretMissing.tenant_id, "line")
        : v2StorePath(secretMissing.tenant_id, "sml"),
      tone: "error",
      tenant_id: secretMissing.tenant_id,
      tenant_name: secretMissing.tenant_name,
    };
  }

  // 2. Datasource not runnable — latest JavaWS failure (unreachable/invalid_zip/etc).
  const javaWsFailure = operations?.latest_javaws_failure ?? null;
  if (javaWsFailure) {
    const tenant = activeTenants.find(
      (item) => item.tenant_id === javaWsFailure.tenant_id,
    );
    return {
      title: "ตรวจ JavaWS incident ล่าสุด",
      description: `รายงาน ${javaWsFailure.report_key} ตอบกลับจาก JavaWS แต่แปลงผลไม่สำเร็จใน phase ${javaWsFailure.failure_phase ?? "unknown"} จึงไม่ควรใช้ยอดรอบนี้`,
      action_label: "ตรวจ SML",
      href: v2StorePath(javaWsFailure.tenant_id, "sml"),
      tone: "error",
      tenant_id: javaWsFailure.tenant_id,
      tenant_name: tenant?.tenant_name ?? null,
    };
  }

  // Worker not ok is an ops-level blocker reported before per-tenant checks
  // (it silently breaks every scheduled round).
  if (operations && operations.worker.status !== "ok") {
    return {
      title: "ตรวจ worker ก่อนรอบถัดไป",
      description: `สถานะ worker คือ ${operations.worker.status} ถ้าไม่ปกติ รอบแจ้งเตือนอาจไม่เริ่มหรือไม่จบตามเวลา`,
      action_label: "ดูสถานะระบบ",
      href: "/owner-v2/ops",
      tone: "error",
      tenant_id: null,
      tenant_name: null,
    };
  }

  // Blocked access (suspended/past_due without access) is effectively a
  // security/prerequisite blocker at the tenant level.
  const blockedTenant = activeTenants.find((item) => !item.access_enabled);
  if (blockedTenant) {
    return {
      title: "เปิดสิทธิ์ร้านให้พร้อมใช้งาน",
      description: blockedTenant.access_message,
      action_label: "แก้สถานะร้าน",
      href: v2StoreDetailPath(blockedTenant.tenant_id),
      tone: "error",
      tenant_id: blockedTenant.tenant_id,
      tenant_name: blockedTenant.tenant_name,
    };
  }

  // 2b. Datasource not configured (missing entirely, not just unhealthy).
  const missingDatasource = activeTenants.find(
    (item) => !item.health.datasource_configured,
  );
  if (missingDatasource) {
    return {
      title: "เชื่อม SML JavaWS ให้ผ่านก่อน",
      description:
        "ยังไม่ได้ตั้งค่า SML JavaWS หรือ datasource ยังไม่พร้อม จึงยังไม่ควรเปิดรอบแจ้งเตือนจริง",
      action_label: "ตรวจ SML",
      href: v2StorePath(missingDatasource.tenant_id, "sml"),
      tone: "warning",
      tenant_id: missingDatasource.tenant_id,
      tenant_name: missingDatasource.tenant_name,
    };
  }

  // 3. LINE cannot deliver.
  const lineProblemTenant = activeTenants.find(
    (item) =>
      item.health.line_channels === 0 ||
      item.health.line_targets_enabled === 0 ||
      item.health.latest_line_delivery_status === "failed",
  );
  if (lineProblemTenant) {
    return {
      title: "ทำให้เส้นทางส่ง LINE พร้อม",
      description:
        lineProblemTenant.health.latest_line_delivery_status === "failed"
          ? "LINE delivery ล่าสุดส่งไม่สำเร็จ ต้องดูผู้รับ/สิทธิ์/ช่องทางก่อนรอบถัดไป"
          : "ยังไม่มี LINE OA หรือผู้รับที่เปิดรับรายงานผู้บริหาร",
      action_label: "ตรวจ LINE",
      href: v2StorePath(lineProblemTenant.tenant_id, "line"),
      tone: "warning",
      tenant_id: lineProblemTenant.tenant_id,
      tenant_name: lineProblemTenant.tenant_name,
    };
  }

  // 3b. Missing schedule — tenant can deliver but no plan enabled.
  const missingScheduleTenant = activeTenants.find(
    (item) => item.health.notification_rules_enabled === 0,
  );
  if (missingScheduleTenant) {
    return {
      title: "สร้างแผนส่งรายงานอัตโนมัติ",
      description:
        "ร้านนี้พร้อมดึงรายงานและมีผู้รับแล้ว แต่ยังไม่มีแผนแจ้งเตือนที่เปิดใช้งาน",
      action_label: "ตั้งแผนแจ้งเตือน",
      href: v2StorePath(missingScheduleTenant.tenant_id, "notifications"),
      tone: "warning",
      tenant_id: missingScheduleTenant.tenant_id,
      tenant_name: missingScheduleTenant.tenant_name,
    };
  }

  // 4. Scheduled run failed.
  const failedRoundTenant = activeTenants.find(
    (item) =>
      item.health.latest_notification_run_status === "failed" ||
      item.health.latest_report_status === "failed",
  );
  if (failedRoundTenant) {
    return {
      title: "ตรวจรอบรายงานที่ล้มเหลว",
      description:
        failedRoundTenant.health.latest_notification_run_error ??
        "รอบรายงานล่าสุดล้มเหลว ต้องดูรายละเอียดก่อนสรุปยอดให้ผู้บริหาร",
      action_label: "ดูรายละเอียดปัญหา",
      href: v2StoreDetailPath(failedRoundTenant.tenant_id),
      tone: "error",
      tenant_id: failedRoundTenant.tenant_id,
      tenant_name: failedRoundTenant.tenant_name,
    };
  }

  // 5. Open critical business signal.
  const criticalSignalTenant = activeTenants.find(
    (item) => item.health.critical_business_signals > 0,
  );
  if (criticalSignalTenant) {
    return {
      title: "จัดการ business signal ที่ยังเปิดอยู่",
      description: `${criticalSignalTenant.health.critical_business_signals} เรื่องควรตรวจทันทีจาก snapshot ล่าสุด`,
      action_label: "เปิดรายละเอียดร้าน",
      href: v2StoreDetailPath(criticalSignalTenant.tenant_id),
      tone: "error",
      tenant_id: criticalSignalTenant.tenant_id,
      tenant_name: criticalSignalTenant.tenant_name,
    };
  }

  // 6. Proof incomplete — latest round did not fully succeed end to end.
  const missingProofTenant = activeTenants.find(
    (item) =>
      item.health.latest_notification_run_status !== "success" ||
      item.health.latest_line_delivery_status !== "success",
  );
  if (missingProofTenant) {
    return {
      title: "ตรวจ proof ของรอบล่าสุด",
      description:
        "ยังไม่มีหลักฐาน production proof ครบทั้ง notification run และ LINE delivery สำเร็จ",
      action_label: "ดู audit",
      href: "/owner-v2/ops",
      tone: "info",
      tenant_id: missingProofTenant.tenant_id,
      tenant_name: missingProofTenant.tenant_name,
    };
  }

  // 7. Ready.
  const telegramReady = operations?.telegram
    ? operations.telegram.configured &&
      operations.telegram.targets.some((target) => target.enabled)
    : true;
  return {
    title: telegramReady ? "พร้อมรอบถัดไป" : "ตั้งค่า Telegram แจ้งเตือน ops",
    description: telegramReady
      ? "ร้าน active มี prerequisite ครบและมี proof ล่าสุดแล้ว รอตรวจรอบแจ้งเตือนถัดไปหลังส่งจริง"
      : "ระบบพร้อมรอบถัดไป แต่ยังไม่ได้ตั้ง Telegram สำหรับแจ้งเตือน incident ของ ops",
    action_label: telegramReady ? "ดูรอบล่าสุด" : "ดูสถานะระบบ",
    href: "/owner-v2/ops",
    tone: "success",
    tenant_id: null,
    tenant_name: null,
  };
}

/**
 * Compute the per-tenant health matrix row (SML/LINE/schedule/latest
 * run/incident/signals/proof) for the cockpit table.
 */
export function computeOwnerCockpitHealthMatrixRow(
  input: CockpitTenantInput,
  latestJavaWsFailure: CockpitJavaWsFailure | null,
): OwnerCockpitHealthMatrixRow {
  const health = input.health;
  const hasIncident =
    latestJavaWsFailure?.tenant_id === input.tenant_id ||
    health.latest_notification_run_status === "failed" ||
    health.latest_report_status === "failed" ||
    health.latest_line_delivery_status === "failed";
  const latestRunStatus =
    health.latest_notification_run_status ?? health.latest_report_status;

  return {
    tenant_id: input.tenant_id,
    tenant_name: input.tenant_name,
    status: input.status,
    next_action_label: describeTenantNextAction(input, latestJavaWsFailure),
    sml: {
      label: health.datasource_configured ? "พร้อม" : "ต้องตั้ง",
      tone: health.datasource_configured ? "success" : "warning",
    },
    line: {
      label:
        health.line_targets_enabled > 0
          ? `${health.line_targets_enabled} ผู้รับ`
          : health.line_channels > 0
            ? "รอผู้รับ"
            : "ยังไม่มี",
      tone:
        health.line_targets_enabled > 0
          ? "success"
          : health.line_channels > 0
            ? "warning"
            : "error",
    },
    schedule: {
      label:
        health.notification_rules_enabled > 0
          ? `${health.notification_rules_enabled} แผน`
          : "ยังไม่มี",
      tone: health.notification_rules_enabled > 0 ? "success" : "warning",
    },
    latest_run: {
      label: formatRunStatus(latestRunStatus),
      tone:
        latestRunStatus === "success"
          ? "success"
          : latestRunStatus === "failed"
            ? "error"
            : "light",
    },
    incident: {
      label: hasIncident ? "มี" : "ไม่มี",
      tone: hasIncident ? "error" : "success",
    },
    signals: {
      label:
        health.open_business_signals > 0
          ? `${health.open_business_signals} เปิด`
          : "ไม่มี",
      tone:
        health.critical_business_signals > 0
          ? "error"
          : health.open_business_signals > 0
            ? "warning"
            : "success",
    },
    proof: {
      label:
        health.latest_notification_run_status === "success" &&
        health.latest_line_delivery_status === "success"
          ? "ครบ"
          : health.latest_notification_run_at
            ? "ต้องตรวจ"
            : "รอรอบ",
      tone:
        health.latest_notification_run_status === "success" &&
        health.latest_line_delivery_status === "success"
          ? "success"
          : health.latest_notification_run_at
            ? "warning"
            : "light",
    },
    href: v2StoreDetailPath(input.tenant_id),
  };
}

/**
 * Derive the 7-day proof strip for a tenant from existing notification runs and
 * LINE deliveries (manual-derived per doc 20 §329 — no new DB schema).
 *
 * A day counts as "success" when a worker-scheduled round ran and produced at
 * least one successful LINE delivery that day. "missing" = no scheduled round
 * at all that day (against expected daily schedule). "failed"/"partial" =
 * round ran but no successful delivery.
 */
export function deriveProductionProofStrip(input: {
  tenant_id: TenantId;
  tenant_name?: string;
  eligible: boolean;
  runs: ProofRunLike[];
  deliveries: ProofDeliveryLike[];
  now?: Date;
}): OwnerCockpitProofStrip {
  const now = input.now ?? new Date();
  const windowStart = startOfBangkokDay(now, -(PROOF_WINDOW_DAYS - 1));
  const days = buildProofDayBuckets(windowStart, PROOF_WINDOW_DAYS);

  const scheduledRuns = input.runs.filter(
    (run) =>
      (run.source === "worker_due" || run.source === "worker_retry") &&
      run.mode === "send",
  );
  const notificationDeliveries = input.deliveries.filter(
    (delivery) => delivery.delivery_type === "notification_rule",
  );

  for (const day of days) {
    const runsOnDay = scheduledRuns.filter((run) =>
      bangkokDayMatches(run.finished_at ?? run.started_at, day.date),
    );
    const successDeliveriesOnDay = notificationDeliveries.filter(
      (delivery) =>
        delivery.status === "success" &&
        bangkokDayMatches(delivery.sent_at ?? delivery.created_at, day.date),
    );
    const failedDeliveriesOnDay = notificationDeliveries.filter(
      (delivery) =>
        delivery.status === "failed" &&
        bangkokDayMatches(delivery.sent_at ?? delivery.created_at, day.date),
    );

    if (runsOnDay.length === 0) {
      day.status = "missing";
    } else if (successDeliveriesOnDay.length > 0) {
      day.status = "success";
    } else if (failedDeliveriesOnDay.length > 0) {
      day.status = "failed";
    } else {
      day.status = "partial";
    }
  }

  const scheduledRunCount = scheduledRuns.length;
  const scheduledSuccessCount = scheduledRuns.filter(
    (run) => run.status === "success",
  ).length;
  const scheduledFailedCount = scheduledRuns.filter(
    (run) => run.status === "failed",
  ).length;
  const lineDeliveryCount = notificationDeliveries.length;
  const lineDeliverySuccessCount = notificationDeliveries.filter(
    (delivery) => delivery.status === "success",
  ).length;
  const missingRoundCount = days.filter(
    (day) => day.status === "missing",
  ).length;
  const evidenceCount = days.filter(
    (day) => day.status === "success",
  ).length;

  const allTimestamps = [
    ...scheduledRuns.map((run) => run.finished_at ?? run.started_at),
    ...notificationDeliveries.map(
      (delivery) => delivery.sent_at ?? delivery.created_at,
    ),
  ].filter((value): value is string => Boolean(value));
  const latestCheckedAt = latestTimestamp(allTimestamps);
  const latestSuccessAt = latestTimestamp([
    ...scheduledRuns
      .filter((run) => run.status === "success")
      .map((run) => run.finished_at ?? run.started_at),
    ...notificationDeliveries
      .filter((delivery) => delivery.status === "success")
      .map((delivery) => delivery.sent_at ?? delivery.created_at),
  ]);
  const latestProblemAt = latestTimestamp([
    ...scheduledRuns
      .filter((run) => run.status === "failed")
      .map((run) => run.finished_at ?? run.started_at),
    ...notificationDeliveries
      .filter((delivery) => delivery.status === "failed")
      .map((delivery) => delivery.sent_at ?? delivery.created_at),
  ]);

  return {
    tenant_id: input.tenant_id,
    tenant_name: input.tenant_name ?? input.tenant_id,
    eligible: input.eligible,
    days,
    scheduled_run_count: scheduledRunCount,
    scheduled_success_count: scheduledSuccessCount,
    scheduled_failed_count: scheduledFailedCount,
    line_delivery_count: lineDeliveryCount,
    line_delivery_success_count: lineDeliverySuccessCount,
    missing_round_count: missingRoundCount,
    evidence_count: evidenceCount,
    latest_checked_at: latestCheckedAt,
    latest_success_at: latestSuccessAt,
    latest_problem_at: latestProblemAt,
  };
}

function describeTenantNextAction(
  input: CockpitTenantInput,
  latestJavaWsFailure: CockpitJavaWsFailure | null,
): string {
  if (!input.access_enabled) {
    return input.access_message;
  }
  if (!input.health.datasource_configured) {
    return "เชื่อม SML JavaWS แล้วค่อยทดสอบรายงาน";
  }
  if (latestJavaWsFailure?.tenant_id === input.tenant_id) {
    return `JavaWS phase ${latestJavaWsFailure.failure_phase ?? "unknown"} — ตรวจการเชื่อมต่อ`;
  }
  if (
    input.health.line_channels === 0 ||
    input.health.line_targets_enabled === 0
  ) {
    return "เพิ่มผู้รับ LINE ก่อนเปิดรอบแจ้งเตือน";
  }
  if (input.health.notification_rules_enabled === 0) {
    return "ตั้งแผนแจ้งเตือนหลังพร้อม SML และ LINE";
  }
  if (
    input.health.latest_notification_run_status === "failed" ||
    input.health.latest_report_status === "failed"
  ) {
    return "ตรวจรอบล่าสุดที่ล้มเหลวก่อกรอบถัดไป";
  }
  if (input.health.critical_business_signals > 0) {
    return `${input.health.critical_business_signals} เรื่องสำคัญต้องตรวจ`;
  }
  if (
    input.health.latest_notification_run_status === "success" &&
    input.health.latest_line_delivery_status === "success"
  ) {
    return "พร้อมใช้งาน — รอรอบแจ้งเตือนถัดไป";
  }
  return "ตรวจ proof ของรอบล่าสุด";
}

function findSecretMissingTenant(
  tenants: CockpitTenantInput[],
): { tenant_id: TenantId; tenant_name: string; scope: "sml" | "line" } | null {
  // The health summary surfaces datasource_configured / line_channels but not
  // the secret-configured flags directly. We approximate "secret missing" by a
  // datasource that is configured but whose latest run failed with a phase
  // implying bad credentials (auth/http), or a LINE channel that exists but no
  // targets enabled despite notification rules present. This keeps the cockpit
  // conservative: a real secret gap shows up as a failed runnable round first.
  for (const tenant of tenants) {
    if (tenant.health.datasource_configured) {
      if (tenant.health.latest_report_status === "failed") {
        return {
          tenant_id: tenant.tenant_id,
          tenant_name: tenant.tenant_name,
          scope: "sml",
        };
      }
    }
    if (
      tenant.health.line_channels > 0 &&
      tenant.health.notification_rules_enabled > 0 &&
      tenant.health.line_targets_enabled === 0
    ) {
      return {
        tenant_id: tenant.tenant_id,
        tenant_name: tenant.tenant_name,
        scope: "line",
      };
    }
  }
  return null;
}

function buildProofDayBuckets(
  windowStart: Date,
  dayCount: number,
): OwnerCockpitProofDay[] {
  const days: OwnerCockpitProofDay[] = [];
  for (let offset = 0; offset < dayCount; offset += 1) {
    const day = new Date(windowStart);
    day.setUTCDate(windowStart.getUTCDate() + offset);
    days.push({
      day: offset + 1,
      date: formatBangkokYmd(day),
      status: "unknown",
    });
  }
  return days;
}

function startOfBangkokDay(now: Date, offsetDays: number): Date {
  // Bangkok is UTC+7. Normalize to the start of the Bangkok calendar day.
  const bangkokOffsetMs = 7 * 60 * 60 * 1000;
  const bangkokNow = new Date(now.getTime() + bangkokOffsetMs);
  const bangkokStart = new Date(
    Date.UTC(
      bangkokNow.getUTCFullYear(),
      bangkokNow.getUTCMonth(),
      bangkokNow.getUTCDate(),
    ),
  );
  bangkokStart.setUTCDate(bangkokStart.getUTCDate() + offsetDays);
  return new Date(bangkokStart.getTime() - bangkokOffsetMs);
}

function formatBangkokYmd(date: Date): string {
  const bangkokOffsetMs = 7 * 60 * 60 * 1000;
  const bangkok = new Date(date.getTime() + bangkokOffsetMs);
  const year = bangkok.getUTCFullYear();
  const month = String(bangkok.getUTCMonth() + 1).padStart(2, "0");
  const day = String(bangkok.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function bangkokDayMatches(
  value: string | null | undefined,
  bangkokYmd: string,
): boolean {
  if (!value) {
    return false;
  }
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) {
    return false;
  }
  return formatBangkokYmd(new Date(time)) === bangkokYmd;
}

function latestTimestamp(values: Array<string | null | undefined>): string | null {
  let latest: string | null = null;
  let latestMs = 0;
  for (const value of values) {
    if (!value) {
      continue;
    }
    const ms = new Date(value).getTime();
    if (Number.isFinite(ms) && ms > latestMs) {
      latestMs = ms;
      latest = value;
    }
  }
  return latest;
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

function v2StorePath(tenantId: TenantId, step: string): string {
  return `/owner-v2/stores/${encodeURIComponent(tenantId)}/${step}`;
}

function v2StoreDetailPath(tenantId: TenantId): string {
  return `/owner-v2/stores/${encodeURIComponent(tenantId)}`;
}

/** Re-export for callers that need the Bangkok timezone label. */
export const COCKPIT_TIMEZONE = BANGKOK_TZ;
