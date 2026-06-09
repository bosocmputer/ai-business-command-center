"use client";

import dynamic from "next/dynamic";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { ApexOptions } from "apexcharts";
import {
  formatSmlBranchLabel,
  type ArDebtReceiptSnapshot,
  type GrossProfitBaseRow,
  type GrossProfitByArCustomerRow,
  type GrossProfitByArCustomerSnapshot,
  type GrossProfitByProductRow,
  type GrossProfitByProductSnapshot,
  type ReportKey,
  type ReportSnapshot,
  type Tenant,
} from "@ai-bcc/shared";
import { getCommandCenterApiBaseUrl } from "./apiBaseUrl";

const API_BASE_URL = getCommandCenterApiBaseUrl();
const ReactApexChart = dynamic(() => import("react-apexcharts"), {
  ssr: false,
});

type DashboardAccess = {
  token: string;
  expires_at: string;
  source_run_id: string;
  allowed_report_keys: ReportKey[];
  max_date_window_days: number;
  lookback_days: number;
};

type ViewerParams = {
  tenantId: string;
  reportKey: ReportKey;
  runId: string;
  token: string;
};

type ExecutiveDashboardRunStatus =
  | "queued"
  | "running"
  | "success"
  | "success_with_warnings"
  | "failed";

type ExecutiveDashboardReportResult = {
  report_key: ReportKey;
  status: "success" | "success_with_warning" | "failed";
  freshness: "fresh" | "reference" | "unavailable";
  run_id: string | null;
  snapshot_generated_at: string | null;
  duration_ms: number | null;
  row_count: number | null;
  degraded_reason: string | null;
};

type ExecutiveDashboardRun = {
  id: string;
  tenant_id: string;
  source_run_id: string;
  params: {
    date_from: string;
    date_to: string;
    time_from?: string;
    time_to?: string;
  };
  report_keys: ReportKey[];
  status: ExecutiveDashboardRunStatus;
  report_run_ids: string[];
  report_results: ExecutiveDashboardReportResult[];
  snapshots: ReportSnapshot[];
  safe_error_message: string | null;
  queued_at: string | null;
  claimed_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  progress_stage: string | null;
  progress_percent: number | null;
  progress_current_report_key: ReportKey | null;
  progress_done_reports: number | null;
  progress_total_reports: number | null;
  progress_updated_at: string | null;
};

type ExecutiveDashboardRunResponse = {
  data?: ExecutiveDashboardRun;
  reused?: boolean;
  message?: string;
  error?: string;
};

type TenantsResponse = {
  data?: Tenant[];
  error?: string;
};

type Tone = "neutral" | "info" | "good" | "warning" | "critical";

type KpiItem = {
  label: string;
  value: string;
  helper?: string;
  tone?: Tone;
};

type ChartSpec = {
  title: string;
  caption: string;
  kind: "bar";
  color: string;
  data: Array<{ label: string; value: number }>;
};

type EvidenceRow = {
  label: string;
  meta: string;
  value: string;
  tone?: Tone;
};

type EvidenceSection = {
  title: string;
  caption: string;
  rows: EvidenceRow[];
};

type ExecutiveReportViewModel = {
  reportKey: ReportKey;
  category: string;
  title: string;
  primaryLabel: string;
  primaryValue: string;
  primaryUnit: string;
  statusLabel: string;
  statusTone: Tone;
  sourceLabel: string;
  basisLabel: string;
  periodLabel: string;
  generatedAtLabel: string;
  kpis: KpiItem[];
  insights: Array<{ title: string; body: string; tone?: Tone }>;
  actionItems: string[];
  charts: ChartSpec[];
  evidenceSections: EvidenceSection[];
  trustNotes: Array<{ title: string; body: string; tone?: Tone }>;
};

type DashboardMode = "line" | "selected_date";

const reportOrder: ReportKey[] = [
  "sales_goods_services",
  "purchase_goods_payables",
  "gross_profit_by_product",
  "gross_profit_by_ar_customer",
  "stock_balance",
  "stock_reorder",
  "ar_customer_movement",
  "ar_debt_receipt",
];

export function ExecutiveDetailDashboardV2({
  dashboardAccess,
  initialSnapshot,
  viewer,
}: {
  dashboardAccess: DashboardAccess | null;
  initialSnapshot: ReportSnapshot;
  viewer: ViewerParams;
}) {
  const allowedReportKeys = useMemo(
    () =>
      dashboardAccess?.allowed_report_keys?.length
        ? reportOrder.filter((key) =>
            dashboardAccess.allowed_report_keys.includes(key),
          )
        : [initialSnapshot.report_key],
    [dashboardAccess, initialSnapshot.report_key],
  );
  const [tenantDisplayName, setTenantDisplayName] = useState<string | null>(null);
  const [selectedReportKey, setSelectedReportKey] = useState<ReportKey>(
    initialSnapshot.report_key,
  );
  const [dateFrom, setDateFrom] = useState(initialSnapshot.params.date_from);
  const [dateTo, setDateTo] = useState(initialSnapshot.params.date_to);
  const [dashboardRun, setDashboardRun] = useState<ExecutiveDashboardRun | null>(
    null,
  );
  const [runLoading, setRunLoading] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [mode, setMode] = useState<DashboardMode>("line");

  useEffect(() => {
    let cancelled = false;
    async function loadTenantName() {
      try {
        const response = await fetch(`${API_BASE_URL}/api/tenants`);
        const payload = (await response.json()) as TenantsResponse;
        const tenant = payload.data?.find(
          (item) => item.id === initialSnapshot.tenant_id,
        );
        if (!cancelled && tenant) {
          setTenantDisplayName(tenant.name);
        }
      } catch {
        if (!cancelled) {
          setTenantDisplayName(null);
        }
      }
    }
    void loadTenantName();
    return () => {
      cancelled = true;
    };
  }, [initialSnapshot.tenant_id]);

  const isActive =
    dashboardRun?.status === "queued" || dashboardRun?.status === "running";

  useEffect(() => {
    if (!dashboardAccess || !dashboardRun || !isActive) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      void fetchDashboardRun({
        access: dashboardAccess,
        runId: dashboardRun.id,
        tenantId: viewer.tenantId,
        signal: controller.signal,
      })
        .then((nextRun) => setDashboardRun(nextRun))
        .catch(() => undefined);
    }, 2000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [dashboardAccess, dashboardRun, isActive, viewer.tenantId]);

  const dashboardReady =
    dashboardRun?.status === "success" ||
    dashboardRun?.status === "success_with_warnings" ||
    dashboardRun?.status === "failed";
  const activeSnapshots =
    mode === "selected_date" && dashboardReady && dashboardRun
      ? dashboardRun.snapshots
      : [initialSnapshot];
  const selectedSnapshot =
    activeSnapshots.find((snapshot) => snapshot.report_key === selectedReportKey) ??
    null;
  const selectedResult =
    dashboardRun?.report_results.find(
      (result) => result.report_key === selectedReportKey,
    ) ?? null;
  const selectedViewModel = selectedSnapshot
    ? buildExecutiveReportViewModel(selectedSnapshot, selectedResult)
    : null;
  const tenantName = tenantDisplayName ?? initialSnapshot.tenant_id;
  const progress = dashboardRun?.progress_percent ?? 0;

  useEffect(() => {
    document.title = `${getReportTitle(selectedReportKey)} | AI Business Center`;
  }, [selectedReportKey]);

  async function startDashboardRun() {
    if (!dashboardAccess) {
      setRunError("ลิงก์นี้ยังไม่รองรับการเลือกวันที่อื่น กรุณาเปิดจาก LINE รอบล่าสุด");
      return;
    }
    setRunLoading(true);
    setRunError(null);
    setMode("selected_date");
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/reports/${encodeURIComponent(
          viewer.tenantId,
        )}/executive-dashboard-runs`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            dashboard_token: dashboardAccess.token,
            date_from: dateFrom,
            date_to: dateTo,
            client_request_id:
              typeof crypto !== "undefined" && "randomUUID" in crypto
                ? crypto.randomUUID()
                : `${Date.now()}`,
          }),
        },
      );
      const payload = (await response.json()) as ExecutiveDashboardRunResponse;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error || "เริ่มสร้าง dashboard ไม่สำเร็จ");
      }
      setDashboardRun(payload.data);
    } catch (error) {
      setRunError(
        error instanceof Error
          ? error.message
          : "เริ่มสร้าง dashboard ไม่สำเร็จ กรุณาลองใหม่",
      );
    } finally {
      setRunLoading(false);
    }
  }

  function applyQuickChoice(choice: "today" | "yesterday" | "month") {
    const today = toIsoDate(new Date());
    if (choice === "today") {
      setDateFrom(today);
      setDateTo(today);
      return;
    }
    if (choice === "yesterday") {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const value = toIsoDate(yesterday);
      setDateFrom(value);
      setDateTo(value);
      return;
    }
    const now = new Date();
    setDateFrom(toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)));
    setDateTo(today);
  }

  return (
    <main className="min-h-screen bg-[#F5F7FB] text-[#101828]">
      <div className="border-b border-[#D9E2F2] bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone="info">Executive Dashboard V2</StatusPill>
              <StatusPill tone={mode === "line" ? "good" : "info"}>
                {mode === "line" ? "ข้อมูลจาก LINE รอบนี้" : "ข้อมูลวันที่ที่เลือก"}
              </StatusPill>
              {dashboardAccess && (
                <StatusPill tone="neutral">
                  สิทธิ์ {allowedReportKeys.length} รายงาน
                </StatusPill>
              )}
            </div>
            <h1 className="mt-3 text-[24px] font-semibold leading-8 tracking-normal sm:text-[30px] sm:leading-10">
              {selectedViewModel?.title ?? getReportTitle(selectedReportKey)}
            </h1>
            <p className="mt-1 text-[14px] leading-[22px] text-[#667085]">
              {tenantName} · รอบ LINE{" "}
              {formatReportPeriod(initialSnapshot.params)} · อัปเดต{" "}
              {formatDateTime(initialSnapshot.generated_at)}
            </p>
          </div>
          <a
            className="inline-flex h-10 w-full items-center justify-center rounded-lg border border-[#D0D5DD] bg-white px-4 text-[14px] font-semibold leading-[22px] text-[#344054] shadow-sm transition hover:bg-[#F9FAFB] sm:w-fit"
            href={buildV1FallbackUrl(viewer)}
          >
            เปิด V1 fallback
          </a>
        </div>
      </div>

      <section className="border-b border-[#D9E2F2] bg-[#EFF6FF]">
        <div className="mx-auto grid max-w-7xl gap-3 px-4 py-3 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <div className="flex flex-wrap gap-2">
              <ToolbarButton
                active={mode === "line"}
                onClick={() => setMode("line")}
              >
                จาก LINE รอบนี้
              </ToolbarButton>
              <ToolbarButton onClick={() => applyQuickChoice("today")}>
                วันนี้
              </ToolbarButton>
              <ToolbarButton onClick={() => applyQuickChoice("yesterday")}>
                เมื่อวาน
              </ToolbarButton>
              <ToolbarButton onClick={() => applyQuickChoice("month")}>
                เดือนนี้
              </ToolbarButton>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:max-w-xl">
              <DateField label="จากวันที่" value={dateFrom} onChange={setDateFrom} />
              <DateField label="ถึงวันที่" value={dateTo} onChange={setDateTo} />
            </div>
            {dashboardAccess && (
              <p className="mt-2 text-[12px] leading-[18px] text-[#475467]">
                เลือกย้อนหลังได้ {formatInteger(dashboardAccess.lookback_days)} วัน · สูงสุด{" "}
                {formatInteger(dashboardAccess.max_date_window_days)} วันต่อครั้ง
              </p>
            )}
          </div>
          <button
            className="h-11 rounded-lg bg-[#2563EB] px-5 text-[14px] font-semibold leading-[22px] text-white shadow-sm transition hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={runLoading || isActive || !dashboardAccess}
            onClick={() => void startDashboardRun()}
            type="button"
          >
            {isActive ? "กำลังสร้างข้อมูล" : runLoading ? "กำลังรับงาน" : "ดูข้อมูล"}
          </button>
        </div>
      </section>

      {(dashboardRun || runError) && (
        <section className="border-b border-[#EAECF0] bg-white">
          <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6">
            {runError ? (
              <p className="rounded-lg border border-[#FECDCA] bg-[#FEF3F2] px-3 py-2 text-[14px] leading-[22px] text-[#B42318]">
                {runError}
              </p>
            ) : dashboardRun ? (
              <div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[14px] font-semibold leading-[22px] text-[#101828]">
                      {formatDashboardProgressLabel(dashboardRun)}
                    </p>
                    <p className="text-[12px] leading-[18px] text-[#667085]">
                      ช่วงข้อมูล {formatReportPeriod(dashboardRun.params)}
                    </p>
                  </div>
                  <StatusPill tone={dashboardRun.status === "failed" ? "critical" : "info"}>
                    {formatDashboardRunStatus(dashboardRun.status)}
                  </StatusPill>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#EAECF0]">
                  <div
                    className="h-full rounded-full bg-[#2563EB] transition-all"
                    style={{ width: `${Math.max(5, Math.min(100, progress))}%` }}
                  />
                </div>
                {dashboardRun.safe_error_message && (
                  <p className="mt-3 rounded-lg border border-[#FEDF89] bg-[#FFFAEB] px-3 py-2 text-[13px] leading-5 text-[#B54708]">
                    {dashboardRun.safe_error_message}
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </section>
      )}

      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:py-6">
        <aside className="space-y-3">
          <ReportSelector
            allowedKeys={allowedReportKeys}
            mode={mode}
            results={dashboardRun?.report_results ?? []}
            selectedReportKey={selectedReportKey}
            snapshots={activeSnapshots}
            onSelect={setSelectedReportKey}
          />
        </aside>

        <div className="min-w-0 space-y-4">
          {selectedViewModel ? (
            <ReportDashboardSurface
              mode={mode}
              result={selectedResult}
              viewModel={selectedViewModel}
            />
          ) : (
            <UnavailableReportSurface
              mode={mode}
              reportKey={selectedReportKey}
              onRun={() => void startDashboardRun()}
              disabled={!dashboardAccess || isActive || runLoading}
            />
          )}
        </div>
      </div>
    </main>
  );
}

function ReportDashboardSurface({
  mode,
  result,
  viewModel,
}: {
  mode: DashboardMode;
  result: ExecutiveDashboardReportResult | null;
  viewModel: ExecutiveReportViewModel;
}) {
  return (
    <>
      <section className="overflow-hidden rounded-2xl border border-[#D9E2F2] bg-white shadow-sm">
        <div className="grid gap-5 p-4 sm:p-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone="neutral">{viewModel.category}</StatusPill>
              <StatusPill tone={viewModel.statusTone}>
                {viewModel.statusLabel}
              </StatusPill>
              <StatusPill tone="info">{viewModel.sourceLabel}</StatusPill>
            </div>
            <p className="mt-5 text-[13px] font-semibold leading-5 text-[#2563EB]">
              {viewModel.primaryLabel}
            </p>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <strong className="break-words text-[36px] font-semibold leading-[44px] tracking-normal text-[#101828] sm:text-[46px] sm:leading-[56px]">
                {viewModel.primaryValue}
              </strong>
              <span className="text-[20px] font-semibold leading-8 text-[#344054]">
                {viewModel.primaryUnit}
              </span>
            </div>
            <p className="mt-3 text-[14px] leading-[22px] text-[#667085]">
              {mode === "line" ? "ตัวเลขนี้ตรงกับรายงานที่เปิดจาก LINE" : "ตัวเลขนี้สร้างใหม่จากวันที่ที่เลือก"} · {viewModel.periodLabel}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {viewModel.kpis.map((kpi) => (
              <KpiTile key={kpi.label} item={kpi} />
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <div className="space-y-4">
          <section className="rounded-2xl border border-[#D9E2F2] bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[12px] font-semibold leading-[18px] text-[#2563EB]">
                  สิ่งที่ควรดู
                </p>
                <h2 className="mt-1 text-[20px] font-semibold leading-8 text-[#101828]">
                  คำตอบก่อนดูตาราง
                </h2>
              </div>
              {result && (
                <StatusPill tone={result.freshness === "reference" ? "warning" : "good"}>
                  {formatFreshness(result)}
                </StatusPill>
              )}
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              {viewModel.insights.map((insight, index) => (
                <InsightTile
                  key={insight.title}
                  body={insight.body}
                  index={index + 1}
                  title={insight.title}
                  tone={insight.tone}
                />
              ))}
            </div>
          </section>

          {viewModel.charts.length ? (
            <section className="grid gap-4 xl:grid-cols-2">
              {viewModel.charts.map((chart) => (
                <ExecutiveChart key={chart.title} chart={chart} />
              ))}
            </section>
          ) : (
            <section className="rounded-2xl border border-[#D9E2F2] bg-white p-5 shadow-sm">
              <h2 className="text-[20px] font-semibold leading-8 text-[#101828]">
                หลักฐานสำคัญ
              </h2>
              <p className="mt-1 text-[14px] leading-[22px] text-[#667085]">
                รายงานนี้ใช้รายการหลักแทนกราฟ เพราะข้อมูลเป็นเอกสารหรือสถานะเฉพาะรายการ
              </p>
            </section>
          )}

          <section className="grid gap-4 xl:grid-cols-2">
            {viewModel.evidenceSections.map((section) => (
              <EvidencePanel key={section.title} section={section} />
            ))}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-[#D9E2F2] bg-white p-4 shadow-sm sm:p-5">
            <h2 className="text-[18px] font-semibold leading-7 text-[#101828]">
              ควรทำอะไรต่อ
            </h2>
            <ol className="mt-3 space-y-3">
              {viewModel.actionItems.map((item, index) => (
                <li key={item} className="flex gap-3 text-[14px] leading-[22px] text-[#344054]">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#EFF6FF] text-[12px] font-semibold text-[#2563EB]">
                    {index + 1}
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ol>
          </section>

          <section className="rounded-2xl border border-[#D9E2F2] bg-white p-4 shadow-sm sm:p-5">
            <h2 className="text-[18px] font-semibold leading-7 text-[#101828]">
              ที่มาของตัวเลข
            </h2>
            <div className="mt-3 space-y-3">
              <FactRow label="ฐานข้อมูล" value={viewModel.basisLabel} />
              <FactRow label="ช่วงข้อมูล" value={viewModel.periodLabel} />
              <FactRow label="อัปเดต" value={viewModel.generatedAtLabel} />
              {result?.duration_ms != null && (
                <FactRow label="เวลาสร้าง" value={formatDuration(result.duration_ms)} />
              )}
              {result?.row_count != null && (
                <FactRow label="จำนวนแถว" value={`${formatInteger(result.row_count)} rows`} />
              )}
            </div>
            <div className="mt-4 space-y-2">
              {viewModel.trustNotes.map((note) => (
                <TrustNote key={note.title} note={note} />
              ))}
            </div>
          </section>
        </aside>
      </section>
    </>
  );
}

function ReportSelector({
  allowedKeys,
  mode,
  results,
  selectedReportKey,
  snapshots,
  onSelect,
}: {
  allowedKeys: ReportKey[];
  mode: DashboardMode;
  results: ExecutiveDashboardReportResult[];
  selectedReportKey: ReportKey;
  snapshots: ReportSnapshot[];
  onSelect: (reportKey: ReportKey) => void;
}) {
  return (
    <section className="rounded-2xl border border-[#D9E2F2] bg-white p-3 shadow-sm lg:sticky lg:top-4">
      <div className="px-1 py-2">
        <p className="text-[12px] font-semibold leading-[18px] text-[#2563EB]">
          รายงานในชุด LINE
        </p>
        <h2 className="mt-1 text-[18px] font-semibold leading-7 text-[#101828]">
          เลือกมุมวิเคราะห์
        </h2>
      </div>
      <div className="mt-2 space-y-2">
        {allowedKeys.map((reportKey) => {
          const snapshot = snapshots.find((item) => item.report_key === reportKey);
          const result = results.find((item) => item.report_key === reportKey);
          const available = Boolean(snapshot);
          const selected = selectedReportKey === reportKey;
          return (
            <button
              key={reportKey}
              className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                selected
                  ? "border-[#2563EB] bg-[#EFF6FF]"
                  : "border-[#EAECF0] bg-white hover:border-[#B2DDFF] hover:bg-[#F8FBFF]"
              }`}
              onClick={() => onSelect(reportKey)}
              type="button"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words text-[14px] font-semibold leading-[22px] text-[#101828]">
                    {getReportTitle(reportKey)}
                  </p>
                  <p className="mt-0.5 text-[12px] leading-[18px] text-[#667085]">
                    {available
                      ? mode === "line"
                        ? "จาก LINE รอบนี้"
                        : "พร้อมดู"
                      : "รอสร้างข้อมูล"}
                  </p>
                </div>
                <span className={selectorStatusClassName(result, available)}>
                  {result ? formatFreshness(result) : available ? "มีข้อมูล" : "ยังไม่มี"}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function UnavailableReportSurface({
  disabled,
  mode,
  reportKey,
  onRun,
}: {
  disabled: boolean;
  mode: DashboardMode;
  reportKey: ReportKey;
  onRun: () => void;
}) {
  return (
    <section className="rounded-2xl border border-[#D9E2F2] bg-white p-6 text-center shadow-sm">
      <p className="text-[13px] font-semibold leading-5 text-[#2563EB]">
        {getReportTitle(reportKey)}
      </p>
      <h2 className="mt-2 text-[24px] font-semibold leading-8 text-[#101828]">
        ยังไม่มีข้อมูลรายงานนี้ในหน้าปัจจุบัน
      </h2>
      <p className="mx-auto mt-2 max-w-2xl text-[14px] leading-[22px] text-[#667085]">
        {mode === "line"
          ? "ลิงก์จาก LINE เปิดหลักฐานของการ์ดที่กดก่อน หากต้องการดูครบ 8 รายงานให้เลือกวันที่แล้วกดดูข้อมูล"
          : "รายงานนี้ยังไม่พร้อมในผลลัพธ์วันที่ที่เลือก อาจเกิดจากรายงานหนักใช้เวลานานหรือข้อมูลไม่พร้อม"}
      </p>
      <button
        className="mt-5 inline-flex h-11 items-center justify-center rounded-lg bg-[#2563EB] px-5 text-[14px] font-semibold leading-[22px] text-white transition hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled}
        onClick={onRun}
        type="button"
      >
        สร้าง dashboard จากวันที่ที่เลือก
      </button>
    </section>
  );
}

function KpiTile({ item }: { item: KpiItem }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${tileToneClassName(item.tone)}`}>
      <p className="text-[12px] font-semibold leading-[18px] text-[#667085]">
        {item.label}
      </p>
      <p className="mt-1 break-words text-[20px] font-semibold leading-7 text-[#101828]">
        {item.value}
      </p>
      {item.helper && (
        <p className="mt-1 text-[12px] leading-[18px] text-[#667085]">
          {item.helper}
        </p>
      )}
    </div>
  );
}

function InsightTile({
  body,
  index,
  title,
  tone,
}: {
  body: string;
  index: number;
  title: string;
  tone?: Tone;
}) {
  return (
    <article className={`rounded-xl border p-4 ${tileToneClassName(tone)}`}>
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#2563EB] text-[12px] font-semibold text-white">
          {index}
        </span>
        <h3 className="text-[14px] font-semibold leading-[22px] text-[#101828]">
          {title}
        </h3>
      </div>
      <p className="mt-3 text-[14px] leading-[22px] text-[#344054]">{body}</p>
    </article>
  );
}

function ExecutiveChart({ chart }: { chart: ChartSpec }) {
  const chartData = chart.data.filter((item) => Number.isFinite(item.value)).slice(0, 8);
  const options: ApexOptions = {
    chart: {
      fontFamily: "Outfit, sans-serif",
      toolbar: { show: false },
      type: "bar",
    },
    colors: [chart.color],
    dataLabels: { enabled: false },
    grid: { borderColor: "#EAECF0" },
    plotOptions: {
      bar: {
        borderRadius: 6,
        horizontal: true,
      },
    },
    tooltip: {
      y: { formatter: (value) => `${formatMoney(value)} บาท` },
    },
    xaxis: {
      categories: chartData.map((item) => truncateLabel(item.label)),
      labels: {
        formatter: (value) => compactMoney(Number(value)),
      },
    },
  };
  return (
    <section className="rounded-2xl border border-[#D9E2F2] bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold leading-7 text-[#101828]">
            {chart.title}
          </h2>
          <p className="mt-1 text-[14px] leading-[22px] text-[#667085]">
            {chart.caption}
          </p>
        </div>
        <StatusPill tone="neutral">Top {chartData.length}</StatusPill>
      </div>
      {chartData.length ? (
        <div className="mt-4">
          <ReactApexChart
            height={280}
            options={options}
            series={[
              { name: chart.title, data: chartData.map((item) => item.value) },
            ]}
            type="bar"
          />
        </div>
      ) : (
        <EmptyPanel message="ไม่มีข้อมูลเพียงพอสำหรับกราฟนี้" />
      )}
    </section>
  );
}

function EvidencePanel({ section }: { section: EvidenceSection }) {
  return (
    <section className="rounded-2xl border border-[#D9E2F2] bg-white p-4 shadow-sm sm:p-5">
      <h2 className="text-[18px] font-semibold leading-7 text-[#101828]">
        {section.title}
      </h2>
      <p className="mt-1 text-[14px] leading-[22px] text-[#667085]">
        {section.caption}
      </p>
      {section.rows.length ? (
        <div className="mt-4 divide-y divide-[#EAECF0]">
          {section.rows.map((row, index) => (
            <div
              key={`${row.label}-${index}`}
              className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto]"
            >
              <div className="min-w-0">
                <p className="break-words text-[14px] font-semibold leading-[22px] text-[#101828]">
                  {row.label}
                </p>
                <p className="mt-0.5 break-words text-[12px] leading-[18px] text-[#667085]">
                  {row.meta}
                </p>
              </div>
              <p className={`text-[14px] font-semibold leading-[22px] ${textToneClassName(row.tone)}`}>
                {row.value}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <EmptyPanel message="ยังไม่มีรายการสำคัญในช่วงข้อมูลนี้" />
      )}
    </section>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 rounded-lg bg-[#F8FAFC] px-3 py-2 text-[13px] leading-5">
      <dt className="text-[#667085]">{label}</dt>
      <dd className="break-words font-semibold text-[#101828]">{value}</dd>
    </div>
  );
}

function TrustNote({
  note,
}: {
  note: { title: string; body: string; tone?: Tone };
}) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${tileToneClassName(note.tone)}`}>
      <p className="text-[13px] font-semibold leading-5 text-[#101828]">
        {note.title}
      </p>
      <p className="mt-1 text-[12px] leading-[18px] text-[#475467]">
        {note.body}
      </p>
    </div>
  );
}

function DateField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="block">
      <span className="text-[12px] font-semibold leading-[18px] text-[#344054]">
        {label}
      </span>
      <input
        className="mt-1 h-10 w-full rounded-lg border border-[#D0D5DD] bg-white px-3 text-[14px] leading-[22px] text-[#101828] outline-none transition focus:border-[#2563EB] focus:ring-4 focus:ring-[#DBEAFE]"
        onChange={(event) => onChange(event.target.value)}
        type="date"
        value={value}
      />
    </label>
  );
}

function ToolbarButton({
  active,
  children,
  onClick,
}: {
  active?: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`h-9 rounded-lg border px-3 text-[13px] font-semibold leading-5 transition ${
        active
          ? "border-[#2563EB] bg-white text-[#175CD3]"
          : "border-[#D0D5DD] bg-white text-[#344054] hover:bg-[#F9FAFB]"
      }`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function StatusPill({
  children,
  tone,
}: {
  children: ReactNode;
  tone: Tone;
}) {
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold leading-[18px] ${pillToneClassName(tone)}`}>
      {children}
    </span>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <div className="mt-4 rounded-xl border border-[#EAECF0] bg-[#F8FAFC] px-4 py-8 text-center text-[14px] leading-[22px] text-[#667085]">
      {message}
    </div>
  );
}

async function fetchDashboardRun(input: {
  access: DashboardAccess;
  runId: string;
  tenantId: string;
  signal?: AbortSignal;
}) {
  const params = new URLSearchParams({ dashboard_token: input.access.token });
  const response = await fetch(
    `${API_BASE_URL}/api/reports/${encodeURIComponent(
      input.tenantId,
    )}/executive-dashboard-runs/${encodeURIComponent(input.runId)}?${params}`,
    { signal: input.signal },
  );
  const payload = (await response.json()) as ExecutiveDashboardRunResponse;
  if (!response.ok || !payload.data) {
    throw new Error(payload.error || "โหลดสถานะ dashboard ไม่สำเร็จ");
  }
  return payload.data;
}

function buildExecutiveReportViewModel(
  snapshot: ReportSnapshot,
  result: ExecutiveDashboardReportResult | null,
): ExecutiveReportViewModel {
  const base = {
    reportKey: snapshot.report_key,
    category: getReportCategory(snapshot.report_key),
    title: getReportTitle(snapshot.report_key),
    sourceLabel: formatSource(snapshot.source),
    basisLabel: getReportBasis(snapshot),
    periodLabel: formatReportPeriod(snapshot.params),
    generatedAtLabel: formatDateTime(snapshot.generated_at),
    trustNotes: buildTrustNotes(snapshot, result),
  };

  if (snapshot.report_key === "sales_goods_services") {
    const topBranch = snapshot.branch_sales[0] ?? null;
    const topProduct = snapshot.top_products[0] ?? null;
    const hasWarning =
      snapshot.quality_status === "reconciled_with_warning" ||
      Math.abs(snapshot.reconciliation.difference_amount) > 0.01;
    return {
      ...base,
      primaryLabel: "ยอดขายสุทธิ",
      primaryValue: formatMoney(snapshot.summary.total_sales),
      primaryUnit: "บาท",
      statusLabel: hasWarning ? "ควรตรวจยอด" : "พร้อมใช้",
      statusTone: hasWarning ? "warning" : "good",
      kpis: [
        kpi("บิลขาย", `${formatInteger(snapshot.summary.document_count)} ใบ`),
        kpi("รายการขาย", `${formatInteger(snapshot.summary.line_count)} รายการ`),
        kpi("จำนวนขายรวม", formatQty(snapshot.summary.total_qty)),
        kpi("สินค้าขายดี", topProduct?.item_name ?? "ยังไม่มีข้อมูล"),
      ],
      insights: [
        insight("ยอดขายสุทธิ", `${formatMoney(snapshot.summary.total_sales)} บาท จาก ${formatInteger(snapshot.summary.document_count)} บิลขาย`),
        insight("สาขาที่ทำยอดหลัก", topBranch ? `${formatBranchLabel(topBranch)} มูลค่า ${formatMoney(topBranch.total_amount)} บาท` : "ยังไม่มีข้อมูลสาขา"),
        insight("สินค้าขายดี", topProduct ? `${topProduct.item_name} มูลค่า ${formatMoney(topProduct.sum_amount)} บาท` : "ยังไม่มีสินค้าในช่วงข้อมูลนี้"),
      ],
      actionItems: [
        hasWarning ? "ตรวจยอดหัวบิลเทียบยอดรายละเอียดก่อนใช้ตัวเลขสรุป" : "ดูสาขาและสินค้าที่ทำยอดหลักก่อนลงรายละเอียดเอกสาร",
        "เปิดรายการเอกสารสำคัญเพื่อตรวจลูกค้าและยอดบิลที่มีผลต่อยอดรวม",
        "ใช้วันที่อื่นเมื่ออยากเทียบผลหลังจาก LINE รอบนี้",
      ],
      charts: [
        chart("ยอดขายตามสาขา", "ดูว่าสาขาไหนเป็นตัวขับยอดหลัก", "#2563EB", snapshot.branch_sales.map((item) => ({ label: formatBranchLabel(item), value: item.total_amount }))),
        chart("สินค้าขายดี", "สินค้าที่สร้างยอดขายสูงสุด", "#10B981", snapshot.top_products.map((item) => ({ label: item.item_name, value: item.sum_amount }))),
      ],
      evidenceSections: [
        evidence("เอกสารขายสำคัญ", "เอกสารยอดสูงที่ประกอบเป็นยอด LINE", snapshot.documents.slice(0, 8).map((item) => ({
          label: item.doc_no,
          meta: `${item.cust_name || "ไม่ระบุลูกค้า"} · ${formatDate(item.doc_date)}`,
          value: `${formatMoney(item.total_amount)} บาท`,
        }))),
        evidence("ที่มาของยอด", "ตรวจความสอดคล้องของหัวบิลและรายละเอียด", [
          {
            label: "ยอดหัวบิล",
            meta: "ตัวเลขหลักที่ใช้ในรายงาน",
            value: `${formatMoney(snapshot.reconciliation.header_total_amount)} บาท`,
          },
          {
            label: "ยอดรายละเอียด",
            meta: snapshot.reconciliation.note,
            value: `${formatMoney(snapshot.reconciliation.detail_sum_amount)} บาท`,
            tone: hasWarning ? "warning" : "good",
          },
        ]),
      ],
    };
  }

  if (snapshot.report_key === "purchase_goods_payables") {
    const topSupplier = snapshot.top_suppliers[0] ?? null;
    const topProduct = snapshot.top_products[0] ?? null;
    const hasWarning =
      snapshot.quality_status === "reconciled_with_warning" ||
      Math.abs(snapshot.reconciliation.difference_amount) > 0.01;
    return {
      ...base,
      primaryLabel: "ยอดซื้อ/ตั้งหนี้",
      primaryValue: formatMoney(snapshot.summary.total_purchase),
      primaryUnit: "บาท",
      statusLabel: hasWarning ? "ควรตรวจยอด" : "พร้อมใช้",
      statusTone: hasWarning ? "warning" : "good",
      kpis: [
        kpi("เอกสารซื้อ", `${formatInteger(snapshot.summary.document_count)} ใบ`),
        kpi("รายการสินค้า", `${formatInteger(snapshot.summary.line_count)} รายการ`),
        kpi("จำนวนซื้อรวม", formatQty(snapshot.summary.total_qty)),
        kpi("ผู้จำหน่ายหลัก", topSupplier?.supplier_name ?? "ยังไม่มีข้อมูล"),
      ],
      insights: [
        insight("ยอดซื้อรวม", `${formatMoney(snapshot.summary.total_purchase)} บาท จาก ${formatInteger(snapshot.summary.document_count)} เอกสาร`),
        insight("ผู้จำหน่ายหลัก", topSupplier ? `${topSupplier.supplier_name} มูลค่า ${formatMoney(topSupplier.total_amount)} บาท` : "ยังไม่มีผู้จำหน่ายในช่วงนี้"),
        insight("สินค้าที่ซื้อสูงสุด", topProduct ? `${topProduct.item_name} มูลค่า ${formatMoney(topProduct.sum_amount)} บาท` : "ยังไม่มีสินค้าในช่วงนี้"),
      ],
      actionItems: [
        "ตรวจผู้จำหน่ายยอดสูงก่อนดูเอกสารย่อย",
        hasWarning ? "ตรวจยอดหัวเอกสารเทียบยอดรายละเอียดก่อนปิดรอบ" : "ดูสินค้าที่รับเข้ามูลค่าสูงและเทียบกับสต็อก",
        "ใช้ dashboard วันที่อื่นเมื่ออยากเทียบพฤติกรรมซื้อรายวัน",
      ],
      charts: [
        chart("ผู้จำหน่ายหลัก", "ดูว่ายอดซื้อมาจากผู้จำหน่ายใดเป็นหลัก", "#2563EB", snapshot.top_suppliers.map((item) => ({ label: item.supplier_name, value: item.total_amount }))),
        chart("สินค้าที่ซื้อสูงสุด", "สินค้าที่รับเข้าหรือมีมูลค่าซื้อสูงสุด", "#10B981", snapshot.top_products.map((item) => ({ label: item.item_name, value: item.sum_amount }))),
      ],
      evidenceSections: [
        evidence("เอกสารซื้อสำคัญ", "เอกสารยอดสูงที่ควรตรวจ", snapshot.documents.slice(0, 8).map((item) => ({
          label: item.doc_no,
          meta: `${item.cust_name || "ไม่ระบุผู้จำหน่าย"} · ${formatDate(item.doc_date)}`,
          value: `${formatMoney(item.total_amount)} บาท`,
        }))),
        evidence("ที่มาของยอด", "ตรวจความสอดคล้องของหัวเอกสารและรายละเอียด", [
          {
            label: "ยอดหัวเอกสาร",
            meta: "ตัวเลขหลักที่ใช้ในรายงาน",
            value: `${formatMoney(snapshot.reconciliation.header_total_amount)} บาท`,
          },
          {
            label: "ยอดรายละเอียด",
            meta: snapshot.reconciliation.note,
            value: `${formatMoney(snapshot.reconciliation.detail_sum_amount)} บาท`,
            tone: hasWarning ? "warning" : "good",
          },
        ]),
      ],
    };
  }

  if (isGrossProfitSnapshot(snapshot)) {
    const rowLabel = snapshot.report_key === "gross_profit_by_product" ? "สินค้า" : "ลูกหนี้";
    const topRow = snapshot.top_rows[0] ?? null;
    const negativeRow = snapshot.negative_rows[0] ?? null;
    const hasWarning = snapshot.summary.negative_gross_profit_count > 0;
    return {
      ...base,
      primaryLabel: "กำไรขั้นต้น",
      primaryValue: formatMoney(snapshot.summary.gross_profit),
      primaryUnit: "บาท",
      statusLabel: hasWarning ? "ควรตรวจรายการ" : "พร้อมใช้",
      statusTone: hasWarning ? "warning" : "good",
      kpis: [
        kpi("ยอดขายสุทธิ", `${formatMoney(snapshot.summary.net_amount)} บาท`),
        kpi("ต้นทุนสุทธิ", `${formatMoney(snapshot.summary.net_cost)} บาท`),
        kpi("Margin", formatMargin(snapshot.summary.gross_margin_percent)),
        kpi("กำไรติดลบ", `${formatInteger(snapshot.summary.negative_gross_profit_count)} รายการ`, undefined, hasWarning ? "warning" : "good"),
      ],
      insights: [
        insight("ยอดรวมเดียวกัน", snapshot.report_key === "gross_profit_by_product" ? "ยอดรวมเดียวกับกำไรลูกหนี้ แต่แยกดูตามสินค้า" : "ยอดรวมเดียวกับกำไรสินค้า แต่แยกดูตามลูกหนี้"),
        insight(`Top ${rowLabel}`, topRow ? `${getGrossProfitRowLabel(snapshot, topRow)} กำไร ${formatMoney(topRow.gross_profit)} บาท` : "ยังไม่มีข้อมูล"),
        insight("รายการที่ควรตรวจ", negativeRow ? `${getGrossProfitRowLabel(snapshot, negativeRow)} กำไร ${formatMoney(negativeRow.gross_profit)} บาท` : "ยังไม่พบรายการกำไรติดลบ", hasWarning ? "warning" : "good"),
      ],
      actionItems: [
        hasWarning ? "ตรวจรายการกำไรติดลบก่อน เพราะกระทบความน่าเชื่อถือของ margin" : "ดูรายการกำไรสูงเพื่อเข้าใจตัวขับกำไรหลัก",
        "เทียบมุมสินค้าและมุมลูกหนี้ เพราะเป็นยอดรวมเดียวกันแต่ตอบคนละคำถาม",
        "ตรวจต้นทุน ราคาขาย และเอกสารคืนสินค้าของรายการผิดปกติ",
      ],
      charts: [
        chart(`Top ${rowLabel} ตามกำไร`, "รายการที่สร้างกำไรขั้นต้นสูงสุด", "#2563EB", snapshot.top_rows.map((row) => ({ label: getGrossProfitRowLabel(snapshot, row), value: row.gross_profit }))),
        chart(`${rowLabel} กำไรติดลบ`, "รายการที่ควรตรวจต้นทุนหรือราคาขาย", "#F97316", snapshot.negative_rows.map((row) => ({ label: getGrossProfitRowLabel(snapshot, row), value: Math.abs(row.gross_profit) }))),
      ],
      evidenceSections: [
        evidence("รายการกำไรติดลบ", "ควรตรวจต้นทุน ราคาขาย หรือคืนสินค้า", snapshot.negative_rows.slice(0, 8).map((row) => ({
          label: getGrossProfitRowLabel(snapshot, row),
          meta: `ยอดขาย ${formatMoney(row.net_amount)} · ต้นทุน ${formatMoney(row.net_cost)}`,
          value: `${formatMoney(row.gross_profit)} บาท`,
          tone: "warning",
        }))),
        evidence(`Top ${rowLabel}`, "รายการที่สร้างกำไรสูงสุด", snapshot.top_rows.slice(0, 8).map((row) => ({
          label: getGrossProfitRowLabel(snapshot, row),
          meta: `Margin ${formatMargin(row.gross_margin_percent)}`,
          value: `${formatMoney(row.gross_profit)} บาท`,
        }))),
      ],
    };
  }

  if (snapshot.report_key === "stock_balance") {
    const topItem = snapshot.top_items_by_value[0] ?? null;
    const negativeItem = snapshot.negative_items[0] ?? null;
    const hasWarning = snapshot.summary.negative_stock_count > 0;
    return {
      ...base,
      primaryLabel: "มูลค่าสต็อกคงเหลือ",
      primaryValue: formatMoney(snapshot.summary.stock_value),
      primaryUnit: "บาท",
      statusLabel: hasWarning ? "ควรตรวจทันที" : "พร้อมใช้",
      statusTone: hasWarning ? "critical" : "good",
      kpis: [
        kpi("จำนวนสินค้า", `${formatInteger(snapshot.summary.sku_count)} รายการ`),
        kpi("รับเข้า", `${formatMoney(snapshot.summary.amount_in)} บาท`),
        kpi("จ่ายออก", `${formatMoney(snapshot.summary.amount_out)} บาท`),
        kpi("สต็อกติดลบ", `${formatInteger(snapshot.summary.negative_stock_count)} รายการ`, undefined, hasWarning ? "critical" : "good"),
      ],
      insights: [
        insight("มูลค่าสต็อก", `${formatMoney(snapshot.summary.stock_value)} บาท จาก ${formatInteger(snapshot.summary.sku_count)} รายการ`),
        insight("สินค้ามูลค่าสูง", topItem ? `${topItem.ic_name} มูลค่า ${formatMoney(topItem.balance_amount)} บาท` : "ยังไม่มีรายการมูลค่าสูง"),
        insight("รายการที่ควรตรวจ", negativeItem ? `${negativeItem.ic_name} คงเหลือ ${formatQty(negativeItem.balance_qty)}` : "ยังไม่พบสินค้าคงเหลือติดลบ", hasWarning ? "critical" : "good"),
      ],
      actionItems: [
        hasWarning ? "ตรวจสินค้าเหลือติดลบก่อนใช้ยอดสต็อกตัดสินใจ" : "ดูสินค้ามูลค่าสูงเพื่อเข้าใจเงินที่จมในสต็อก",
        "เทียบยอดรับเข้าและจ่ายออกในวันกับเอกสารจริง",
        "ตรวจสินค้าที่ไม่มีต้นทุนหรือมีต้นทุนเป็นศูนย์ก่อนคุยเรื่องกำไร",
      ],
      charts: [
        chart("สินค้ามูลค่าสูง", "รายการที่ถือมูลค่าสต็อกมากที่สุด", "#2563EB", snapshot.top_items_by_value.map((item) => ({ label: item.ic_name, value: item.balance_amount }))),
        chart("สินค้าคงเหลือติดลบ", "แสดงจำนวนติดลบเป็นค่าสัมบูรณ์เพื่อเทียบความรุนแรง", "#EF4444", snapshot.negative_items.map((item) => ({ label: item.ic_name, value: Math.abs(item.balance_qty) }))),
      ],
      evidenceSections: [
        evidence("สินค้าคงเหลือติดลบ", "ควรตรวจเอกสารรับเข้าและจ่ายออก", snapshot.negative_items.slice(0, 8).map((item) => ({
          label: item.ic_name,
          meta: `${item.ic_code} · ${item.ic_unit_code}`,
          value: formatQty(item.balance_qty),
          tone: "critical",
        }))),
        evidence("สินค้ามูลค่าสูง", "รายการที่มีผลต่อมูลค่าสต็อกรวม", snapshot.top_items_by_value.slice(0, 8).map((item) => ({
          label: item.ic_name,
          meta: `${item.ic_code} · คงเหลือ ${formatQty(item.balance_qty)} ${item.ic_unit_code}`,
          value: `${formatMoney(item.balance_amount)} บาท`,
        }))),
      ],
    };
  }

  if (snapshot.report_key === "stock_reorder") {
    const topItem = snapshot.top_items[0] ?? null;
    const hasWarning = snapshot.summary.out_of_stock_count > 0;
    return {
      ...base,
      primaryLabel: "สินค้าถึงจุดสั่งซื้อ",
      primaryValue: formatInteger(snapshot.summary.reorder_count),
      primaryUnit: "รายการ",
      statusLabel: hasWarning ? "ควรตรวจสั่งซื้อ" : "มีข้อสังเกต",
      statusTone: hasWarning ? "warning" : "info",
      kpis: [
        kpi("ของหมด", `${formatInteger(snapshot.summary.out_of_stock_count)} รายการ`, undefined, hasWarning ? "warning" : "good"),
        kpi("ใกล้หมด", `${formatInteger(snapshot.summary.low_stock_count)} รายการ`),
        kpi("ค้างรับเข้า", formatQty(snapshot.summary.purchase_balance_qty_total)),
        kpi("ขาดรวม", formatQty(snapshot.summary.shortage_qty_total)),
      ],
      insights: [
        insight("ถึงจุดสั่งซื้อ", `${formatInteger(snapshot.summary.reorder_count)} รายการต่ำกว่าจุดสั่งซื้อ`),
        insight("ของหมด", hasWarning ? `${formatInteger(snapshot.summary.out_of_stock_count)} รายการคงเหลือ 0 หรือติดลบ` : "ยังไม่พบรายการของหมด", hasWarning ? "warning" : "good"),
        insight("รายการแรกที่ควรดู", topItem ? `${topItem.ic_name} ขาดอีก ${formatQty(topItem.shortage_qty)}` : "ยังไม่มีรายการที่ต้องสั่งซื้อ"),
      ],
      actionItems: [
        hasWarning ? "ตรวจรายการของหมดก่อน เพราะกระทบการขายทันที" : "ตรวจรายการใกล้หมดและค้างรับเข้า",
        "เทียบค้างรับเข้ากับใบสั่งซื้อก่อนสั่งเพิ่ม",
        "ใช้รายงานนี้เป็นข้อมูลล่าสุดจาก SML ไม่ใช่รายงานย้อนหลังตามวัน",
      ],
      charts: [
        chart("สินค้าที่ขาดมาก", "เรียงตามจำนวนที่ต่ำกว่าจุดสั่งซื้อ", "#F97316", snapshot.top_items.map((item) => ({ label: item.ic_name, value: item.shortage_qty }))),
      ],
      evidenceSections: [
        evidence("รายการแรกที่ควรสั่ง", "ของหมดก่อน แล้วตามด้วยใกล้หมด", snapshot.top_items.slice(0, 10).map((item) => ({
          label: item.ic_name,
          meta: `${item.ic_code} · คงเหลือ ${formatQty(item.balance_qty)} · จุดสั่งซื้อ ${formatQty(item.purchase_point)}`,
          value: `ขาดอีก ${formatQty(item.shortage_qty)}`,
          tone: item.status === "out_of_stock" ? "warning" : "info",
        }))),
      ],
    };
  }

  if (snapshot.report_key === "ar_customer_movement") {
    const topCustomer = snapshot.top_customers[0] ?? null;
    const topDoc = snapshot.top_documents[0] ?? null;
    return {
      ...base,
      primaryLabel: "ยอดเคลื่อนไหวสุทธิ",
      primaryValue: formatMoney(snapshot.summary.net_movement_amount),
      primaryUnit: "บาท",
      statusLabel: "ข้อมูลสะสม",
      statusTone: "info",
      kpis: [
        kpi("ลูกหนี้", `${formatInteger(snapshot.summary.customer_count)} ราย`),
        kpi("เอกสาร", `${formatInteger(snapshot.summary.document_count)} ใบ`),
        kpi("เพิ่มลูกหนี้", `${formatMoney(snapshot.summary.ar_increase_amount)} บาท`),
        kpi("รับชำระ/ลดหนี้", `${formatMoney(snapshot.summary.ar_decrease_amount + snapshot.summary.receipt_amount)} บาท`),
      ],
      insights: [
        insight("ข้อมูลสะสมถึงวันที่", "รายงานนี้ไม่ใช่อายุหนี้และไม่ใช่ยอดคงค้าง"),
        insight("ลูกหนี้เคลื่อนไหวสูงสุด", topCustomer ? `${topCustomer.cust_name} สุทธิ ${formatMoney(topCustomer.net_movement_amount)} บาท` : "ยังไม่มีลูกหนี้ในช่วงข้อมูล"),
        insight("เอกสารสำคัญ", topDoc ? `${topDoc.doc_no} มูลค่า ${formatMoney(topDoc.amount)} บาท` : "ยังไม่มีเอกสารสำคัญ"),
      ],
      actionItems: [
        "อ่านเป็นการเคลื่อนไหวสะสมถึงวันที่ ไม่ใช่รายงานอายุหนี้",
        "ดูลูกหนี้ที่มียอดเคลื่อนไหวสุทธิสูงก่อน",
        "ตรวจเอกสารยอดสูงหรือเอกสารรับชำระที่เปลี่ยนยอดมาก",
      ],
      charts: [
        chart("ลูกหนี้เคลื่อนไหวสูง", "เรียงตามยอดเคลื่อนไหวสุทธิ", "#2563EB", snapshot.top_customers.map((item) => ({ label: item.cust_name, value: Math.abs(item.net_movement_amount) }))),
        chart("เอกสารยอดสูง", "เอกสารที่มีผลต่อยอดเคลื่อนไหว", "#10B981", snapshot.top_documents.map((item) => ({ label: item.doc_no, value: Math.abs(item.amount) }))),
      ],
      evidenceSections: [
        evidence("ลูกหนี้สำคัญ", "ลูกหนี้ที่ควรดูการเคลื่อนไหวก่อน", snapshot.top_customers.slice(0, 8).map((item) => ({
          label: item.cust_name,
          meta: `${item.cust_code} · ${formatInteger(item.document_count)} เอกสาร`,
          value: `${formatMoney(item.net_movement_amount)} บาท`,
        }))),
        evidence("เอกสารสำคัญ", "เอกสารที่ประกอบยอดเคลื่อนไหว", snapshot.top_documents.slice(0, 8).map((item) => ({
          label: item.doc_no,
          meta: `${item.cust_name} · ${formatDate(item.doc_date)}`,
          value: `${formatMoney(item.amount)} บาท`,
        }))),
      ],
    };
  }

  const snapshotReceipt = snapshot as ArDebtReceiptSnapshot;
  const topCustomer = snapshotReceipt.top_customers[0] ?? null;
  const hasWarning = snapshotReceipt.summary.unmatched_payment_count > 0;
  return {
    ...base,
    primaryLabel: "ยอดรับชำระรวม",
    primaryValue: formatMoney(snapshotReceipt.summary.total_received_amount),
    primaryUnit: "บาท",
    statusLabel: hasWarning ? "ควรตรวจยอด" : "พร้อมใช้",
    statusTone: hasWarning ? "warning" : "good",
    kpis: [
      kpi("ลูกหนี้", `${formatInteger(snapshotReceipt.summary.customer_count)} ราย`),
      kpi("เอกสาร", `${formatInteger(snapshotReceipt.summary.receipt_count)} ใบ`),
      kpi("เงินสด", `${formatMoney(snapshotReceipt.summary.cash_amount)} บาท`),
      kpi("โอน", `${formatMoney(snapshotReceipt.summary.transfer_amount)} บาท`),
    ],
    insights: [
      insight("ยอดรับชำระ", `${formatMoney(snapshotReceipt.summary.total_received_amount)} บาท จาก ${formatInteger(snapshotReceipt.summary.receipt_count)} เอกสาร`),
      insight("ลูกหนี้รับชำระสูงสุด", topCustomer ? `${topCustomer.cust_name} รับชำระ ${formatMoney(topCustomer.total_received_amount)} บาท` : "ยังไม่มีลูกหนี้ในช่วงข้อมูล"),
      insight("ช่องทางรับเงิน", hasWarning ? `พบ ${formatInteger(snapshotReceipt.summary.unmatched_payment_count)} เอกสารที่ควรตรวจช่องทางรับเงิน` : "ยังไม่พบข้อสังเกตช่องทางรับเงิน", hasWarning ? "warning" : "good"),
    ],
    actionItems: [
      hasWarning ? "ตรวจเอกสารที่ยอดเงินสดและโอนไม่ตรงกับยอดรับชำระ" : "ดูเอกสารรับชำระยอดสูงและลูกหนี้หลัก",
      "แยกดูเงินสดและโอนก่อนสรุปยอดรับจริง",
      "รายงานนี้อิงวันที่เอกสารรับชำระ ไม่ตัดตามเวลาแจ้งเตือน",
    ],
    charts: [
      chart("ช่องทางรับเงิน", "เงินสดและโอนจากเอกสารรับชำระ", "#2563EB", [
        { label: "เงินสด", value: snapshotReceipt.summary.cash_amount },
        { label: "โอน", value: snapshotReceipt.summary.transfer_amount },
      ]),
      chart("ลูกหนี้รับชำระสูงสุด", "ลูกหนี้ที่มียอดรับชำระมากที่สุด", "#10B981", snapshotReceipt.top_customers.map((item) => ({ label: item.cust_name, value: item.total_received_amount }))),
    ],
    evidenceSections: [
      evidence("เอกสารรับชำระสำคัญ", "เอกสารยอดสูงและช่องทางรับเงิน", snapshotReceipt.top_receipts.slice(0, 8).map((item) => ({
        label: item.doc_no,
        meta: `${item.cust_name} · ${formatDate(item.doc_date)} · เงินสด ${formatMoney(item.cash_amount)} / โอน ${formatMoney(item.transfer_amount)}`,
        value: `${formatMoney(item.total_received_amount)} บาท`,
        tone: item.payment_status === "matched" ? "neutral" : "warning",
      }))),
      evidence("ลูกหนี้รับชำระสูงสุด", "ลูกหนี้ที่สร้างยอดรับชำระหลัก", snapshotReceipt.top_customers.slice(0, 8).map((item) => ({
        label: item.cust_name,
        meta: `${item.cust_code} · ${formatInteger(item.receipt_count)} เอกสาร`,
        value: `${formatMoney(item.total_received_amount)} บาท`,
      }))),
    ],
  };
}

function buildTrustNotes(
  snapshot: ReportSnapshot,
  result: ExecutiveDashboardReportResult | null,
) {
  const notes: Array<{ title: string; body: string; tone?: Tone }> = [
    {
      title: "ข้อมูลจาก SML",
      body: "ตัวเลขมาจากข้อมูลรายงานที่ระบบบันทึกไว้ ไม่แสดงรายละเอียดเทคนิคให้ผู้บริหารสับสน",
      tone: "info",
    },
  ];
  if (result?.freshness === "reference") {
    notes.push({
      title: "ใช้ข้อมูลอ้างอิง",
      body: result.snapshot_generated_at
        ? `ข้อมูลสดใช้เวลานาน ระบบใช้ข้อมูลอ้างอิงล่าสุดเมื่อ ${formatDateTime(result.snapshot_generated_at)}`
        : "ข้อมูลสดใช้เวลานาน ระบบใช้ข้อมูลอ้างอิงล่าสุดที่ปลอดภัย",
      tone: "warning",
    });
  }
  if (snapshot.report_key === "ar_customer_movement") {
    notes.push({
      title: "ไม่ใช่รายงานอายุหนี้",
      body: "รายงานนี้แสดงการเคลื่อนไหวสะสมถึงวันที่ ไม่ใช่ยอดคงค้างหรือ aging",
      tone: "neutral",
    });
  }
  if (snapshot.report_key === "stock_reorder") {
    notes.push({
      title: "ข้อมูลล่าสุดจาก SML",
      body: "รายงานนี้เป็นยอดปัจจุบัน ไม่ใช่รายงานย้อนหลังตามวัน",
      tone: "neutral",
    });
  }
  return notes;
}

function kpi(label: string, value: string, helper?: string, tone?: Tone): KpiItem {
  return { label, value, helper, tone };
}

function insight(title: string, body: string, tone?: Tone) {
  return { title, body, tone };
}

function chart(
  title: string,
  caption: string,
  color: string,
  data: Array<{ label: string; value: number }>,
): ChartSpec {
  return { title, caption, color, data, kind: "bar" };
}

function evidence(
  title: string,
  caption: string,
  rows: EvidenceRow[],
): EvidenceSection {
  return { title, caption, rows };
}

function isGrossProfitSnapshot(
  snapshot: ReportSnapshot,
): snapshot is GrossProfitByProductSnapshot | GrossProfitByArCustomerSnapshot {
  return (
    snapshot.report_key === "gross_profit_by_product" ||
    snapshot.report_key === "gross_profit_by_ar_customer"
  );
}

function getGrossProfitRowLabel(
  snapshot: GrossProfitByProductSnapshot | GrossProfitByArCustomerSnapshot,
  row: GrossProfitBaseRow | GrossProfitByProductRow | GrossProfitByArCustomerRow,
) {
  return snapshot.report_key === "gross_profit_by_product"
    ? (row as GrossProfitByProductRow).name_1 ||
        (row as GrossProfitByProductRow).code ||
        "ไม่ระบุสินค้า"
    : (row as GrossProfitByArCustomerRow).ar_detail ||
        (row as GrossProfitByArCustomerRow).ar_code ||
        "ไม่ระบุลูกหนี้";
}

function getReportTitle(reportKey: ReportKey) {
  switch (reportKey) {
    case "sales_goods_services":
      return "รายงานขายสินค้าและบริการ";
    case "purchase_goods_payables":
      return "รายงานซื้อ/ตั้งหนี้";
    case "gross_profit_by_product":
      return "รายงานกำไรขั้นต้นสินค้า";
    case "gross_profit_by_ar_customer":
      return "รายงานกำไรขั้นต้นลูกหนี้";
    case "stock_balance":
      return "รายงานสต็อกคงเหลือ";
    case "stock_reorder":
      return "รายงานสินค้าถึงจุดสั่งซื้อ";
    case "ar_customer_movement":
      return "รายงานเคลื่อนไหวลูกหนี้";
    case "ar_debt_receipt":
      return "รายงานรับชำระหนี้";
  }
}

function getReportCategory(reportKey: ReportKey) {
  switch (reportKey) {
    case "sales_goods_services":
      return "ขาย · รายวัน";
    case "purchase_goods_payables":
      return "ซื้อ · รายวัน";
    case "gross_profit_by_product":
      return "กำไร · มุมสินค้า";
    case "gross_profit_by_ar_customer":
      return "กำไร · มุมลูกหนี้";
    case "stock_balance":
      return "สต็อก · ณ วันที่";
    case "stock_reorder":
      return "สต็อก · ล่าสุด";
    case "ar_customer_movement":
      return "ลูกหนี้ · สะสม";
    case "ar_debt_receipt":
      return "รับเงิน · รายวัน";
  }
}

function getReportBasis(snapshot: ReportSnapshot) {
  if (snapshot.report_key === "stock_reorder") {
    return "ข้อมูลล่าสุดจาก SML";
  }
  if (snapshot.report_key === "stock_balance") {
    return "คงเหลือ ณ วันที่";
  }
  if (snapshot.report_key === "ar_customer_movement") {
    return "ข้อมูลสะสมถึงวันที่";
  }
  if (snapshot.report_key === "ar_debt_receipt") {
    return "ข้อมูลวันที่เอกสารรับชำระ";
  }
  return "ช่วงข้อมูลจากรอบ LINE";
}

function formatSource(source: ReportSnapshot["source"]) {
  return source === "sample_snapshot" ? "ข้อมูลตัวอย่าง" : "ข้อมูลจาก SML";
}

function formatBranchLabel(item: { branch_code: string; branch_label?: string }) {
  return item.branch_label ?? formatSmlBranchLabel(item.branch_code);
}

function formatDashboardProgressLabel(run: ExecutiveDashboardRun) {
  if (run.progress_stage === "queued") {
    return "รอคิวสร้าง dashboard";
  }
  if (run.progress_stage === "claimed") {
    return "เริ่มงานแล้ว";
  }
  if (run.progress_stage === "running_report") {
    const reportName = run.progress_current_report_key
      ? getReportTitle(run.progress_current_report_key)
      : "รายงาน";
    const done = run.progress_done_reports ?? 0;
    const total = run.progress_total_reports ?? run.report_keys.length;
    return `กำลังสร้างรายงาน ${done}/${total}: ${reportName}`;
  }
  if (run.progress_stage === "completed") {
    return "สร้าง dashboard เสร็จแล้ว";
  }
  if (run.progress_stage === "failed") {
    return "สร้าง dashboard ไม่สำเร็จ";
  }
  return "กำลังสร้าง dashboard";
}

function formatDashboardRunStatus(status: ExecutiveDashboardRunStatus) {
  if (status === "queued") return "รอคิว";
  if (status === "running") return "กำลังรัน";
  if (status === "success") return "สำเร็จ";
  if (status === "success_with_warnings") return "สำเร็จพร้อมข้อสังเกต";
  return "ไม่สำเร็จ";
}

function formatFreshness(result: ExecutiveDashboardReportResult) {
  if (result.freshness === "fresh") return "สด";
  if (result.freshness === "reference") return "ข้อมูลอ้างอิง";
  return "ไม่พร้อม";
}

function buildV1FallbackUrl(viewer: ViewerParams) {
  const params = new URLSearchParams({
    tenant_id: viewer.tenantId,
    report_key: viewer.reportKey,
    run_id: viewer.runId,
    token: viewer.token,
    viewer_version: "v1",
  });
  return `/command-center/brief?${params}`;
}

function selectorStatusClassName(
  result: ExecutiveDashboardReportResult | undefined,
  available: boolean,
) {
  const tone: Tone = result
    ? result.freshness === "fresh"
      ? "good"
      : result.freshness === "reference"
        ? "warning"
        : "critical"
    : available
      ? "info"
      : "neutral";
  return `rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-4 ${pillToneClassName(tone)}`;
}

function tileToneClassName(tone: Tone = "neutral") {
  if (tone === "good") return "border-[#ABEFC6] bg-[#ECFDF3]";
  if (tone === "warning") return "border-[#FEDF89] bg-[#FFFAEB]";
  if (tone === "critical") return "border-[#FECDCA] bg-[#FEF3F2]";
  if (tone === "info") return "border-[#B2DDFF] bg-[#EFF6FF]";
  return "border-[#EAECF0] bg-[#F8FAFC]";
}

function pillToneClassName(tone: Tone) {
  if (tone === "good") return "border-[#ABEFC6] bg-[#ECFDF3] text-[#027A48]";
  if (tone === "warning") return "border-[#FEDF89] bg-[#FFFAEB] text-[#B54708]";
  if (tone === "critical") return "border-[#FECDCA] bg-[#FEF3F2] text-[#B42318]";
  if (tone === "info") return "border-[#B2DDFF] bg-[#EFF6FF] text-[#175CD3]";
  return "border-[#D0D5DD] bg-white text-[#475467]";
}

function textToneClassName(tone: Tone = "neutral") {
  if (tone === "good") return "text-[#027A48]";
  if (tone === "warning") return "text-[#B54708]";
  if (tone === "critical") return "text-[#B42318]";
  if (tone === "info") return "text-[#175CD3]";
  return "text-[#101828]";
}

function formatReportPeriod(params: {
  date_from: string;
  date_to: string;
  time_from?: string;
  time_to?: string;
}) {
  if (params.time_from && params.time_to) {
    return params.date_from === params.date_to
      ? `${formatDate(params.date_from)} ${params.time_from}-${params.time_to}`
      : `${formatDate(params.date_from)} ${params.time_from} ถึง ${formatDate(
          params.date_to,
        )} ${params.time_to}`;
  }
  return params.date_from === params.date_to
    ? formatDate(params.date_from)
    : `${formatDate(params.date_from)} ถึง ${formatDate(params.date_to)}`;
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "ไม่ระบุเวลา";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(date);
}

function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatMoney(value: number | null | undefined) {
  return new Intl.NumberFormat("th-TH", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(value || 0);
}

function compactMoney(value: number) {
  return new Intl.NumberFormat("th-TH", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value || 0);
}

function formatInteger(value: number | null | undefined) {
  return new Intl.NumberFormat("th-TH", {
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatQty(value: number | null | undefined) {
  return new Intl.NumberFormat("th-TH", {
    maximumFractionDigits: 3,
  }).format(value || 0);
}

function formatMargin(value: number | null) {
  if (value == null) return "ตรวจสอบ";
  return `${new Intl.NumberFormat("th-TH", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(value)}%`;
}

function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} วินาที`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} นาที ${rest} วินาที` : `${minutes} นาที`;
}

function truncateLabel(label: string) {
  return label.length > 22 ? `${label.slice(0, 21)}...` : label;
}
