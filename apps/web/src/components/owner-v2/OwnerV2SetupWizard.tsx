"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Badge from "@/components/ui/badge/Badge";
import { AlertIcon, CheckCircleIcon } from "@/icons";
import { isAbortError, ownerV2Fetch } from "./api";
import { InlineNotice } from "./ui";
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

type DetailState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "success";
      step: OwnerV2StepId;
      data:
        | OwnerV2SmlSetupPayload
        | OwnerV2ReportSetupPayload
        | OwnerV2LineSetupPayload
        | OwnerV2NotificationSetupPayload
        | OwnerV2PermissionSetupPayload
        | null;
    };

const stepOrder: OwnerV2StepId[] = [
  "store",
  "sml",
  "reports",
  "line",
  "permissions",
  "notifications",
];

const stepLabels: Record<OwnerV2StepId, string> = {
  store: "ร้าน",
  sml: "SML",
  reports: "รายงาน",
  line: "LINE",
  permissions: "สิทธิ์",
  notifications: "แจ้งเตือน",
};

const primaryActionClass =
  "inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-theme-sm font-medium text-white shadow-theme-xs transition hover:bg-brand-600 sm:w-auto";

const secondaryActionClass =
  "inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-theme-sm font-medium text-gray-700 shadow-theme-xs transition hover:bg-gray-50 hover:text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03] dark:hover:text-gray-200 sm:w-auto";

export default function OwnerV2SetupWizard({
  tenant,
  steps,
  initialStep = "store",
  onStepChange,
}: {
  tenant: OwnerV2Tenant;
  steps: OwnerV2SetupStep[];
  initialStep?: OwnerV2StepId;
  onStepChange?: (step: OwnerV2StepId) => void;
}) {
  const [activeStep, setActiveStep] = useState<OwnerV2StepId>(initialStep);
  const [detailState, setDetailState] = useState<DetailState>({
    status: "idle",
  });

  const loadStepDetail = useCallback(
    async (step: OwnerV2StepId, signal?: AbortSignal) => {
      if (step === "store") {
        setDetailState({ status: "success", step, data: null });
        return;
      }
      setDetailState({ status: "loading" });
      try {
        const path = detailEndpointForStep(tenant.id, step);
        const data = await ownerV2Fetch<
          | OwnerV2SmlSetupPayload
          | OwnerV2ReportSetupPayload
          | OwnerV2LineSetupPayload
          | OwnerV2NotificationSetupPayload
          | OwnerV2PermissionSetupPayload
        >(path, { signal });
        if (signal?.aborted) {
          return;
        }
        setDetailState({ status: "success", step, data });
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        setDetailState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "โหลดรายละเอียดขั้นตอนนี้ไม่สำเร็จ",
        });
      }
    },
    [tenant.id],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadStepDetail(activeStep, controller.signal);
    return () => controller.abort();
  }, [activeStep, loadStepDetail]);

  const handleStepSelect = (step: OwnerV2StepId) => {
    setActiveStep(step);
    onStepChange?.(step);
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 pb-4 pt-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
          ขั้นตอนตั้งค่าร้าน
        </h2>
        <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
          เปิดเฉพาะขั้นที่ต้องดู ระบบจะโหลดรายละเอียดของขั้นนั้นเท่านั้น
        </p>
      </div>
      <div className="grid gap-4 2xl:grid-cols-[300px_minmax(0,1fr)]">
        <div className="rounded-xl bg-gray-50 p-2 dark:bg-white/[0.02]">
          {stepOrder.map((stepId) => {
            const step =
              steps.find((item) => item.step === stepId) ?? fallbackStep(stepId);
            return (
              <StepButton
                active={activeStep === stepId}
                key={stepId}
                onClick={() => handleStepSelect(stepId)}
                step={step}
              />
            );
          })}
        </div>
        <div className="min-w-0">
          <StepDetail
            activeStep={activeStep}
            detailState={detailState}
            tenant={tenant}
          />
        </div>
      </div>
    </section>
  );
}

function StepButton({
  active,
  onClick,
  step,
}: {
  active: boolean;
  onClick: () => void;
  step: OwnerV2SetupStep;
}) {
  return (
    <button
      className={`flex w-full items-start gap-3 rounded-lg p-3 text-left transition ${
        active
          ? "bg-brand-50 ring-1 ring-brand-100 dark:bg-brand-500/10 dark:ring-brand-500/20"
          : "hover:bg-gray-50 dark:hover:bg-white/[0.03]"
      }`}
      onClick={onClick}
      type="button"
    >
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
          step.ok
            ? "bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-400"
            : "bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-warning-300"
        }`}
      >
        {step.ok ? (
          <CheckCircleIcon className="h-4 w-4" />
        ) : (
          <AlertIcon className="h-4 w-4" />
        )}
      </span>
      <span className="min-w-0">
        <span className="block text-theme-sm font-medium text-gray-800 dark:text-white/90">
          {stepLabels[step.step]}
        </span>
        <span className="mt-0.5 block text-theme-xs leading-5 text-gray-500 dark:text-gray-400">
          {step.detail}
        </span>
      </span>
    </button>
  );
}

function StepDetail({
  activeStep,
  detailState,
  tenant,
}: {
  activeStep: OwnerV2StepId;
  detailState: DetailState;
  tenant: OwnerV2Tenant;
}) {
  if (detailState.status === "loading") {
    return <DetailSkeleton />;
  }
  if (detailState.status === "error") {
    return (
      <div className="p-5">
        <InlineNotice
          message={`${detailState.message} ลองรีเฟรช หรือเปิดขั้นตอนนี้อีกครั้ง`}
          tone="error"
          title="โหลดรายละเอียดไม่สำเร็จ"
        />
      </div>
    );
  }
  if (activeStep === "store") {
    return <StoreStep tenant={tenant} />;
  }
  if (detailState.status !== "success") {
    return <DetailSkeleton />;
  }
  if (activeStep === "sml") {
    return (
      <SmlStep
        data={detailState.data as OwnerV2SmlSetupPayload}
        tenantId={tenant.id}
      />
    );
  }
  if (activeStep === "reports") {
    return (
      <ReportStep
        data={detailState.data as OwnerV2ReportSetupPayload}
        tenantId={tenant.id}
      />
    );
  }
  if (activeStep === "line") {
    return (
      <LineStep
        data={detailState.data as OwnerV2LineSetupPayload}
        tenantId={tenant.id}
      />
    );
  }
  if (activeStep === "permissions") {
    return (
      <PermissionStep
        data={detailState.data as OwnerV2PermissionSetupPayload}
        tenantId={tenant.id}
      />
    );
  }
  return (
    <NotificationStep
      data={detailState.data as OwnerV2NotificationSetupPayload}
      tenantId={tenant.id}
    />
  );
}

function StoreStep({ tenant }: { tenant: OwnerV2Tenant }) {
  return (
    <div className="space-y-4 p-5">
      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">
          ข้อมูลร้านและสถานะใช้งาน
        </h3>
        <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
          ใช้ตรวจว่าร้านเปิดใช้งานอยู่หรือไม่ ก่อนเริ่มตั้งค่า SML และ LINE
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Fact label="แพ็กเกจ" value={tenant.plan_code} />
        <Fact label="สถานะร้าน" value={formatTenantStatus(tenant.status)} />
        <Fact
          label="ความพร้อม"
          value={`${tenant.completed_steps}/${tenant.total_steps}`}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {tenant.dashboard_path ? (
          <Link className={primaryActionClass} href={tenant.dashboard_path}>
            เปิด dashboard ลูกค้า
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function SmlStep({
  data,
  tenantId,
}: {
  data: OwnerV2SmlSetupPayload;
  tenantId: string;
}) {
  const datasource = data.datasource;
  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            SML JavaWS
          </h3>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            แสดงเฉพาะสถานะ config ที่ปลอดภัย ไม่แสดง password หรือ token
          </p>
        </div>
        <Link
          className={primaryActionClass}
          href={`/owner-v2/stores/${encodeURIComponent(tenantId)}/sml`}
        >
          เปิดฟอร์ม SML
        </Link>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Fact label="ชนิด datasource" value={datasource.kind ?? "ยังไม่ตั้ง"} />
        <Fact label="Database" value={datasource.database ?? "ยังไม่ระบุ"} />
        <Fact
          label="Auth"
          value={datasource.auth_configured ? "ตั้งค่าแล้ว" : "ไม่ใช้ auth"}
        />
      </div>
      {data.latest_report_run ? (
        <InlineNotice
          message={`${data.latest_report_run.report_key} · ${data.latest_report_run.row_count.toLocaleString("th-TH")} แถว`}
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

function ReportStep({
  data,
  tenantId,
}: {
  data: OwnerV2ReportSetupPayload;
  tenantId: string;
}) {
  const latestRun = data.latest_runs[0] ?? null;
  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            ทดสอบรายงาน
          </h3>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            ใช้ตรวจว่ารายงานรันสำเร็จจริงก่อนเปิดแจ้งเตือนประจำวัน
          </p>
        </div>
        <Link
          className={primaryActionClass}
          href={`/owner-v2/stores/${encodeURIComponent(tenantId)}/reports`}
        >
          รันรายงานทดสอบ
        </Link>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Fact label="รายงานทั้งหมด" value={`${data.reports.length} รายงาน`} />
        <Fact
          label="Snapshot ล่าสุด"
          value={`${data.latest_snapshots.length} รายงาน`}
        />
      </div>
      {latestRun ? (
        <InlineNotice
          message={`${latestRun.report_key} · ${latestRun.row_count.toLocaleString("th-TH")} แถว${
            latestRun.failure_phase ? ` · phase ${latestRun.failure_phase}` : ""
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

function LineStep({
  data,
  tenantId,
}: {
  data: OwnerV2LineSetupPayload;
  tenantId: string;
}) {
  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            LINE OA และผู้รับ
          </h3>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            เช็ค token, secret และผู้รับที่พร้อมส่งจริง
          </p>
        </div>
        <Link
          className={primaryActionClass}
          href={`/owner-v2/stores/${encodeURIComponent(tenantId)}/line`}
        >
          จัดการ LINE
        </Link>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <Fact label="LINE OA" value={`${data.channels.length} ช่องทาง`} />
        <Fact
          label="พร้อมส่ง"
          value={`${data.readiness.send_ready_channels}/${data.readiness.total_channels}`}
        />
        <Fact label="ผู้รับทั้งหมด" value={`${data.targets.length} รายการ`} />
        <Fact
          label="ผู้รับพร้อมส่ง"
          value={`${data.readiness.ready_targets}/${data.readiness.total_targets}`}
        />
      </div>
      {!data.channels.length ? (
        <InlineNotice
          message="ยังไม่มี LINE OA ให้เพิ่มช่องทางหรือใช้ OA กลางก่อน"
          title="ยังไม่มี LINE OA"
          tone="info"
        />
      ) : null}
    </div>
  );
}

function PermissionStep({
  data,
  tenantId,
}: {
  data: OwnerV2PermissionSetupPayload;
  tenantId: string;
}) {
  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            สิทธิ์รายงาน
          </h3>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            role ของผู้รับต้องดูรายงานที่อยู่ในแผนแจ้งเตือนได้ก่อนเปิดใช้งานจริง
          </p>
        </div>
        <Link
          className={primaryActionClass}
          href={`/owner-v2/stores/${encodeURIComponent(tenantId)}/permissions`}
        >
          แก้สิทธิ์
        </Link>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {data.roles.map((role) => (
          <Fact key={role.access_profile_key} label={role.label} value={`${role.target_count} ผู้รับ`} />
        ))}
      </div>
      {data.impacted_notification_plans.length ? (
        <InlineNotice
          message={`${data.impacted_notification_plans.length} แผนมีผู้รับที่สิทธิ์ไม่พอ ให้แก้สิทธิ์ก่อนเปิดรอบจริง`}
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

function NotificationStep({
  data,
  tenantId,
}: {
  data: OwnerV2NotificationSetupPayload;
  tenantId: string;
}) {
  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            แผนแจ้งเตือน
          </h3>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            ตรวจแผนที่เปิดใช้งานและรอบล่าสุด โดยโหลดเฉพาะ tenant นี้
          </p>
        </div>
        <Link
          className={primaryActionClass}
          href={`/owner-v2/stores/${encodeURIComponent(tenantId)}/notifications`}
        >
          ตั้งแผนแจ้งเตือน
        </Link>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Fact label="แผนทั้งหมด" value={`${data.rules.length} แผน`} />
        <Fact
          label="แผนเปิดใช้งาน"
          value={`${data.rules.filter((rule) => rule.enabled).length} แผน`}
        />
        <Fact
          label="ผู้รับพร้อมส่ง"
          value={`${data.enabled_target_count}/${data.target_count}`}
        />
      </div>
      {!data.rules.length ? (
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
    <div className="rounded-lg bg-gray-50 p-3 dark:bg-white/[0.02]">
      <p className="text-theme-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 break-words text-theme-sm font-semibold text-gray-800 dark:text-white/90">
        {value || "-"}
      </p>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-4 p-5">
      <div className="h-5 w-48 animate-pulse rounded bg-gray-100 dark:bg-white/[0.06]" />
      <div className="grid gap-3 md:grid-cols-3">
        <div className="h-20 animate-pulse rounded-2xl bg-gray-100 dark:bg-white/[0.06]" />
        <div className="h-20 animate-pulse rounded-2xl bg-gray-100 dark:bg-white/[0.06]" />
        <div className="h-20 animate-pulse rounded-2xl bg-gray-100 dark:bg-white/[0.06]" />
      </div>
      <div className="h-24 animate-pulse rounded-xl bg-gray-100 dark:bg-white/[0.06]" />
    </div>
  );
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

function formatTenantStatus(status: string) {
  const labels: Record<string, string> = {
    trial: "ทดลองใช้",
    active: "ใช้งาน",
    past_due: "ค้างชำระ",
    suspended: "ระงับ",
    cancelled: "ยกเลิก",
  };
  return labels[status] ?? status;
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
