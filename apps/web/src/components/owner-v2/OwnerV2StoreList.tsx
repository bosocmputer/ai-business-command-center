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
import {
  formatPlanCode,
  formatRunStatus,
  formatTenantStatus,
  Fact,
  Panel,
  PanelBody,
  PanelHeader,
  primaryActionClass,
  secondaryActionClass,
  tenantStatusColor,
  TechnicalDetails,
} from "./ui";

type StoreListState =
  | { status: "loading" }
  | { status: "auth_required"; message: string }
  | { status: "error"; message: string }
  | { status: "success"; data: OwnerV2WorkbenchPayload };

type StoreFilter = "all" | "needs_action" | "ready" | "signals";

const emptyTenants: OwnerV2Tenant[] = [];

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
  const priorityTenants = useMemo(
    () =>
      [...tenants]
        .filter(
          (tenant) =>
            !tenant.ready || tenant.health.critical_business_signals > 0,
        )
        .sort(compareStorePriority)
        .slice(0, 3),
    [tenants],
  );
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
        `${tenant.name} ${formatPlanCode(tenant.plan_code)} ${formatTenantStatus(
          tenant.status,
        )} ${tenant.next_action?.label ?? ""} ${tenant.next_action?.detail ?? ""}`,
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
        detail="ลองโหลดรายชื่อร้านใหม่อีกครั้ง ถ้ายังไม่สำเร็จให้ตรวจสิทธิ์ผู้ดูแลและการเชื่อมต่อระบบกลาง"
        technicalDetail={state.message}
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

      <StorePriorityPanel tenants={priorityTenants} />

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 pb-3 pt-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6">
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

        <div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <input
            className="owner-v2-input xl:max-w-md"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ค้นหาชื่อร้านหรือสิ่งที่ต้องทำต่อ"
            value={query}
          />
          {/* Segmented filter toggle — TailAdmin chart-03 pattern */}
          <div className="grid grid-cols-2 items-center gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-900 sm:inline-grid sm:grid-cols-4">
            {filters.map((item) => (
              <button
                aria-pressed={filter === item.id}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-theme-sm font-medium transition ${
                  filter === item.id
                    ? "bg-white text-gray-900 shadow-theme-xs dark:bg-gray-800 dark:text-white"
                    : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                }`}
                key={item.id}
                onClick={() => setFilter(item.id)}
                type="button"
              >
                <span>{item.label}</span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${
                    filter === item.id
                      ? "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400"
                      : "bg-gray-200 text-gray-500 dark:bg-white/[0.05] dark:text-gray-400"
                  }`}
                >
                  {item.count.toLocaleString("th-TH")}
                </span>
              </button>
            ))}
          </div>
        </div>

        {filteredTenants.length ? (
          <>
            {/* Desktop table — TailAdmin table-01 pattern. Store name and
                actions are explicit links so admins have predictable targets.
                w-full on the table itself so columns fill the card width (the
                min-w only kicks in on a very narrow lg viewport to allow scroll). */}
            <div className="hidden w-full overflow-x-auto lg:block">
              <table className="w-full min-w-[920px]">
                <thead>
                  <tr className="border-y border-gray-100 dark:border-gray-800">
                    <th className="w-[25%] py-3 pr-5 text-left">
                      <span className="text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                        ร้าน
                      </span>
                    </th>
                    <th className="w-[16%] px-3 py-3 text-left">
                      <span className="text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                        ความพร้อม
                      </span>
                    </th>
                    <th className="w-[17%] px-3 py-3 text-left">
                      <span className="text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                        LINE
                      </span>
                    </th>
                    <th className="w-[19%] px-3 py-3 text-left">
                      <span className="text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                        รอบล่าสุด
                      </span>
                    </th>
                    <th className="w-[23%] px-3 py-3 text-left">
                      <span className="text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                        สิ่งที่ต้องทำต่อ
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

            <div className="space-y-3 lg:hidden">
              {filteredTenants.map((tenant) => (
                <StoreCard key={tenant.id} tenant={tenant} />
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-xl bg-gray-50 p-10 text-center dark:bg-white/[0.02]">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-400 dark:bg-white/[0.05] dark:text-gray-500">
              <InfoIcon className="h-6 w-6" />
            </span>
            <div>
              <p className="text-base font-semibold text-gray-800 dark:text-white/90">
                ไม่พบร้านที่ตรงกับตัวกรอง
              </p>
              <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-gray-500 dark:text-gray-400">
                ลองล้างคำค้นหาหรือเปลี่ยนตัวกรอง ถ้ายังไม่มีร้านให้กดเพิ่มร้านใหม่
              </p>
            </div>
            <Link className={primaryActionClass} href="/owner-v2/stores/new">
              <PlusIcon className="h-4 w-4" />
              เพิ่มร้านใหม่
            </Link>
            <Button
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
              type="button"
              variant="outline"
            >
              ล้างตัวกรอง
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

function StorePriorityPanel({ tenants }: { tenants: OwnerV2Tenant[] }) {
  if (!tenants.length) {
    return null;
  }
  return (
    <Panel>
      <PanelHeader
        action={
          <Badge color="warning" size="sm">
            {tenants.length.toLocaleString("th-TH")} ร้าน
          </Badge>
        }
        description="หยิบร้านที่ควรตรวจจากความพร้อมและสัญญาณสำคัญ เพื่อให้ทีมเริ่มแก้จากเรื่องที่กระทบการส่ง LINE หรือการใช้งานก่อน"
        title="สิ่งที่ควรทำก่อน"
      />
      <PanelBody>
        <div className="grid gap-3 lg:grid-cols-3">
          {tenants.map((tenant) => {
            const href = `/owner-v2/stores/${encodeURIComponent(tenant.id)}`;
            const action = getPrimaryStoreAction(tenant, href);
            const hasCritical = tenant.health.critical_business_signals > 0;
            return (
              <article
                className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-white/[0.02]"
                key={tenant.id}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 break-words text-sm font-semibold text-gray-900 dark:text-white">
                    {tenant.name}
                  </p>
                  <Badge color={hasCritical ? "error" : "warning"} size="sm">
                    {hasCritical ? "มีสัญญาณสำคัญ" : "ต้องทำต่อ"}
                  </Badge>
                </div>
                <p className="mt-2 text-sm font-medium text-gray-800 dark:text-white/90">
                  {tenant.next_action?.label ?? "ตรวจระบบร้าน"}
                </p>
                <p className="mt-1 line-clamp-2 text-theme-xs leading-5 text-gray-500 dark:text-gray-400">
                  {tenant.next_action?.detail ??
                    "เปิดร้านเพื่อตรวจความพร้อม LINE, รายงาน และรอบแจ้งเตือนล่าสุด"}
                </p>
                <div className="mt-4">
                  <Link className={primaryActionClass} href={action.href}>
                    {action.label}
                    <ArrowRightIcon className="h-4 w-4" />
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      </PanelBody>
    </Panel>
  );
}

function StoreTableRow({ tenant }: { tenant: OwnerV2Tenant }) {
  const href = `/owner-v2/stores/${encodeURIComponent(tenant.id)}`;
  const systemHref = `${href}?tab=system`;
  const hasCritical = tenant.health.critical_business_signals > 0;
  const nextAction = getPrimaryStoreAction(tenant, href);
  return (
    <tr className="group transition hover:bg-gray-50 dark:hover:bg-white/[0.03]">
      <td className="py-4 pr-5 align-middle">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              className="break-words text-sm font-semibold text-gray-900 transition hover:text-brand-600 dark:text-white dark:hover:text-brand-400"
              href={href}
            >
              {tenant.name}
            </Link>
            <StatusBadge status={tenant.status} />
          </div>
          <p className="mt-1 break-all text-theme-xs text-gray-500 dark:text-gray-400">
            แพ็กเกจ {formatPlanCode(tenant.plan_code)}
          </p>
        </div>
      </td>
      <td className="px-3 py-4 align-middle">
        <ReadinessCell tenant={tenant} />
      </td>
      <td className="px-3 py-4 align-middle">
        <StatusStack
          detail={`แผนแจ้งเตือน ${tenant.health.notification_rules_enabled.toLocaleString(
            "th-TH",
          )} แผน`}
          label="ผู้รับ LINE"
          tone={
            tenant.health.line_targets_enabled > 0 &&
            tenant.health.notification_rules_enabled > 0
              ? "success"
              : "warning"
          }
          value={`${tenant.health.line_targets_enabled.toLocaleString(
            "th-TH",
          )} ราย`}
        />
      </td>
      <td className="px-3 py-4 align-middle">
        <StatusStack
          detail={`รอบส่ง ${formatRunStatus(
            tenant.health.latest_notification_run_status,
          )}`}
          label="รายงาน"
          tone={runStatusTone(tenant.health.latest_report_status)}
          value={formatRunStatus(tenant.health.latest_report_status)}
        />
      </td>
      <td className="px-3 py-4 align-middle">
        <p className="text-sm font-medium text-gray-800 dark:text-white/90">
          {tenant.next_action?.label ?? "พร้อมใช้งาน"}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <p className="line-clamp-1 text-theme-xs leading-5 text-gray-500 dark:text-gray-400">
            {tenant.next_action?.detail ?? "ตรวจรอบแจ้งเตือนหรือเปิดหน้าลูกค้าได้เลย"}
          </p>
          {hasCritical ? (
            <Badge color="error" size="sm">
              {tenant.health.critical_business_signals} สัญญาณสำคัญ
            </Badge>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link className={primaryActionClass} href={nextAction.href}>
            {nextAction.label}
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
          {nextAction.href !== systemHref ? (
            <Link className={secondaryActionClass} href={systemHref}>
              ตรวจระบบร้าน
            </Link>
          ) : null}
        </div>
        <StoreQuickLinks baseHref={href} compact />
      </td>
    </tr>
  );
}

function StoreCard({ tenant }: { tenant: OwnerV2Tenant }) {
  const href = `/owner-v2/stores/${encodeURIComponent(tenant.id)}`;
  const systemHref = `${href}?tab=system`;
  const hasCritical = tenant.health.critical_business_signals > 0;
  const nextAction = getPrimaryStoreAction(tenant, href);
  return (
    <article className="rounded-2xl border border-gray-200 bg-white p-4 transition hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:bg-white/[0.03] dark:hover:border-gray-700 dark:hover:bg-white/[0.05]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-gray-900 dark:text-white">
          {tenant.name}
        </span>
        <StatusBadge status={tenant.status} />
        <ReadinessBadge tenant={tenant} />
      </div>
      <p className="mt-1 break-all text-theme-xs text-gray-500 dark:text-gray-400">
        แพ็กเกจ {formatPlanCode(tenant.plan_code)}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <MobileFact
          label="LINE"
          value={`${tenant.health.line_targets_enabled.toLocaleString(
            "th-TH",
          )} ผู้รับ`}
        />
        <MobileFact
          label="แผนแจ้งเตือน"
          value={`${tenant.health.notification_rules_enabled.toLocaleString(
            "th-TH",
          )} แผน`}
        />
        <MobileFact
          label="รายงานล่าสุด"
          value={formatRunStatus(tenant.health.latest_report_status)}
        />
        <MobileFact
          label="รอบส่งล่าสุด"
          value={formatRunStatus(tenant.health.latest_notification_run_status)}
        />
      </div>
      <div className="mt-3">
        <p className="text-sm font-medium text-gray-800 dark:text-white/90">
          {tenant.next_action?.label ?? "พร้อมใช้งาน"}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <p className="line-clamp-2 text-theme-xs leading-5 text-gray-500 dark:text-gray-400">
            {tenant.next_action?.detail ?? "ตรวจรอบแจ้งเตือนหรือเปิดหน้าลูกค้าได้เลย"}
          </p>
          {hasCritical ? (
            <Badge color="error" size="sm">
              {tenant.health.critical_business_signals} สัญญาณสำคัญ
            </Badge>
          ) : null}
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Link className={primaryActionClass} href={nextAction.href}>
          {nextAction.label}
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
        {nextAction.href !== href ? (
          <Link className={secondaryActionClass} href={href}>
            เปิดร้าน
          </Link>
        ) : null}
        {nextAction.href !== systemHref ? (
          <Link className={secondaryActionClass} href={systemHref}>
            ตรวจระบบร้าน
          </Link>
        ) : null}
      </div>
      <StoreQuickLinks baseHref={href} />
    </article>
  );
}

function StoreQuickLinks({
  baseHref,
  compact = false,
}: {
  baseHref: string;
  compact?: boolean;
}) {
  const links = [
    { href: `${baseHref}/line`, label: "LINE" },
    { href: `${baseHref}/notifications`, label: "แผนแจ้งเตือน" },
    { href: `${baseHref}/reports`, label: "รายงาน" },
    { href: `${baseHref}/ai-ceo`, label: "AI CEO" },
  ];
  return (
    <div
      className={
        compact
          ? "mt-2 flex flex-wrap gap-1.5"
          : "mt-3 grid grid-cols-2 gap-2"
      }
    >
      {links.map((item) => (
        <Link
          className={`inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white text-theme-xs font-medium text-gray-700 shadow-theme-xs transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-600 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300 dark:hover:border-brand-500/30 dark:hover:bg-brand-500/10 dark:hover:text-brand-400 ${
            compact ? "px-2.5 py-1.5" : "px-3 py-2"
          }`}
          href={item.href}
          key={item.href}
        >
          {item.label}
        </Link>
      ))}
    </div>
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
  // TailAdmin metric-group-01 pattern: h-12 w-12 icon tile (rounded-xl),
  // label + value row, then text-title-sm font-bold value.
  const toneClass = {
    neutral: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-white/90",
    success:
      "bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-500",
    warning:
      "bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-orange-400",
  }[tone];
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
      <div
        className={`flex h-12 w-12 items-center justify-center rounded-xl ${toneClass}`}
      >
        {icon}
      </div>
      <p className="mt-5 text-sm text-gray-500 dark:text-gray-400">{label}</p>
      <h4 className="mt-2 text-title-sm font-bold text-gray-800 dark:text-white/90">
        {value}
      </h4>
    </div>
  );
}

function EmptyState({
  action,
  detail,
  technicalDetail,
  title,
  tone,
}: {
  action: ReactNode;
  detail: string;
  technicalDetail?: string;
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
          {technicalDetail ? (
            <div className="mt-4">
              <TechnicalDetails embedded title="รายละเอียดสำหรับทีมดูแลระบบ">
                <Fact label="ข้อความระบบ" value={technicalDetail} />
              </TechnicalDetails>
            </div>
          ) : null}
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

function ReadinessCell({ tenant }: { tenant: OwnerV2Tenant }) {
  const percent =
    tenant.total_steps > 0
      ? Math.round((tenant.completed_steps / tenant.total_steps) * 100)
      : 0;
  return (
    <div className="min-w-[140px]">
      <div className="flex items-center justify-between gap-2">
        <ReadinessBadge tenant={tenant} />
        <span className="text-theme-xs font-medium text-gray-500 dark:text-gray-400">
          {percent}%
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
        <div
          className={`h-full rounded-full ${
            tenant.ready ? "bg-success-500" : "bg-warning-500"
          }`}
          style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }}
        />
      </div>
      <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
        {tenant.completed_steps.toLocaleString("th-TH")}/
        {tenant.total_steps.toLocaleString("th-TH")} ขั้นตอน
      </p>
    </div>
  );
}

function StatusStack({
  detail,
  label,
  tone,
  value,
}: {
  detail: string;
  label: string;
  tone: "success" | "warning" | "error" | "light";
  value: string;
}) {
  return (
    <div className="min-w-[130px]">
      <p className="text-theme-xs text-gray-500 dark:text-gray-400">{label}</p>
      <div className="mt-1">
        <Badge color={tone} size="sm">
          {value}
        </Badge>
      </div>
      <p className="mt-1 text-theme-xs leading-5 text-gray-500 dark:text-gray-400">
        {detail}
      </p>
    </div>
  );
}

function MobileFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3 dark:bg-white/[0.02]">
      <p className="text-theme-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 break-words text-theme-sm font-semibold text-gray-800 dark:text-white/90">
        {value}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge color={tenantStatusColor(status)} size="sm">
      {formatTenantStatus(status)}
    </Badge>
  );
}

function getPrimaryStoreAction(tenant: OwnerV2Tenant, fallbackHref: string) {
  if (tenant.next_action) {
    return {
      href: tenant.next_action.href,
      label: tenant.next_action.action_label || "ทำขั้นถัดไป",
    };
  }
  return { href: fallbackHref, label: "เปิดร้าน" };
}

function runStatusTone(
  status?: string | null,
): "success" | "warning" | "error" | "light" {
  if (!status) {
    return "light";
  }
  if (status === "success") {
    return "success";
  }
  if (status === "failed") {
    return "error";
  }
  return "warning";
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

function compareStorePriority(left: OwnerV2Tenant, right: OwnerV2Tenant) {
  return storePriorityScore(right) - storePriorityScore(left);
}

function storePriorityScore(tenant: OwnerV2Tenant) {
  let score = 0;
  score += tenant.health.critical_business_signals * 100;
  if (!tenant.ready) {
    score += 50;
  }
  score += Math.max(tenant.total_steps - tenant.completed_steps, 0) * 5;
  if (tenant.health.latest_notification_run_status === "failed") {
    score += 30;
  }
  if (tenant.health.latest_report_status === "failed") {
    score += 30;
  }
  if (tenant.health.line_targets_enabled <= 0) {
    score += 10;
  }
  return score;
}

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}
