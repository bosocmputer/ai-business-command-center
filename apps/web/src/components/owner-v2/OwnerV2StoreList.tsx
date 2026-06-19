"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import {
  AlertIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  GroupIcon,
  InfoIcon,
  PlusIcon,
} from "@/icons";
import { isAbortError, ownerV2Fetch } from "./api";
import type {
  OwnerV2Tenant,
  OwnerV2WorkbenchPayload,
} from "./types";

type StoreListState =
  | { status: "loading" }
  | { status: "auth_required"; message: string }
  | { status: "error"; message: string }
  | { status: "success"; data: OwnerV2WorkbenchPayload };

type StoreFilter = "all" | "needs_action" | "ready" | "signals";

const emptyTenants: OwnerV2Tenant[] = [];

const primaryActionClass =
  "inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-theme-sm font-medium text-white shadow-theme-xs transition hover:bg-brand-600 sm:w-auto";

const secondaryActionClass =
  "inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-theme-sm font-medium text-gray-700 shadow-theme-xs transition hover:bg-gray-50 hover:text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03] dark:hover:text-gray-200 sm:w-auto";

export default function OwnerV2StoreList() {
  const [state, setState] = useState<StoreListState>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StoreFilter>("all");

  const load = useCallback(async (signal?: AbortSignal) => {
    setState({ status: "loading" });
    try {
      const data = await ownerV2Fetch<OwnerV2WorkbenchPayload>(
        "/api/owner/workbench",
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
      const statusCode = (error as Error & { status?: number }).status;
      const message =
        error instanceof Error
          ? error.message
          : "โหลดรายชื่อร้านไม่สำเร็จ";
      setState(
        statusCode === 401 || statusCode === 403
          ? {
              status: "auth_required",
              message: "สิทธิ์ผู้ดูแลหมดอายุ กรุณาเข้าสู่ระบบใหม่",
            }
          : { status: "error", message },
      );
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const tenants = state.status === "success" ? state.data.tenants : emptyTenants;
  const counts = useMemo(() => summarizeTenants(tenants), [tenants]);
  const filteredTenants = useMemo(() => {
    const normalizedQuery = normalizeText(query);
    return tenants.filter((tenant) => {
      if (filter === "ready" && !tenant.ready) {
        return false;
      }
      if (filter === "needs_action" && tenant.ready) {
        return false;
      }
      if (filter === "signals" && tenant.health.critical_business_signals <= 0) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      return normalizeText(
        `${tenant.name} ${tenant.id} ${tenant.status} ${tenant.next_action?.label ?? ""}`,
      ).includes(normalizedQuery);
    });
  }, [filter, query, tenants]);

  if (state.status === "loading") {
    return <StoreListSkeleton />;
  }

  if (state.status === "auth_required") {
    return (
      <EmptyState
        action={
          <Link className={primaryActionClass} href="/signin">
            เข้าสู่ระบบใหม่
          </Link>
        }
        detail={state.message}
        title="ต้องเข้าสู่ระบบผู้ดูแล"
        tone="warning"
      />
    );
  }

  if (state.status === "error") {
    return (
      <EmptyState
        action={
          <Button onClick={() => void load()} type="button" variant="outline">
            โหลดรายชื่อร้านใหม่
          </Button>
        }
        detail={`${state.message} ลองรีเฟรชอีกครั้ง หรือตรวจสิทธิ์ผู้ดูแล`}
        title="โหลดรายชื่อร้านไม่สำเร็จ"
        tone="error"
      />
    );
  }

  if (!tenants.length) {
    return (
      <EmptyState
        action={
          <Link className={primaryActionClass} href="/owner-v2/stores/new">
            <PlusIcon className="h-4 w-4" />
            เพิ่มร้านแรก
          </Link>
        }
        detail="เริ่มจากสร้างร้าน แล้วค่อยเชื่อม SML, LINE, สิทธิ์ และแผนแจ้งเตือน"
        title="ยังไม่มีร้านในระบบ"
        tone="info"
      />
    );
  }

  const filters: Array<{ id: StoreFilter; label: string; count: number }> = [
    { id: "all", label: "ทั้งหมด", count: counts.total },
    { id: "needs_action", label: "ต้องทำต่อ", count: counts.needsAction },
    { id: "ready", label: "พร้อมใช้งาน", count: counts.ready },
    { id: "signals", label: "มีสัญญาณเตือน", count: counts.signals },
  ];

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryMetric
          icon={<GroupIcon className="h-5 w-5" />}
          label="ร้านทั้งหมด"
          tone="neutral"
          value={`${counts.total.toLocaleString("th-TH")} ร้าน`}
        />
        <SummaryMetric
          icon={<AlertIcon className="h-5 w-5" />}
          label="ต้องทำต่อ"
          tone={counts.needsAction ? "warning" : "success"}
          value={`${counts.needsAction.toLocaleString("th-TH")} ร้าน`}
        />
        <SummaryMetric
          icon={<CheckCircleIcon className="h-5 w-5" />}
          label="พร้อมใช้งาน"
          tone="success"
          value={`${counts.ready.toLocaleString("th-TH")} ร้าน`}
        />
        <SummaryMetric
          icon={<InfoIcon className="h-5 w-5" />}
          label="สัญญาณเตือน"
          tone={counts.signals ? "warning" : "neutral"}
          value={`${counts.signals.toLocaleString("th-TH")} ร้าน`}
        />
      </section>

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 pb-4 pt-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6">
        <div className="mb-4 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
              ร้านทั้งหมด
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-500 dark:text-gray-400">
              ใช้หน้านี้เพื่อหาร้าน เปิดหน้าตั้งค่า หรือไปทำงานถัดไปโดยไม่ต้องกลับหน้าแรกก่อน
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row xl:w-auto">
            <Button
              className="w-full sm:w-auto"
              onClick={() => void load()}
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

        <div className="mb-5 grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
          <input
            className="owner-v2-input"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ค้นหาชื่อร้าน, tenant id หรือสิ่งที่ต้องทำต่อ"
            value={query}
          />
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {filters.map((item) => (
              <button
                className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition ${
                  filter === item.id
                    ? "bg-brand-50 text-brand-600 ring-1 ring-brand-100 dark:bg-brand-500/10 dark:text-brand-400 dark:ring-brand-500/20"
                    : "bg-gray-50 text-gray-700 hover:bg-gray-100 dark:bg-white/[0.02] dark:text-gray-300 dark:hover:bg-white/[0.05]"
                }`}
                key={item.id}
                onClick={() => setFilter(item.id)}
                type="button"
              >
                <span>{item.label}</span>
                <span className="rounded-full bg-white px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                  {item.count.toLocaleString("th-TH")}
                </span>
              </button>
            ))}
          </div>
        </div>

        {filteredTenants.length ? (
          <>
            <div className="hidden overflow-hidden rounded-lg bg-gray-50 px-4 pb-3 pt-4 dark:bg-white/[0.02] lg:block">
              <div className="w-full overflow-x-auto">
                <table className="w-full min-w-[960px]">
                  <thead>
                    <tr className="border-y border-gray-100 dark:border-gray-800">
                      <th className="w-[28%] py-3 pr-5 text-left">
                        <span className="text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                          ร้าน
                        </span>
                      </th>
                      <th className="w-[18%] px-3 py-3 text-left">
                        <span className="text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                          ความพร้อม
                        </span>
                      </th>
                      <th className="w-[28%] px-3 py-3 text-left">
                        <span className="text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                          สิ่งที่ต้องทำ
                        </span>
                      </th>
                      <th className="w-[18%] px-3 py-3 text-left">
                        <span className="text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                          สถานะหลัก
                        </span>
                      </th>
                      <th className="px-3 py-3 text-right">
                        <span className="text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                          เปิดงาน
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {filteredTenants.map((tenant) => (
                      <StoreTableRow key={tenant.id} tenant={tenant} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-3 lg:hidden">
              {filteredTenants.map((tenant) => (
                <StoreCard key={tenant.id} tenant={tenant} />
              ))}
            </div>
          </>
        ) : (
          <div className="rounded-lg bg-gray-50 p-6 text-center dark:bg-white/[0.02]">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">
              ไม่พบร้านที่ตรงกับตัวกรอง
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-gray-500 dark:text-gray-400">
              ลองล้างคำค้นหาหรือเปลี่ยนตัวกรอง ถ้ายังไม่มีร้านให้กดเพิ่มร้านใหม่
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function StoreTableRow({ tenant }: { tenant: OwnerV2Tenant }) {
  return (
    <tr>
      <td className="py-4 pr-5 align-top">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              className="break-words text-sm font-semibold text-gray-900 transition hover:text-brand-600 dark:text-white"
              href={`/owner-v2/stores/${encodeURIComponent(tenant.id)}`}
            >
              {tenant.name}
            </Link>
            <StatusBadge status={tenant.status} />
          </div>
          <p className="mt-1 break-all text-theme-xs text-gray-500 dark:text-gray-400">
            {tenant.id}
          </p>
        </div>
      </td>
      <td className="px-3 py-4 align-top">
        <ReadinessBadge tenant={tenant} />
      </td>
      <td className="px-3 py-4 align-top">
        <p className="text-sm font-medium text-gray-800 dark:text-white/90">
          {tenant.next_action?.label ?? "พร้อมใช้งาน"}
        </p>
        <p className="mt-1 line-clamp-2 text-theme-xs leading-5 text-gray-500 dark:text-gray-400">
          {tenant.next_action?.detail ?? "ตรวจรอบแจ้งเตือนหรือเปิดหน้าลูกค้าได้เลย"}
        </p>
      </td>
      <td className="px-3 py-4 align-top">
        <CriticalSignalBadge tenant={tenant} />
      </td>
      <td className="px-3 py-4 text-right align-top">
        <Link
          className={primaryActionClass}
          href={`/owner-v2/stores/${encodeURIComponent(tenant.id)}`}
        >
          จัดการร้าน
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
      </td>
    </tr>
  );
}

function StoreCard({ tenant }: { tenant: OwnerV2Tenant }) {
  return (
    <article className="rounded-lg bg-gray-50 p-4 dark:bg-white/[0.02]">
      <div className="flex flex-col gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              className="text-sm font-semibold text-gray-900 transition hover:text-brand-600 dark:text-white"
              href={`/owner-v2/stores/${encodeURIComponent(tenant.id)}`}
            >
              {tenant.name}
            </Link>
            <StatusBadge status={tenant.status} />
          </div>
          <p className="mt-1 break-all text-theme-xs text-gray-500 dark:text-gray-400">
            {tenant.id}
          </p>
        </div>
        <div className="rounded-lg bg-white p-3 dark:bg-gray-900">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">
              {tenant.next_action?.label ?? "พร้อมใช้งาน"}
            </p>
            <ReadinessBadge tenant={tenant} />
          </div>
          <p className="text-sm leading-6 text-gray-500 dark:text-gray-400">
            {tenant.next_action?.detail ?? "ตรวจรอบแจ้งเตือนหรือเปิดหน้าลูกค้าได้เลย"}
          </p>
          {tenant.health.critical_business_signals > 0 ? (
            <div className="mt-2">
              <CriticalSignalBadge tenant={tenant} />
            </div>
          ) : null}
        </div>
        <Link
          className={primaryActionClass}
          href={`/owner-v2/stores/${encodeURIComponent(tenant.id)}`}
        >
          จัดการร้าน
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
      </div>
    </article>
  );
}

function CriticalSignalBadge({ tenant }: { tenant: OwnerV2Tenant }) {
  if (tenant.health.critical_business_signals <= 0) {
    return <Badge color="light" size="sm">ไม่มีสัญญาณสำคัญ</Badge>;
  }
  return (
    <Badge color="warning" size="sm">
      เตือน {tenant.health.critical_business_signals}
    </Badge>
  );
}

function SummaryMetric({
  icon,
  label,
  tone,
  value,
}: {
  icon: ReactNode;
  label: string;
  tone: "neutral" | "success" | "warning";
  value: string;
}) {
  const toneClass = {
    neutral: "bg-gray-100 text-gray-700 dark:bg-white/[0.05] dark:text-gray-300",
    success:
      "bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-400",
    warning:
      "bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-warning-300",
  }[tone];
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${toneClass}`}>
        {icon}
      </div>
      <p className="mt-4 text-theme-xs text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-white">
        {value}
      </p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white p-3 dark:bg-gray-900">
      <p className="text-theme-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-gray-900 dark:text-white">
        {value}
      </p>
    </div>
  );
}

function EmptyState({
  action,
  detail,
  title,
  tone,
}: {
  action: ReactNode;
  detail: string;
  title: string;
  tone: "info" | "warning" | "error";
}) {
  const toneConfig = {
    error: {
      className:
        "border-error-500 bg-error-50 dark:border-error-500/30 dark:bg-error-500/15",
      icon: <AlertIcon className="size-6 fill-current" />,
      iconClassName: "text-error-500",
    },
    info: {
      className:
        "border-blue-light-500 bg-blue-light-50 dark:border-blue-light-500/30 dark:bg-blue-light-500/15",
      icon: <InfoIcon className="size-6 fill-current" />,
      iconClassName: "text-blue-light-500 dark:text-blue-light-400",
    },
    warning: {
      className:
        "border-warning-500 bg-warning-50 dark:border-warning-500/30 dark:bg-warning-500/15",
      icon: <AlertIcon className="size-6 fill-current" />,
      iconClassName: "text-warning-500 dark:text-orange-400",
    },
  }[tone];
  return (
    <section className={`rounded-xl border p-4 ${toneConfig.className}`}>
      <div className="flex items-start gap-3">
        <div className={`-mt-0.5 shrink-0 ${toneConfig.iconClassName}`}>
          {toneConfig.icon}
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            {title}
          </h2>
          <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-300">
            {detail}
          </p>
          <div className="mt-4">{action}</div>
        </div>
      </div>
    </section>
  );
}

function StoreListSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            className="h-32 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]"
            key={index}
          />
        ))}
      </div>
      <div className="h-[560px] animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
    </div>
  );
}

function ReadinessBadge({ tenant }: { tenant: OwnerV2Tenant }) {
  return (
    <Badge color={tenant.ready ? "success" : "warning"} size="sm">
      {tenant.ready
        ? "พร้อม"
        : `${tenant.completed_steps}/${tenant.total_steps} พร้อม`}
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge color={tenantStatusColor(status)} size="sm">
      {formatTenantStatus(status)}
    </Badge>
  );
}

function summarizeTenants(tenants: OwnerV2Tenant[]) {
  return tenants.reduce(
    (summary, tenant) => {
      summary.total += 1;
      if (tenant.ready) {
        summary.ready += 1;
      } else {
        summary.needsAction += 1;
      }
      if (tenant.health.critical_business_signals > 0) {
        summary.signals += 1;
      }
      return summary;
    },
    { total: 0, ready: 0, needsAction: 0, signals: 0 },
  );
}

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function formatTenantStatus(status: string) {
  const labels: Record<string, string> = {
    active: "ใช้งาน",
    cancelled: "ยกเลิก",
    past_due: "ค้างชำระ",
    suspended: "ระงับ",
    trial: "ทดลองใช้",
  };
  return labels[status] ?? status;
}

function tenantStatusColor(
  status: string,
): "success" | "warning" | "error" | "light" {
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

function formatRunStatus(status?: string | null) {
  const labels: Record<string, string> = {
    failed: "ล้มเหลว",
    queued: "รอรัน",
    running: "กำลังรัน",
    success: "สำเร็จ",
  };
  return status ? labels[status] ?? status : "ยังไม่มี";
}
