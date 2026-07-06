"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import Badge from "@/components/ui/badge/Badge";
import { AlertIcon, ArrowRightIcon, CheckCircleIcon, InfoIcon } from "@/icons";
import type {
  OwnerV2Cockpit,
  OwnerV2CockpitHealthCell,
  OwnerV2CockpitTone,
  OwnerV2ProofStrip,
} from "./types";
import {
  formatTenantStatus,
  primaryActionClass,
  secondaryActionClass,
  tenantStatusColor,
} from "./ui";

export default function OwnerV2Cockpit({ cockpit }: { cockpit: OwnerV2Cockpit }) {
  // Defensive guard: if a future API change ever returns a cockpit without
  // next_action (or the whole payload null), rendering the panels below would
  // throw and blank the entire Workbench. Fail to a neutral fallback instead.
  if (!cockpit || !cockpit.next_action) {
    return (
      <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
          ยังไม่พร้อมแสดงสถานะ
        </h2>
        <p className="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400">
          ระบบกำลังคำนวณสถานะและลำดับความสำคัญ ลองรีเฟรชในอีกครู่
        </p>
      </section>
    );
  }
  return (
    <div className="space-y-5">
      <NextActionPanel cockpit={cockpit} />
      <StoreHealthMatrix cockpit={cockpit} />
      <ProofStripBoard proofStrips={cockpit.proof_strips ?? []} />
    </div>
  );
}

function NextActionPanel({ cockpit }: { cockpit: OwnerV2Cockpit }) {
  const action = cockpit.next_action;
  const toneConfig = toneConfigFor(action.tone);
  return (
    <section
      className={`rounded-2xl border p-5 ${toneConfig.className} md:p-6`}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`-mt-0.5 shrink-0 ${toneConfig.iconClassName}`}>
              {toneConfig.icon}
            </span>
            <h2 className="text-theme-lg font-semibold text-gray-800 dark:text-white/90">
              {formatAdminCopy(action.title)}
            </h2>
          </div>
          <p className="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400">
            {formatAdminCopy(action.description)}
          </p>
          {action.tenant_name ? (
            <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
              เกี่ยวกับร้าน: {action.tenant_name}
            </p>
          ) : null}
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Link className={primaryActionClass} href={action.href}>
            {formatAdminCopy(action.action_label)}
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
          <Link className={secondaryActionClass} href="/owner-v2/ops">
            ศูนย์ตรวจระบบ
          </Link>
        </div>
      </div>
    </section>
  );
}

function StoreHealthMatrix({ cockpit }: { cockpit: OwnerV2Cockpit }) {
  if (!cockpit.health_matrix?.length) {
    return null;
  }
  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex flex-col gap-2 border-b border-gray-100 px-4 py-4 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
            สถานะร้านทั้งหมด
          </h3>
          <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
            ดูจุดติดขัดหลักของแต่ละร้านในตารางเดียว คลิกแถวเพื่อจัดการต่อ
          </p>
        </div>
        <Badge color="light">
          {(cockpit.active_tenant_count ?? 0).toLocaleString("th-TH")} ร้านที่ใช้งาน
        </Badge>
      </div>
      <div className="space-y-3 p-4 lg:hidden">
        {cockpit.health_matrix.map((row) => (
          <HealthMatrixMobileCard key={row.tenant_id} row={row} />
        ))}
      </div>
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[760px]">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800">
              <th className="px-4 py-3 text-left sm:px-6">
                <span className="text-theme-xs font-medium uppercase text-gray-400 dark:text-gray-500">
                  ร้าน
                </span>
              </th>
              {HEALTH_MATRIX_COLUMNS.map((column) => (
                <th className="px-3 py-3 text-left" key={column.key}>
                  <span className="text-theme-xs font-medium uppercase text-gray-400 dark:text-gray-500">
                    {column.label}
                  </span>
                </th>
              ))}
              <th className="px-4 py-3 text-right sm:px-6">
                <span className="text-theme-xs font-medium uppercase text-gray-400 dark:text-gray-500">
                  จัดการ
                </span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {cockpit.health_matrix.map((row) => (
              <HealthMatrixRow key={row.tenant_id} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function HealthMatrixRow({
  row,
}: {
  row: OwnerV2Cockpit["health_matrix"][number];
}) {
  const cells = healthMatrixCells(row);
  return (
    <tr className="transition hover:bg-gray-50 dark:hover:bg-white/[0.03]">
      <td className="px-4 py-3 align-top sm:px-6">
        <Link
          className="text-sm font-semibold text-gray-900 transition hover:text-brand-600 dark:text-white"
          href={row.href}
        >
          {row.tenant_name}
        </Link>
        <p className="mt-1 line-clamp-2 text-theme-xs leading-5 text-gray-500 dark:text-gray-400">
          {formatAdminCopy(row.next_action_label)}
        </p>
      </td>
      {cells.map((entry) => (
        <td className="px-3 py-3 align-top" key={entry.key}>
          <Badge color={entry.cell.tone} size="sm">
            {entry.cell.label}
          </Badge>
        </td>
      ))}
      <td className="px-4 py-3 text-right align-top sm:px-6">
        <Link className={secondaryActionClass} href={row.href}>
          จัดการ
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
      </td>
    </tr>
  );
}

function HealthMatrixMobileCard({
  row,
}: {
  row: OwnerV2Cockpit["health_matrix"][number];
}) {
  return (
    <article className="rounded-xl bg-gray-50 p-4 dark:bg-white/[0.02]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            className="text-sm font-semibold text-gray-900 transition hover:text-brand-600 dark:text-white"
            href={row.href}
          >
            {row.tenant_name}
          </Link>
          <p className="mt-1 line-clamp-2 text-theme-xs leading-5 text-gray-500 dark:text-gray-400">
            {formatAdminCopy(row.next_action_label)}
          </p>
        </div>
        <Badge color={tenantStatusColor(row.status)} size="sm">
          {formatTenantStatus(row.status)}
        </Badge>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {healthMatrixCells(row).map((entry) => (
          <div
            className="rounded-lg bg-white p-2.5 dark:bg-white/[0.03]"
            key={entry.key}
          >
            <p className="text-theme-xs text-gray-500 dark:text-gray-400">
              {entry.label}
            </p>
            <Badge color={entry.cell.tone} size="sm">
              {entry.cell.label}
            </Badge>
          </div>
        ))}
      </div>
      <Link className={`${primaryActionClass} mt-3`} href={row.href}>
        เปิดร้าน
        <ArrowRightIcon className="h-4 w-4" />
      </Link>
    </article>
  );
}

function healthMatrixCells(row: OwnerV2Cockpit["health_matrix"][number]): Array<{
  label: string;
  key: string;
  cell: OwnerV2CockpitHealthCell;
}> {
  return [
    { label: "SML", key: "sml", cell: row.sml },
    { label: "LINE", key: "line", cell: row.line },
    { label: "แผน", key: "schedule", cell: row.schedule },
    { label: "รอบล่าสุด", key: "latest_run", cell: row.latest_run },
    { label: "เหตุการณ์", key: "incident", cell: row.incident },
    { label: "สัญญาณ", key: "signals", cell: row.signals },
    { label: "หลักฐาน", key: "proof", cell: row.proof },
  ];
}

function ProofStripBoard({ proofStrips }: { proofStrips: OwnerV2ProofStrip[] }) {
  const eligible = proofStrips.filter((strip) => strip.eligible);
  if (!eligible.length) {
    return null;
  }
  const totalMissing = eligible.reduce(
    (total, strip) => total + strip.missing_round_count,
    0,
  );
  const totalEvidence = eligible.reduce(
    (total, strip) => total + strip.evidence_count,
    0,
  );
  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex flex-col gap-2 border-b border-gray-100 px-4 py-4 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
            หลักฐานรอบส่ง 7 วัน
          </h3>
          <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
            วันที่มีรอบส่งจริงของร้านที่พร้อมเข้ารอบ ย้อนหลัง 7 วัน
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge color={totalEvidence > 0 ? "success" : "light"}>
            {totalEvidence.toLocaleString("th-TH")} หลักฐานสำเร็จ
          </Badge>
          <Badge color={totalMissing > 0 ? "warning" : "success"}>
            {totalMissing.toLocaleString("th-TH")} รอบขาด
          </Badge>
        </div>
      </div>
      <div className="custom-scrollbar flex max-h-[420px] flex-col gap-3 overflow-y-auto p-4 sm:p-6">
        {eligible.map((strip) => (
          <ProofStripRow key={strip.tenant_id} strip={strip} />
        ))}
      </div>
    </section>
  );
}

function ProofStripRow({ strip }: { strip: OwnerV2ProofStrip }) {
  return (
    <div className="rounded-xl bg-gray-50 p-4 dark:bg-white/[0.02]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Link
          className="text-sm font-semibold text-gray-900 transition hover:text-brand-600 dark:text-white"
          href={`/owner-v2/stores/${encodeURIComponent(strip.tenant_id)}`}
        >
          {strip.tenant_name ?? "ร้านไม่ระบุชื่อ"}
        </Link>
        <div className="flex flex-wrap gap-2">
          <Badge color="light" size="sm">
            {strip.evidence_count}/7 วันสำเร็จ
          </Badge>
          {strip.missing_round_count > 0 ? (
            <Badge color="warning" size="sm">
              ขาด {strip.missing_round_count} รอบ
            </Badge>
          ) : null}
          {strip.scheduled_failed_count > 0 ? (
            <Badge color="error" size="sm">
              ล้มเหลว {strip.scheduled_failed_count} รอบ
            </Badge>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {strip.days.map((day) => (
          <span
            className={`inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-theme-xs font-medium ${proofDayClass(
              day.status,
            )}`}
            key={day.day}
            title={`วันที่ ${day.day} · ${day.date} · ${proofDayLabel(day.status)}`}
          >
            D{day.day}
          </span>
        ))}
      </div>
      {strip.latest_success_at || strip.latest_problem_at ? (
        <p className="mt-3 text-theme-xs text-gray-500 dark:text-gray-400">
          {strip.latest_success_at
            ? `สำเร็จล่าสุด ${formatDateTime(strip.latest_success_at)}`
            : "ยังไม่มีรอบสำเร็จ"}
          {strip.latest_problem_at
            ? ` · ปัญหาล่าสุด ${formatDateTime(strip.latest_problem_at)}`
            : ""}
        </p>
      ) : null}
    </div>
  );
}

const HEALTH_MATRIX_COLUMNS = [
  { key: "sml", label: "SML" },
  { key: "line", label: "LINE" },
  { key: "schedule", label: "แผน" },
  { key: "latest_run", label: "รอบล่าสุด" },
  { key: "incident", label: "เหตุการณ์" },
  { key: "signals", label: "สัญญาณ" },
  { key: "proof", label: "หลักฐาน" },
] as const;

function toneConfigFor(tone: OwnerV2CockpitTone): {
  className: string;
  icon: ReactNode;
  iconClassName: string;
} {
  switch (tone) {
    case "error":
      return {
        className:
          "border-error-500 bg-error-50 dark:border-error-500/30 dark:bg-error-500/15",
        icon: <AlertIcon className="size-7 fill-current" />,
        iconClassName: "text-error-500",
      };
    case "warning":
      return {
        className:
          "border-warning-500 bg-warning-50 dark:border-warning-500/30 dark:bg-warning-500/15",
        icon: <AlertIcon className="size-7 fill-current" />,
        iconClassName: "text-warning-500 dark:text-orange-400",
      };
    case "success":
      return {
        className:
          "border-success-500 bg-success-50 dark:border-success-500/30 dark:bg-success-500/15",
        icon: <CheckCircleIcon className="size-7 fill-current" />,
        iconClassName: "text-success-500",
      };
    default:
      return {
        className:
          "border-blue-light-500 bg-blue-light-50 dark:border-blue-light-500/30 dark:bg-blue-light-500/15",
        icon: <InfoIcon className="size-7 fill-current" />,
        iconClassName: "text-blue-light-500 dark:text-blue-light-400",
      };
  }
}

function proofDayClass(status: OwnerV2ProofStrip["days"][number]["status"]) {
  switch (status) {
    case "success":
      return "bg-success-500/15 text-success-600 dark:text-success-400";
    case "partial":
      return "bg-blue-light-500/15 text-blue-light-600 dark:text-blue-light-400";
    case "failed":
      return "bg-error-500/15 text-error-600 dark:text-error-400";
    case "missing":
      return "bg-warning-500/15 text-warning-600 dark:text-warning-400";
    default:
      return "bg-gray-200 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400";
  }
}

function proofDayLabel(status: OwnerV2ProofStrip["days"][number]["status"]) {
  switch (status) {
    case "success":
      return "สำเร็จ";
    case "partial":
      return "รันแล้ว ยังไม่ครบ";
    case "failed":
      return "ล้มเหลว";
    case "missing":
      return "ไม่มีรอบ";
    default:
      return "ยังไม่ทราบ";
  }
}

function formatAdminCopy(value?: string | null) {
  if (!value) {
    return "";
  }
  const replacements: Array<[RegExp, string]> = [
    [/\bbusiness signals?\b/gi, "สัญญาณธุรกิจ"],
    [/\bsnapshots?\s+ล่าสุด\b/gi, "ข้อมูลล่าสุด"],
    [/\bsnapshots?\b/gi, "ข้อมูลล่าสุด"],
    [/\bblockers?\b/gi, "จุดติดขัด"],
    [/\bactive\b/gi, "ใช้งาน"],
  ];
  return replacements.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value,
  )
    .replace(/ข้อมูลล่าสุด\s+ล่าสุด/g, "ข้อมูลล่าสุด")
    .replace(/จัดการ\s+สัญญาณธุรกิจ/g, "จัดการสัญญาณธุรกิจ")
    .replace(/จาก\s+ข้อมูลล่าสุด/g, "จากข้อมูลล่าสุด");
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}
