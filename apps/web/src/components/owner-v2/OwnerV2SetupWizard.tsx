"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getReportCatalogEntry, isReportKey } from "@ai-bcc/shared";
import Badge from "@/components/ui/badge/Badge";
import { AlertIcon, ArrowRightIcon, CheckCircleIcon } from "@/icons";
import { isAbortError, ownerV2Fetch } from "./api";
import { InlineNotice, primaryActionClass } from "./ui";
import type {
  OwnerV2LineSetupPayload,
  OwnerV2NotificationSetupPayload,
  OwnerV2PermissionSetupPayload,
  OwnerV2ReportSetupPayload,
  OwnerV2SetupStep,
  OwnerV2SmlSetupPayload,
  OwnerV2StepId,
  OwnerV2Tenant,
} from "./types";

// Empty placeholders so a step component can render safely even if its setup
// payload is null (e.g. during loading or when the API returns no data for an
// unconfigured slice).
const EMPTY_DATASOURCE = {
  source: "missing",
  kind: null,
  database: null,
  config_file_name: null,
  auth_mode: null,
  auth_configured: false,
  password_configured: false,
  encryption_configured: false,
  updated_at: null,
} as const;

const EMPTY_READINESS = {
  send_ready_channels: 0,
  total_channels: 0,
  ready_targets: 0,
  total_targets: 0,
} as const;

const stepOrder: OwnerV2StepId[] = [
  "store",
  "sml",
  "reports",
  "line",
  "permissions",
  "notifications",
];

const stepLabels: Record<OwnerV2StepId, string> = {
  store: "ข้อมูลร้าน",
  sml: "เชื่อม SML",
  reports: "ทดสอบรายงาน",
  line: "ตั้งค่า LINE",
  permissions: "ตรวจสิทธิ์",
  notifications: "ตั้งแผนแจ้งเตือน",
};

const stepSetupHref: Record<OwnerV2StepId, ((tenantId: string) => string) | null> = {
  store: null, // store step has no setup page; it reflects tenant status
  sml: (id) => `/owner-v2/stores/${encodeURIComponent(id)}/sml`,
  reports: (id) => `/owner-v2/stores/${encodeURIComponent(id)}/reports`,
  line: (id) => `/owner-v2/stores/${encodeURIComponent(id)}/line`,
  permissions: (id) => `/owner-v2/stores/${encodeURIComponent(id)}/permissions`,
  notifications: (id) => `/owner-v2/stores/${encodeURIComponent(id)}/notifications`,
};

const stepActionLabel: Record<OwnerV2StepId, string> = {
  store: "ตรวจร้าน",
  sml: "เปิดตั้งค่า SML",
  reports: "เปิดทดสอบรายงาน",
  line: "เปิดจัดการ LINE",
  permissions: "เปิดแก้สิทธิ์",
  notifications: "เปิดตั้งแผน",
};

const outlineActionClass =
  "inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-theme-xs font-medium text-gray-600 shadow-theme-xs transition hover:bg-gray-50 hover:text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-white/[0.03] dark:hover:text-gray-100 sm:w-auto";

type StepPayload =
  | OwnerV2SmlSetupPayload
  | OwnerV2ReportSetupPayload
  | OwnerV2LineSetupPayload
  | OwnerV2NotificationSetupPayload
  | OwnerV2PermissionSetupPayload
  | null;

type StepDetailState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: StepPayload };

export default function OwnerV2SetupWizard({
  tenant,
  steps,
}: {
  tenant: OwnerV2Tenant;
  steps: OwnerV2SetupStep[];
  initialStep?: OwnerV2StepId;
  onStepChange?: (step: OwnerV2StepId) => void;
}) {
  // Resolve each step id to its prepared-step entry (ok/label/detail), falling
  // back to a neutral entry if the backend didn't return one.
  const prepared: Record<OwnerV2StepId, OwnerV2SetupStep> = {} as Record<
    OwnerV2StepId,
    OwnerV2SetupStep
  >;
  for (const stepId of stepOrder) {
    prepared[stepId] =
      steps.find((item) => item.step === stepId) ?? fallbackStep(stepId);
  }
  const completedCount = stepOrder.filter((id) => prepared[id].ok).length;
  const allDone = completedCount === stepOrder.length;
  const anyActionable = stepOrder.some(
    (id) => stepSetupHref[id] !== null && !prepared[id].ok,
  );

  const [showAll, setShowAll] = useState(false);

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <header className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            ขั้นตอนเตรียมร้าน
          </h2>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            {allDone
              ? "เตรียมร้านครบทุกขั้นแล้ว เปิดใช้งานแจ้งเตือนอัตโนมัติได้"
              : "เริ่มจากขั้นบนสุดที่ยังไม่เสร็จ กดปุ่มเพื่อเปิดหน้าตั้งค่าของขั้นนั้น"}
          </p>
        </div>
        <Badge color={allDone ? "success" : "warning"} size="sm">
          {completedCount}/{stepOrder.length} เสร็จ
        </Badge>
      </header>

      <div className="space-y-3 px-4 pb-5 sm:px-6">
        {allDone && !showAll ? (
          <DoneSummary
            completedCount={completedCount}
            onShow={() => setShowAll(true)}
            tenant={tenant}
          />
        ) : allDone && showAll ? (
          <>
            {stepOrder.map((stepId) => {
              const step = prepared[stepId];
              return (
                <CompactStepRow
                  href={setupHrefFor(tenant.id, stepId)}
                  key={stepId}
                  step={step}
                />
              );
            })}
            <button
              className="mt-1 text-theme-xs font-medium text-gray-500 transition hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
              onClick={() => setShowAll(false)}
              type="button"
            >
              ซ่อนรายละเอียดขั้นตอน
            </button>
          </>
        ) : (
          <>
            {stepOrder.map((stepId) => {
              const step = prepared[stepId];
              // Hide the store step when complete (it reflects tenant status,
              // which the hero already shows). Keep incomplete steps prominent.
              if (stepId === "store" && step.ok) {
                return null;
              }
              return (
                <StepCard
                  actionable={!step.ok}
                  key={stepId}
                  step={step}
                  stepId={stepId}
                  tenant={tenant}
                />
              );
            })}
            {!anyActionable && !allDone ? (
              <p className="text-theme-xs text-gray-500 dark:text-gray-400">
                ขั้นที่ยังไม่เสร็จเป็นขั้นที่ไม่มีหน้าตั้งค่าแยก ตรวจข้อมูลร้านในแท็บตั้งค่าขั้นสูง
              </p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Step card — the primary unit. Prominent when actionable.
/* ------------------------------------------------------------------ */

function StepCard({
  actionable,
  step,
  stepId,
  tenant,
}: {
  actionable: boolean;
  step: OwnerV2SetupStep;
  stepId: OwnerV2StepId;
  tenant: OwnerV2Tenant;
}) {
  const href = setupHrefFor(tenant.id, stepId);
  const ctaLabel = step.ok
    ? "แก้ไข"
    : stepActionLabel[stepId];
  const [detailOpen, setDetailOpen] = useState(false);

  return (
    <div
      className={`overflow-hidden rounded-xl border ${
        actionable
          ? "border-warning-300 bg-warning-50/40 dark:border-warning-500/30 dark:bg-warning-500/[0.04]"
          : "border-gray-200 bg-gray-50/50 dark:border-gray-800 dark:bg-white/[0.02]"
      }`}
    >
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
              step.ok
                ? "bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-400"
                : "bg-warning-100 text-warning-600 dark:bg-warning-500/15 dark:text-warning-300"
            }`}
          >
            {step.ok ? (
              <CheckCircleIcon className="h-5 w-5" />
            ) : (
              <AlertIcon className="h-5 w-5" />
            )}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                {stepLabels[stepId]}
              </p>
              {actionable ? (
                <Badge color="warning" size="sm">
                  ต้องทำ
                </Badge>
              ) : (
                <Badge color="success" size="sm">
                  เสร็จแล้ว
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
              {step.detail}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {href ? (
            <Link className={actionable ? primaryActionClass : outlineActionClass} href={href}>
              {ctaLabel}
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
          ) : null}
          {stepId !== "store" ? (
            <button
              className={outlineActionClass}
              onClick={() => setDetailOpen((v) => !v)}
              type="button"
            >
              {detailOpen ? "ซ่อนสถานะ" : "ดูสถานะ"}
            </button>
          ) : null}
        </div>
      </div>

      {detailOpen && stepId !== "store" ? (
        <div className="border-t border-gray-200 px-4 py-4 dark:border-gray-800 sm:px-6">
          <StepDetailLazy stepId={stepId} tenantId={tenant.id} />
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Compact row — used when a store is fully ready (all steps done).
/* ------------------------------------------------------------------ */

function CompactStepRow({
  href,
  step,
}: {
  href: string | null;
  step: OwnerV2SetupStep;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-4 py-3 dark:bg-white/[0.02]">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-400">
          <CheckCircleIcon className="h-4 w-4" />
        </span>
        <p className="truncate text-sm font-medium text-gray-700 dark:text-gray-300">
          {step.label}
        </p>
      </div>
      {href ? (
        <Link
          className="text-theme-xs font-medium text-brand-600 transition hover:text-brand-700 dark:text-brand-400"
          href={href}
        >
          แก้ไข
        </Link>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Done summary — collapsed view for fully-ready stores.
/* ------------------------------------------------------------------ */

function DoneSummary({
  completedCount,
  onShow,
  tenant,
}: {
  completedCount: number;
  onShow: () => void;
  tenant: OwnerV2Tenant;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-success-300 bg-success-50/50 p-4 dark:border-success-500/30 dark:bg-success-500/[0.06] sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success-500/15 text-success-600 dark:text-success-400">
          <CheckCircleIcon className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            เตรียมร้านครบ {completedCount}/{stepOrder.length} ขั้นแล้ว
          </p>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            ระบบพร้อมส่งแจ้งเตือนตามแผน เปิดดู dashboard หรือแก้ขั้นใดก็ได้
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {tenant.dashboard_path ? (
          <Link className={outlineActionClass} href={tenant.dashboard_path}>
            เปิด dashboard ลูกค้า
          </Link>
        ) : null}
        <button
          className={outlineActionClass}
          onClick={onShow}
          type="button"
        >
          ดูทุกขั้น
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Lazy step detail — loads per-card (no shared state, no race).
/* ------------------------------------------------------------------ */

function StepDetailLazy({
  stepId,
  tenantId,
}: {
  stepId: OwnerV2StepId;
  tenantId: string;
}) {
  const [state, setState] = useState<StepDetailState>({ status: "loading" });

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState({ status: "loading" });
      try {
        const data = await ownerV2Fetch<StepPayload>(
          detailEndpointForStep(tenantId, stepId),
          { signal },
        );
        if (signal?.aborted) {
          return;
        }
        setState({ status: "success", data });
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "โหลดรายละเอียดขั้นนี้ไม่สำเร็จ",
        });
      }
    },
    [stepId, tenantId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (state.status === "loading") {
    return <DetailSkeleton />;
  }
  if (state.status === "error") {
    return (
      <InlineNotice
        message={`${state.message} ลองปิดแล้วเปิด “ดูสถานะ” อีกครั้ง`}
        tone="error"
        title="โหลดสถานะไม่สำเร็จ"
      />
    );
  }

  switch (stepId) {
    case "sml":
      return (
        <SmlStep data={state.data as OwnerV2SmlSetupPayload | null} />
      );
    case "reports":
      return (
        <ReportStep data={state.data as OwnerV2ReportSetupPayload | null} />
      );
    case "line":
      return (
        <LineStep data={state.data as OwnerV2LineSetupPayload | null} />
      );
    case "permissions":
      return (
        <PermissionStep data={state.data as OwnerV2PermissionSetupPayload | null} />
      );
    case "notifications":
      return (
        <NotificationStep data={state.data as OwnerV2NotificationSetupPayload | null} />
      );
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Per-step detail content (renders the lazy-loaded summary facts).
/* ------------------------------------------------------------------ */

function SmlStep({ data }: { data: OwnerV2SmlSetupPayload | null }) {
  const datasource = data?.datasource ?? EMPTY_DATASOURCE;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Fact label="ชนิดแหล่งข้อมูล" value={datasource.kind ?? "ยังไม่ตั้ง"} />
        <Fact label="ฐานข้อมูล" value={datasource.database ?? "ยังไม่ระบุ"} />
        <Fact
          label="รหัสผ่าน"
          value={datasource.auth_configured ? "ตั้งค่าแล้ว" : "ไม่ใช้รหัสผ่าน"}
        />
      </div>
      {data?.latest_report_run ? (
        <InlineNotice
          message={`${formatReportLabel(data.latest_report_run.report_key)} · ${data.latest_report_run.row_count.toLocaleString("th-TH")} แถว`}
          title={`รายงานล่าสุด: ${formatReportRunStatus(data.latest_report_run.status)}`}
          tone={data.latest_report_run.status === "success" ? "success" : "warning"}
        />
      ) : (
        <InlineNotice
          message="ยังไม่มีรายงานล่าสุด กดรันรายงานทดสอบก่อนเปิดแผนแจ้งเตือน"
          title="ยังไม่มีหลักฐานรายงาน"
          tone="warning"
        />
      )}
    </div>
  );
}

function ReportStep({ data }: { data: OwnerV2ReportSetupPayload | null }) {
  const latestRun = data?.latest_runs?.[0] ?? null;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Fact label="รายงานทั้งหมด" value={`${data?.reports?.length ?? 0} รายงาน`} />
        <Fact
          label="ข้อมูลล่าสุด"
          value={`${data?.latest_snapshots?.length ?? 0} รายงาน`}
        />
      </div>
      {latestRun ? (
        <InlineNotice
          message={`${formatReportLabel(latestRun.report_key)} · ${latestRun.row_count.toLocaleString("th-TH")} แถว${
            latestRun.failure_phase ? " · มีข้อสังเกตจากระบบ" : ""
          }`}
          title={`รายงานล่าสุด: ${formatReportRunStatus(latestRun.status)}`}
          tone={latestRun.status === "success" ? "success" : "warning"}
        />
      ) : (
        <InlineNotice
          message="ยังไม่มีรายงานล่าสุด กดรันรายงานทดสอบก่อนเปิดแผนแจ้งเตือน"
          title="ยังไม่มีหลักฐานรายงาน"
          tone="warning"
        />
      )}
    </div>
  );
}

function LineStep({ data }: { data: OwnerV2LineSetupPayload | null }) {
  const channels = data?.channels ?? [];
  const targets = data?.targets ?? [];
  const readiness = data?.readiness ?? EMPTY_READINESS;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <Fact label="LINE OA" value={`${channels.length} ช่องทาง`} />
        <Fact
          label="พร้อมส่ง"
          value={`${readiness.send_ready_channels}/${readiness.total_channels}`}
        />
        <Fact label="ผู้รับทั้งหมด" value={`${targets.length} รายการ`} />
        <Fact
          label="ผู้รับพร้อมส่ง"
          value={`${readiness.ready_targets}/${readiness.total_targets}`}
        />
      </div>
      {!channels.length ? (
        <InlineNotice
          message="ยังไม่มี LINE OA ให้เพิ่มช่องทางหรือใช้ OA กลางก่อน"
          title="ยังไม่มี LINE OA"
          tone="info"
        />
      ) : null}
    </div>
  );
}

function PermissionStep({ data }: { data: OwnerV2PermissionSetupPayload | null }) {
  const roles = data?.roles ?? [];
  const impacted = data?.impacted_notification_plans ?? [];
  return (
    <div className="space-y-3">
      {roles.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {roles.map((role) => (
            <Fact
              key={role.access_profile_key}
              label={role.label}
              value={`${role.target_count} ผู้รับ`}
            />
          ))}
        </div>
      ) : (
        <p className="text-theme-xs text-gray-500 dark:text-gray-400">
          ยังไม่มี role สิทธิ์รายงาน
        </p>
      )}
      {impacted.length ? (
        <InlineNotice
          message={`${impacted.length} แผนมีผู้รับที่สิทธิ์ไม่พอ ให้แก้สิทธิ์ก่อนเปิดรอบจริง`}
          title="มีสิทธิ์ที่ต้องแก้"
          tone="warning"
        />
      ) : (
        <InlineNotice
          message="ยังไม่พบแผนที่เปิดอยู่แล้วติดสิทธิ์ผู้รับ"
          title="สิทธิ์พร้อมสำหรับแผนปัจจุบัน"
          tone="success"
        />
      )}
    </div>
  );
}

function NotificationStep({ data }: { data: OwnerV2NotificationSetupPayload | null }) {
  const rules = data?.rules ?? [];
  const enabledTargetCount = data?.enabled_target_count ?? 0;
  const targetCount = data?.target_count ?? 0;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Fact label="แผนทั้งหมด" value={`${rules.length} แผน`} />
        <Fact
          label="แผนเปิดใช้งาน"
          value={`${rules.filter((rule) => rule.enabled).length} แผน`}
        />
        <Fact
          label="ผู้รับพร้อมส่ง"
          value={`${enabledTargetCount}/${targetCount}`}
        />
      </div>
      {!rules.length ? (
        <InlineNotice
          message="ยังไม่มีแผนแจ้งเตือน ตั้งแผนหลัง SML และ LINE พร้อม"
          title="ยังไม่มีแผนแจ้งเตือน"
          tone="info"
        />
      ) : null}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white p-3 dark:bg-white/[0.02]">
      <p className="text-theme-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 break-words text-theme-sm font-semibold text-gray-800 dark:text-white/90">
        {value || "-"}
      </p>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="h-16 animate-pulse rounded-lg bg-gray-100 dark:bg-white/[0.06]" />
        <div className="h-16 animate-pulse rounded-lg bg-gray-100 dark:bg-white/[0.06]" />
        <div className="h-16 animate-pulse rounded-lg bg-gray-100 dark:bg-white/[0.06]" />
      </div>
      <div className="h-16 animate-pulse rounded-xl bg-gray-100 dark:bg-white/[0.06]" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers
/* ------------------------------------------------------------------ */

function setupHrefFor(tenantId: string, stepId: OwnerV2StepId): string | null {
  const factory = stepSetupHref[stepId];
  return factory ? factory(tenantId) : null;
}

function fallbackStep(step: OwnerV2StepId): OwnerV2SetupStep {
  return {
    key: step,
    ok: false,
    label: stepLabels[step],
    detail: "เลือกขั้นนี้เพื่อโหลดรายละเอียด",
    step,
    action_label: "ดูรายละเอียด",
    href: "",
  };
}

function detailEndpointForStep(tenantId: string, step: OwnerV2StepId) {
  const encodedTenantId = encodeURIComponent(tenantId);
  if (step === "sml" || step === "reports") {
    return step === "sml"
      ? `/api/owner/tenants/${encodedTenantId}/sml-setup`
      : `/api/owner/tenants/${encodedTenantId}/report-setup`;
  }
  if (step === "line") {
    return `/api/owner/tenants/${encodedTenantId}/line-setup`;
  }
  if (step === "permissions") {
    return `/api/owner/tenants/${encodedTenantId}/report-permissions`;
  }
  return `/api/owner/tenants/${encodedTenantId}/notification-setup`;
}

function formatReportRunStatus(status: string) {
  const labels: Record<string, string> = {
    queued: "รอรัน",
    running: "กำลังรัน",
    success: "สำเร็จ",
    failed: "ล้มเหลว",
  };
  return labels[status] ?? status;
}

function formatReportLabel(reportKey: string) {
  if (!isReportKey(reportKey)) {
    return "รายงาน";
  }
  const entry = getReportCatalogEntry(reportKey);
  return entry.shortLabel ?? entry.label;
}
