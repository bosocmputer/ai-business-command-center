"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BANGKOK_TIME_ZONE,
  type ReportKey,
  type ReportRunRecord,
  type ReportRunStatus,
} from "@ai-bcc/shared";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import { AlertIcon, CheckCircleIcon, InfoIcon } from "@/icons";
import {
  isAbortError,
  ownerV2Fetch,
  ownerV2Request,
  type OwnerV2FetchError,
  type OwnerV2FetchErrorPayload,
} from "./api";
import type { OwnerV2ReportSetupPayload } from "./types";

type ReportSetupState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: OwnerV2ReportSetupPayload };

type OwnerReport = OwnerV2ReportSetupPayload["reports"][number];

type ChunkedReportProgress = {
  run: ReportRunRecord;
  progress_stage: string;
  progress_percent: number;
  chunk_summary: {
    total: number;
    done: number;
    failed: number;
    running: number;
    queued: number;
    rows_processed: number;
    total_units: number;
  };
  elapsed_ms: number;
  can_close_page: boolean;
  next_action_message: string;
};

type ReportRunPayload = OwnerV2FetchErrorPayload & {
  data?: unknown;
  run?: ReportRunRecord;
  duplicate?: boolean;
  progress?: ChunkedReportProgress;
  active_run?: ReportRunRecord;
};

const terminalStatuses: ReportRunStatus[] = ["success", "failed"];

export default function OwnerV2Reports({ tenantId }: { tenantId: string }) {
  const [state, setState] = useState<ReportSetupState>({ status: "loading" });
  const [selectedReportKey, setSelectedReportKey] =
    useState<ReportKey>("sales_goods_services");
  const [dateFrom, setDateFrom] = useState(() => defaultReportDate());
  const [dateTo, setDateTo] = useState(() => defaultReportDate());
  const [busy, setBusy] = useState<ReportKey | null>(null);
  const [message, setMessage] = useState<{
    tone: "success" | "warning" | "error";
    text: string;
  } | null>(null);
  const [progress, setProgress] = useState<ChunkedReportProgress | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState({ status: "loading" });
      setMessage(null);
      try {
        const data = await ownerV2Fetch<OwnerV2ReportSetupPayload>(
          `/api/owner/tenants/${encodeURIComponent(tenantId)}/report-setup`,
          { signal },
        );
        if (signal?.aborted) {
          return;
        }
        setState({ status: "success", data });
        setSelectedReportKey((current) =>
          data.reports.some((report) => report.report_key === current)
            ? current
            : data.reports[0]?.report_key ?? "sales_goods_services",
        );
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "โหลดข้อมูลรายงานไม่สำเร็จ",
        });
      }
    },
    [tenantId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const setup = state.status === "success" ? state.data : null;
  const reports = setup?.reports ?? [];
  const latestRunByReport = useMemo(
    () => buildLatestRunByReport(setup?.latest_runs ?? []),
    [setup?.latest_runs],
  );
  const latestSnapshotByReport = useMemo(
    () => new Map(setup?.latest_snapshots.map((item) => [item.report_key, item]) ?? []),
    [setup?.latest_snapshots],
  );
  const selectedReport =
    reports.find((report) => report.report_key === selectedReportKey) ??
    reports[0] ??
    null;
  const selectedRun = selectedReport
    ? latestRunByReport.get(selectedReport.report_key) ?? null
    : null;
  const selectedSnapshot = selectedReport
    ? latestSnapshotByReport.get(selectedReport.report_key) ?? null
    : null;
  const activeRun =
    setup?.latest_runs.find((run) => !isTerminalStatus(run.status)) ?? null;
  const dateInvalid = !dateFrom || !dateTo || dateFrom > dateTo;
  const chunkedEnabled = Boolean(
    setup?.tenant.feature_flags.sml_chunked_heavy_reports_enabled,
  );
  const selectedIsAsync =
    Boolean(selectedReport?.async_supported) &&
    (selectedReport?.report_key === "stock_balance" ||
      selectedReport?.report_key === "ar_customer_movement");
  const runDisabled =
    busy !== null ||
    !selectedReport ||
    dateInvalid ||
    (selectedIsAsync && !chunkedEnabled) ||
    Boolean(progress && !isTerminalStatus(progress.run.status));
  const successRuns =
    setup?.latest_runs.filter((run) => run.status === "success").length ?? 0;
  const failedRuns =
    setup?.latest_runs.filter((run) => run.status === "failed").length ?? 0;
  const activeRuns =
    setup?.latest_runs.filter((run) => !isTerminalStatus(run.status)).length ?? 0;

  const loadProgress = useCallback(
    async (run: Pick<ReportRunRecord, "id" | "tenant_id">) => {
      try {
        return await ownerV2Fetch<ChunkedReportProgress>(
          `/api/reports/${encodeURIComponent(run.tenant_id)}/runs/${encodeURIComponent(
            run.id,
          )}/progress`,
        );
      } catch {
        return null;
      }
    },
    [],
  );

  useEffect(() => {
    if (!activeRun || progress) {
      return;
    }
    let cancelled = false;
    void loadProgress(activeRun).then((next) => {
      if (!cancelled && next) {
        setProgress(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeRun, loadProgress, progress]);

  useEffect(() => {
    if (!progress || isTerminalStatus(progress.run.status)) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadProgress(progress.run).then((next) => {
        if (next) {
          setProgress(next);
        }
      });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [loadProgress, progress]);

  async function runSelectedReport() {
    if (busy !== null) {
      return;
    }
    if (!setup || !selectedReport) {
      setMessage({
        tone: "warning",
        text: "เลือกรายงานก่อนรันทดสอบ",
      });
      return;
    }
    if (dateInvalid) {
      setMessage({
        tone: "warning",
        text: "กรุณาเลือกช่วงวันที่ให้ถูกต้องก่อนรันทดสอบ",
      });
      return;
    }
    if (selectedIsAsync && !chunkedEnabled) {
      setMessage({
        tone: "warning",
        text: "รายงานหนักยังไม่พร้อม ต้องเปิด sml_chunked_heavy_reports_enabled ก่อนเริ่มรันเบื้องหลัง",
      });
      return;
    }

    setBusy(selectedReport.report_key);
    setMessage(null);
    try {
      const payload = await ownerV2Request<ReportRunPayload>(
        selectedIsAsync
          ? `/api/reports/${encodeURIComponent(tenantId)}/${selectedReport.report_key}/run-async`
          : `/api/reports/${encodeURIComponent(tenantId)}/${selectedReport.report_key}/run`,
        {
          method: "POST",
          body: {
            date_from: dateFrom,
            date_to: dateTo,
          },
        },
      );

      if (payload.progress) {
        setProgress(payload.progress);
      } else {
        setProgress(null);
      }
      setMessage({
        tone: "success",
        text: selectedIsAsync
          ? payload.duplicate
            ? `${selectedReport.label}: พบ run เดิมที่กำลังทำงาน จะแสดง progress ต่อจาก run นั้น`
            : `${selectedReport.label}: เริ่มรันแล้ว ปิดหน้าได้ ระบบยังรันต่อ`
          : `${selectedReport.label}: รันสำเร็จและบันทึก snapshot แล้ว`,
      });
      await load();
    } catch (error) {
      const payload = (error as OwnerV2FetchError).payload as
        | ReportRunPayload
        | undefined;
      if (payload?.progress) {
        setProgress(payload.progress);
      } else if (payload?.run ?? payload?.active_run) {
        setProgress(null);
      }
      setMessage({
        tone: "error",
        text:
          error instanceof Error
            ? `${selectedReport.label}: ${error.message}`
            : `${selectedReport.label}: รันรายงานไม่สำเร็จ`,
      });
      await load().catch(() => undefined);
    } finally {
      setBusy(null);
    }
  }

  if (state.status === "loading") {
    return <ReportsSkeleton />;
  }

  if (state.status === "error") {
    return (
      <Panel>
        <PanelBody>
          <EmptyState
            action={
              <Button
                onClick={() => void load()}
                size="sm"
                type="button"
                variant="outline"
              >
                โหลดใหม่
              </Button>
            }
            detail={`${state.message} กรุณาตรวจ session ผู้ดูแลหรือเลือกร้านใหม่`}
            title="โหลดสถานะรายงานไม่สำเร็จ"
          />
        </PanelBody>
      </Panel>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
      <Panel>
        <PanelHeader
          action={
            <div className="flex flex-wrap gap-2">
              <Badge color={chunkedEnabled ? "success" : "warning"}>
                {chunkedEnabled ? "รายงานใหญ่พร้อม" : "รายงานใหญ่ปิด"}
              </Badge>
              <Badge color={activeRuns ? "info" : "light"}>
                กำลังทำงาน {activeRuns}
              </Badge>
            </div>
          }
          description="เลือก report, ช่วงวันที่ แล้วรันทดสอบเฉพาะร้านนี้ก่อนนำไปใช้กับ dashboard หรือ LINE"
          title={`รายงานของ ${state.data.tenant.name}`}
        />
        <PanelBody>
          {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

          <div className="grid gap-3 md:grid-cols-3">
            <Metric label="รายงานที่รองรับ" value={reports.length.toString()} />
            <Metric label="สำเร็จล่าสุด" value={successRuns.toString()} />
            <Metric label="ไม่สำเร็จล่าสุด" value={failedRuns.toString()} />
          </div>

          <div className="custom-scrollbar flex max-h-[560px] flex-col gap-2 overflow-y-auto">
            {reports.map((report) => (
              <ReportRow
                key={report.report_key}
                latestRun={latestRunByReport.get(report.report_key) ?? null}
                latestSnapshot={latestSnapshotByReport.get(report.report_key) ?? null}
                onSelect={() => setSelectedReportKey(report.report_key)}
                report={report}
                selected={report.report_key === selectedReportKey}
              />
            ))}
          </div>
        </PanelBody>
      </Panel>

      <div className="space-y-6">
        <Panel>
          <PanelHeader
            description="กดรันเมื่อพร้อมเท่านั้น รายงานหนักจะรันเบื้องหลังและปิดหน้าได้"
            title="ควบคุมการรัน"
          />
          <PanelBody>
            {selectedReport ? (
              <>
                <div className="rounded-lg bg-gray-50 p-4 dark:bg-white/[0.02]">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">
                        {selectedReport.label}
                      </p>
                      <p className="mt-1 text-theme-sm leading-6 text-gray-500 dark:text-gray-400">
                        {selectedReport.description}
                      </p>
                    </div>
                    <Badge color={selectedReport.sensitive ? "warning" : "info"}>
                      {selectedReport.sensitive ? "ข้อมูลอ่อนไหว" : "มาตรฐาน"}
                    </Badge>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    จากวันที่
                    <input
                      className="mt-1 h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-theme-sm text-gray-800 shadow-theme-xs outline-hidden transition placeholder:text-gray-400 focus:border-brand-300 focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-brand-800"
                      onChange={(event) => setDateFrom(event.target.value)}
                      type="date"
                      value={dateFrom}
                    />
                  </label>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    ถึงวันที่
                    <input
                      className="mt-1 h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-theme-sm text-gray-800 shadow-theme-xs outline-hidden transition placeholder:text-gray-400 focus:border-brand-300 focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-brand-800"
                      onChange={(event) => setDateTo(event.target.value)}
                      type="date"
                      value={dateTo}
                    />
                  </label>
                </div>

                {dateInvalid ? (
                  <Notice tone="warning">
                    ช่วงวันที่ไม่ถูกต้อง กรุณาเลือกวันที่เริ่มต้นไม่เกินวันที่สิ้นสุด
                  </Notice>
                ) : null}

                {selectedIsAsync && !chunkedEnabled ? (
                  <Notice tone="warning">
                    ร้านนี้ยังไม่ได้เปิด chunked heavy reports จึงยังไม่ควรรันรายงานหนักจากหน้านี้
                  </Notice>
                ) : null}

                <Button
                  disabled={runDisabled}
                  onClick={() => void runSelectedReport()}
                  type="button"
                >
                  {busy === selectedReport.report_key
                    ? "กำลังเริ่มรัน..."
                    : selectedIsAsync
                      ? "เริ่มรันเบื้องหลัง"
                      : "รันทดสอบรายงาน"}
                </Button>
                <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">
                  {runDisabled
                    ? "ถ้าปุ่มกดไม่ได้ ให้ตรวจช่วงวันที่, active run, หรือ feature flag ของรายงานหนัก"
                    : "ระบบจะ query SML JavaWS และบันทึก snapshot ให้ dashboard/LINE ใช้ต่อ"}
                </p>
              </>
            ) : (
              <EmptyState
                detail="ยังไม่มี report catalog สำหรับร้านนี้ กรุณาตรวจ API report setup"
                title="ยังเลือกรายงานไม่ได้"
              />
            )}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="ผลล่าสุดของรายงานที่เลือก" />
          <PanelBody>
            {selectedRun ? (
              <RunDetail run={selectedRun} snapshot={selectedSnapshot ?? null} />
            ) : (
              <EmptyState
                detail="ยังไม่มี report run ของรายงานนี้ กดรันทดสอบเมื่อ SML พร้อม"
                title="ยังไม่มี run"
              />
            )}
          </PanelBody>
        </Panel>

        {progress ? (
          <Panel>
            <PanelHeader title="ความคืบหน้าการรันเบื้องหลัง" />
            <PanelBody>
              <ProgressCard progress={progress} />
            </PanelBody>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

function ReportRow({
  latestRun,
  latestSnapshot,
  onSelect,
  report,
  selected,
}: {
  latestRun: ReportRunRecord | null;
  latestSnapshot: OwnerV2ReportSetupPayload["latest_snapshots"][number] | null;
  onSelect: () => void;
  report: OwnerReport;
  selected: boolean;
}) {
  return (
    <button
      aria-pressed={selected}
      className={`w-full rounded-lg p-3 text-left transition ${
        selected
          ? "bg-brand-50 ring-1 ring-brand-100 dark:bg-brand-500/10 dark:ring-brand-500/20"
          : "hover:bg-gray-50 dark:hover:bg-white/[0.03]"
      }`}
      onClick={onSelect}
      type="button"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">
              {report.label}
            </p>
            {report.sensitive ? (
              <Badge color="warning" size="sm">
                ข้อมูลอ่อนไหว
              </Badge>
            ) : null}
            {report.heavy ? (
              <Badge color="info" size="sm">
                รายงานหนัก
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-theme-sm leading-6 text-gray-500 dark:text-gray-400">
            {report.description}
          </p>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2 text-xs sm:min-w-72">
          <SmallFact
            label="Run"
            value={latestRun ? formatRunStatus(latestRun.status) : "ยังไม่มี"}
          />
          <SmallFact
            label="Snapshot"
            value={
              latestSnapshot ? formatDateTime(latestSnapshot.generated_at) : "ยังไม่มี"
            }
          />
        </div>
      </div>
    </button>
  );
}

function RunDetail({
  run,
  snapshot,
}: {
  run: ReportRunRecord;
  snapshot: OwnerV2ReportSetupPayload["latest_snapshots"][number] | null;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 rounded-lg bg-gray-50 p-4 dark:bg-white/[0.02]">
        <div
          className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
            run.status === "success"
              ? "bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-400"
              : run.status === "failed"
                ? "bg-error-50 text-error-600 dark:bg-error-500/15 dark:text-error-400"
                : "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400"
          }`}
        >
          {run.status === "success" ? (
            <CheckCircleIcon className="h-4 w-4" />
          ) : run.status === "failed" ? (
            <AlertIcon className="h-4 w-4" />
          ) : (
            <InfoIcon className="h-4 w-4" />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">
            {formatRunStatus(run.status)}
          </p>
          <p className="mt-1 break-words text-theme-xs leading-5 text-gray-500 dark:text-gray-400">
            {run.id}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Metric label="Rows" value={run.row_count.toLocaleString("th-TH")} />
        <Metric label="Duration" value={formatRunDuration(run)} />
        <Metric
          label="Period"
          value={formatReportPeriod(run.params.date_from, run.params.date_to)}
        />
        <Metric
          label="Snapshot"
          value={snapshot ? formatDateTime(snapshot.generated_at) : "ยังไม่มี"}
        />
      </div>
      {run.failure_phase || run.failure_kind || run.safe_error_message ? (
        <Notice tone="error">
          {run.failure_phase ? `ขั้นตอนที่ผิดพลาด: ${run.failure_phase}. ` : ""}
          {run.failure_kind ? `ประเภทปัญหา: ${run.failure_kind}. ` : ""}
          {run.safe_error_message ?? "รันไม่สำเร็จ กรุณาตรวจ SML JavaWS แล้วลองใหม่"}
        </Notice>
      ) : null}
    </div>
  );
}

function ProgressCard({ progress }: { progress: ChunkedReportProgress }) {
  const percent = Math.max(0, Math.min(100, progress.progress_percent ?? 0));
  const isDone = isTerminalStatus(progress.run.status);
  return (
    <div className="rounded-xl border border-blue-light-500 bg-blue-light-50 p-4 dark:border-blue-light-500/30 dark:bg-blue-light-500/15">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <InfoIcon className="-mt-0.5 h-6 w-6 shrink-0 text-blue-light-500 dark:text-blue-light-400" />
          <div>
            <p className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">
              {formatRunStatus(progress.run.status)}
            </p>
            <p className="mt-1 text-theme-xs leading-5 text-gray-500 dark:text-gray-400">
              {formatProgressStage(progress.progress_stage)} ·{" "}
              {formatElapsedMs(progress.elapsed_ms)}
            </p>
          </div>
        </div>
        <Badge color={isDone ? "success" : "info"}>{percent}%</Badge>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/80 dark:bg-gray-900/50">
        <div
          className="h-full rounded-full bg-brand-500 transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <SmallFact
          label="Chunks"
          value={`${progress.chunk_summary.done}/${progress.chunk_summary.total}`}
        />
        <SmallFact
          label="Rows"
          value={progress.chunk_summary.rows_processed.toLocaleString("th-TH")}
        />
      </div>
      <p className="mt-3 text-theme-xs leading-5 text-gray-500 dark:text-gray-400">
        {progress.next_action_message}
      </p>
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 pb-4 pt-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6">
      {children}
    </section>
  );
}

function PanelHeader({
  action,
  description,
  title,
}: {
  action?: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 max-w-2xl text-theme-sm leading-6 text-gray-500 dark:text-gray-400">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function PanelBody({ children }: { children: ReactNode }) {
  return <div className="space-y-5">{children}</div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3 dark:bg-white/[0.02]">
      <p className="text-theme-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 break-words text-theme-xl font-semibold text-gray-800 dark:text-white/90">
        {value}
      </p>
    </div>
  );
}

function SmallFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-white/[0.02]">
      <p className="text-theme-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 truncate text-theme-xs font-semibold text-gray-800 dark:text-white/90">
        {value}
      </p>
    </div>
  );
}

function Notice({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "success" | "warning" | "error";
}) {
  const classes = {
    error:
      "border-error-500 bg-error-50 dark:border-error-500/30 dark:bg-error-500/15",
    success:
      "border-success-500 bg-success-50 dark:border-success-500/30 dark:bg-success-500/15",
    warning:
      "border-warning-500 bg-warning-50 dark:border-warning-500/30 dark:bg-warning-500/15",
  }[tone];
  const Icon =
    tone === "success" ? CheckCircleIcon : tone === "warning" ? InfoIcon : AlertIcon;
  const iconClass =
    tone === "success"
      ? "text-success-500"
      : tone === "warning"
        ? "text-warning-500 dark:text-orange-400"
        : "text-error-500";
  return (
    <div className={`rounded-xl border p-4 ${classes}`}>
      <div className="flex items-start gap-3">
        <Icon className={`-mt-0.5 h-6 w-6 shrink-0 ${iconClass}`} />
        <div className="text-sm leading-6 text-gray-500 dark:text-gray-400">
          {children}
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  action,
  detail,
  title,
}: {
  action?: ReactNode;
  detail: string;
  title: string;
}) {
  return (
    <div className="rounded-lg bg-gray-50 p-5 text-center dark:bg-white/[0.02] sm:p-6">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
        <InfoIcon className="h-5 w-5" />
      </div>
      <p className="mt-3 text-theme-sm font-semibold text-gray-800 dark:text-white/90">
        {title}
      </p>
      <p className="mx-auto mt-2 max-w-md text-theme-sm leading-6 text-gray-500 dark:text-gray-400">
        {detail}
      </p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

function ReportsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
      <Panel>
        <PanelHeader title="กำลังโหลดรายการรายงาน" />
        <PanelBody>
          <MiniSkeleton rows={6} />
        </PanelBody>
      </Panel>
      <Panel>
        <PanelHeader title="กำลังโหลด run control" />
        <PanelBody>
          <MiniSkeleton rows={4} />
        </PanelBody>
      </Panel>
    </div>
  );
}

function MiniSkeleton({ rows }: { rows: number }) {
  return (
    <div className="animate-pulse space-y-3">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          className="h-11 rounded-lg bg-gray-100 dark:bg-gray-800"
          key={index}
        />
      ))}
    </div>
  );
}

function buildLatestRunByReport(runs: ReportRunRecord[]) {
  const sorted = [...runs].sort((left, right) =>
    (right.finished_at ?? right.started_at).localeCompare(
      left.finished_at ?? left.started_at,
    ),
  );
  const map = new Map<ReportKey, ReportRunRecord>();
  for (const run of sorted) {
    if (!map.has(run.report_key)) {
      map.set(run.report_key, run);
    }
  }
  return map;
}

function isTerminalStatus(status: ReportRunStatus) {
  return terminalStatuses.includes(status);
}

function formatRunStatus(status: ReportRunStatus | null) {
  if (!status) {
    return "ยังไม่มี";
  }
  const labels: Record<ReportRunStatus, string> = {
    failed: "ไม่สำเร็จ",
    queued: "รอคิว",
    running: "กำลังรัน",
    success: "สำเร็จ",
  };
  return labels[status] ?? status;
}

function formatProgressStage(stage: string | null) {
  if (!stage) {
    return "กำลังเตรียมงาน";
  }
  const labels: Record<string, string> = {
    chunking: "แบ่ง chunk",
    finalizing: "รวมผลลัพธ์",
    queued: "รอคิว",
    running: "กำลังรัน",
    success: "สำเร็จ",
  };
  return labels[stage] ?? stage;
}

function formatReportPeriod(dateFrom: string, dateTo: string) {
  if (!dateFrom || !dateTo) {
    return "ยังไม่เลือกช่วงวันที่";
  }
  if (dateFrom === dateTo) {
    return dateFrom;
  }
  return `${dateFrom} ถึง ${dateTo}`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "ยังไม่มี";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: BANGKOK_TIME_ZONE,
  }).format(date);
}

function formatRunDuration(run: ReportRunRecord) {
  if (!run.finished_at) {
    return run.status === "running" ? "กำลังรัน" : "ยังไม่จบ";
  }
  const started = Date.parse(run.queued_at ?? run.started_at);
  const finished = Date.parse(run.finished_at);
  if (!Number.isFinite(started) || !Number.isFinite(finished)) {
    return "ไม่ทราบเวลา";
  }
  return formatElapsedMs(Math.max(0, finished - started));
}

function formatElapsedMs(value: number) {
  if (value < 1000) {
    return `${value} ms`;
  }
  const seconds = Math.round(value / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function defaultReportDate() {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: BANGKOK_TIME_ZONE,
    year: "numeric",
  }).format(yesterday);
}
