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
import ComponentCard from "@/components/common/ComponentCard";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import Alert from "@/components/ui/alert/Alert";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import Select from "@/components/form/Select";
import Label from "@/components/form/Label";
import Input from "@/components/form/input/InputField";
import Pagination from "@/components/tables/Pagination";
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
import { buildAdminJsonHeaders, forgetAdminToken } from "./adminAuth";
import { getCommandCenterApiBaseUrl } from "./apiBaseUrl";

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

type BadgeTone =
  | "primary"
  | "success"
  | "error"
  | "warning"
  | "info"
  | "light"
  | "dark";

const ReactApexChart = dynamic(() => import("react-apexcharts"), {
  ssr: false,
});

const API_BASE_URL = getCommandCenterApiBaseUrl();

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
      return { color: "light" as BadgeTone, text: "กำลังโหลด" };
    }

    if (snapshot.quality_status === "valid") {
      return { color: "success" as BadgeTone, text: "ข้อมูลพร้อมใช้" };
    }

    if (snapshot.quality_status === "stale") {
      return { color: "warning" as BadgeTone, text: "ข้อมูลตัวอย่าง" };
    }

    if (snapshot.quality_status === "failed") {
      return { color: "error" as BadgeTone, text: "รันรายงานไม่สำเร็จ" };
    }

    return { color: "warning" as BadgeTone, text: "ยอดขายต้องตรวจสอบ" };
  }, [snapshot]);

  async function runReport() {
    setRunning(true);
    setError(null);
    try {
      const headers = buildAdminJsonHeaders();
      if (!headers) {
        throw new Error("ต้องกรอก Admin token ก่อนรันรายงาน");
      }

      const response = await fetch(
        `${API_BASE_URL}/api/reports/${tenantId}/sales_goods_services/run`,
        {
          method: "POST",
          headers,
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
        if (response.status === 401 || response.status === 403) {
          forgetAdminToken();
        }
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
      if (
        mode === "send" &&
        !window.confirm(
          [
            "ยืนยันส่ง LINE Morning Brief จริง?",
            `บริษัท: ${selectedTenant?.name ?? tenantId}`,
            `วันที่ข้อมูล: ${formatReportPeriod(morningBriefPeriod.date_from, morningBriefPeriod.date_to)}`,
            `ปลายทาง: ${getTenantLineTarget(operationsStatus, tenantId)}`,
          ].join("\n"),
        )
      ) {
        return;
      }

      const headers = buildAdminJsonHeaders();
      if (!headers) {
        throw new Error("ต้องกรอก Admin token ก่อนส่งหรือทดสอบ LINE");
      }

      const response = await fetch(
        `${API_BASE_URL}/api/reports/${tenantId}/sales_goods_services/morning-brief/run-and-send`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ period: "yesterday", mode, force }),
        },
      );

      const payload = (await response.json()) as {
        data?: MorningBriefActionResult;
        error?: string;
      };

      if (!payload.data) {
        if (response.status === 401 || response.status === 403) {
          forgetAdminToken();
        }
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
      <PageBreadcrumb
        pageTitle="แดชบอร์ดธุรกิจ"
        homeLabel="หน้าแรก"
        homeHref="/command-center"
      />

      <ReportControlBar
        tenantId={tenantId}
        tenantOptions={tenantOptions.length ? tenantOptions : fallbackTenantOptions}
        dateFrom={dateFrom}
        dateTo={dateTo}
        running={running}
        loading={loading}
        onTenantChange={(value) => setTenantId(value)}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onReload={() => void loadDashboard(tenantId)}
        onRun={() => void runReport()}
      />

      {error && (
        <Alert
          variant="error"
          title="โหลดข้อมูลไม่สำเร็จ"
          message={error}
        />
      )}

      {loading && <LoadingState />}

      {!loading && snapshot && (
        <>
          {snapshot.summary.document_count === 0 ? (
            <EmptyRangeState />
          ) : (
            <div className="space-y-5">
              {linePreview && (
                <CustomerReportLinkPanel
                  preview={linePreview}
                  snapshot={snapshot}
                  lineDelivery={morningBriefSuccessDelivery}
                />
              )}

              <div className="grid grid-cols-12 gap-4 md:gap-6">
                <div className="col-span-12 xl:col-span-7">
                  <div id="morning-brief">
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
                </div>
                <div className="col-span-12 xl:col-span-5">
                  <OperationsReadinessPanel
                    status={operationsStatus}
                    tenantId={tenantId}
                    snapshot={snapshot}
                  />
                </div>
              </div>

              <details className="group rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
                <summary className="flex cursor-pointer list-none flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-base font-medium text-gray-800 dark:text-white/90">
                      เครื่องมือวิเคราะห์เพิ่มเติม
                    </p>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      กราฟ รายละเอียดตาราง ประวัติรัน และ audit log สำหรับทีมดูแลระบบ
                    </p>
                  </div>
                  <Badge color="light">เปิดเมื่อต้องตรวจสอบ</Badge>
                </summary>
                <div className="space-y-6 border-t border-gray-100 p-4 dark:border-gray-800 sm:p-6">
                  <ExecutiveBriefPanel
                    snapshot={snapshot}
                    tenantName={selectedTenant?.name ?? tenantId}
                    qualityText={qualityBadge.text}
                    qualityColor={qualityBadge.color}
                    datasourceReady={Boolean(selectedTenant?.datasourceConfigured)}
                    lineDelivery={morningBriefSuccessDelivery}
                    operationsStatus={operationsStatus}
                  />
                  <BusinessHealthStrip
                    snapshot={snapshot}
                    lineDelivery={morningBriefSuccessDelivery}
                    operationsStatus={operationsStatus}
                  />
                  <DecisionBriefPanel
                    snapshot={snapshot}
                    lineDelivery={morningBriefSuccessDelivery}
                    operationsStatus={operationsStatus}
                  />
                  <div className="grid grid-cols-12 gap-4 md:gap-6">
                    <div className="col-span-12 xl:col-span-7">
                      <BranchSalesChart snapshot={snapshot} />
                    </div>
                    <div className="col-span-12 xl:col-span-5">
                      <TopProductsChart snapshot={snapshot} />
                    </div>
                    <div className="col-span-12 xl:col-span-5">
                      <ReconciliationPanel snapshot={snapshot} />
                    </div>
                    {linePreview && (
                      <div className="col-span-12 xl:col-span-7">
                        <MorningBriefPreview
                          preview={linePreview}
                          deliveries={lineDeliveries}
                          latestResult={lineSendResult}
                        />
                      </div>
                    )}
                    <div className="col-span-12">
                      <SnapshotProvenance snapshot={snapshot} runs={runs} />
                    </div>
                    <div className="col-span-12 xl:col-span-7">
                      <RunHistory runs={runs} />
                    </div>
                    <div className="col-span-12 xl:col-span-5">
                      <AuditTrail auditLogs={auditLogs} />
                    </div>
                    <div className="col-span-12">
                      <CollapsibleDataSection snapshot={snapshot} />
                    </div>
                  </div>
                </div>
              </details>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BusinessHealthStrip({
  snapshot,
  lineDelivery,
  operationsStatus,
}: {
  snapshot: SalesGoodsServicesSnapshot;
  lineDelivery: LineDeliveryRecord | null;
  operationsStatus: OperationsStatus | null;
}) {
  const totalSales = snapshot.summary.total_sales;
  const documentCount = snapshot.summary.document_count;
  const lineCount = snapshot.summary.line_count;
  const averageBill = documentCount > 0 ? totalSales / documentCount : 0;
  const linesPerBill = documentCount > 0 ? lineCount / documentCount : 0;
  const topBranch = snapshot.branch_sales[0] ?? null;
  const topBranchShare = topBranch
    ? (topBranch.total_amount / Math.max(totalSales, 1)) * 100
    : 0;
  const topProduct = snapshot.top_products[0] ?? null;
  const topProductShare = topProduct
    ? (topProduct.sum_amount / Math.max(totalSales, 1)) * 100
    : 0;
  const reconciliationOk =
    Math.abs(snapshot.reconciliation.difference_amount) <= 0.01;
  const lineSent = lineDelivery?.status === "success";
  const workerOk = operationsStatus?.worker.status === "ok";
  const operationalReady = reconciliationOk && lineSent && workerOk;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <HealthMetricCard
        icon={<DollarLineIcon className="text-success-600 dark:text-success-400" />}
        label="ยอดขายเมื่อวาน"
        value={`${formatMoney(totalSales)} บาท`}
        detail={`${formatInteger(documentCount)} บิล · บิลเฉลี่ย ${formatMoney(averageBill)} บาท`}
        tone="success"
        badge="ยอดขาย"
      />
      <HealthMetricCard
        icon={<GroupIcon className="size-6 text-brand-600 dark:text-brand-400" />}
        label="ความเข้มข้นของสาขา"
        value={topBranch ? `${formatBranchLabel(topBranch.branch_code)} · ${formatPercent(topBranchShare)}` : "-"}
        detail={
          topBranchShare >= 90
            ? "ยอดขายอยู่ที่สาขาเดียวสูง อาจเป็นร้านสาขาเดียวหรือยังไม่ได้ map สาขา"
            : `${snapshot.branch_sales.length} สาขามีข้อมูลในรอบนี้`
        }
        tone={topBranchShare >= 90 ? "warning" : "primary"}
        badge="สาขา"
      />
      <HealthMetricCard
        icon={<BoxIconLine className="text-warning-600 dark:text-warning-400" />}
        label="สินค้าที่นำยอด"
        value={topProduct ? `${formatPercent(topProductShare)} ของยอดขาย` : "ยังไม่มีข้อมูล"}
        detail={topProduct?.item_name ?? "ยังไม่พบสินค้าขายดีในช่วงนี้"}
        tone={topProductShare >= 35 ? "warning" : "light"}
        badge="สินค้า"
      />
      <HealthMetricCard
        icon={<TableIcon className="text-blue-light-600 dark:text-blue-light-400" />}
        label="พร้อมใช้คุยธุรกิจ"
        value={operationalReady ? "พร้อมนำเสนอ" : "ควรตรวจก่อนใช้จริง"}
        detail={`${formatQty(linesPerBill)} รายการต่อบิล · ${
          lineSent ? "LINE ส่งแล้ว" : "LINE ยังไม่ส่ง"
        }`}
        tone={operationalReady ? "success" : "warning"}
        badge="ความพร้อม"
      />
    </div>
  );
}

function HealthMetricCard({
  icon,
  label,
  value,
  detail,
  tone,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: "success" | "warning" | "primary" | "light";
  badge: string;
}) {
  const toneClass = {
    success: "border-success-200 bg-success-50/70 dark:border-success-500/20 dark:bg-success-500/10",
    warning: "border-warning-200 bg-warning-50/70 dark:border-warning-500/20 dark:bg-warning-500/10",
    primary: "border-brand-200 bg-brand-50/70 dark:border-brand-500/20 dark:bg-brand-500/10",
    light: "border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]",
  }[tone];

  return (
    <div className={`rounded-2xl border p-5 shadow-theme-xs ${toneClass}`}>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white shadow-theme-xs dark:bg-white/10">
          {icon}
        </div>
        <Badge color={tone}>{badge}</Badge>
      </div>
      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p className="mt-2 line-clamp-2 text-xl font-semibold text-gray-900 dark:text-white/90">
        {value}
      </p>
      <p className="mt-2 line-clamp-2 text-sm leading-5 text-gray-600 dark:text-gray-300">
        {detail}
      </p>
    </div>
  );
}

function CustomerReportLinkPanel({
  preview,
  snapshot,
  lineDelivery,
}: {
  preview: SalesGoodsServicesLinePreview;
  snapshot: SalesGoodsServicesSnapshot;
  lineDelivery: LineDeliveryRecord | null;
}) {
  return (
    <ComponentCard
      id="sales-report"
      title="ลิงก์รายงานสำหรับลูกค้า"
      desc="ลิงก์เดียวกับที่แนบใน LINE เปิดหน้า compact report viewer ของรอบรายงานนี้โดยตรง"
      action={
        <Badge color={preview.dashboard_url ? "success" : "warning"}>
          {preview.dashboard_url ? "Signed link พร้อมใช้" : "ยังไม่ตั้งค่า signing"}
        </Badge>
      }
      bodyClassName="!p-4 sm:!p-4"
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-center">
        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-4">
          <SummaryBlock
            label="วันที่ข้อมูล"
            value={formatReportPeriod(snapshot.params.date_from, snapshot.params.date_to)}
          />
          <SummaryBlock
            label="ยอดขาย"
            value={`${formatMoney(snapshot.summary.total_sales)} บาท`}
          />
          <SummaryBlock label="เลขอ้างอิง" value={snapshot.run_id} />
          <SummaryBlock
            label="สถานะ LINE"
            value={lineDelivery?.status === "success" ? "ส่งแล้ว" : "รอส่ง"}
            tone={lineDelivery?.status === "success" ? "success" : "warning"}
          />
        </div>
        {preview.dashboard_url ? (
          <a
            href={preview.dashboard_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 items-center justify-center rounded-lg bg-brand-500 px-4 text-sm font-medium text-white transition hover:bg-brand-600"
          >
            เปิดหน้ารายงาน
          </a>
        ) : (
          <p className="rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-700 dark:bg-warning-500/10 dark:text-orange-300">
            ตั้งค่า REPORT_VIEWER_SIGNING_SECRET เพื่อเปิด signed viewer link
          </p>
        )}
      </div>
    </ComponentCard>
  );
}

function ExecutiveBriefPanel({
  snapshot,
  tenantName,
  qualityText,
  qualityColor,
  datasourceReady,
  lineDelivery,
  operationsStatus,
}: {
  snapshot: SalesGoodsServicesSnapshot;
  tenantName: string;
  qualityText: string;
  qualityColor: BadgeTone;
  datasourceReady: boolean;
  lineDelivery: LineDeliveryRecord | null;
  operationsStatus: OperationsStatus | null;
}) {
  const topBranch = snapshot.branch_sales[0] ?? null;
  const topProduct = snapshot.top_products[0] ?? null;
  const branchShare = topBranch
    ? (topBranch.total_amount / Math.max(snapshot.summary.total_sales, 1)) * 100
    : 0;
  const reconciliationOk =
    Math.abs(snapshot.reconciliation.difference_amount) <= 0.01;
  const workerOk = operationsStatus?.worker.status === "ok";
  const lineSent = lineDelivery?.status === "success";

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge color={qualityColor}>{qualityText}</Badge>
            <Badge color={datasourceReady ? "success" : "warning"}>
              {datasourceReady ? "เชื่อม SML แล้ว" : "รอเชื่อม SML"}
            </Badge>
            <Badge color={lineSent ? "success" : "warning"}>
              LINE {lineSent ? "ส่งแล้ว" : "ยังไม่ส่ง"}
            </Badge>
            <Badge color={workerOk ? "success" : "warning"}>
              งานเบื้องหลัง {workerOk ? "ปกติ" : "ต้องตรวจ"}
            </Badge>
          </div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-500">
            Executive Morning Brief
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white/90">
            {tenantName}
          </h1>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-gray-600 dark:text-gray-300">
            เมื่อวานมียอดขาย {formatMoney(snapshot.summary.total_sales)} บาท จาก{" "}
            {formatInteger(snapshot.summary.document_count)} บิล
            {topBranch
              ? ` สาขาที่นำคือ ${topBranch.branch_code} (${formatPercent(branchShare)})`
              : ""}
            {topProduct ? ` สินค้าหลักคือ ${topProduct.item_name}` : ""}
          </p>
        </div>
        <div className="grid min-w-full grid-cols-2 gap-3 sm:grid-cols-4 xl:min-w-[520px]">
          <ExecutiveFact label="ยอดขาย" value={`${formatMoney(snapshot.summary.total_sales)} บาท`} />
          <ExecutiveFact label="บิลขาย" value={`${formatInteger(snapshot.summary.document_count)} ใบ`} />
          <ExecutiveFact label="สาขานำ" value={topBranch?.branch_code ?? "-"} />
          <ExecutiveFact label="ข้อมูล" value={reconciliationOk ? "ยอดตรงกัน" : "มีส่วนต่าง"} />
        </div>
      </div>
    </section>
  );
}

function ExecutiveFact({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-gray-100 bg-gray-50 px-3 py-3 dark:border-gray-800 dark:bg-white/[0.04]">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-semibold text-gray-900 dark:text-white/90" title={value}>
        {value}
      </p>
    </div>
  );
}

function ReportControlBar({
  tenantId,
  tenantOptions,
  dateFrom,
  dateTo,
  running,
  loading,
  onTenantChange,
  onDateFromChange,
  onDateToChange,
  onReload,
  onRun,
}: {
  tenantId: TenantId;
  tenantOptions: Array<{ value: string; label: string }>;
  dateFrom: string;
  dateTo: string;
  running: boolean;
  loading: boolean;
  onTenantChange: (value: TenantId) => void;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onReload: () => void;
  onRun: () => void;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_160px_160px_minmax(220px,240px)]">
        <div>
          <Label>บริษัท / ฐานข้อมูล</Label>
          <Select
            key={tenantId}
            className="truncate"
            options={tenantOptions}
            defaultValue={tenantId}
            onChange={(value) => onTenantChange(value as TenantId)}
          />
        </div>
        <div>
          <Label>วันที่เริ่มต้น</Label>
          <Input
            key={`${tenantId}-from`}
            type="date"
            defaultValue={dateFrom}
            onChange={(event) => onDateFromChange(event.target.value)}
          />
        </div>
        <div>
          <Label>วันที่สิ้นสุด</Label>
          <Input
            key={`${tenantId}-to`}
            type="date"
            defaultValue={dateTo}
            onChange={(event) => onDateToChange(event.target.value)}
          />
        </div>
        <div className="flex items-end">
          <div className="grid w-full grid-cols-2 gap-2">
            <Button
              className="h-11 w-full whitespace-nowrap px-3"
              variant="outline"
              onClick={onReload}
              disabled={running || loading}
            >
              รีเฟรช
            </Button>
            <Button
              className="h-11 w-full whitespace-nowrap px-3"
              onClick={onRun}
              disabled={running || loading}
              startIcon={<ArrowUpIcon />}
            >
              {running ? "กำลังรัน" : "รันรายงาน"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DecisionBriefPanel({
  snapshot,
  lineDelivery,
  operationsStatus,
}: {
  snapshot: SalesGoodsServicesSnapshot;
  lineDelivery: LineDeliveryRecord | null;
  operationsStatus: OperationsStatus | null;
}) {
  const noBranch = snapshot.branch_sales.find(
    (branch) => branch.branch_code === "no_branch",
  );
  const reconciliationOk =
    Math.abs(snapshot.reconciliation.difference_amount) <= 0.01;
  const workerOk = operationsStatus?.worker.status === "ok";
  const lineSent = lineDelivery?.status === "success";
  const topBranch = snapshot.branch_sales[0] ?? null;
  const topBranchShare = topBranch
    ? (topBranch.total_amount / Math.max(snapshot.summary.total_sales, 1)) * 100
    : 0;
  const topProduct = snapshot.top_products[0] ?? null;
  const topProductShare = topProduct
    ? (topProduct.sum_amount / Math.max(snapshot.summary.total_sales, 1)) * 100
    : 0;
  const items = [
    {
      title: "ตรวจสาขาที่ไม่ระบุ",
      value: noBranch ? "มีรายการไม่ระบุสาขา" : "ข้อมูลสาขาชัดเจน",
      detail: noBranch
        ? `${formatMoney(noBranch.total_amount)} บาทอยู่ใน no_branch`
        : `${snapshot.branch_sales[0]?.branch_code ?? "-"} เป็นสาขาหลักของรอบนี้`,
      owner: "ฝ่ายขาย / แอดมิน SML",
      tone: noBranch ? "warning" : "success",
    },
    {
      title: "ยืนยันตัวเลขก่อนส่งต่อ",
      value: reconciliationOk ? "ยอดหัวบิลตรงกับรายการ" : "ยอดมีส่วนต่าง",
      detail: reconciliationOk
        ? "ใช้ตัวเลขนี้คุยต่อได้"
        : `ส่วนต่าง ${formatMoney(snapshot.reconciliation.difference_amount)} บาท`,
      owner: "บัญชี / ผู้ดูแลข้อมูล",
      tone: reconciliationOk ? "success" : "warning",
    },
    {
      title: "สถานะ Morning Brief",
      value: lineSent ? "ส่ง LINE แล้ว" : "ยังไม่พบการส่งสำเร็จ",
      detail: lineDelivery
        ? formatDateTime(lineDelivery.created_at)
        : "ควรทดสอบก่อน demo ลูกค้า",
      owner: "ผู้ดูแลระบบ",
      tone: lineSent ? "success" : "warning",
    },
    {
      title: "สุขภาพงานเบื้องหลัง",
      value: workerOk ? "ทำงานปกติ" : "ควรตรวจ worker",
      detail: operationsStatus?.worker.age_seconds
        ? formatDuration(operationsStatus.worker.age_seconds)
        : "ยังไม่มี heartbeat",
      owner: "Technical owner",
      tone: workerOk ? "success" : "warning",
    },
    {
      title: "ความเสี่ยงพึ่งสาขาเดียว",
      value:
        topBranch && topBranchShare >= 90
          ? `${topBranch.branch_code} ถือยอด ${formatPercent(topBranchShare)}`
          : "กระจายยอดขายอยู่ในเกณฑ์",
      detail:
        topBranch && topBranchShare >= 90
          ? "ควรตรวจว่าสาขาอื่นไม่มีข้อมูลจริง หรือ mapping สาขายังไม่ครบ"
          : `${snapshot.branch_sales.length} สาขาถูกนับในรายงานนี้`,
      owner: "ผู้จัดการสาขา",
      tone: topBranch && topBranchShare >= 90 ? "warning" : "success",
    },
    {
      title: "สินค้าหลักของรอบนี้",
      value: topProduct
        ? `${topProduct.item_name.slice(0, 42)}${topProduct.item_name.length > 42 ? "..." : ""}`
        : "ยังไม่มีสินค้าเด่น",
      detail: topProduct
        ? `${formatMoney(topProduct.sum_amount)} บาท · ${formatPercent(topProductShare)} ของยอดขาย`
        : "ยังไม่พบรายการสินค้าในช่วงวันที่นี้",
      owner: "จัดซื้อ / ฝ่ายขาย",
      tone: topProductShare >= 35 ? "warning" : "success",
    },
  ] satisfies Array<{
    title: string;
    value: string;
    detail: string;
    owner: string;
    tone: "success" | "warning";
  }>;
  const watchCount = items.filter((item) => item.tone === "warning").length;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
      <div className="rounded-2xl border border-gray-900 bg-[#101828] p-6 text-white shadow-theme-md">
        <Badge color={watchCount ? "warning" : "success"}>
          {watchCount ? `${watchCount} เรื่องควรดู` : "พร้อมนำเสนอ"}
        </Badge>
        <p className="mt-5 text-sm font-medium text-gray-300">
          Executive decision
        </p>
        <h3 className="mt-2 text-2xl font-semibold text-white">
          {watchCount
            ? "มีประเด็นที่ควรเคลียร์ก่อนส่งต่อ"
            : "รายงานพร้อมใช้คุยธุรกิจวันนี้"}
        </h3>
        <p className="mt-3 text-sm leading-6 text-gray-300">
          ระบบอ่านข้อมูลจาก SML แล้วแปลงเป็นรายการตัดสินใจสั้น ๆ เพื่อให้เจ้าของกิจการไม่ต้องไล่ดูตารางเอง
        </p>
        <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.06] p-4">
          <p className="text-xs font-medium uppercase text-gray-400">
            Next best action
          </p>
          <p className="mt-2 text-sm font-semibold text-white">
            {watchCount
              ? "เริ่มจากการตรวจ no_branch และความถูกต้องยอดขาย"
              : "ใช้ dashboard นี้เป็น morning brief สำหรับทีมขายได้เลย"}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {items.map((item, index) => (
          <div
            key={item.title}
            className={`rounded-2xl border bg-white p-5 shadow-theme-xs dark:bg-white/[0.03] ${
              item.tone === "success"
                ? "border-success-100 dark:border-success-500/20"
                : "border-warning-200 dark:border-warning-500/20"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-xl text-sm font-semibold ${
                    item.tone === "success"
                      ? "bg-success-50 text-success-600 dark:bg-success-500/15"
                      : "bg-warning-50 text-warning-600 dark:bg-warning-500/15"
                  }`}
                >
                  {index + 1}
                </span>
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white/90">
                    {item.title}
                  </p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Owner: {item.owner}
                  </p>
                </div>
              </div>
              <Badge color={item.tone}>
                {item.tone === "success" ? "ปกติ" : "ควรดู"}
              </Badge>
            </div>
            <p className="mt-4 text-base font-semibold text-gray-800 dark:text-white/90">
              {item.value}
            </p>
            <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">
              {item.detail}
            </p>
          </div>
        ))}
      </div>
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
    <ComponentCard
      id="operations-readiness"
      title="สถานะระบบพร้อมใช้งาน"
      desc="ตรวจว่า API, งานส่งรายงานเช้า, ฐานข้อมูลของบริษัท และ LINE OA พร้อมใช้งานหรือไม่"
      action={
        <Badge color={status.api.ok && status.scheduler.enabled ? "success" : "warning"}>
          {status.api.ok && status.scheduler.enabled ? "พร้อมใช้งาน" : "ต้องตรวจ"}
        </Badge>
      }
    >
      <div className="flex flex-wrap gap-2">
        <Badge color={status.api.system_store === "postgres" ? "success" : "warning"}>
          {status.api.system_store === "postgres" ? "ฐานระบบพร้อม" : "โหมดไฟล์ทดลอง"}
        </Badge>
        <Badge color={workerTone}>งานเบื้องหลัง {formatWorkerStatus(status.worker.status)}</Badge>
        <Badge color={status.scheduler.enabled ? "success" : "warning"}>
          ส่งอัตโนมัติ {status.scheduler.enabled ? "เปิดอยู่" : "ปิดอยู่"}
        </Badge>
      </div>
      <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
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
    </ComponentCard>
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
    <ComponentCard
      title="ส่งสรุปยอดขายเข้า LINE"
      desc="ทดสอบข้อความหรือส่ง Morning Brief ของเมื่อวานจากข้อมูลที่ trace ได้"
      action={
        <div className="flex flex-wrap gap-2">
          <Badge color={statusColor}>{statusText}</Badge>
          <Badge color="light">08:00 Asia/Bangkok</Badge>
        </div>
      }
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
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
    </ComponentCard>
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
    <ComponentCard
      id="morning-brief"
      title="ตัวอย่างข้อความ LINE ตอนเช้า"
      desc="ข้อความที่ลูกค้าจะได้รับจากข้อมูลรายงานล่าสุด"
      action={
        <div className="flex flex-wrap gap-2">
          <Badge color={preview.source === "sml_postgres" ? "success" : "warning"}>
            {formatSource(preview.source)}
          </Badge>
          <Badge color={preview.line_message_type === "flex" ? "success" : "light"}>
            {preview.line_message_type === "flex"
              ? "Flex + ปุ่มเปิดรายงาน"
              : "ข้อความ LINE"}
          </Badge>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
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
            label="รูปแบบข้อความ"
            value={
              preview.line_message_type === "flex"
                ? "Flex Message พร้อมปุ่มเปิดรายงาน"
                : "Text fallback"
            }
          />
          <SummaryRow
            label="ลิงก์แดชบอร์ด"
            value={preview.dashboard_url ? "แนบหลังปุ่มเปิดรายงาน" : "ยังไม่ตั้งค่า"}
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
    </ComponentCard>
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
    <ComponentCard
      title="ยอดขายแยกตามสาขา"
      action={<Badge color="light">{snapshot.branch_sales.length} สาขา</Badge>}
    >
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
    </ComponentCard>
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
    <ComponentCard
      title="สินค้าขายดี"
      action={<Badge color="success">จากรายการสินค้า</Badge>}
    >
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
    </ComponentCard>
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
    <ComponentCard
      title="ตรวจยอดขาย"
      action={
        <Badge color={hasWarning ? "warning" : "success"}>
          {hasWarning ? "ควรตรวจสอบ" : "ยอดตรงกัน"}
        </Badge>
      }
    >
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
    </ComponentCard>
  );
}

function RunHistory({ runs }: { runs: ReportRunRecord[] }) {
  return (
    <ComponentCard
      id="run-history"
      title="ประวัติการรันรายงาน"
      action={<Badge color="light">{runs.length} รอบ</Badge>}
    >
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
    </ComponentCard>
  );
}

function AuditTrail({ auditLogs }: { auditLogs: AuditLogEntry[] }) {
  return (
    <ComponentCard
      id="audit-trail"
      title="บันทึกกิจกรรมระบบ"
      action={<Badge color="light">{auditLogs.length} รายการ</Badge>}
    >
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
    </ComponentCard>
  );
}

function CollapsibleDataSection({
  snapshot,
}: {
  snapshot: SalesGoodsServicesSnapshot;
}) {
  return (
    <details className="group rounded-2xl border border-gray-200 bg-white shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03]">
      <summary className="flex cursor-pointer list-none flex-col gap-3 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-base font-medium text-gray-800 dark:text-white/90">
            ตารางข้อมูลต้นทาง
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            เปิดเฉพาะตอนต้องตรวจเลขบิลหรือรายการสินค้า ลด noise สำหรับหน้า executive view
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge color="light">{snapshot.documents.length} บิล</Badge>
          <Badge color="light">{snapshot.lines.length} รายการ</Badge>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 transition group-open:bg-brand-50 group-open:text-brand-500 dark:bg-white/5 dark:text-gray-300">
            เปิดดูตาราง
          </span>
        </div>
      </summary>
      <div className="space-y-4 border-t border-gray-100 p-4 dark:border-gray-800 sm:p-6">
        <DocumentsTable snapshot={snapshot} />
        <LinesTable snapshot={snapshot} />
      </div>
    </details>
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
    <ComponentCard
      title={props.title}
      desc={props.description}
      action={
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
      }
      bodyClassName="sm:p-0"
    >
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
        <Pagination
          currentPage={currentPage + 1}
          totalPages={pageCount}
          onPageChange={(nextPage) => setPage(nextPage - 1)}
          previousLabel="ก่อนหน้า"
          nextLabel="ถัดไป"
        />
      </div>
    </ComponentCard>
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

function formatPercent(value: number) {
  return `${value.toLocaleString("th-TH", {
    maximumFractionDigits: 1,
  })}%`;
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

function getTenantLineTarget(status: OperationsStatus | null, tenantId: TenantId) {
  return (
    status?.tenants.find((tenant) => tenant.id === tenantId)?.line_target_masked ??
    "ยังไม่ตั้งค่า"
  );
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
  return value === "sml_postgres" ? "ข้อมูลจากระบบขาย SML" : "ข้อมูลตัวอย่าง";
}

function formatBranchLabel(branchCode: string) {
  if (branchCode === "no_branch") {
    return "ไม่ระบุสาขา";
  }
  return `สาขา ${branchCode}`;
}
