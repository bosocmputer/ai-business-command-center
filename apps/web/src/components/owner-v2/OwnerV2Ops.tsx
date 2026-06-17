"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
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

type OperationsStatus = {
  worker?: {
    status: string;
    age_seconds?: number | null;
  };
  scheduler?: {
    enabled?: boolean;
  };
  backup?: {
    configured?: boolean;
    last_backup_at?: string | null;
    recommendation?: string | null;
  };
  operational_alerts?: {
    telegram?: {
      status?: {
        configured?: boolean;
        bot_username?: string | null;
        targets?: Array<{ enabled: boolean }>;
      };
      deliveries?: Array<{
        alert_type: string;
        severity: string;
        status: string;
        created_at: string;
        safe_error_message?: string | null;
      }>;
    };
  };
  report_health?: {
    latest_javaws_failure?: {
      tenant_id: string;
      report_key: string;
      failure_kind?: string | null;
      failure_phase?: string | null;
      safe_error_message: string;
    } | null;
    heavy_report_runs?: Array<{
      id: string;
      tenant_id: string;
      report_key: string;
      status: string;
      duration_ms: number | null;
    }>;
  };
};

export default function OwnerV2Ops() {
  const [status, setStatus] = useState<"loading" | "success" | "error">(
    "loading",
  );
  const [data, setData] = useState<OperationsStatus | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const load = async (signal?: AbortSignal) => {
    setStatus("loading");
    setErrorMessage("");
    try {
      const result = await ownerV2Fetch<OperationsStatus>(
        "/api/owner/operations/status",
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
        error instanceof Error ? error.message : "โหลดสถานะ Ops ไม่สำเร็จ",
      );
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, []);

  if (status === "loading" && !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              className="h-40 animate-pulse rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6"
              key={index}
            />
          ))}
        </div>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="h-96 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
          <div className="h-96 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <OpsNotice
        action={
          <Button
            className="mt-4 h-10 w-full px-4 py-0 sm:w-auto"
            onClick={() => void load()}
            type="button"
            variant="outline"
          >
            รีเฟรช Ops
          </Button>
        }
        text={`${errorMessage} ลองรีเฟรชอีกครั้ง ถ้ายังไม่สำเร็จให้ตรวจ API และ session ผู้ดูแล`}
        title="โหลด Ops status ไม่สำเร็จ"
        tone="error"
      />
    );
  }

  const telegram = data?.operational_alerts?.telegram?.status ?? null;
  const telegramReady = Boolean(
    telegram?.configured && telegram.targets?.some((target) => target.enabled),
  );
  const latestJavaWs = data?.report_health?.latest_javaws_failure ?? null;
  const heavyRuns = data?.report_health?.heavy_report_runs ?? [];

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <OpsMetric
          icon={<BoxCubeIcon className="h-6 w-6" />}
          label="Worker"
          tone={data?.worker?.status === "ok" ? "success" : "warning"}
          value={formatWorker(data?.worker)}
        />
        <OpsMetric
          icon={<TimeIcon className="h-6 w-6" />}
          label="Scheduler"
          tone={data?.scheduler?.enabled ? "success" : "warning"}
          value={data?.scheduler?.enabled ? "DB-backed" : "ยังไม่พร้อม"}
        />
        <OpsMetric
          icon={<BellIcon className="h-6 w-6" />}
          label="Telegram ops"
          tone={telegramReady ? "success" : "warning"}
          value={
            telegramReady
              ? telegram?.bot_username
                ? `@${telegram.bot_username}`
                : "พร้อม"
              : "ยังไม่พร้อม"
          }
        />
        <OpsMetric
          icon={<PlugInIcon className="h-6 w-6" />}
          label="Backup"
          tone={data?.backup?.configured ? "success" : "warning"}
          value={data?.backup?.configured ? "ตั้งค่าแล้ว" : "ยังต้องตั้ง"}
        />
      </section>

      {latestJavaWs ? (
        <OpsNotice
          text={`${latestJavaWs.tenant_id} · ${latestJavaWs.report_key} · ${
            latestJavaWs.failure_kind ?? "-"
          } / phase ${latestJavaWs.failure_phase ?? "-"}: ${
            latestJavaWs.safe_error_message
          }`}
          title="JavaWS failure ล่าสุด"
          tone="warning"
        />
      ) : (
        <OpsNotice
          text="ยังไม่พบ JavaWS failure ล่าสุดในข้อมูลที่ระบบส่งกลับมา ถ้าเกิด failure รอบถัดไป phase diagnostic จะแสดงที่หน้านี้"
          title="JavaWS diagnostic"
          tone="success"
        />
      )}

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <HeavyReportTable runs={heavyRuns.slice(0, 8)} />
        <TelegramDeliveries
          deliveries={(data?.operational_alerts?.telegram?.deliveries ?? []).slice(
            0,
            8,
          )}
        />
      </section>
    </div>
  );
}

function OpsMetric({
  icon,
  label,
  tone,
  value,
}: {
  icon: ReactNode;
  label: string;
  tone: "success" | "warning";
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-white/90">
        {icon}
      </div>
      <div className="mt-5 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <span className="text-theme-sm text-gray-500 dark:text-gray-400">
            {label}
          </span>
          <h4 className="mt-2 break-words text-base font-bold text-gray-800 dark:text-white/90">
            {value}
          </h4>
        </div>
        <Badge color={tone}>{tone === "success" ? "ปกติ" : "ต้องดู"}</Badge>
      </div>
    </div>
  );
}

function OpsNotice({
  action,
  text,
  title,
  tone,
}: {
  action?: ReactNode;
  text: string;
  title: string;
  tone: "success" | "warning" | "error";
}) {
  const toneConfig = {
    error: {
      className:
        "border-error-500 bg-error-50 dark:border-error-500/30 dark:bg-error-500/15",
      icon: <AlertIcon className="size-6 fill-current" />,
      iconClassName: "text-error-500",
    },
    success: {
      className:
        "border-success-500 bg-success-50 dark:border-success-500/30 dark:bg-success-500/15",
      icon: <CheckCircleIcon className="size-6 fill-current" />,
      iconClassName: "text-success-500",
    },
    warning: {
      className:
        "border-warning-500 bg-warning-50 dark:border-warning-500/30 dark:bg-warning-500/15",
      icon: <InfoIcon className="size-6 fill-current" />,
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
          <h3 className="mb-1 text-sm font-semibold text-gray-800 dark:text-white/90">
            {title}
          </h3>
          <p className="text-theme-sm leading-6 text-gray-500 dark:text-gray-400">
            {text}
          </p>
          {action}
        </div>
      </div>
    </section>
  );
}

function HeavyReportTable({
  runs,
}: {
  runs: NonNullable<OperationsStatus["report_health"]>["heavy_report_runs"];
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-5">
        <div>
          <h3 className="text-base font-medium text-gray-800 dark:text-white/90">
            Heavy report ล่าสุด
          </h3>
          <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
            แสดงเฉพาะ metadata ที่ปลอดภัย ไม่แสดง SQL หรือข้อมูลลูกค้า
          </p>
        </div>
        <Badge color={runs?.length ? "info" : "light"}>
          {runs?.length ? `${runs.length} runs` : "empty"}
        </Badge>
      </div>

      {runs?.length ? (
        <div className="max-w-full overflow-x-auto border-t border-gray-100 dark:border-gray-800">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800">
                <TableHead>Tenant</TableHead>
                <TableHead>Report</TableHead>
                <TableHead>Status</TableHead>
                <TableHead align="right">Duration</TableHead>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {runs.map((run) => (
                <tr key={run.id}>
                  <TableCell>
                    <p className="font-medium text-gray-800 text-theme-sm dark:text-white/90">
                      {run.tenant_id}
                    </p>
                  </TableCell>
                  <TableCell>
                    <p className="text-theme-sm text-gray-500 dark:text-gray-400">
                      {run.report_key}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge color={statusTone(run.status)}>{run.status}</Badge>
                  </TableCell>
                  <TableCell align="right">
                    <p className="font-medium text-gray-700 text-theme-sm dark:text-gray-300">
                      {durationLabel(run.duration_ms)}
                    </p>
                  </TableCell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="border-t border-gray-100 p-5 dark:border-gray-800 sm:p-6">
          <EmptyState text="ยังไม่มี heavy report ล่าสุด" />
        </div>
      )}
    </section>
  );
}

function TelegramDeliveries({
  deliveries,
}: {
  deliveries: NonNullable<
    NonNullable<
      NonNullable<OperationsStatus["operational_alerts"]>["telegram"]
    >["deliveries"]
  >;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex items-center justify-between gap-3 px-5 py-4 sm:px-6 sm:py-5">
        <div>
          <h3 className="text-base font-medium text-gray-800 dark:text-white/90">
            Telegram deliveries
          </h3>
          <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
            Ops alert ล่าสุด
          </p>
        </div>
        <BellIcon className="h-5 w-5 text-gray-400" />
      </div>

      {deliveries.length ? (
        <div className="custom-scrollbar flex max-h-[420px] flex-col overflow-y-auto border-t border-gray-100 px-5 dark:border-gray-800 sm:px-6">
          {deliveries.map((delivery) => (
            <div
              className="flex items-start justify-between gap-4 border-b border-gray-200 pb-4 pt-4 first:pt-0 last:border-b-0 last:pb-0 dark:border-gray-800"
              key={`${delivery.alert_type}-${delivery.created_at}`}
            >
              <div className="min-w-0">
                <h4 className="truncate text-base font-semibold text-gray-800 dark:text-white/90">
                  {delivery.alert_type}
                </h4>
                <span className="mt-1 block text-theme-xs text-gray-500 dark:text-gray-400">
                  {formatDateTime(delivery.created_at)}
                </span>
                {delivery.safe_error_message ? (
                  <p className="mt-2 text-theme-xs leading-5 text-error-600 dark:text-error-400">
                    {delivery.safe_error_message}
                  </p>
                ) : null}
              </div>
              <div className="shrink-0 text-right">
                <Badge color={statusTone(delivery.status)}>
                  {delivery.status}
                </Badge>
                <span className="mt-2 block text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                  {delivery.severity}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="border-t border-gray-100 p-5 dark:border-gray-800 sm:p-6">
          <EmptyState text="ยังไม่มี delivery ล่าสุด" />
        </div>
      )}
    </section>
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
    <th className="px-5 py-3 text-left sm:px-6">
      <div
        className={`flex items-center ${
          align === "right" ? "justify-end" : ""
        }`}
      >
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
    <td className="px-5 py-4 sm:px-6">
      <div
        className={`flex items-center ${
          align === "right" ? "justify-end" : ""
        }`}
      >
        {children}
      </div>
    </td>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-4 py-6 text-center dark:border-gray-800 dark:bg-white/[0.03]">
      <p className="text-theme-sm font-medium text-gray-800 dark:text-white/90">
        {text}
      </p>
    </div>
  );
}

function statusTone(status: string) {
  if (status === "success" || status === "ok") {
    return "success";
  }
  if (status === "failed" || status === "error") {
    return "error";
  }
  return "warning";
}

function formatWorker(worker?: OperationsStatus["worker"]) {
  if (!worker) {
    return "ยังไม่ทราบ";
  }
  if (worker.status === "ok") {
    return `ปกติ ${worker.age_seconds ?? "-"}s`;
  }
  return worker.status;
}

function durationLabel(durationMs: number | null) {
  if (durationMs === null) {
    return "-";
  }
  return `${Math.round(durationMs / 1000)}s`;
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
