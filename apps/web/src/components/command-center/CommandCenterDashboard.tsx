"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { ApexOptions } from "apexcharts";
import {
  deriveMorningBriefDateRange,
  type LineDeliveryRecord,
  type LineSendMode,
  type LineSendResult,
  type ReportRunRecord,
  type SalesGoodsServicesParams,
  type SalesGoodsServicesLinePreview,
  type SalesGoodsServicesSnapshot,
  type Tenant,
  type TenantId,
  type WorkerHeartbeatRecord,
} from "@ai-bcc/shared";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import Select from "@/components/form/Select";
import Label from "@/components/form/Label";
import Input from "@/components/form/input/InputField";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowUpIcon,
  BoxIconLine,
  CheckCircleIcon,
  DollarLineIcon,
  GroupIcon,
  TableIcon,
} from "@/icons";

type AuditLogEntry = {
  id?: number;
  tenant_id: TenantId | null;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata_json: Record<string, unknown>;
  created_at: string;
};

type MorningBriefActionResult =
  | {
      delivery: LineDeliveryRecord;
      preview: SalesGoodsServicesLinePreview;
      configured: boolean;
      mode: LineSendMode;
      force: boolean;
      delivery_key: string;
      params: SalesGoodsServicesParams;
      run: ReportRunRecord;
    }
  | {
      status: "skipped";
      reason: string;
      delivery: LineDeliveryRecord;
      delivery_key: string;
      params: SalesGoodsServicesParams;
    };

type OperationsStatus = {
  api: {
    ok: boolean;
    service: string;
    system_store: "postgres" | "local-json";
    time: string;
  };
  dashboard: {
    app_base_url_configured: boolean;
    dashboard_url: string | null;
    public_api_base_url_configured: boolean;
  };
  scheduler: {
    enabled: boolean;
    tenant_ids: string[];
    time: string;
    timezone: string;
    mode: LineSendMode;
    force: boolean;
  };
  worker: {
    heartbeat_configured: boolean;
    latest_heartbeat: WorkerHeartbeatRecord | null;
    age_seconds: number | null;
    status: WorkerHeartbeatRecord["status"] | "stale" | "missing";
  };
  tenants: Array<{
    id: TenantId;
    name: string;
    database_name: string;
    datasource_configured: boolean;
    line_configured: boolean;
    line_target_masked: string | null;
  }>;
};

const ReactApexChart = dynamic(() => import("react-apexcharts"), {
  ssr: false,
});

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:4000";

const defaultTenantId: TenantId = "tenant_demo_remote";
const defaultDateRange = {
  date_from: "2026-05-10",
  date_to: "2026-05-19",
};
const fallbackTenantOptions = [
  { value: "tenant_demo_remote", label: "บริษัท Demo Remote (ฐาน demo)" },
  {
    value: "tenant_office_sml1_2026",
    label: "บริษัท Office SML1 2026 (ฐาน sml1_2026)",
  },
];

export default function CommandCenterDashboard() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState<TenantId>(defaultTenantId);
  const [dateFrom, setDateFrom] = useState(defaultDateRange.date_from);
  const [dateTo, setDateTo] = useState(defaultDateRange.date_to);
  const [snapshot, setSnapshot] = useState<SalesGoodsServicesSnapshot | null>(
    null,
  );
  const [runs, setRuns] = useState<ReportRunRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [lineDeliveries, setLineDeliveries] = useState<LineDeliveryRecord[]>(
    [],
  );
  const [linePreview, setLinePreview] =
    useState<SalesGoodsServicesLinePreview | null>(null);
  const [operationsStatus, setOperationsStatus] =
    useState<OperationsStatus | null>(null);
  const [lineSending, setLineSending] = useState(false);
  const [lineSendResult, setLineSendResult] = useState<LineSendResult | null>(
    null,
  );
  const [morningBriefResult, setMorningBriefResult] =
    useState<MorningBriefActionResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async (nextTenantId: TenantId) => {
    setLoading(true);
    setError(null);
    try {
      const [
        tenantsResponse,
        snapshotResponse,
        runsResponse,
        auditResponse,
        linePreviewResponse,
        lineDeliveriesResponse,
        operationsResponse,
      ] = await Promise.all([
        fetch(`${API_BASE_URL}/api/tenants`),
        fetch(
          `${API_BASE_URL}/api/reports/${nextTenantId}/sales_goods_services/latest`,
        ),
        fetch(
          `${API_BASE_URL}/api/reports/${nextTenantId}/sales_goods_services/runs`,
        ),
        fetch(`${API_BASE_URL}/api/audit-logs`),
        fetch(
          `${API_BASE_URL}/api/reports/${nextTenantId}/sales_goods_services/line-preview`,
        ),
        fetch(
          `${API_BASE_URL}/api/reports/${nextTenantId}/sales_goods_services/line-deliveries`,
        ),
        fetch(`${API_BASE_URL}/api/operations/status`),
      ]);

      if (
        !tenantsResponse.ok ||
        !snapshotResponse.ok ||
        !runsResponse.ok ||
        !auditResponse.ok ||
        !linePreviewResponse.ok ||
        !lineDeliveriesResponse.ok ||
        !operationsResponse.ok
      ) {
        throw new Error("API ของแดชบอร์ดยังไม่พร้อมใช้งาน");
      }

      const tenantsPayload = (await tenantsResponse.json()) as {
        data: Tenant[];
      };
      const snapshotPayload = (await snapshotResponse.json()) as {
        data: SalesGoodsServicesSnapshot;
      };
      const runsPayload = (await runsResponse.json()) as {
        data: ReportRunRecord[];
      };
      const auditPayload = (await auditResponse.json()) as {
        data: AuditLogEntry[];
      };
      const linePreviewPayload = (await linePreviewResponse.json()) as {
        data: SalesGoodsServicesLinePreview;
      };
      const lineDeliveriesPayload = (await lineDeliveriesResponse.json()) as {
        data: LineDeliveryRecord[];
      };
      const operationsPayload = (await operationsResponse.json()) as {
        data: OperationsStatus;
      };

      setTenants(tenantsPayload.data);
      setSnapshot(snapshotPayload.data);
      setRuns(runsPayload.data);
      setLinePreview(linePreviewPayload.data);
      setLineDeliveries(lineDeliveriesPayload.data);
      setOperationsStatus(operationsPayload.data);
      setAuditLogs(
        auditPayload.data.filter((entry) => entry.tenant_id === nextTenantId),
      );
      setDateFrom(snapshotPayload.data.params.date_from);
      setDateTo(snapshotPayload.data.params.date_to);
    } catch (unknownError) {
      setError(
        unknownError instanceof Error
          ? unknownError.message
          : "โหลดแดชบอร์ดไม่สำเร็จ",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard(tenantId);
  }, [loadDashboard, tenantId]);

  const selectedTenant = tenants.find((tenant) => tenant.id === tenantId);
  const tenantOptions = tenants.map((tenant) => ({
    value: tenant.id,
    label: `${tenant.name} (ฐาน ${tenant.databaseName})`,
  }));
  const morningBriefPeriod = useMemo(
    () => deriveMorningBriefDateRange({ period: "yesterday" }),
    [],
  );
  const morningBriefSuccessDelivery = useMemo(
    () =>
      lineDeliveries.find(
        (delivery) =>
          delivery.delivery_type === "morning_brief" &&
          delivery.period_from === morningBriefPeriod.date_from &&
          delivery.period_to === morningBriefPeriod.date_to &&
          delivery.status === "success",
      ) ?? null,
    [lineDeliveries, morningBriefPeriod.date_from, morningBriefPeriod.date_to],
  );

  const qualityBadge = useMemo(() => {
    if (!snapshot) {
      return { color: "light" as const, text: "Loading" };
    }

    if (snapshot.quality_status === "valid") {
      return { color: "success" as const, text: "ข้อมูลพร้อมใช้" };
    }

    if (snapshot.quality_status === "stale") {
      return { color: "warning" as const, text: "ข้อมูลตัวอย่าง" };
    }

    if (snapshot.quality_status === "failed") {
      return { color: "error" as const, text: "รันรายงานไม่สำเร็จ" };
    }

    return { color: "warning" as const, text: "ยอดขายต้องตรวจสอบ" };
  }, [snapshot]);

  async function runReport() {
    setRunning(true);
    setError(null);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/reports/${tenantId}/sales_goods_services/run`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            date_from: dateFrom,
            date_to: dateTo,
          }),
        },
      );

      const payload = (await response.json()) as {
        data?: SalesGoodsServicesSnapshot;
        error?: string;
      };

      if (!response.ok || !payload.data) {
        throw new Error(payload.error || "Report run failed.");
      }

      setSnapshot(payload.data);
      await loadDashboard(tenantId);
    } catch (unknownError) {
      setError(
        unknownError instanceof Error
          ? unknownError.message
          : "รันรายงานไม่สำเร็จ",
      );
      await loadDashboard(tenantId);
    } finally {
      setRunning(false);
    }
  }

  async function runMorningBrief(mode: LineSendMode, force = false) {
    setLineSending(true);
    setError(null);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/reports/${tenantId}/sales_goods_services/morning-brief/run-and-send`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ period: "yesterday", mode, force }),
        },
      );

      const payload = (await response.json()) as {
        data?: MorningBriefActionResult;
        error?: string;
      };

      if (!payload.data) {
        throw new Error(payload.error || "Morning brief request failed.");
      }

      setMorningBriefResult(payload.data);
      if ("preview" in payload.data) {
        setLinePreview(payload.data.preview);
        setLineSendResult({
          delivery: payload.data.delivery,
          preview: payload.data.preview,
          configured: payload.data.configured,
          mode: payload.data.mode,
        });
      }
      await loadDashboard(tenantId);
    } catch (unknownError) {
      setError(
        unknownError instanceof Error
          ? unknownError.message
          : "ส่งสรุปเช้าไม่สำเร็จ",
      );
      await loadDashboard(tenantId);
    } finally {
      setLineSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-3xl">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge color={qualityBadge.color}>{qualityBadge.text}</Badge>
            <Badge color={selectedTenant?.datasourceConfigured ? "success" : "warning"}>
              {selectedTenant?.datasourceConfigured
                ? "เชื่อมฐานข้อมูลแล้ว"
                : "ยังไม่ตั้งค่าฐานข้อมูล"}
            </Badge>
          </div>
          <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
            แดชบอร์ดยอดขาย SML
          </h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            ดูยอดขายสินค้าและบริการจาก SML แยกตามบริษัท สาขา และสินค้า
            พร้อมส่งสรุปเข้า LINE OA ทุกเช้า
          </p>
          {snapshot && (
            <div className="mt-4 grid grid-cols-1 gap-3 text-xs text-gray-500 dark:text-gray-400 sm:grid-cols-2 xl:grid-cols-4">
              <span>
                อัปเดตล่าสุด:{" "}
                <strong className="font-medium text-gray-700 dark:text-gray-200">
                  {formatDateTime(snapshot.generated_at)}
                </strong>
              </span>
              <span>
                แหล่งข้อมูล:{" "}
                <strong className="font-medium text-gray-700 dark:text-gray-200">
                  {formatSource(snapshot.source)}
                </strong>
              </span>
              <span>
                ช่วงวันที่:{" "}
                <strong className="font-medium text-gray-700 dark:text-gray-200">
                  {formatReportPeriod(snapshot.params.date_from, snapshot.params.date_to)}
                </strong>
              </span>
              <span className="truncate">
                เลขอ้างอิง:{" "}
                <strong className="font-medium text-gray-700 dark:text-gray-200">
                  {snapshot.run_id}
                </strong>
              </span>
            </div>
          )}
        </div>

        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 xl:max-w-4xl xl:grid-cols-[minmax(280px,1.6fr)_160px_160px_170px]">
          <div>
            <Label>บริษัท / ฐานข้อมูล</Label>
            <Select
              key={tenantId}
              className="truncate"
              options={
                tenantOptions.length
                  ? tenantOptions
                  : fallbackTenantOptions
              }
              defaultValue={tenantId}
              onChange={(value) => setTenantId(value as TenantId)}
            />
          </div>
          <div>
            <Label>วันที่เริ่มต้น</Label>
            <Input
              key={`${tenantId}-from`}
              type="date"
              defaultValue={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            />
          </div>
          <div>
            <Label>วันที่สิ้นสุด</Label>
            <Input
              key={`${tenantId}-to`}
              type="date"
              defaultValue={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
            />
          </div>
          <div className="flex items-end">
            <div className="grid w-full grid-cols-2 gap-2">
              <Button
                className="h-11 w-full px-3"
                variant="outline"
                onClick={() => void loadDashboard(tenantId)}
                disabled={running || loading}
              >
                โหลดใหม่
              </Button>
              <Button
                className="h-11 w-full px-3"
                onClick={() => void runReport()}
                disabled={running || loading}
                startIcon={<ArrowUpIcon />}
              >
                {running ? "กำลังรัน" : "รันรายงาน"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-error-200 bg-error-50 p-4 text-sm text-error-700 dark:border-error-800 dark:bg-error-500/10 dark:text-error-400">
          {error}
        </div>
      )}

      {loading && <LoadingState />}

      {!loading && snapshot && (
        <>
          <OperationsReadinessPanel
            status={operationsStatus}
            tenantId={tenantId}
            snapshot={snapshot}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              icon={<DollarLineIcon className="text-gray-800 dark:text-white/90" />}
              label="ยอดขายสุทธิ"
              value={formatMoney(snapshot.summary.total_sales)}
              detail="ยอดขายจากหัวบิล SML"
            />
            <MetricCard
              icon={<GroupIcon className="text-gray-800 size-6 dark:text-white/90" />}
              label="จำนวนบิลขาย"
              value={formatInteger(snapshot.summary.document_count)}
              detail="เอกสารขายทั้งหมด"
            />
            <MetricCard
              icon={<TableIcon className="text-gray-800 dark:text-white/90" />}
              label="รายการสินค้า/บริการ"
              value={formatInteger(snapshot.summary.line_count)}
              detail={`จำนวนรวม ${formatQty(snapshot.summary.total_qty)}`}
            />
            <MetricCard
              icon={<BoxIconLine className="text-gray-800 dark:text-white/90" />}
              label="สินค้าขายดี"
              value={snapshot.summary.top_product_name || "ยังไม่มีข้อมูล"}
              detail="เรียงตามยอดขายสินค้า"
              valueTone="compact"
            />
          </div>

          {snapshot.summary.document_count === 0 ? (
            <EmptyRangeState />
          ) : (
            <div className="grid grid-cols-12 gap-4 md:gap-6">
              <div className="col-span-12">
                <SnapshotProvenance snapshot={snapshot} runs={runs} />
              </div>
              <div className="col-span-12">
                <MorningBriefControl
                  tenantName={selectedTenant?.name ?? tenantId}
                  period={morningBriefPeriod}
                  sentDelivery={morningBriefSuccessDelivery}
                  latestResult={morningBriefResult}
                  running={lineSending}
                  nextSchedule={formatNextMorningBriefSchedule()}
                  onDryRun={() => void runMorningBrief("dry_run", true)}
                  onSend={() => void runMorningBrief("send", false)}
                />
              </div>
              {linePreview && (
                <div className="col-span-12">
                  <MorningBriefPreview
                    preview={linePreview}
                    deliveries={lineDeliveries}
                    latestResult={lineSendResult}
                  />
                </div>
              )}
              <div className="col-span-12 xl:col-span-7">
                <BranchSalesChart snapshot={snapshot} />
              </div>
              <div className="col-span-12 xl:col-span-5">
                <TopProductsChart snapshot={snapshot} />
              </div>
              <div className="col-span-12 xl:col-span-5">
                <ReconciliationPanel snapshot={snapshot} />
              </div>
              <div className="col-span-12 xl:col-span-7">
                <RunHistory runs={runs} />
              </div>
              <div className="col-span-12">
                <AuditTrail auditLogs={auditLogs} />
              </div>
              <div className="col-span-12">
                <DocumentsTable snapshot={snapshot} />
              </div>
              <div className="col-span-12">
                <LinesTable snapshot={snapshot} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function OperationsReadinessPanel({
  status,
  tenantId,
  snapshot,
}: {
  status: OperationsStatus | null;
  tenantId: TenantId;
  snapshot: SalesGoodsServicesSnapshot;
}) {
  if (!status) {
    return null;
  }

  const tenantStatus = status.tenants.find((tenant) => tenant.id === tenantId);
  const workerTone = operationsBadgeColor(status.worker.status);
  const workerAge =
    status.worker.age_seconds === null
      ? "ยังไม่มีสัญญาณ"
      : formatDuration(status.worker.age_seconds);

  return (
    <div id="operations-readiness" className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            สถานะระบบพร้อมใช้งาน
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            ตรวจว่า API, งานส่งรายงานเช้า, ฐานข้อมูลของบริษัท และ LINE OA พร้อมใช้งานหรือไม่
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge color={status.api.system_store === "postgres" ? "success" : "warning"}>
            {status.api.system_store === "postgres" ? "ฐานระบบพร้อม" : "โหมดไฟล์ทดลอง"}
          </Badge>
          <Badge color={workerTone}>งานเบื้องหลัง {formatWorkerStatus(status.worker.status)}</Badge>
          <Badge color={status.scheduler.enabled ? "success" : "warning"}>
            ส่งอัตโนมัติ {status.scheduler.enabled ? "เปิดอยู่" : "ปิดอยู่"}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 xl:grid-cols-6">
        <SummaryBlock
          label="API"
          value={status.api.ok ? "พร้อมใช้งาน" : "ต้องตรวจสอบ"}
          tone={status.api.ok ? "success" : "error"}
        />
        <SummaryBlock
          label="งานเบื้องหลัง"
          value={`${formatWorkerStatus(status.worker.status)} · ${workerAge}`}
          tone={workerTone}
        />
        <SummaryBlock
          label="เวลาส่ง LINE"
          value={`${status.scheduler.time} ${status.scheduler.timezone}`}
        />
        <SummaryBlock
          label="ฐานข้อมูลบริษัท"
          value={tenantStatus?.datasource_configured ? "เชื่อมต่อแล้ว" : "ยังไม่ตั้งค่า"}
          tone={tenantStatus?.datasource_configured ? "success" : "warning"}
        />
        <SummaryBlock
          label="LINE OA"
          value={tenantStatus?.line_configured ? tenantStatus.line_target_masked ?? "พร้อมส่ง" : "ยังไม่ตั้งค่า"}
          tone={tenantStatus?.line_configured ? "success" : "warning"}
        />
        <SummaryBlock
          label="ข้อมูลล่าสุด"
          value={formatDuration(
            Math.max(
              0,
              Math.floor((Date.now() - new Date(snapshot.generated_at).getTime()) / 1000),
            ),
          )}
        />
      </div>
    </div>
  );
}

function MetricCard(props: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  valueTone?: "default" | "compact";
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800">
        {props.icon}
      </div>
      <div className="mt-5">
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {props.label}
        </span>
        <h4
          className={`mt-2 line-clamp-3 font-bold text-gray-800 dark:text-white/90 ${
            props.valueTone === "compact" ? "text-lg leading-snug" : "text-title-sm"
          }`}
          title={props.value}
        >
          {props.value}
        </h4>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {props.detail}
        </p>
      </div>
    </div>
  );
}

function SnapshotProvenance({
  snapshot,
  runs,
}: {
  snapshot: SalesGoodsServicesSnapshot;
  runs: ReportRunRecord[];
}) {
  const currentRun = runs.find((run) => run.id === snapshot.run_id);

  return (
    <div className="grid grid-cols-1 gap-4 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:grid-cols-4 md:p-6">
      <SnapshotFact
        label="แหล่งข้อมูล"
        value={formatSource(snapshot.source)}
      />
      <SnapshotFact
        label="รันสำเร็จล่าสุด"
        value={formatDateTime(snapshot.generated_at)}
      />
      <SnapshotFact
        label="จำนวนแถวที่โหลด"
        value={formatInteger(
          snapshot.summary.document_count + snapshot.summary.line_count,
        )}
      />
      <SnapshotFact
        label="เลขอ้างอิงรอบรัน"
        value={currentRun ? currentRun.id : snapshot.run_id}
      />
    </div>
  );
}

function SnapshotFact(props: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase text-gray-400">
        {props.label}
      </p>
      <p className="mt-2 truncate text-sm font-semibold text-gray-800 dark:text-white/90">
        {props.value}
      </p>
    </div>
  );
}

function MorningBriefControl({
  tenantName,
  period,
  sentDelivery,
  latestResult,
  running,
  nextSchedule,
  onDryRun,
  onSend,
}: {
  tenantName: string;
  period: SalesGoodsServicesParams;
  sentDelivery: LineDeliveryRecord | null;
  latestResult: MorningBriefActionResult | null;
  running: boolean;
  nextSchedule: string;
  onDryRun: () => void;
  onSend: () => void;
}) {
  const skippedDuplicate =
    latestResult && "status" in latestResult && latestResult.status === "skipped";
  const statusText = sentDelivery
    ? "ส่งแล้ว"
    : skippedDuplicate
    ? "กันส่งซ้ำแล้ว"
    : "พร้อมส่ง";
  const statusColor = sentDelivery
    ? "success"
    : skippedDuplicate
    ? "warning"
    : "light";
  const resultDelivery = latestResult?.delivery ?? sentDelivery;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="mr-auto text-lg font-semibold text-gray-800 dark:text-white/90">
              ส่งสรุปยอดขายเข้า LINE
            </h3>
            <Badge color={statusColor}>{statusText}</Badge>
            <Badge color="light">08:00 Asia/Bangkok</Badge>
          </div>
          <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <SummaryBlock label="บริษัท" value={tenantName} />
            <SummaryBlock
              label="วันที่ข้อมูล"
              value={formatReportPeriod(period.date_from, period.date_to)}
            />
            <SummaryBlock label="รอบส่งถัดไป" value={nextSchedule} />
            <SummaryBlock
              label="กันส่งซ้ำ"
              value={sentDelivery ? "ส่งสำเร็จแล้ว" : "ยังไม่เคยส่งสำเร็จ"}
            />
          </div>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:w-[320px]">
          <Button
            className="h-11 px-3"
            variant="outline"
            onClick={onDryRun}
            disabled={running}
          >
            {running ? "กำลังทดสอบ" : "ทดสอบข้อความ"}
          </Button>
          <Button
            className="h-11 px-3"
            onClick={onSend}
            disabled={running || Boolean(sentDelivery)}
          >
            {running ? "กำลังส่ง" : sentDelivery ? "ส่งแล้ว" : "ส่งของเมื่อวาน"}
          </Button>
        </div>
      </div>
      {resultDelivery && (
        <div className="mt-5 grid grid-cols-1 gap-3 border-t border-gray-100 pt-4 text-sm dark:border-gray-800 sm:grid-cols-3">
          <SummaryBlock
            label="การส่งล่าสุด"
            value={formatDeliveryStatus(resultDelivery.status)}
            tone={lineDeliveryBadgeColor(resultDelivery.status)}
          />
          <SummaryBlock
            label="ปลายทาง LINE"
            value={resultDelivery.target_id_masked || "ยังไม่ตั้งค่า"}
          />
          <SummaryBlock
            label="เลขอ้างอิง"
            value={resultDelivery.report_run_id}
          />
        </div>
      )}
      {latestResult && "status" in latestResult && (
        <p className="mt-4 rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:bg-warning-500/10 dark:text-orange-400">
          ระบบกันส่งซ้ำทำงานแล้วสำหรับข้อมูลวันที่ {formatReportPeriod(period.date_from, period.date_to)}
        </p>
      )}
    </div>
  );
}

function SummaryBlock(props: {
  label: string;
  value: string;
  tone?: "success" | "warning" | "error" | "light";
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase text-gray-400">
        {props.label}
      </p>
      <div className="mt-2 min-w-0">
        {props.tone ? (
          <Badge color={props.tone}>{props.value}</Badge>
        ) : (
          <p className="truncate font-semibold text-gray-800 dark:text-white/90">
            {props.value}
          </p>
        )}
      </div>
    </div>
  );
}

function MorningBriefPreview({
  preview,
  deliveries,
  latestResult,
}: {
  preview: SalesGoodsServicesLinePreview;
  deliveries: LineDeliveryRecord[];
  latestResult: LineSendResult | null;
}) {
  const latestDelivery = latestResult?.delivery ?? deliveries[0] ?? null;

  return (
    <div id="morning-brief" className="grid grid-cols-1 gap-4 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:grid-cols-[minmax(0,1fr)_320px] md:p-6">
      <div>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h3 className="mr-auto text-lg font-semibold text-gray-800 dark:text-white/90">
            ตัวอย่างข้อความ LINE ตอนเช้า
          </h3>
          <Badge color={preview.source === "sml_postgres" ? "success" : "warning"}>
            {formatSource(preview.source)}
          </Badge>
          <Badge color="light">ข้อความ LINE</Badge>
        </div>
        <pre className="max-h-[320px] overflow-y-auto whitespace-pre-wrap rounded-xl bg-gray-50 p-4 text-sm leading-6 text-gray-700 dark:bg-gray-900 dark:text-gray-300">
          {preview.text}
        </pre>
      </div>
      <div className="space-y-4">
        {latestDelivery && (
          <div className="rounded-xl border border-gray-100 p-3 dark:border-gray-800">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase text-gray-400">
                การส่ง LINE ล่าสุด
              </p>
              <Badge color={lineDeliveryBadgeColor(latestDelivery.status)}>
                {formatDeliveryStatus(latestDelivery.status)}
              </Badge>
            </div>
            <p className="truncate text-xs text-gray-500 dark:text-gray-400">
              {latestDelivery.id}
            </p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              ปลายทาง: {latestDelivery.target_id_masked || "ยังไม่ตั้งค่า"}
            </p>
            {latestDelivery.safe_error_message && (
              <p className="mt-2 rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:bg-warning-500/10 dark:text-orange-400">
                {latestDelivery.safe_error_message}
              </p>
            )}
          </div>
        )}
        <SummaryRow label="เลขอ้างอิงรอบรัน" value={preview.run_id} />
        <SummaryRow label="สร้างเมื่อ" value={formatDateTime(preview.generated_at)} />
        <SummaryRow
          label="ลิงก์แดชบอร์ด"
          value={preview.dashboard_url ? "แนบในข้อความแล้ว" : "ยังไม่ตั้งค่า"}
        />
        <div>
          <p className="mb-2 text-xs font-medium uppercase text-gray-400">
            หมายเหตุ
          </p>
          {preview.warnings.length ? (
            <div className="space-y-2">
              {preview.warnings.map((warning) => (
                <p
                  key={warning}
                  className="rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:bg-warning-500/10 dark:text-orange-400"
                >
                  {warning}
                </p>
              ))}
            </div>
          ) : (
            <p className="rounded-lg bg-success-50 px-3 py-2 text-xs text-success-700 dark:bg-success-500/10 dark:text-success-500">
              พร้อมส่งเข้า LINE OA
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function lineDeliveryBadgeColor(status: LineDeliveryRecord["status"]) {
  if (status === "success") {
    return "success" as const;
  }

  if (status === "failed") {
    return "error" as const;
  }

  return "warning" as const;
}

function operationsBadgeColor(
  status: OperationsStatus["worker"]["status"],
) {
  if (status === "ok") {
    return "success" as const;
  }

  if (status === "error") {
    return "error" as const;
  }

  return "warning" as const;
}

function BranchSalesChart({
  snapshot,
}: {
  snapshot: SalesGoodsServicesSnapshot;
}) {
  const options: ApexOptions = {
    colors: ["#465fff"],
    chart: {
      fontFamily: "Outfit, sans-serif",
      type: "bar",
      toolbar: { show: false },
    },
    plotOptions: {
      bar: {
        horizontal: false,
        columnWidth: "38%",
        borderRadius: 5,
        borderRadiusApplication: "end",
      },
    },
    dataLabels: { enabled: false },
    xaxis: {
      categories: snapshot.branch_sales.map((branch) => branch.branch_code),
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: { labels: { formatter: (value) => `${Math.round(value / 1000)}k` } },
    grid: { yaxis: { lines: { show: true } } },
    tooltip: {
      y: { formatter: (value) => `${formatMoney(value)}` },
    },
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white px-5 pt-5 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6 sm:pt-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
          ยอดขายแยกตามสาขา
        </h3>
        <Badge color="light">{snapshot.branch_sales.length} สาขา</Badge>
      </div>
      <div className="max-w-full overflow-x-auto custom-scrollbar">
        <div className="-ml-5 min-w-[650px] xl:min-w-full pl-2">
          <ReactApexChart
            options={options}
            series={[
              {
                name: "ยอดขาย",
                data: snapshot.branch_sales.map(
                  (branch) => branch.total_amount,
                ),
              },
            ]}
            type="bar"
            height={260}
          />
        </div>
      </div>
    </div>
  );
}

function TopProductsChart({
  snapshot,
}: {
  snapshot: SalesGoodsServicesSnapshot;
}) {
  const products = snapshot.top_products.slice(0, 6);
  const options: ApexOptions = {
    colors: ["#12b76a"],
    chart: {
      fontFamily: "Outfit, sans-serif",
      type: "bar",
      toolbar: { show: false },
    },
    plotOptions: {
      bar: {
        horizontal: true,
        borderRadius: 5,
      },
    },
    dataLabels: { enabled: false },
    xaxis: {
      categories: products.map((product) => product.item_name),
      labels: { formatter: (value) => `${Math.round(Number(value) / 1000)}k` },
    },
    tooltip: {
      y: { formatter: (value) => `${formatMoney(value)}` },
    },
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
          สินค้าขายดี
        </h3>
        <Badge color="success">จากรายการสินค้า</Badge>
      </div>
      <ReactApexChart
        options={options}
        series={[
          {
            name: "ยอดขาย",
            data: products.map((product) => product.sum_amount),
          },
        ]}
        type="bar"
        height={260}
      />
    </div>
  );
}

function ReconciliationPanel({
  snapshot,
}: {
  snapshot: SalesGoodsServicesSnapshot;
}) {
  const hasWarning =
    Math.abs(snapshot.reconciliation.difference_amount) > 0.01;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] sm:p-6">
      <div className="mb-5 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
          ตรวจยอดขาย
        </h3>
        <Badge color={hasWarning ? "warning" : "success"}>
          {hasWarning ? "ควรตรวจสอบ" : "ยอดตรงกัน"}
        </Badge>
      </div>
      <div className="space-y-4">
        <SummaryRow
          label="ยอดขายตามบิล"
          value={formatMoney(snapshot.reconciliation.header_total_amount)}
        />
        <SummaryRow
          label="ยอดรวมตามรายการสินค้า"
          value={formatMoney(snapshot.reconciliation.detail_sum_amount)}
        />
        <SummaryRow
          label="ส่วนต่าง"
          value={formatMoney(snapshot.reconciliation.difference_amount)}
        />
      </div>
      <p className="mt-5 text-sm text-gray-500 dark:text-gray-400">
        {snapshot.reconciliation.note}
      </p>
      <div className="mt-4 rounded-xl bg-gray-50 p-4 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
        ตัวเลขยอดขายหลักใช้ยอดรวมจากหัวบิล SML ส่วนกราฟสินค้าและจำนวนใช้รายการสินค้าในบิล
        ถ้ามีส่วนต่าง อาจเกิดจาก VAT ส่วนลด การปัดเศษ หรือวิธีเก็บข้อมูลหัวบิลกับรายการสินค้าไม่เหมือนกัน
      </div>
    </div>
  );
}

function RunHistory({ runs }: { runs: ReportRunRecord[] }) {
  return (
    <div id="run-history" className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
          ประวัติการรันรายงาน
        </h3>
        <Badge color="light">{runs.length} รอบ</Badge>
      </div>
      <div className="space-y-3">
        {runs.slice(0, 6).map((run) => (
          <div
            key={run.id}
            className="rounded-xl border border-gray-100 px-4 py-3 dark:border-gray-800"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-800 dark:text-white/90">
                  {run.id}
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {formatReportPeriod(run.params.date_from, run.params.date_to)} ·{" "}
                  {formatInteger(run.row_count)} แถว
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {formatDateTime(run.started_at)}
                  {run.finished_at ? ` ถึง ${formatDateTime(run.finished_at)}` : ""}
                </p>
              </div>
              <Badge
                color={
                  run.status === "success"
                    ? "success"
                    : run.status === "running"
                    ? "warning"
                    : "error"
                }
              >
                {formatRunStatus(run.status)}
              </Badge>
            </div>
            {run.safe_error_message && (
              <p className="mt-3 rounded-lg bg-error-50 px-3 py-2 text-xs text-error-600 dark:bg-error-500/10 dark:text-error-400">
                {run.safe_error_message}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AuditTrail({ auditLogs }: { auditLogs: AuditLogEntry[] }) {
  return (
    <div id="audit-trail" className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
          บันทึกกิจกรรมระบบ
        </h3>
        <Badge color="light">{auditLogs.length} รายการ</Badge>
      </div>
      {auditLogs.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          ยังไม่มีกิจกรรมของบริษัทนี้
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {auditLogs.slice(0, 6).map((entry) => (
            <div
              key={`${entry.created_at}-${entry.target_id}-${entry.action}`}
              className="rounded-xl border border-gray-100 px-4 py-3 dark:border-gray-800"
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                  {entry.action}
                </p>
                <Badge
                  color={entry.action.endsWith("succeeded") ? "success" : "light"}
                >
                  {entry.target_type}
                </Badge>
              </div>
              <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                {entry.target_id || "-"}
              </p>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {formatDateTime(entry.created_at)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DocumentsTable({
  snapshot,
}: {
  snapshot: SalesGoodsServicesSnapshot;
}) {
  return (
    <DataTable
      title="บิลขาย"
      description="ข้อมูลหัวบิลจาก SML ใช้เป็นยอดขายหลักของรายงาน"
      badge={`${snapshot.documents.length} แถว`}
      headers={["วันที่", "เลขที่บิล", "ลูกค้า", "สาขาบนบิล", "ยอดรวม", "แคชเชียร์"]}
      rows={snapshot.documents.map((document) => [
        document.doc_date,
        document.doc_no,
        document.cust_name || document.cust_code || "-",
        document.branch_code || "ไม่ระบุสาขา",
        formatMoney(document.total_amount),
        document.cashier_code || "-",
      ])}
    />
  );
}

function LinesTable({ snapshot }: { snapshot: SalesGoodsServicesSnapshot }) {
  return (
    <DataTable
      title="รายการสินค้าและบริการ"
      description="ข้อมูลรายการในบิล ใช้สำหรับดูสินค้าขายดี จำนวนขาย และยอดขายรายสาขา"
      badge={`${snapshot.lines.length} แถว`}
      headers={["วันที่", "เลขที่บิล", "สินค้า/บริการ", "สาขา", "จำนวน", "ยอดขาย"]}
      rows={snapshot.lines.map((line) => [
        line.doc_date,
        line.doc_no,
        `${line.item_code || "-"} ${line.item_name || ""}`,
        line.branch_code || "ไม่ระบุสาขา",
        formatQty(line.qty),
        formatMoney(line.sum_amount),
      ])}
    />
  );
}

function DataTable(props: {
  title: string;
  description?: string;
  badge: string;
  headers: string[];
  rows: string[][];
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 10;
  const filteredRows = props.rows.filter((row) =>
    row.join(" ").toLowerCase().includes(query.trim().toLowerCase()),
  );
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleRows = filteredRows.slice(
    currentPage * pageSize,
    currentPage * pageSize + pageSize,
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            {props.title}
          </h3>
          {props.description && (
            <p className="mt-1 max-w-3xl text-xs leading-5 text-gray-500 dark:text-gray-400">
              {props.description}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:w-[360px] sm:flex-row sm:items-center">
          <Input
            type="text"
            placeholder="ค้นหาในตาราง"
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
          <Badge color="light">{props.badge}</Badge>
        </div>
      </div>
      <div className="max-w-full overflow-x-auto">
        <Table>
          <TableHeader className="border-y border-gray-100 bg-gray-50 dark:border-gray-800 dark:bg-gray-900">
            <TableRow>
              {props.headers.map((header) => (
                <TableCell
                  key={header}
                  isHeader
                  className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400"
                >
                  {header}
                </TableCell>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-gray-100 dark:divide-gray-800">
            {visibleRows.map((row, rowIndex) => (
              <TableRow key={`${props.title}-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <TableCell
                    key={`${props.title}-${rowIndex}-${cellIndex}`}
                    className="px-5 py-4 text-sm text-gray-700 dark:text-gray-300"
                  >
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-col gap-3 border-t border-gray-100 px-5 py-4 text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <span>
          แสดง {visibleRows.length ? currentPage * pageSize + 1 : 0}-
          {Math.min((currentPage + 1) * pageSize, filteredRows.length)} จาก{" "}
          {filteredRows.length}
        </span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPage(Math.max(0, currentPage - 1))}
            disabled={currentPage === 0}
          >
            ก่อนหน้า
          </Button>
          <span className="text-xs">
            {currentPage + 1} / {pageCount}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))}
            disabled={currentPage >= pageCount - 1}
          >
            ถัดไป
          </Button>
        </div>
      </div>
    </div>
  );
}

function SummaryRow(props: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-500 dark:text-gray-400">
        {props.label}
      </span>
      <span className="text-sm font-medium text-gray-800 dark:text-white/90">
        {props.value}
      </span>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {["ยอดขายสุทธิ", "จำนวนบิล", "รายการสินค้า", "สินค้าขายดี"].map((label) => (
        <div
          key={label}
          className="h-40 animate-pulse rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]"
        >
          <div className="h-12 w-12 rounded-xl bg-gray-100 dark:bg-gray-800" />
          <div className="mt-5 h-4 w-24 rounded bg-gray-100 dark:bg-gray-800" />
          <div className="mt-3 h-6 w-32 rounded bg-gray-100 dark:bg-gray-800" />
        </div>
      ))}
    </div>
  );
}

function EmptyRangeState() {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center dark:border-gray-800 dark:bg-white/[0.03]">
      <CheckCircleIcon className="mx-auto mb-4 h-10 w-10 text-gray-400" />
      <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
        ไม่พบยอดขายในช่วงวันที่นี้
      </h3>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
        รายงานทำงานสำเร็จ แต่ไม่มีข้อมูลขายในช่วงวันที่ที่เลือก ลองเปลี่ยนช่วงวันที่หรือบริษัท
      </p>
    </div>
  );
}

function formatMoney(value: number) {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatInteger(value: number) {
  return value.toLocaleString("th-TH");
}

function formatQty(value: number) {
  return value.toLocaleString("th-TH", {
    maximumFractionDigits: 3,
  });
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

function formatDuration(seconds: number) {
  if (seconds < 60) {
    return `${seconds} วินาทีที่แล้ว`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} นาทีที่แล้ว`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} ชั่วโมงที่แล้ว`;
  }

  return `${Math.floor(hours / 24)} วันที่แล้ว`;
}

function formatWorkerStatus(status: OperationsStatus["worker"]["status"]) {
  if (status === "ok") {
    return "ปกติ";
  }

  if (status === "warning") {
    return "มีคำเตือน";
  }

  if (status === "error") {
    return "ผิดพลาด";
  }

  if (status === "stale") {
    return "สัญญาณเก่า";
  }

  return "ยังไม่พบสัญญาณ";
}

function formatDeliveryStatus(status: LineDeliveryRecord["status"]) {
  if (status === "success") {
    return "ส่งสำเร็จ";
  }

  if (status === "failed") {
    return "ส่งไม่สำเร็จ";
  }

  if (status === "dry_run") {
    return "ทดสอบข้อความ";
  }

  return "ข้ามการส่ง";
}

function formatRunStatus(status: ReportRunRecord["status"]) {
  if (status === "success") {
    return "สำเร็จ";
  }

  if (status === "running") {
    return "กำลังรัน";
  }

  return "ไม่สำเร็จ";
}

function formatReportPeriod(dateFrom: string, dateTo: string) {
  if (dateFrom === dateTo) {
    return formatDateOnly(dateFrom);
  }

  return `${formatDateOnly(dateFrom)} - ${formatDateOnly(dateTo)}`;
}

function formatDateOnly(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatNextMorningBriefSchedule(now = new Date()) {
  const bangkokNow = getBangkokMinute(now);
  const nextDate =
    bangkokNow.time >= "08:00"
      ? addDaysToYmd(bangkokNow.date, 1)
      : bangkokNow.date;

  return `${formatDateOnly(nextDate)} 08:00`;
}

function getBangkokMinute(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  };
}

function addDaysToYmd(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

function formatSource(value: SalesGoodsServicesSnapshot["source"]) {
  return value === "sml_postgres" ? "SML PostgreSQL" : "ข้อมูลตัวอย่าง";
}
