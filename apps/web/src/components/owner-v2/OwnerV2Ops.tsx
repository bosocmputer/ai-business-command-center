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
import { formatLineDeliveryStatus, formatRunStatus } from "./ui";

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
    system_store?: string | null;
  };
  operational_alerts?: {
    telegram?: {
      status?: {
        configured?: boolean;
        encryption_configured?: boolean;
        verified?: boolean;
        bot_username?: string | null;
        bot_first_name?: string | null;
        updated_at?: string | null;
        targets?: Array<{
          id?: string;
          display_name?: string | null;
          target_id_masked?: string | null;
          enabled: boolean;
          updated_at?: string | null;
        }>;
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
  audit_logs?: AuditLogEntry[];
  tenants?: AuditTenantEntry[];
};

type AuditLogEntry = {
  id?: number;
  tenant_id: string | null;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata_json: Record<string, unknown>;
  created_at: string;
};

type AuditTenantEntry = {
  id: string;
  name: string;
  status: string;
  database_name?: string | null;
  plan_code?: string;
  datasource_configured?: boolean;
  line_configured?: boolean;
  line_target_masked?: string | null;
};

type TelegramChatPreview = {
  chat_id: string;
  chat_id_masked: string;
  display_name: string;
  type: string;
};

const SMOKE_TEST_ALERTS: Array<{ alertType: string; label: string }> = [
  { alertType: "incident_dry_run", label: "Incident dry-run" },
  { alertType: "javaws_diagnostic", label: "JavaWS diagnostic" },
  { alertType: "heavy_report_slow", label: "Slow heavy report" },
  { alertType: "notification_summary", label: "Summary" },
];

const AUDIT_ACTION_LABELS: Record<string, string> = {
  datasource_test_succeeded: "ทดสอบ SML สำเร็จ",
  datasource_test_failed: "ทดสอบ SML ไม่สำเร็จ",
  line_channel_created: "เพิ่ม LINE OA",
  line_channel_updated: "แก้ไข LINE OA",
  line_channel_secrets_updated: "บันทึก LINE secret",
  line_target_assigned: "เพิ่มผู้รับเข้าร้าน",
  line_target_assignment_updated: "อัปเดตผู้รับเข้าร้าน",
  line_target_approved: "อนุมัติผู้รับ LINE",
  line_target_updated: "แก้สิทธิ์ผู้รับ LINE",
  line_delivery_succeeded: "ส่ง LINE สำเร็จ",
  line_delivery_failed: "ส่ง LINE ไม่สำเร็จ",
  morning_brief_report_run_requested: "รันแผนแจ้งเตือน",
  report_run_requested: "รันรายงาน",
  report_run_succeeded: "รันรายงานสำเร็จ",
  report_run_failed: "รันรายงานไม่สำเร็จ",
  report_validation_signed_off: "รับรองยอดรายงาน",
  owner_tenant_created: "เพิ่มร้านค้า",
  owner_tenant_updated: "แก้ไขร้านค้า",
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
        error instanceof Error ? error.message : "โหลดสถานะตรวจระบบไม่สำเร็จ",
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
            className="mt-4 w-full sm:w-auto"
            onClick={() => void load()}
            size="sm"
            type="button"
            variant="outline"
          >
            รีเฟรชสถานะ
          </Button>
        }
        text={`${errorMessage} ลองรีเฟรชอีกครั้ง ถ้ายังไม่สำเร็จให้ตรวจ API และ session ผู้ดูแล`}
        title="โหลดสถานะตรวจระบบไม่สำเร็จ"
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
          label="ตัวประมวลผลงาน"
          tone={data?.worker?.status === "ok" ? "success" : "warning"}
          value={formatWorker(data?.worker)}
        />
        <OpsMetric
          icon={<TimeIcon className="h-6 w-6" />}
          label="ตัวตั้งเวลา"
          tone={data?.scheduler?.enabled ? "success" : "warning"}
          value={data?.scheduler?.enabled ? "เปิดใช้งาน" : "ยังไม่พร้อม"}
        />
        <OpsMetric
          icon={<BellIcon className="h-6 w-6" />}
          label="Telegram แจ้งเตือน"
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
          label="สำรองข้อมูล"
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
          title="ปัญหา JavaWS ล่าสุด"
          tone="warning"
        />
      ) : (
        <OpsNotice
          text="ยังไม่พบปัญหา JavaWS ล่าสุดในข้อมูลที่ระบบส่งกลับมา ถ้าเกิดปัญหารอบถัดไป ระบบจะแสดง phase diagnostic ที่หน้านี้"
          title="ตัวช่วยวิเคราะห์ JavaWS"
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

      {data?.backup && !data.backup.configured && data.backup.recommendation ? (
        <OpsNotice
          text={data.backup.recommendation}
          title="แนะนำให้ตั้งค่า backup"
          tone="warning"
        />
      ) : null}

      <TelegramOpsManager
        onChanged={() => void load()}
        status={data?.operational_alerts?.telegram?.status ?? null}
      />

      {data?.tenants?.length ? (
        <PerTenantAudit tenants={data.tenants} />
      ) : null}

      <AuditLogPanel auditLogs={data?.audit_logs ?? []} />
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
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 pb-3 pt-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            รายงานหนักล่าสุด
          </h3>
          <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
            แสดงเฉพาะหลักฐานปลอดภัย ไม่แสดง SQL หรือข้อมูลลูกค้า
          </p>
        </div>
        <Badge color={runs?.length ? "info" : "light"}>
          {runs?.length ? `${runs.length} รายการ` : "ว่าง"}
        </Badge>
      </div>

      {runs?.length ? (
        <>
          <div className="space-y-3 md:hidden">
            {runs.map((run) => (
              <div
                className="rounded-lg bg-gray-50 p-3 dark:bg-white/[0.02]"
                key={run.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-theme-sm font-medium text-gray-800 dark:text-white/90">
                      {run.tenant_id}
                    </p>
                    <p className="mt-1 break-words text-theme-xs text-gray-500 dark:text-gray-400">
                      {run.report_key}
                    </p>
                  </div>
                  <Badge color={statusTone(run.status)}>{formatRunStatus(run.status)}</Badge>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-gray-100 pt-3 dark:border-gray-800">
                  <span className="text-theme-xs text-gray-500 dark:text-gray-400">
                    ใช้เวลา
                  </span>
                  <span className="text-theme-sm font-medium text-gray-700 dark:text-gray-300">
                    {durationLabel(run.duration_ms)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="hidden w-full overflow-x-auto md:block">
            <table className="min-w-full">
              <thead>
                <tr className="border-gray-100 border-y dark:border-gray-800">
                  <TableHead>ร้าน</TableHead>
                  <TableHead>รายงาน</TableHead>
                  <TableHead>สถานะ</TableHead>
                  <TableHead align="right">ใช้เวลา</TableHead>
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
                      <Badge color={statusTone(run.status)}>
                        {formatRunStatus(run.status)}
                      </Badge>
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
        </>
      ) : (
        <EmptyState text="ยังไม่มี heavy report ล่าสุด" />
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
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 pb-3 pt-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            การส่ง Telegram ล่าสุด
          </h3>
          <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
            แจ้งเตือนสำหรับผู้ดูแลระบบ
          </p>
        </div>
        <BellIcon className="h-5 w-5 text-gray-400 dark:text-gray-500" />
      </div>

      {deliveries.length ? (
        <div className="custom-scrollbar flex max-h-[420px] flex-col gap-2 overflow-y-auto">
          {deliveries.map((delivery) => (
            <div
              className="flex items-start justify-between gap-4 rounded-lg p-3 transition hover:bg-gray-50 dark:hover:bg-white/[0.03]"
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
                  {formatLineDeliveryStatus(delivery.status)}
                </Badge>
                <span className="mt-2 block text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                  {delivery.severity}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text="ยังไม่มีประวัติส่ง Telegram ล่าสุด" />
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
    <th
      className={
        align === "right" ? "py-3 pl-5 text-left" : "py-3 pr-5 text-left"
      }
    >
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
    <td className={align === "right" ? "py-3 pl-5" : "py-3 pr-5"}>
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
    <div className="rounded-lg bg-gray-50 px-4 py-6 text-center dark:bg-white/[0.02]">
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

function AuditLogPanel({ auditLogs }: { auditLogs: AuditLogEntry[] }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 pb-4 pt-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
          Audit log ล่าสุด
        </h3>
        <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
          หลักฐานการรันรายงาน การส่ง LINE การอนุมัติผู้รับ และการรับรองยอด
        </p>
      </div>
      {auditLogs.length ? (
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {auditLogs.slice(0, 12).map((entry) => (
            <div
              className="grid gap-1 py-3 lg:grid-cols-[200px_minmax(0,1fr)]"
              key={`${entry.id ?? entry.created_at}-${entry.action}-${entry.target_id ?? ""}`}
            >
              <div>
                <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                  {formatAuditAction(entry.action)}
                </p>
                <p className="text-theme-xs text-gray-500 dark:text-gray-400">
                  {formatDateTime(entry.created_at)}
                </p>
              </div>
              <div className="text-sm leading-6 text-gray-500 dark:text-gray-400">
                <p>
                  ร้าน: {entry.tenant_id ?? "-"}
                  {entry.target_id ? ` · ${entry.target_type}: ${entry.target_id}` : ""}
                </p>
                <p className="mt-0.5">{formatAuditMetadata(entry.metadata_json)}</p>
                <span
                  className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-theme-xs font-medium ${auditActionToneClass(
                    entry.action,
                  )}`}
                >
                  {entry.action}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text="ยังไม่มี audit log ล่าสุด" />
      )}
    </section>
  );
}

function TelegramOpsManager({
  status,
  onChanged,
}: {
  status:
    | {
        configured?: boolean;
        encryption_configured?: boolean;
        verified?: boolean;
        bot_username?: string | null;
        bot_first_name?: string | null;
        updated_at?: string | null;
        targets?: Array<{
          id?: string;
          display_name?: string | null;
          target_id_masked?: string | null;
          enabled: boolean;
          updated_at?: string | null;
        }>;
      }
    | null
    | undefined;
  onChanged?: () => void;
}) {
  const [botToken, setBotToken] = useState("");
  const [chats, setChats] = useState<TelegramChatPreview[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ tone: "success" | "error"; message: string } | null>(null);

  const targets = status?.targets ?? [];
  const hasTarget = targets.some((target) => target.enabled);

  async function runAction(key: string, fn: () => Promise<void>) {
    if (busy !== null) {
      return;
    }
    setBusy(key);
    setResult(null);
    try {
      await fn();
    } catch (error) {
      setResult({
        tone: "error",
        message: error instanceof Error ? error.message : "action ไม่สำเร็จ",
      });
    } finally {
      setBusy(null);
    }
  }

  async function saveToken(event: React.FormEvent) {
    event.preventDefault();
    await runAction("token", async () => {
      await ownerV2Fetch(`/api/owner/operational-alerts/telegram/secrets`, {
        method: "PUT",
        body: { bot_token: botToken.trim() },
      });
      setBotToken("");
      setResult({ tone: "success", message: "บันทึก bot token แล้ว" });
      onChanged?.();
    });
  }

  async function loadChats() {
    await runAction("chats", async () => {
      const data = await ownerV2Fetch<TelegramChatPreview[]>(
        `/api/owner/operational-alerts/telegram/updates`,
      );
      setChats(Array.isArray(data) ? data : []);
    });
  }

  async function saveTarget(chat: TelegramChatPreview) {
    await runAction(`target-${chat.chat_id}`, async () => {
      await ownerV2Fetch(`/api/owner/operational-alerts/telegram/targets`, {
        method: "POST",
        body: {
          chat_id: chat.chat_id,
          display_name: chat.display_name,
          enabled: true,
        },
      });
      setResult({ tone: "success", message: `เพิ่ม ${chat.display_name} เป็นผู้รับแล้ว` });
      onChanged?.();
    });
  }

  async function sendTest() {
    await runAction("test", async () => {
      await ownerV2Fetch(`/api/owner/operational-alerts/telegram/test`, {
        method: "POST",
        body: { message: "Owner UI test" },
      });
      setResult({ tone: "success", message: "ส่ง test alert แล้ว" });
      // A test send updates the "verified" status and delivery history, so
      // refresh the parent so the page stops showing stale readiness.
      onChanged?.();
    });
  }

  async function runSmoke(alertType: string) {
    await runAction(`smoke-${alertType}`, async () => {
      await ownerV2Fetch(`/api/owner/operational-alerts/smoke-test`, {
        method: "POST",
        body: {
          alert_type: alertType,
          severity: alertType === "notification_summary" ? "info" : "warning",
          scheduled_time: "08:00",
          report_key:
            alertType === "javaws_diagnostic" ? "sales_goods_services" : undefined,
        },
      });
      setResult({ tone: "success", message: `ส่ง smoke test (${alertType}) แล้ว` });
      onChanged?.();
    });
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 pb-4 pt-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
          Telegram ops alert
        </h3>
        <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
          ตั้ง bot token โหลด chat ที่จะรับแจ้งเตือน และทดสอบก่อนเปิดใช้จริง
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Fact label="Bot token" tone={status?.configured ? "success" : "warning"} value={status?.configured ? "ตั้งแล้ว" : "ยังไม่ตั้ง"} />
        <Fact label="Encryption" tone={status?.encryption_configured ? "success" : "warning"} value={status?.encryption_configured ? "พร้อม" : "ยังไม่พร้อม"} />
        <Fact label="ผู้รับ" tone={hasTarget ? "success" : "warning"} value={`${targets.filter((t) => t.enabled).length}/${targets.length} เปิด`} />
      </div>

      <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={saveToken}>
        <input
          className="owner-v2-input"
          onChange={(event) => setBotToken(event.target.value)}
          placeholder="Telegram bot token (ไม่แสดงค่าที่บันทึกไว้)"
          type="password"
          value={botToken}
        />
        <Button disabled={busy === "token" || !botToken.trim()} type="submit" size="sm">
          {busy === "token" ? "กำลังบันทึก..." : "บันทึก token"}
        </Button>
      </form>

      <div className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Chat ที่จะรับแจ้งเตือน</p>
          <Button disabled={busy === "chats"} onClick={() => void loadChats()} size="sm" type="button" variant="outline">
            {busy === "chats" ? "กำลังโหลด..." : "โหลด chats"}
          </Button>
        </div>
        {chats.length ? (
          <div className="mt-2 divide-y divide-gray-100 dark:divide-gray-800">
            {chats.slice(0, 8).map((chat) => (
              <div className="flex items-center justify-between gap-2 py-2" key={chat.chat_id}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-800 dark:text-white/90">{chat.display_name}</p>
                  <p className="truncate text-theme-xs text-gray-500 dark:text-gray-400">{chat.chat_id_masked} · {chat.type}</p>
                </div>
                <Button disabled={busy !== null} onClick={() => void saveTarget(chat)} size="sm" type="button" variant="outline">
                  เลือก
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-theme-xs text-gray-500 dark:text-gray-400">กด “โหลด chats” เพื่อดึงรายการจาก Telegram</p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button disabled={busy === "test"} onClick={() => void sendTest()} size="sm" type="button">
          {busy === "test" ? "กำลังส่ง..." : "ส่ง test alert"}
        </Button>
        {SMOKE_TEST_ALERTS.map((smoke) => (
          <Button
            disabled={busy !== null}
            key={smoke.alertType}
            onClick={() => void runSmoke(smoke.alertType)}
            size="sm"
            type="button"
            variant="outline"
          >
            {busy === `smoke-${smoke.alertType}` ? "..." : smoke.label}
          </Button>
        ))}
      </div>

      {result ? (
        <p className={`mt-3 text-theme-sm ${result.tone === "error" ? "text-error-600" : "text-success-600"}`}>
          {result.message}
        </p>
      ) : null}
    </section>
  );
}

function PerTenantAudit({ tenants }: { tenants: AuditTenantEntry[] }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 pb-4 pt-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
          สถานะร้านล่าสุด
        </h3>
        <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
          รอบรายงาน การส่ง LINE และสถานะ datasource ต่อร้าน
        </p>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {tenants.map((tenant) => (
          <div className="grid gap-2 py-3 lg:grid-cols-[minmax(180px,1fr)_170px_170px_140px] lg:items-center" key={tenant.id}>
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 dark:text-white">{tenant.name}</p>
              <p className="mt-1 truncate text-theme-xs text-gray-500 dark:text-gray-400">{tenant.id}</p>
            </div>
            <Fact
              label="SML"
              tone={tenant.datasource_configured ? "success" : "warning"}
              value={tenant.datasource_configured ? (tenant.database_name ?? "พร้อม") : "ยังไม่พร้อม"}
            />
            <Fact
              label="LINE"
              tone={tenant.line_configured ? "success" : "warning"}
              value={tenant.line_configured ? (tenant.line_target_masked ?? "พร้อม") : "ยังไม่พร้อม"}
            />
            <Badge color={tenant.status === "active" || tenant.status === "trial" ? "success" : "light"} size="sm">
              {tenant.status === "active" ? "ใช้งาน" : tenant.status === "trial" ? "ทดลอง" : tenant.status}
            </Badge>
          </div>
        ))}
      </div>
    </section>
  );
}

function Fact({ label, tone, value }: { label: string; tone?: "success" | "warning" | "error"; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3 dark:bg-white/[0.02]">
      {tone ? (
        <div className="flex items-start justify-between gap-2">
          <p className="text-theme-xs text-gray-500 dark:text-gray-400">{label}</p>
          <Badge color={tone} size="sm">
            {tone === "success" ? "ปกติ" : tone === "warning" ? "ต้องดู" : "สำคัญ"}
          </Badge>
        </div>
      ) : (
        <p className="text-theme-xs text-gray-500 dark:text-gray-400">{label}</p>
      )}
      <p className="mt-1 break-words text-theme-sm font-semibold text-gray-800 dark:text-white/90">{value || "-"}</p>
    </div>
  );
}

function formatAuditAction(action: string) {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

function auditActionTone(action: string): "success" | "warning" | "error" | "light" {
  if (action.includes("failed")) {
    return "error";
  }
  if (action.includes("signed_off") || action.includes("succeeded")) {
    return "success";
  }
  if (action.includes("updated") || action.includes("requested")) {
    return "warning";
  }
  return "light";
}

function auditActionToneClass(action: string) {
  const tone = auditActionTone(action);
  const classes: Record<string, string> = {
    error: "bg-error-50 text-error-600 dark:bg-error-500/15 dark:text-error-500",
    light: "bg-gray-100 text-gray-700 dark:bg-white/5 dark:text-white/80",
    success: "bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-500",
    warning: "bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-orange-400",
  };
  return classes[tone] ?? classes.light;
}

function formatAuditMetadata(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata) {
    return "ไม่มี metadata เพิ่มเติม";
  }
  const parts: string[] = [];
  const entries: Array<[string, unknown]> = [
    ["safe_error_message", metadata.safe_error_message],
    ["date_from", metadata.date_from],
    ["date_to", metadata.date_to],
    ["difference_amount", metadata.difference_amount],
    ["accepted", metadata.accepted],
    ["access_profile_key", metadata.access_profile_key],
    ["enabled", metadata.enabled],
  ];
  for (const [key, value] of entries) {
    if (value !== null && value !== undefined && value !== "") {
      parts.push(`${key}: ${String(value)}`);
    }
  }
  return parts.length ? parts.join(" · ") : "ไม่มี metadata เพิ่มเติม";
}

function formatWorker(worker?: OperationsStatus["worker"]) {
  if (!worker) {
    return "ยังไม่ทราบ";
  }
  if (worker.status === "ok") {
    const ageSeconds = worker.age_seconds;
    if (typeof ageSeconds === "number" && ageSeconds >= 0) {
      const minutes = Math.max(0, Math.round(ageSeconds / 60));
      return minutes > 0
        ? `ปกติ (heartbeat ${minutes} นาทีที่แล้ว)`
        : "ปกติ (heartbeat อายุไม่ถึงนาที)";
    }
    return "ปกติ";
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
