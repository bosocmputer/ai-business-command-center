"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PlusIcon } from "@/icons";
import Button from "@/components/ui/button/Button";
import { isAbortError, ownerV2Fetch } from "./api";
import OwnerV2Cockpit from "./OwnerV2Cockpit";
import {
  formatRunStatus,
  InlineNotice,
  primaryActionClass,
} from "./ui";
import type {
  OwnerV2CockpitTone,
  OwnerV2WorkbenchPayload,
} from "./types";

type WorkbenchStatus =
  | "loading"
  | "success"
  | "error"
  | "auth_required";

export default function OwnerV2Workbench() {
  const [workbench, setWorkbench] = useState<OwnerV2WorkbenchPayload | null>(
    null,
  );
  const [status, setStatus] = useState<WorkbenchStatus>("loading");
  const [errorMessage, setErrorMessage] = useState("");

  const loadWorkbench = useCallback(async (signal?: AbortSignal) => {
    setStatus("loading");
    setErrorMessage("");
    try {
      const data = await ownerV2Fetch<OwnerV2WorkbenchPayload>(
        "/api/owner/workbench",
        { signal },
      );
      if (signal?.aborted) {
        return;
      }
      setWorkbench(data);
      setStatus("success");
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      const statusCode = (error as Error & { status?: number }).status;
      if (statusCode === 401 || statusCode === 403) {
        setStatus("auth_required");
        setErrorMessage("Session ผู้ดูแลหมดอายุ กรุณาเข้าสู่ระบบใหม่");
        return;
      }
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "โหลดหน้าเริ่มงานไม่สำเร็จ",
      );
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadWorkbench(controller.signal);
    return () => controller.abort();
  }, [loadWorkbench]);

  if (status === "auth_required") {
    return (
      <WorkbenchMessage
        actionHref="/signin"
        actionLabel="เข้าสู่ระบบใหม่"
        message={errorMessage}
        title="ต้องเข้าสู่ระบบผู้ดูแล"
        tone="warning"
      />
    );
  }

  if (status === "error") {
    return (
      <WorkbenchMessage
        actionLabel="รีเฟรชหน้าเริ่มงาน"
        message={errorMessage}
        onAction={() => void loadWorkbench()}
        title="โหลดหน้าเริ่มงานไม่สำเร็จ"
        tone="error"
      />
    );
  }

  if (status === "loading" && !workbench) {
    return <WorkbenchSkeleton />;
  }

  if (workbench && workbench.tenants.length === 0) {
    return (
      <WorkbenchMessage
        actionHref="/owner-v2/stores/new"
        actionLabel="เพิ่มร้านแรก"
        message="ยังไม่มีร้านในระบบ เริ่มจากสร้างร้านแล้วค่อยเชื่อม SML และ LINE"
        title="ยังไม่มีร้านให้จัดการ"
        tone="info"
      />
    );
  }

  const ops = workbench?.ops;
  return (
    <div className="space-y-6">
      {workbench?.cockpit ? (
        <OwnerV2Cockpit cockpit={workbench.cockpit} />
      ) : null}

      <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h2 className="text-theme-lg font-semibold text-gray-800 dark:text-white/90">
              ภาพรวมระบบ
            </h2>
            <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
              สถานะล่าสุดของ worker, แผนแจ้งเตือน และการแจ้งเตือน ops
              สำหรับทุกร้านในระบบ
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button
              className="w-full sm:w-auto"
              onClick={() => void loadWorkbench()}
              size="sm"
              type="button"
              variant="outline"
            >
              รีเฟรช
            </Button>
            <Link className={primaryActionClass} href="/owner-v2/stores/new">
              <PlusIcon className="h-4 w-4" />
              เพิ่มร้าน
            </Link>
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <Fact
            label="งานต้องตรวจ"
            value={`${ops?.warning_count ?? 0} รายการ`}
          />
          <Fact
            label="สัญญาณสำคัญ"
            value={`${ops?.critical_count ?? 0} เรื่อง`}
          />
          <Fact
            label="Worker"
            value={formatWorkerStatus(ops?.worker_status)}
          />
          <Fact
            label="Telegram ops"
            value={ops?.telegram_ready ? "พร้อมแจ้งเตือน" : "ยังไม่พร้อม"}
          />
          <Fact
            label="ร้าน active"
            value={`${workbench?.cockpit?.active_tenant_count ?? 0} ร้าน`}
          />
          <Fact
            label="ค้นหา/จัดการร้าน"
            value={
              <Link
                className="text-brand-600 hover:underline dark:text-brand-400"
                href="/owner-v2/stores"
              >
                เปิดหน้าร้านทั้งหมด →
              </Link>
            }
          />
        </div>

        {ops && ops.warning_count > 0 ? (
          <div className="mt-5">
            <InlineNotice
              message={`มี ${ops.warning_count} รายการที่ควรตรวจก่อนรอบแจ้งเตือนถัดไป ดูรายละเอียดในตารางสถานะร้านหรือหน้าตรวจระบบ`}
              title="ต้องตรวจก่อนรอบถัดไป"
              tone="warning"
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}

function Fact({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-gray-50 p-3 dark:bg-white/[0.02]">
      <p className="text-theme-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 break-words text-theme-sm font-semibold text-gray-800 dark:text-white/90">
        {value || "-"}
      </p>
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

function WorkbenchSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-40 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
      <div className="h-32 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
      <div className="h-80 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
    </div>
  );
}

function formatWorkerStatus(status?: string | null) {
  if (!status) {
    return "ยังไม่ทราบ";
  }
  if (status === "ok") {
    return "ปกติ";
  }
  if (status === "missing") {
    return "ไม่พบ heartbeat";
  }
  return status;
}
