"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRightIcon, PlusIcon } from "@/icons";
import { isAbortError, ownerV2Fetch } from "./api";
import OwnerV2Cockpit from "./OwnerV2Cockpit";
import { InlineNotice, primaryActionClass, secondaryActionClass } from "./ui";
import type {
  OwnerV2CockpitTone,
  OwnerV2WorkbenchPayload,
} from "./types";

type WorkbenchStatus = "loading" | "success" | "error" | "auth_required";

export default function OwnerV2Workbench() {
  const [workbench, setWorkbench] = useState<OwnerV2WorkbenchPayload | null>(
    null,
  );
  const [status, setStatus] = useState<WorkbenchStatus>("loading");
  const [errorMessage, setErrorMessage] = useState("");

  const loadWorkbench = useCallback(async () => {
    setStatus("loading");
    setErrorMessage("");
    try {
      const data = await ownerV2Fetch<OwnerV2WorkbenchPayload>(
        "/api/owner/workbench",
      );
      setWorkbench(data);
      setStatus("success");
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      if (error instanceof Error && error.message.includes("session")) {
        setStatus("auth_required");
        return;
      }
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "โหลดข้อมูล cockpit ไม่สำเร็จ",
      );
    }
  }, []);

  useEffect(() => {
    void loadWorkbench();
  }, [loadWorkbench]);

  if (status === "auth_required") {
    return (
      <WorkbenchMessage
        actionHref="/signin"
        actionLabel="เข้าสู่ระบบใหม่"
        message="session หมดอายุ กรุณาเข้าสู่ระบบผู้ดูแลอีกครั้ง"
        title="session หมดอายุ"
        tone="warning"
      />
    );
  }

  if (status === "loading" && !workbench) {
    return <WorkbenchSkeleton />;
  }

  if (status === "error" && !workbench) {
    return (
      <WorkbenchMessage
        actionLabel="รีเฟรช"
        message={errorMessage}
        onAction={() => void loadWorkbench()}
        title="โหลด cockpit ไม่สำเร็จ"
        tone="error"
      />
    );
  }

  if (workbench && workbench.tenants.length === 0) {
    return (
      <WorkbenchMessage
        actionHref="/owner-v2/stores/new"
        actionLabel="เพิ่มร้านแรก"
        message="ยังไม่มีร้านในระบบ เพิ่มร้านแรกเพื่อเริ่มตั้งค่า SML และ LINE OA"
        title="ยังไม่มีร้าน"
        tone="info"
      />
    );
  }

  const ops = workbench?.ops;
  const warningCount = ops?.warning_count ?? 0;
  const criticalCount = ops?.critical_count ?? 0;
  const activeTenantCount = workbench?.cockpit?.active_tenant_count ?? 0;
  const telegramReady = Boolean(ops?.telegram_ready);
  const workerOk = ops?.worker_status === "ok";

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Metric cards — full-width 4-col KPI strip (TailAdmin metric-group pattern) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-6 xl:grid-cols-4">
        <MetricCard
          icon={
            <svg
              className="h-6 w-6 fill-gray-800 dark:fill-white/90"
              viewBox="0 0 24 24"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5zm0 13L2 10v10l10 5 10-5V10l-10 5z" />
            </svg>
          }
          label="ร้าน active"
          tone="brand"
          value={`${activeTenantCount}`}
        />
        <MetricCard
          icon={
            <svg
              className="h-6 w-6 fill-gray-800 dark:fill-white/90"
              viewBox="0 0 24 24"
            >
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
            </svg>
          }
          label="งานต้องตรวจ"
          tone={warningCount > 0 ? "warning" : "success"}
          trend={
            warningCount > 0
              ? { label: `${warningCount} รายการ`, tone: "warning" }
              : { label: "ไม่มี", tone: "success" }
          }
          value={`${warningCount}`}
        />
        <MetricCard
          icon={
            <svg
              className="h-6 w-6 fill-gray-800 dark:fill-white/90"
              viewBox="0 0 24 24"
            >
              <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
            </svg>
          }
          label="สัญญาณสำคัญ"
          tone={criticalCount > 0 ? "error" : "success"}
          trend={
            criticalCount > 0
              ? { label: `${criticalCount} เรื่อง`, tone: "error" }
              : { label: "ปกติ", tone: "success" }
          }
          value={`${criticalCount}`}
        />
        <MetricCard
          icon={
            <svg
              className="h-6 w-6 fill-gray-800 dark:fill-white/90"
              viewBox="0 0 24 24"
            >
              <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
            </svg>
          }
          label="Telegram ops"
          tone={telegramReady ? "success" : "warning"}
          trend={
            telegramReady
              ? { label: "พร้อมแจ้งเตือน", tone: "success" }
              : { label: "ยังไม่พร้อม", tone: "warning" }
          }
          value={workerOk ? "พร้อม" : "ตรวจ worker"}
        />
      </div>

      {warningCount > 0 ? (
        <InlineNotice
          message={`มี ${warningCount} รายการที่ควรตรวจก่อนรอบแจ้งเตือนถัดไป ดูรายละเอียดในตารางสถานะร้านหรือหน้าตรวจระบบ`}
          title="ต้องตรวจก่อนรอบถัดไป"
          tone="warning"
        />
      ) : null}

      {/* Main grid — 7/5 split: cockpit (left) + actions/quick-links (right) */}
      <div className="grid grid-cols-1 gap-4 md:gap-6 xl:grid-cols-12">
        <div className="space-y-5 sm:space-y-6 xl:col-span-7">
          {workbench?.cockpit ? (
            <OwnerV2Cockpit cockpit={workbench.cockpit} />
          ) : null}
        </div>

        {/* Right rail — quick actions + worker status (TailAdmin right-column pattern) */}
        <div className="space-y-5 sm:space-y-6 xl:col-span-5">
          <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
              การจัดการร้าน
            </h3>
            <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
              เพิ่มร้านใหม่ ค้นหา หรือเปิดหน้าตรวจระบบ
            </p>
            <div className="mt-5 flex flex-col gap-3">
              <Link className={primaryActionClass} href="/owner-v2/stores/new">
                <PlusIcon className="h-4 w-4" />
                เพิ่มร้านใหม่
              </Link>
              <Link
                className={secondaryActionClass}
                href="/owner-v2/stores"
              >
                จัดการร้านทั้งหมด
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
              <Link className={secondaryActionClass} href="/owner-v2/ops">
                ตรวจระบบ (worker, audit, Telegram)
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
              สถานะ worker
            </h3>
            <div className="mt-5 space-y-4">
              <WorkerStatusRow
                label="Worker heartbeat"
                ok={workerOk}
                value={formatWorkerStatus(ops?.worker_status)}
              />
              <WorkerStatusRow
                label="Telegram ops"
                ok={telegramReady}
                value={telegramReady ? "พร้อมแจ้งเตือน" : "ยังไม่พร้อม"}
              />
              <WorkerStatusRow
                label="ร้าน active"
                ok
                value={`${activeTenantCount} ร้าน`}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Metric card — TailAdmin metric-group-01 pattern
/* ------------------------------------------------------------------ */

type MetricTone = "brand" | "success" | "warning" | "error";

const metricIconTile: Record<MetricTone, string> = {
  brand: "bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400",
  success:
    "bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-500",
  warning:
    "bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-orange-400",
  error: "bg-error-50 text-error-600 dark:bg-error-500/15 dark:text-error-500",
};

function MetricCard({
  icon,
  label,
  tone,
  trend,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  tone: MetricTone;
  trend?: { label: string; tone: "success" | "warning" | "error" };
  value: string;
}) {
  const trendTone =
    trend?.tone === "error"
      ? "bg-error-50 text-error-600 dark:bg-error-500/15 dark:text-error-500"
      : trend?.tone === "warning"
        ? "bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-orange-400"
        : "bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-500";
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
      <div
        className={`flex h-12 w-12 items-center justify-center rounded-xl ${metricIconTile[tone]}`}
      >
        {icon}
      </div>
      <div className="mt-5 flex items-end justify-between">
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {label}
        </span>
        {trend ? (
          <span
            className={`flex items-center gap-1 rounded-full py-0.5 pl-2 pr-2.5 text-sm font-medium ${trendTone}`}
          >
            {trend.label}
          </span>
        ) : null}
      </div>
      <h4 className="mt-2 text-title-sm font-bold text-gray-800 dark:text-white/90">
        {value}
      </h4>
    </div>
  );
}

function WorkerStatusRow({
  label,
  ok,
  value,
}: {
  label: string;
  ok: boolean;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${ok ? "bg-success-500" : "bg-warning-500"}`}
        />
        <span className="text-sm font-medium text-gray-800 dark:text-white/90">
          {value}
        </span>
      </div>
    </div>
  );
}

function formatWorkerStatus(status?: string | null) {
  if (status === "ok") {
    return "พร้อม";
  }
  if (status === "missing" || status === "stale") {
    return "หยุดทำงาน";
  }
  return "ไม่ทราบสถานะ";
}

/* ------------------------------------------------------------------ */
/* Loading / empty / error states
/* ------------------------------------------------------------------ */

function WorkbenchSkeleton() {
  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-6 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            className="h-40 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]"
            key={i}
          />
        ))}
      </div>
      <div className="h-80 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
    </div>
  );
}

function WorkbenchMessage({
  actionHref,
  actionLabel,
  message,
  onAction,
  title,
  tone,
}: {
  actionHref?: string;
  actionLabel: string;
  message: string;
  onAction?: () => void;
  title: string;
  tone: OwnerV2CockpitTone;
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
      <InlineNotice message={message} title={title} tone={tone} />
      <div className="mt-4">
        {actionHref ? (
          <Link className={primaryActionClass} href={actionHref}>
            {actionLabel}
          </Link>
        ) : (
          <button
            className={primaryActionClass}
            onClick={onAction}
            type="button"
          >
            {actionLabel}
          </button>
        )}
      </div>
    </section>
  );
}
