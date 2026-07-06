"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import {
  AlertIcon,
  BellIcon,
  BoxCubeIcon,
  CheckCircleIcon,
  InfoIcon,
  PlugInIcon,
  TimeIcon,
} from "@/icons";
import { isAbortError, ownerV2Fetch } from "./api";
import {
  Fact,
  Notice,
  Panel,
  PanelBody,
  PanelHeader,
  TechnicalDetails as AdminTechnicalDetails,
  formatDateTime,
  formatRunStatus,
  primaryActionClass,
  secondaryActionClass,
} from "./ui";

type HealthSeverity = "critical" | "warning" | "ok" | "info";

type HealthCenterPayload = {
  overall: {
    status: HealthSeverity;
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
  tenants: HealthTenant[];
  incidents: HealthIncident[];
};

type HealthTenant = {
  tenant_id: string;
  tenant_name: string;
  status: HealthSeverity;
  status_label: string;
  plan_code: string;
  line: {
    status: HealthSeverity;
    label: string;
    enabled_targets: number;
    total_targets: number;
    latest_delivery_at: string | null;
    latest_delivery_status: string | null;
  };
  notification: {
    status: HealthSeverity;
    label: string;
    enabled_rules: number;
    latest_run_at: string | null;
    latest_run_status: string | null;
    latest_run_mode: string | null;
  };
  ai_ceo: {
    status: HealthSeverity;
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
    status: HealthSeverity;
    label: string;
    latest_run_at: string | null;
    latest_run_status: string | null;
    failed_count: number;
    warning_count: number;
  };
  datasource: {
    status: HealthSeverity;
    label: string;
    configured: boolean;
  };
  actions: Array<{ label: string; href: string }>;
};

type HealthIncident = {
  id: string;
  severity: Exclude<HealthSeverity, "ok">;
  severity_label: string;
  tenant_id: string | null;
  tenant_name: string | null;
  title: string;
  detail: string;
  action_label: string;
  action_href: string;
  occurred_at: string | null;
  system_area: "system" | "line" | "notification" | "ai_ceo" | "report" | "datasource";
};

const WINDOW_OPTIONS: Array<{ value: 24 | 72 | 168; label: string }> = [
  { value: 24, label: "24 ชม." },
  { value: 72, label: "3 วัน" },
  { value: 168, label: "7 วัน" },
];

const numberFormatter = new Intl.NumberFormat("th-TH");
const usdFormatter = new Intl.NumberFormat("th-TH", {
  currency: "USD",
  maximumFractionDigits: 4,
  style: "currency",
});

export default function OwnerV2Ops() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryWindowHours = parseWindowHours(searchParams.get("window_hours"));
  const [status, setStatus] = useState<"loading" | "success" | "error">(
    "loading",
  );
  const [windowHours, setWindowHours] = useState<24 | 72 | 168>(
    queryWindowHours,
  );
  const [data, setData] = useState<HealthCenterPayload | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const load = async (signal?: AbortSignal) => {
    setStatus("loading");
    setErrorMessage("");
    try {
      const result = await ownerV2Fetch<HealthCenterPayload>(
        `/api/owner/health-center?window_hours=${windowHours}`,
        { signal },
      );
      if (signal?.aborted) {
        return;
      }
      setData(result);
      setStatus("success");
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "โหลดศูนย์ตรวจระบบไม่สำเร็จ",
      );
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [windowHours]);

  useEffect(() => {
    setWindowHours((current) =>
      current === queryWindowHours ? current : queryWindowHours,
    );
  }, [queryWindowHours]);

  function selectWindowHours(value: 24 | 72 | 168) {
    setWindowHours(value);
    const params = new URLSearchParams(searchParams.toString());
    params.set("window_hours", value.toString());
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  if (status === "loading" && !data) {
    return <HealthCenterSkeleton />;
  }

  if (status === "error" && !data) {
    return (
      <Panel>
        <PanelBody spaced>
          <Notice
            text="ลองโหลดใหม่อีกครั้ง ถ้ายังไม่สำเร็จ ให้เข้าสู่ระบบผู้ดูแลใหม่หรือตรวจสถานะเครื่องแม่ข่าย"
            title="โหลดศูนย์ตรวจระบบไม่สำเร็จ"
            tone="error"
          />
          <AdminTechnicalDetails embedded title="รายละเอียดข้อผิดพลาด">
            <Fact label="ข้อความระบบ" value={errorMessage} />
          </AdminTechnicalDetails>
        </PanelBody>
      </Panel>
    );
  }

  const payload = data;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            ศูนย์ตรวจระบบร้านค้า
          </h2>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            สรุปสุขภาพระบบหลังบ้านจากรอบแจ้งเตือน LINE, AI CEO และรายงานล่าสุด
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <WindowSelector value={windowHours} onChange={selectWindowHours} />
          <Button
            disabled={status === "loading"}
            onClick={() => void load()}
            size="sm"
            type="button"
            variant="outline"
          >
            รีเฟรช
          </Button>
        </div>
      </div>

      {payload ? (
        <>
          <OverviewSection payload={payload} />
          <ActionSection incidents={payload.incidents} />
          <TenantSection tenants={payload.tenants} />
          <HealthTechnicalDetails payload={payload} />
        </>
      ) : null}
    </div>
  );
}

function WindowSelector({
  onChange,
  value,
}: {
  onChange: (value: 24 | 72 | 168) => void;
  value: 24 | 72 | 168;
}) {
  return (
    <div className="grid w-full grid-cols-3 rounded-lg border border-gray-200 bg-white p-1 dark:border-gray-800 dark:bg-white/[0.03] sm:inline-grid sm:w-auto">
      {WINDOW_OPTIONS.map((option) => (
        <button
          className={`rounded-md px-3 py-2 text-theme-xs font-medium transition ${
            value === option.value
              ? "bg-brand-500 text-white"
              : "text-gray-500 hover:bg-gray-50 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03] dark:hover:text-gray-200"
          }`}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function OverviewSection({ payload }: { payload: HealthCenterPayload }) {
  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <HealthMetric
        icon={<CheckCircleIcon className="h-6 w-6" />}
        label="ภาพรวมวันนี้"
        tone={payload.overall.status}
        value={payload.overall.label}
        detail={`อัปเดต ${formatDateTime(payload.overall.generated_at)}`}
      />
      <HealthMetric
        icon={<AlertIcon className="h-6 w-6" />}
        label="ต้องแก้"
        tone={payload.overall.critical_count > 0 ? "critical" : "ok"}
        value={`${numberFormatter.format(payload.overall.critical_count)} เรื่อง`}
        detail={`${numberFormatter.format(payload.summary.tenant_critical_count)} ร้าน`}
      />
      <HealthMetric
        icon={<InfoIcon className="h-6 w-6" />}
        label="ควรตรวจ"
        tone={payload.overall.warning_count > 0 ? "warning" : "ok"}
        value={`${numberFormatter.format(payload.overall.warning_count)} เรื่อง`}
        detail={`${numberFormatter.format(payload.summary.tenant_warning_count)} ร้าน`}
      />
      <HealthMetric
        icon={<BellIcon className="h-6 w-6" />}
        label="ส่ง LINE ล่าสุด"
        tone={payload.summary.line_failed_count > 0 ? "critical" : "ok"}
        value={
          payload.summary.line_failed_count > 0
            ? "มีส่งไม่สำเร็จ"
            : "ไม่พบปัญหา"
        }
        detail={`${numberFormatter.format(payload.summary.line_failed_count)} รายการส่งไม่สำเร็จ`}
      />
      <HealthMetric
        icon={<PlugInIcon className="h-6 w-6" />}
        label="AI CEO"
        tone={payload.summary.ai_ceo_warning_count > 0 ? "warning" : "ok"}
        value={
          payload.summary.ai_ceo_warning_count > 0
            ? "ควรตรวจ"
            : "พร้อมใช้งาน"
        }
        detail={`${numberFormatter.format(payload.summary.ai_ceo_warning_count)} ร้านมี warning`}
      />
    </section>
  );
}

function HealthMetric({
  detail,
  icon,
  label,
  tone,
  value,
}: {
  detail: string;
  icon: ReactNode;
  label: string;
  tone: HealthSeverity;
  value: string;
}) {
  return (
    <Panel className="px-5 pb-5 pt-5 md:px-6 md:pb-6 md:pt-6">
      <div
        className={`flex h-12 w-12 items-center justify-center rounded-xl ${toneTileClass(
          tone,
        )}`}
      >
        {icon}
      </div>
      <div className="mt-5 flex items-end justify-between gap-3">
        <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
        <Badge color={badgeColor(tone)}>{statusLabel(tone)}</Badge>
      </div>
      <h4 className="mt-2 break-words text-theme-xl font-semibold leading-7 text-gray-800 dark:text-white/90">
        {value}
      </h4>
      <p className="mt-1 break-words text-theme-xs text-gray-500 dark:text-gray-400">
        {detail}
      </p>
    </Panel>
  );
}

function ActionSection({ incidents }: { incidents: HealthIncident[] }) {
  return (
    <Panel>
      <PanelHeader
        description="เรียงจากเรื่องที่กระทบการส่งแจ้งเตือนหรือความพร้อมของร้านมากที่สุด"
        title="สิ่งที่ต้องทำก่อน"
      />
      <PanelBody spaced>
        {incidents.length ? (
          <div className="space-y-3">
            {incidents.map((incident) => (
              <IncidentRow incident={incident} key={incident.id} />
            ))}
          </div>
        ) : (
          <Notice
            text="ยังไม่พบเรื่องต้องแก้หรือควรตรวจในช่วงเวลาที่เลือก ระบบแจ้งเตือนและรายงานพร้อมใช้งาน"
            title="วันนี้ระบบปกติ"
            tone="success"
          />
        )}
      </PanelBody>
    </Panel>
  );
}

function IncidentRow({ incident }: { incident: HealthIncident }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3 dark:bg-white/[0.02]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge color={badgeColor(incident.severity)} size="sm">
              {incident.severity_label}
            </Badge>
            <span className="text-theme-xs text-gray-500 dark:text-gray-400">
              {incident.tenant_name ?? "ระบบรวม"}
            </span>
            {incident.occurred_at ? (
              <span className="text-theme-xs text-gray-500 dark:text-gray-400">
                {formatDateTime(incident.occurred_at)}
              </span>
            ) : null}
          </div>
          <h4 className="mt-2 break-words text-sm font-semibold text-gray-800 dark:text-white/90">
            {incident.title}
          </h4>
          <p className="mt-1 break-words text-sm leading-6 text-gray-500 dark:text-gray-400">
            {incident.detail}
          </p>
        </div>
        <a className={primaryActionClass} href={incident.action_href}>
          {incident.action_label}
        </a>
      </div>
    </div>
  );
}

function TenantSection({ tenants }: { tenants: HealthTenant[] }) {
  return (
    <Panel>
      <PanelHeader
        description="ดูสถานะรายร้านแบบอ่านง่าย หากมีปัญหาให้กดปุ่มในคอลัมน์การแก้ไข"
        title="สถานะรายร้าน"
      />
      <PanelBody>
        {tenants.length ? (
          <>
            <div className="space-y-3 lg:hidden">
              {tenants.map((tenant) => (
                <TenantMobileCard key={tenant.tenant_id} tenant={tenant} />
              ))}
            </div>
            <div className="hidden w-full overflow-x-auto lg:block">
              <table className="min-w-full">
                <thead>
                  <tr className="border-gray-100 border-y dark:border-gray-800">
                    <TableHead>ร้าน</TableHead>
                    <TableHead>LINE</TableHead>
                    <TableHead>AI CEO</TableHead>
                    <TableHead>รายงาน</TableHead>
                    <TableHead>แหล่งข้อมูล</TableHead>
                    <TableHead align="right">การแก้ไข</TableHead>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {tenants.map((tenant) => (
                    <TenantTableRow key={tenant.tenant_id} tenant={tenant} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <Notice
            text="ยังไม่มีร้านที่เปิดใช้งานในระบบ"
            title="ยังไม่มีร้านให้ตรวจ"
            tone="info"
          />
        )}
      </PanelBody>
    </Panel>
  );
}

function TenantTableRow({ tenant }: { tenant: HealthTenant }) {
  const primaryAction = tenant.actions[0];
  const secondaryActionCount = Math.max(0, tenant.actions.length - 1);
  return (
    <tr>
      <TableCell>
        <div className="min-w-0">
          <p className="font-medium text-gray-800 text-theme-sm dark:text-white/90">
            {tenant.tenant_name}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge color={badgeColor(tenant.status)} size="sm">
              {tenant.status_label}
            </Badge>
            <Badge color="light" size="sm">
              {formatPlanCode(tenant.plan_code)}
            </Badge>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <StatusCell
          detail={`${tenant.line.enabled_targets}/${tenant.line.total_targets} ผู้รับ`}
          status={tenant.line.status}
          title={tenant.line.label}
        />
      </TableCell>
      <TableCell>
        <StatusCell
          detail={
            tenant.ai_ceo.enabled
              ? aiCeoAdminDetail(tenant.ai_ceo)
              : "ยังไม่เปิด"
          }
          status={tenant.ai_ceo.status}
          title={tenant.ai_ceo.label}
        />
      </TableCell>
      <TableCell>
        <StatusCell
          detail={
            tenant.reports.latest_run_at
              ? formatDateTime(tenant.reports.latest_run_at)
              : "ยังไม่มีรอบ"
          }
          status={tenant.reports.status}
          title={tenant.reports.label}
        />
      </TableCell>
      <TableCell>
        <StatusCell
          detail={tenant.datasource.configured ? "พร้อมรันรายงาน" : "ต้องตั้งค่า"}
          status={tenant.datasource.status}
          title={tenant.datasource.label}
        />
      </TableCell>
      <TableCell align="right">
        <div className="flex flex-col items-end gap-1">
          {primaryAction ? (
            <a className={primaryActionClass} href={primaryAction.href}>
              {primaryAction.label}
            </a>
          ) : (
            <a
              className={secondaryActionClass}
              href={`/owner-v2/stores/${encodeURIComponent(tenant.tenant_id)}`}
            >
              เปิดร้าน
            </a>
          )}
          {secondaryActionCount > 0 ? (
            <span className="text-theme-xs text-gray-500 dark:text-gray-400">
              มีอีก {numberFormatter.format(secondaryActionCount)} ทางเลือกในหน้าร้าน
            </span>
          ) : null}
        </div>
      </TableCell>
    </tr>
  );
}

function TenantMobileCard({ tenant }: { tenant: HealthTenant }) {
  const primaryAction = tenant.actions[0];
  const secondaryActionCount = Math.max(0, tenant.actions.length - 1);
  return (
    <div className="rounded-lg bg-gray-50 p-3 dark:bg-white/[0.02]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="break-words text-sm font-semibold text-gray-800 dark:text-white/90">
            {tenant.tenant_name}
          </h4>
          <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
            แพ็กเกจ {formatPlanCode(tenant.plan_code)}
          </p>
        </div>
        <Badge color={badgeColor(tenant.status)}>{tenant.status_label}</Badge>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Fact label="LINE" tone={factTone(tenant.line.status)} value={tenant.line.label} />
        <Fact
          label="AI CEO"
          tone={factTone(tenant.ai_ceo.status)}
          value={tenant.ai_ceo.label}
        />
        <Fact
          label="รายงาน"
          tone={factTone(tenant.reports.status)}
          value={tenant.reports.label}
        />
        <Fact
          label="แหล่งข้อมูล"
          tone={factTone(tenant.datasource.status)}
          value={tenant.datasource.label}
        />
      </div>
      <div className="mt-3 space-y-2">
        {primaryAction ? (
          <a className={primaryActionClass} href={primaryAction.href}>
            {primaryAction.label}
          </a>
        ) : (
          <a
            className={secondaryActionClass}
            href={`/owner-v2/stores/${encodeURIComponent(tenant.tenant_id)}`}
          >
            เปิดร้าน
          </a>
        )}
        {secondaryActionCount > 0 ? (
          <p className="text-theme-xs text-gray-500 dark:text-gray-400">
            มีอีก {numberFormatter.format(secondaryActionCount)} ทางเลือกในหน้าร้าน
          </p>
        ) : null}
      </div>
    </div>
  );
}

function StatusCell({
  detail,
  status,
  title,
}: {
  detail: string;
  status: HealthSeverity;
  title: string;
}) {
  return (
    <div className="min-w-0">
      <Badge color={badgeColor(status)} size="sm">
        {statusLabel(status)}
      </Badge>
      <p className="mt-2 break-words text-theme-sm font-medium text-gray-800 dark:text-white/90">
        {title}
      </p>
      <p className="mt-1 break-words text-theme-xs text-gray-500 dark:text-gray-400">
        {detail}
      </p>
    </div>
  );
}

function HealthTechnicalDetails({ payload }: { payload: HealthCenterPayload }) {
  const totalAiTokens = payload.tenants.reduce(
    (sum, tenant) => sum + tenant.ai_ceo.window_tokens,
    0,
  );
  const totalAiCost = payload.tenants.reduce(
    (sum, tenant) => sum + tenant.ai_ceo.window_cost_usd,
    0,
  );
  return (
    <AdminTechnicalDetails description="ข้อมูลนี้ใช้สำหรับทีมดูแลระบบเมื่อจำเป็นต้องตรวจ worker, ช่วงข้อมูล หรือค่าใช้งาน AI">
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Fact
            label="ช่วงข้อมูล"
            tone="light"
            value={`${payload.overall.window_hours} ชั่วโมง`}
          />
          <Fact
            label="ร้านทั้งหมด"
            tone="light"
            value={`${numberFormatter.format(payload.summary.tenant_count)} ร้าน`}
          />
          <Fact
            label="Worker"
            tone={payload.summary.worker_stale ? "error" : "success"}
            value={payload.summary.worker_stale ? "ควรตรวจทันที" : "ปกติ"}
          />
          <Fact
            label="สร้างข้อมูล"
            tone="light"
            value={formatDateTime(payload.overall.generated_at)}
          />
          <Fact
            label="ค่าใช้งาน AI ในช่วงนี้"
            tone="light"
            value={`${formatTokens(totalAiTokens)} · ${usdFormatter.format(totalAiCost)}`}
          />
        </div>
        <p className="mt-4 text-theme-xs leading-5 text-gray-500 dark:text-gray-400">
          หน้านี้อ่านจากประวัติรอบแจ้งเตือน การส่ง LINE รายงาน และ AI CEO
          ในระบบหลังบ้านเท่านั้น ไม่รันรายงานใหม่และไม่ดึงข้อมูลลูกค้าจาก SML
          ตอนเปิดหน้า
        </p>
    </AdminTechnicalDetails>
  );
}

function TableHead({
  align = "left",
  children,
}: {
  align?: "left" | "right";
  children: ReactNode;
}) {
  return (
    <th className={align === "right" ? "py-3 pl-5 text-left" : "py-3 pr-5 text-left"}>
      <div className={`flex items-center ${align === "right" ? "justify-end" : ""}`}>
        <p className="font-medium text-gray-500 text-theme-xs dark:text-gray-400">
          {children}
        </p>
      </div>
    </th>
  );
}

function TableCell({
  align = "left",
  children,
}: {
  align?: "left" | "right";
  children: ReactNode;
}) {
  return (
    <td className={align === "right" ? "py-4 pl-5" : "py-4 pr-5"}>
      <div className={`flex items-center ${align === "right" ? "justify-end" : ""}`}>
        {children}
      </div>
    </td>
  );
}

function HealthCenterSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <div className="h-10 w-48 animate-pulse rounded-lg bg-gray-100 dark:bg-white/[0.03]" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            className="h-44 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]"
            key={index}
          />
        ))}
      </div>
      <div className="h-96 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
    </div>
  );
}

function badgeColor(severity: HealthSeverity) {
  if (severity === "critical") {
    return "error";
  }
  if (severity === "warning") {
    return "warning";
  }
  if (severity === "ok") {
    return "success";
  }
  return "info";
}

function factTone(severity: HealthSeverity) {
  if (severity === "critical") {
    return "error";
  }
  if (severity === "warning") {
    return "warning";
  }
  if (severity === "ok") {
    return "success";
  }
  return "light";
}

function statusLabel(severity: HealthSeverity) {
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

function toneTileClass(severity: HealthSeverity) {
  if (severity === "critical") {
    return "bg-error-50 text-error-600 dark:bg-error-500/15 dark:text-error-500";
  }
  if (severity === "warning") {
    return "bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-orange-400";
  }
  if (severity === "ok") {
    return "bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-500";
  }
  return "bg-blue-light-50 text-blue-light-500 dark:bg-blue-light-500/15 dark:text-blue-light-500";
}

function formatTokens(value: number) {
  if (value >= 1_000_000) {
    return `${numberFormatter.format(Math.round(value / 10_000) / 100)}M tokens`;
  }
  if (value >= 1_000) {
    return `${numberFormatter.format(Math.round(value / 10) / 100)}K tokens`;
  }
  return `${numberFormatter.format(value)} tokens`;
}

function aiCeoAdminDetail(aiCeo: HealthTenant["ai_ceo"]) {
  if (aiCeo.action_hint) {
    return aiCeo.action_hint;
  }
  if (aiCeo.latest_run_at) {
    return `รอบล่าสุด ${formatDateTime(aiCeo.latest_run_at)}`;
  }
  return aiCeo.latest_run_status
    ? `สถานะ ${formatRunStatus(aiCeo.latest_run_status)}`
    : "เปิดใช้งานแล้ว";
}

function parseWindowHours(value: string | null): 24 | 72 | 168 {
  if (value === "72") {
    return 72;
  }
  if (value === "168") {
    return 168;
  }
  return 24;
}

function formatPlanCode(value: string) {
  const labels: Record<string, string> = {
    business: "ร้านใหญ่",
    pro: "ร้านใหญ่ Pro",
    starter: "ร้านเล็ก",
  };
  return labels[value] ?? value;
}
