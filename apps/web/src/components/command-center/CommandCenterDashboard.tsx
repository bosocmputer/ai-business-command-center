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
  { value: "tenant_demo_remote", label: "Demo Remote (demo)" },
  {
    value: "tenant_office_sml1_2026",
    label: "Office SML1 2026 (sml1_2026)",
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
      ]);

      if (
        !tenantsResponse.ok ||
        !snapshotResponse.ok ||
        !runsResponse.ok ||
        !auditResponse.ok ||
        !linePreviewResponse.ok ||
        !lineDeliveriesResponse.ok
      ) {
        throw new Error("Dashboard API is not ready.");
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

      setTenants(tenantsPayload.data);
      setSnapshot(snapshotPayload.data);
      setRuns(runsPayload.data);
      setLinePreview(linePreviewPayload.data);
      setLineDeliveries(lineDeliveriesPayload.data);
      setAuditLogs(
        auditPayload.data.filter((entry) => entry.tenant_id === nextTenantId),
      );
      setDateFrom(snapshotPayload.data.params.date_from);
      setDateTo(snapshotPayload.data.params.date_to);
    } catch (unknownError) {
      setError(
        unknownError instanceof Error
          ? unknownError.message
          : "Unable to load dashboard.",
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
    label: `${tenant.name} (${tenant.databaseName})`,
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
      return { color: "success" as const, text: "Valid" };
    }

    if (snapshot.quality_status === "stale") {
      return { color: "warning" as const, text: "Stale sample" };
    }

    if (snapshot.quality_status === "failed") {
      return { color: "error" as const, text: "Failed" };
    }

    return { color: "warning" as const, text: "Reconciliation warning" };
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
          : "Report run failed.",
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
          : "Morning brief request failed.",
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
                ? "Datasource configured"
                : "Env required for live run"}
            </Badge>
          </div>
          <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">
            AI Business Command Center
          </h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Report contract: sales_goods_services. Financial truth uses SML
            header total, while product and branch analytics come from detail
            lines.
          </p>
          {snapshot && (
            <div className="mt-4 grid grid-cols-1 gap-3 text-xs text-gray-500 dark:text-gray-400 sm:grid-cols-2 xl:grid-cols-4">
              <span>
                Last run:{" "}
                <strong className="font-medium text-gray-700 dark:text-gray-200">
                  {formatDateTime(snapshot.generated_at)}
                </strong>
              </span>
              <span>
                Source:{" "}
                <strong className="font-medium text-gray-700 dark:text-gray-200">
                  {formatSource(snapshot.source)}
                </strong>
              </span>
              <span>
                Period:{" "}
                <strong className="font-medium text-gray-700 dark:text-gray-200">
                  {snapshot.params.date_from} to {snapshot.params.date_to}
                </strong>
              </span>
              <span className="truncate">
                Run ID:{" "}
                <strong className="font-medium text-gray-700 dark:text-gray-200">
                  {snapshot.run_id}
                </strong>
              </span>
            </div>
          )}
        </div>

        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 xl:max-w-4xl xl:grid-cols-[minmax(280px,1.6fr)_160px_160px_170px]">
          <div>
            <Label>Tenant</Label>
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
            <Label>From</Label>
            <Input
              key={`${tenantId}-from`}
              type="date"
              defaultValue={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            />
          </div>
          <div>
            <Label>To</Label>
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
                Refresh
              </Button>
              <Button
                className="h-11 w-full px-3"
                onClick={() => void runReport()}
                disabled={running || loading}
                startIcon={<ArrowUpIcon />}
              >
                {running ? "Running" : "Run"}
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              icon={<DollarLineIcon className="text-gray-800 dark:text-white/90" />}
              label="Total Sales"
              value={formatMoney(snapshot.summary.total_sales)}
              detail="ic_trans.total_amount"
            />
            <MetricCard
              icon={<GroupIcon className="text-gray-800 size-6 dark:text-white/90" />}
              label="Documents"
              value={formatInteger(snapshot.summary.document_count)}
              detail="Sales invoices"
            />
            <MetricCard
              icon={<TableIcon className="text-gray-800 dark:text-white/90" />}
              label="Detail Lines"
              value={formatInteger(snapshot.summary.line_count)}
              detail={`${formatQty(snapshot.summary.total_qty)} units`}
            />
            <MetricCard
              icon={<BoxIconLine className="text-gray-800 dark:text-white/90" />}
              label="Top Product"
              value={snapshot.summary.top_product_name || "No data"}
              detail="By detail sum_amount"
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
        label="Snapshot Source"
        value={formatSource(snapshot.source)}
      />
      <SnapshotFact
        label="Last Successful Run"
        value={formatDateTime(snapshot.generated_at)}
      />
      <SnapshotFact
        label="Rows Loaded"
        value={formatInteger(
          snapshot.summary.document_count + snapshot.summary.line_count,
        )}
      />
      <SnapshotFact
        label="Run Trace"
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
    ? "Sent"
    : skippedDuplicate
    ? "Duplicate skipped"
    : "Ready";
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
              Morning Brief Control
            </h3>
            <Badge color={statusColor}>{statusText}</Badge>
            <Badge color="light">08:00 Asia/Bangkok</Badge>
          </div>
          <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <SummaryBlock label="Tenant" value={tenantName} />
            <SummaryBlock
              label="Data date"
              value={formatReportPeriod(period.date_from, period.date_to)}
            />
            <SummaryBlock label="Next schedule" value={nextSchedule} />
            <SummaryBlock
              label="Guard"
              value={sentDelivery ? "Success delivery exists" : "No success yet"}
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
            {running ? "Running" : "Dry run"}
          </Button>
          <Button
            className="h-11 px-3"
            onClick={onSend}
            disabled={running || Boolean(sentDelivery)}
          >
            {running ? "Sending" : sentDelivery ? "Sent" : "Send yesterday"}
          </Button>
        </div>
      </div>
      {resultDelivery && (
        <div className="mt-5 grid grid-cols-1 gap-3 border-t border-gray-100 pt-4 text-sm dark:border-gray-800 sm:grid-cols-3">
          <SummaryBlock
            label="Last delivery"
            value={resultDelivery.status}
            tone={lineDeliveryBadgeColor(resultDelivery.status)}
          />
          <SummaryBlock
            label="Target"
            value={resultDelivery.target_id_masked || "Not configured"}
          />
          <SummaryBlock
            label="Trace"
            value={resultDelivery.report_run_id}
          />
        </div>
      )}
      {latestResult && "status" in latestResult && (
        <p className="mt-4 rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:bg-warning-500/10 dark:text-orange-400">
          Duplicate guard skipped a repeated send for {formatReportPeriod(period.date_from, period.date_to)}.
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
            Morning Brief Preview
          </h3>
          <Badge color={preview.source === "sml_postgres" ? "success" : "warning"}>
            {formatSource(preview.source)}
          </Badge>
          <Badge color="light">LINE text</Badge>
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
                Last LINE Action
              </p>
              <Badge color={lineDeliveryBadgeColor(latestDelivery.status)}>
                {latestDelivery.status}
              </Badge>
            </div>
            <p className="truncate text-xs text-gray-500 dark:text-gray-400">
              {latestDelivery.id}
            </p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Target: {latestDelivery.target_id_masked || "Not configured"}
            </p>
            {latestDelivery.safe_error_message && (
              <p className="mt-2 rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:bg-warning-500/10 dark:text-orange-400">
                {latestDelivery.safe_error_message}
              </p>
            )}
          </div>
        )}
        <SummaryRow label="Run ID" value={preview.run_id} />
        <SummaryRow label="Generated" value={formatDateTime(preview.generated_at)} />
        <SummaryRow
          label="Dashboard"
          value={preview.dashboard_url ? "Included" : "Not configured"}
        />
        <div>
          <p className="mb-2 text-xs font-medium uppercase text-gray-400">
            Warnings
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
              Ready for LINE sender.
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
          Sales by Branch
        </h3>
        <Badge color="light">{snapshot.branch_sales.length} branches</Badge>
      </div>
      <div className="max-w-full overflow-x-auto custom-scrollbar">
        <div className="-ml-5 min-w-[650px] xl:min-w-full pl-2">
          <ReactApexChart
            options={options}
            series={[
              {
                name: "Sales",
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
          Top Products
        </h3>
        <Badge color="success">Detail</Badge>
      </div>
      <ReactApexChart
        options={options}
        series={[
          {
            name: "Amount",
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
          Reconciliation
        </h3>
        <Badge color={hasWarning ? "warning" : "success"}>
          {hasWarning ? "Warning" : "Matched"}
        </Badge>
      </div>
      <div className="space-y-4">
        <SummaryRow
          label="Header total"
          value={formatMoney(snapshot.reconciliation.header_total_amount)}
        />
        <SummaryRow
          label="Detail total"
          value={formatMoney(snapshot.reconciliation.detail_sum_amount)}
        />
        <SummaryRow
          label="Difference"
          value={formatMoney(snapshot.reconciliation.difference_amount)}
        />
      </div>
      <p className="mt-5 text-sm text-gray-500 dark:text-gray-400">
        {snapshot.reconciliation.note}
      </p>
      <div className="mt-4 rounded-xl bg-gray-50 p-4 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
        Financial KPI uses header `ic_trans.total_amount`. Product, quantity,
        and top item analytics use detail `ic_trans_detail.sum_amount`. A
        warning usually means VAT, discount, rounding, or document/detail base
        differs in SML, not that the run failed.
      </div>
    </div>
  );
}

function RunHistory({ runs }: { runs: ReportRunRecord[] }) {
  return (
    <div id="run-history" className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
          Run History
        </h3>
        <Badge color="light">{runs.length} runs</Badge>
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
                  {run.params.date_from} to {run.params.date_to} ·{" "}
                  {formatInteger(run.row_count)} rows
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {formatDateTime(run.started_at)}
                  {run.finished_at ? ` -> ${formatDateTime(run.finished_at)}` : ""}
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
                {run.status}
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
          Audit Trail
        </h3>
        <Badge color="light">{auditLogs.length} events</Badge>
      </div>
      {auditLogs.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No audit events for this tenant yet.
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
      title="Sales Documents"
      description="Header view from ic_trans. If header branch is blank, branch analytics still use detail branch where available."
      badge={`${snapshot.documents.length} rows`}
      headers={["Date", "Doc No", "Customer", "Header Branch", "Total", "Cashier"]}
      rows={snapshot.documents.map((document) => [
        document.doc_date,
        document.doc_no,
        document.cust_name || document.cust_code || "-",
        document.branch_code || "Header blank",
        formatMoney(document.total_amount),
        document.cashier_code || "-",
      ])}
    />
  );
}

function LinesTable({ snapshot }: { snapshot: SalesGoodsServicesSnapshot }) {
  return (
    <DataTable
      title="Product and Service Lines"
      description="Detail view from ic_trans_detail. Branch charts and top-product analytics use this detail branch."
      badge={`${snapshot.lines.length} rows`}
      headers={["Date", "Doc No", "Item", "Detail Branch", "Qty", "Amount"]}
      rows={snapshot.lines.map((line) => [
        line.doc_date,
        line.doc_no,
        `${line.item_code || "-"} ${line.item_name || ""}`,
        line.branch_code || "no_branch",
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
            placeholder="Search table"
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
          Showing {visibleRows.length ? currentPage * pageSize + 1 : 0}-
          {Math.min((currentPage + 1) * pageSize, filteredRows.length)} of{" "}
          {filteredRows.length}
        </span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPage(Math.max(0, currentPage - 1))}
            disabled={currentPage === 0}
          >
            Previous
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
            Next
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
      {["Total Sales", "Documents", "Lines", "Top Product"].map((label) => (
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
        No sales in this range
      </h3>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
        The report returned a valid empty snapshot. Try another period or tenant.
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
  return value === "sml_postgres" ? "SML PostgreSQL" : "Sample snapshot";
}
