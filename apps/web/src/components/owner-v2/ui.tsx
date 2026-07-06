"use client";

import type { FormEventHandler, ReactNode } from "react";
import Badge from "@/components/ui/badge/Badge";
import { AlertIcon, CheckCircleIcon, InfoIcon } from "@/icons";

/**
 * Shared UI primitives for the owner-v2 cockpit pages.
 *
 * These were previously duplicated across 6-7 components (StoreDetail,
 * LineSetup, NewTenant, NotificationSetup, ReportPermissions, Reports,
 * SmlSetup, Workbench, StoreList, Cockpit, Ops, System). Keep this file the
 * single source so every cockpit page renders panels, notices and facts the
 * same way.
 */

export type FactTone = "success" | "warning" | "error" | "light";

export type NoticeTone = "success" | "warning" | "error" | "info";

/** Shared action link/button classnames used by every cockpit page. */
export const primaryActionClass =
  "inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-theme-sm font-medium text-white shadow-theme-xs transition hover:bg-brand-600 sm:w-auto";

export const secondaryActionClass =
  "inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-theme-sm font-medium text-gray-700 shadow-theme-xs transition hover:bg-gray-50 hover:text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03] dark:hover:text-gray-200 sm:w-auto";

export function Panel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 pb-4 pt-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6 ${
        className ?? ""
      }`}
    >
      {children}
    </section>
  );
}

export function PanelHeader({
  action,
  description,
  title,
}: {
  action?: ReactNode;
  description?: ReactNode;
  title: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
          {title}
        </h3>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-500 dark:text-gray-400">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function PanelBody({
  children,
  spaced,
}: {
  children: ReactNode;
  spaced?: boolean;
}) {
  return <div className={spaced ? "space-y-5" : undefined}>{children}</div>;
}

export function FormPanel({
  action,
  as = "section",
  children,
  description,
  onSubmit,
  title,
}: {
  action?: ReactNode;
  as?: "form" | "section";
  children: ReactNode;
  description?: ReactNode;
  onSubmit?: FormEventHandler<HTMLFormElement>;
  title: ReactNode;
}) {
  const content = (
    <>
      <div className="px-5 py-4 sm:px-6 sm:py-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h3 className="text-base font-medium text-gray-800 dark:text-white/90">
              {title}
            </h3>
            {description ? (
              <p className="mt-1 text-theme-sm leading-6 text-gray-500 dark:text-gray-400">
                {description}
              </p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      </div>
      <div className="space-y-6 border-t border-gray-100 p-5 dark:border-gray-800 sm:p-6">
        {children}
      </div>
    </>
  );

  const className =
    "rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]";

  if (as === "form") {
    return (
      <form className={className} onSubmit={onSubmit}>
        {content}
      </form>
    );
  }

  return <section className={className}>{content}</section>;
}

export function Notice({
  text,
  title,
  tone,
}: {
  text?: ReactNode;
  title: ReactNode;
  tone: NoticeTone;
}) {
  const toneConfig = noticeToneConfig(tone);
  return (
    <div className={`rounded-xl border p-4 ${toneConfig.className}`}>
      <div className="flex items-start gap-3">
        <div className={`-mt-0.5 shrink-0 ${toneConfig.iconClassName}`}>
          {toneConfig.icon}
        </div>
        <div className="min-w-0">
          <p className="mb-1 text-sm font-semibold text-gray-800 dark:text-white/90">
            {title}
          </p>
          {text ? (
            <p className="break-words text-sm leading-6 text-gray-500 dark:text-gray-400">
              {text}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Compact notice variant (no title/text split) used by the workbench steps.
 * Kept for compatibility; prefer <Notice title=.../> for new code.
 */
export function InlineNotice({
  message,
  title,
  tone,
}: {
  message: ReactNode;
  title: ReactNode;
  tone: NoticeTone;
}) {
  return (
    <div className={`rounded-xl border p-4 ${noticeToneConfig(tone).className}`}>
      <div className="flex items-start gap-3">
        <div className={`-mt-0.5 shrink-0 ${noticeToneConfig(tone).iconClassName}`}>
          {noticeToneConfig(tone).icon}
        </div>
        <div className="min-w-0">
          <p className="mb-1 text-sm font-semibold text-gray-800 dark:text-white/90">
            {title}
          </p>
          <p className="break-words text-sm leading-6 text-gray-500 dark:text-gray-400">
            {message}
          </p>
        </div>
      </div>
    </div>
  );
}

export function Fact({
  label,
  tone,
  value,
}: {
  label: ReactNode;
  tone?: FactTone;
  value: ReactNode;
}) {
  return (
    <div className="rounded-lg bg-gray-50 p-3 dark:bg-white/[0.02]">
      {tone ? (
        <div className="flex items-start justify-between gap-2">
          <p className="text-theme-xs text-gray-500 dark:text-gray-400">
            {label}
          </p>
          <Badge color={tone} size="sm">
            {tone === "success"
              ? "ปกติ"
              : tone === "warning"
                ? "ต้องดู"
                : tone === "error"
                  ? "สำคัญ"
                  : "ข้อมูล"}
          </Badge>
        </div>
      ) : (
        <p className="text-theme-xs text-gray-500 dark:text-gray-400">{label}</p>
      )}
      <p className="mt-1 break-words text-theme-sm font-semibold text-gray-800 dark:text-white/90">
        {value || "-"}
      </p>
    </div>
  );
}

export function Field({
  children,
  help,
  label,
}: {
  children: ReactNode;
  help?: ReactNode;
  label: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
        {label}
      </span>
      {children}
      {help ? (
        <span className="mt-1.5 block text-xs leading-5 text-gray-500 dark:text-gray-400">
          {help}
        </span>
      ) : null}
    </label>
  );
}

export function TechnicalDetails({
  children,
  defaultOpen = false,
  description,
  embedded = false,
  title = "รายละเอียดเทคนิค",
}: {
  children: ReactNode;
  defaultOpen?: boolean;
  description?: ReactNode;
  embedded?: boolean;
  title?: ReactNode;
}) {
  return (
    <details
      className={
        embedded
          ? "rounded-xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-white/[0.02]"
          : "rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03] sm:p-5"
      }
      open={defaultOpen}
    >
      <summary className="cursor-pointer list-none text-base font-medium text-gray-800 marker:hidden dark:text-white/90">
        <span className="inline-flex items-center gap-2">
          {title}
          <span className="text-theme-xs font-normal text-gray-500 dark:text-gray-400">
            กดเพื่อดูข้อมูลสำหรับทีมดูแลระบบ
          </span>
        </span>
      </summary>
      {description ? (
        <p className="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400">
          {description}
        </p>
      ) : null}
      <div className="mt-4">{children}</div>
    </details>
  );
}

function noticeToneConfig(tone: NoticeTone): {
  className: string;
  icon: ReactNode;
  iconClassName: string;
} {
  switch (tone) {
    case "error":
      return {
        className:
          "border-error-500 bg-error-50 dark:border-error-500/30 dark:bg-error-500/15",
        icon: <AlertIcon className="size-6 fill-current" />,
        iconClassName: "text-error-500",
      };
    case "warning":
      return {
        className:
          "border-warning-500 bg-warning-50 dark:border-warning-500/30 dark:bg-warning-500/15",
        icon: <AlertIcon className="size-6 fill-current" />,
        iconClassName: "text-warning-500 dark:text-orange-400",
      };
    case "success":
      return {
        className:
          "border-success-500 bg-success-50 dark:border-success-500/30 dark:bg-success-500/15",
        icon: <CheckCircleIcon className="size-6 fill-current" />,
        iconClassName: "text-success-500",
      };
    default:
      return {
        className:
          "border-blue-light-500 bg-blue-light-50 dark:border-blue-light-500/30 dark:bg-blue-light-500/15",
        icon: <InfoIcon className="size-6 fill-current" />,
        iconClassName: "text-blue-light-500 dark:text-blue-light-400",
      };
  }
}

/** Bangkok-aware date+time formatter shared across cockpit pages. */
export function formatDateTime(value?: string | null): string {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

export function formatTenantStatus(status: string): string {
  const labels: Record<string, string> = {
    active: "ใช้งาน",
    cancelled: "ยกเลิก",
    past_due: "ค้างชำระ",
    suspended: "ระงับ",
    trial: "ทดลองใช้",
  };
  return labels[status] ?? status;
}

export function tenantStatusColor(
  status: string,
): FactTone {
  if (status === "active" || status === "trial") {
    return "success";
  }
  if (status === "past_due") {
    return "warning";
  }
  if (status === "suspended" || status === "cancelled") {
    return "error";
  }
  return "light";
}

export function formatRunStatus(status?: string | null): string {
  if (!status) {
    return "ยังไม่มี";
  }
  const labels: Record<string, string> = {
    failed: "ล้มเหลว",
    queued: "รอคิว",
    running: "กำลังรัน",
    success: "สำเร็จ",
    success_with_warnings: "สำเร็จพร้อมข้อสังเกต",
  };
  return labels[status] ?? status;
}

export function formatLineDeliveryStatus(status?: string | null): string {
  if (!status) {
    return "ยังไม่ทราบ";
  }
  const labels: Record<string, string> = {
    failed: "ส่งไม่สำเร็จ",
    skipped: "ข้าม",
    success: "ส่งแล้ว",
  };
  return labels[status] ?? status;
}

export function formatPlanCode(value?: string | null): string {
  if (!value) {
    return "ไม่ระบุแพ็กเกจ";
  }
  const labels: Record<string, string> = {
    business: "ร้านใหญ่",
    pro: "ร้านใหญ่ Pro",
    starter: "ร้านเล็ก",
  };
  return labels[value] ?? value;
}
