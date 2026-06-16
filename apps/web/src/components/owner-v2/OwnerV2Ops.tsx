"use client";

import { useEffect, useState } from "react";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
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
      <div className="grid gap-4 md:grid-cols-2">
        <div className="h-44 animate-pulse rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
        <div className="h-44 animate-pulse rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
      </div>
    );
  }

  if (status === "error") {
    return (
      <section className="rounded-xl border border-error-200 bg-error-50 p-5 text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300">
        <p className="font-semibold">โหลด Ops status ไม่สำเร็จ</p>
        <p className="mt-1 text-sm leading-6">{errorMessage}</p>
        <Button
          className="mt-4 h-10 px-4 py-0"
          onClick={() => void load()}
          type="button"
        >
          รีเฟรช
        </Button>
      </section>
    );
  }

  const telegram = data?.operational_alerts?.telegram?.status ?? null;
  const telegramReady = Boolean(
    telegram?.configured && telegram.targets?.some((target) => target.enabled),
  );
  const latestJavaWs = data?.report_health?.latest_javaws_failure ?? null;
  const heavyRuns = data?.report_health?.heavy_report_runs ?? [];

  return (
    <div className="space-y-4">
      <section className="grid gap-3 md:grid-cols-4">
        <Fact
          label="Worker"
          tone={data?.worker?.status === "ok" ? "success" : "warning"}
          value={formatWorker(data?.worker)}
        />
        <Fact
          label="Scheduler"
          tone={data?.scheduler?.enabled ? "success" : "warning"}
          value={data?.scheduler?.enabled ? "DB-backed" : "ยังไม่พร้อม"}
        />
        <Fact
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
        <Fact
          label="Backup"
          tone={data?.backup?.configured ? "success" : "warning"}
          value={data?.backup?.configured ? "ตั้งค่าแล้ว" : "ยังต้องตั้ง"}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            JavaWS failure ล่าสุด
          </h2>
          {latestJavaWs ? (
            <div className="mt-4 rounded-lg border border-warning-200 bg-warning-50 p-4 text-sm leading-6 text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-300">
              <p className="font-semibold">
                {latestJavaWs.tenant_id} · {latestJavaWs.report_key}
              </p>
              <p className="mt-1">
                {latestJavaWs.failure_kind ?? "-"} / phase{" "}
                {latestJavaWs.failure_phase ?? "-"}
              </p>
              <p className="mt-1">{latestJavaWs.safe_error_message}</p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
              ยังไม่พบ JavaWS failure ล่าสุด
            </p>
          )}

          <h3 className="mt-6 text-sm font-semibold text-gray-900 dark:text-white">
            Heavy report ล่าสุด
          </h3>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {heavyRuns.slice(0, 6).map((run) => (
              <div
                className="rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]"
                key={run.id}
              >
                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                  {run.tenant_id}
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {run.report_key}
                </p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <Badge color={run.status === "success" ? "success" : "warning"}>
                    {run.status}
                  </Badge>
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {run.duration_ms === null
                      ? "-"
                      : `${Math.round(run.duration_ms / 1000)}s`}
                  </span>
                </div>
              </div>
            ))}
            {!heavyRuns.length ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                ยังไม่มี heavy report ล่าสุด
              </p>
            ) : null}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            Telegram deliveries
          </h2>
          <div className="mt-4 space-y-3">
            {(data?.operational_alerts?.telegram?.deliveries ?? [])
              .slice(0, 8)
              .map((delivery) => (
                <div
                  className="rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]"
                  key={`${delivery.alert_type}-${delivery.created_at}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">
                      {delivery.alert_type}
                    </p>
                    <Badge color={delivery.status === "success" ? "success" : "warning"}>
                      {delivery.status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {formatDateTime(delivery.created_at)}
                  </p>
                  {delivery.safe_error_message ? (
                    <p className="mt-1 text-xs text-error-600 dark:text-error-400">
                      {delivery.safe_error_message}
                    </p>
                  ) : null}
                </div>
              ))}
            {!(data?.operational_alerts?.telegram?.deliveries ?? []).length ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                ยังไม่มี delivery ล่าสุด
              </p>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function Fact({
  label,
  tone,
  value,
}: {
  label: string;
  tone: "success" | "warning";
  value: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="break-words text-sm font-semibold text-gray-900 dark:text-white">
          {value}
        </p>
        <Badge color={tone}>{tone === "success" ? "ปกติ" : "ต้องดู"}</Badge>
      </div>
    </div>
  );
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
