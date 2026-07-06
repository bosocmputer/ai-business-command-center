"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
import {
  Fact,
  Field,
  Notice,
  Panel,
  PanelBody,
  PanelHeader,
  TechnicalDetails,
  formatDateTime,
  formatRunStatus,
  secondaryActionClass,
} from "./ui";

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
  // Guard the array slices against null: the API can return explicit null for
  // unconfigured tenants, and the old `setup?.X.method()` calls crashed on
  // `null.method()`. The `?? []` only caught the result of `.method`, not the
  // null input, so these are real crash bugs — fix by guarding the field first.
  // Memoize the guarded arrays so the downstream useMemo deps stay stable
  // (a raw `?? []` creates a new array each render and re-triggers the memos).
  const latestRuns = useMemo(
    () => setup?.latest_runs ?? [],
    [setup?.latest_runs],
  );
  const latestSnapshots = useMemo(
    () => setup?.latest_snapshots ?? [],
    [setup?.latest_snapshots],
  );
  const latestRunByReport = useMemo(
    () => buildLatestRunByReport(latestRuns),
    [latestRuns],
  );
  const latestSnapshotByReport = useMemo(
    () => new Map(latestSnapshots.map((item) => [item.report_key, item])),
    [latestSnapshots],
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
    latestRuns.find((run) => !isTerminalStatus(run.status)) ?? null;
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
    latestRuns.filter((run) => run.status === "success").length;
  const failedRuns =
    latestRuns.filter((run) => run.status === "failed").length;
  const activeRuns =
    latestRuns.filter((run) => !isTerminalStatus(run.status)).length;

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
        text: "รายงานขนาดใหญ่ยังไม่พร้อม กรุณาเปิดโหมดรันเบื้องหลังของร้านก่อนเริ่มงาน",
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
            ? `${selectedReport.label}: พบงานเดิมที่กำลังทำอยู่ จะแสดงความคืบหน้าต่อจากงานนั้น`
            : `${selectedReport.label}: เริ่มรันแล้ว ปิดหน้าได้ ระบบยังรันต่อ`
          : `${selectedReport.label}: รันสำเร็จและบันทึกข้อมูลล่าสุดแล้ว`,
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
        <PanelBody spaced>
          <Notice
            tone="error"
            title="โหลดสถานะรายงานไม่สำเร็จ"
            text="ลองโหลดใหม่อีกครั้ง ถ้ายังไม่สำเร็จ ให้เปิดศูนย์ตรวจระบบหรือเลือกร้านใหม่"
          />
          <TechnicalDetails embedded title="รายละเอียดข้อผิดพลาด">
            <Fact label="ข้อความระบบ" value={state.message} />
          </TechnicalDetails>
          <div>
            <Button
              onClick={() => void load()}
              size="sm"
              type="button"
              variant="outline"
            >
              โหลดใหม่
            </Button>
          </div>
        </PanelBody>
      </Panel>
    );
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <Link
        className={secondaryActionClass}
        href={`/owner-v2/stores/${encodeURIComponent(tenantId)}`}
      >
        ← กลับหน้าร้าน
      </Link>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
      <Panel>
        <PanelHeader
          action={
            <div className="flex flex-wrap gap-2">
              <Badge color={chunkedEnabled ? "success" : "warning"}>
                {chunkedEnabled ? "รันรายงานหนักได้" : "ต้องเปิดรันเบื้องหลัง"}
              </Badge>
              <Badge color={activeRuns ? "info" : "light"}>
                กำลังทำงาน {activeRuns}
              </Badge>
            </div>
          }
          description="เลือกรายงานและช่วงวันที่เพื่อทดสอบข้อมูลของร้านนี้ ก่อนนำไปใช้กับหน้าแดชบอร์ดหรือ LINE"
          title={`รายงานของ ${state.data.tenant.name}`}
        />
        <PanelBody spaced>
          {message ? <Notice tone={message.tone} title={message.text} /> : null}

          <div className="grid gap-3 md:grid-cols-3">
            <Fact label="รายงานที่รองรับ" value={reports.length.toString()} />
            <Fact label="สำเร็จล่าสุด" value={successRuns.toString()} />
            <Fact label="ไม่สำเร็จล่าสุด" value={failedRuns.toString()} />
          </div>

          {reports.length ? (
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
          ) : (
            <EmptyState
              text="กรุณาตรวจสิทธิ์รายงานหรือแพ็กเกจของร้านก่อนรันรายงานด้วยมือ"
              title="ยังไม่มีรายงานให้ร้านนี้"
            />
          )}
        </PanelBody>
      </Panel>

      <div className="space-y-6">
        <Panel>
          <PanelHeader
            description="ใช้เมื่ออยากอัปเดตข้อมูลทันที รายงานหนักจะรันเบื้องหลังและปิดหน้าได้"
            title="รันรายงานด้วยมือ"
          />
          <PanelBody spaced>
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
                  <Field label="จากวันที่">
                    <input
                      className="owner-v2-input"
                      onChange={(event) => setDateFrom(event.target.value)}
                      type="date"
                      value={dateFrom}
                    />
                  </Field>
                  <Field label="ถึงวันที่">
                    <input
                      className="owner-v2-input"
                      onChange={(event) => setDateTo(event.target.value)}
                      type="date"
                      value={dateTo}
                    />
                  </Field>
                </div>

                {dateInvalid ? (
                  <Notice
                    tone="warning"
                    title="ช่วงวันที่ไม่ถูกต้อง กรุณาเลือกวันที่เริ่มต้นไม่เกินวันที่สิ้นสุด"
                  />
                ) : null}

                {selectedIsAsync && !chunkedEnabled ? (
                  <Notice
                    tone="warning"
                    title="ร้านนี้ยังไม่ได้เปิดโหมดรันรายงานขนาดใหญ่ จึงยังไม่ควรรันรายงานหนักจากหน้านี้"
                  />
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
                      : "รันรายงานนี้"}
                </Button>
                <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">
                  {runDisabled
                    ? "ถ้าปุ่มกดไม่ได้ ให้ตรวจช่วงวันที่ งานที่กำลังรันอยู่ หรือโหมดรันรายงานขนาดใหญ่"
                    : "ระบบจะดึงข้อมูลจาก SML และบันทึกข้อมูลล่าสุดให้หน้าแดชบอร์ด/LINE ใช้ต่อ"}
                </p>
              </>
            ) : (
              <div className="flex flex-col items-center gap-3 rounded-lg bg-gray-50 p-5 text-center dark:bg-white/[0.02] sm:p-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                  <InfoIcon className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
                    ยังเลือกรายงานไม่ได้
                  </p>
                  <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-gray-500 dark:text-gray-400">
                    ยังไม่มีรายการรายงานสำหรับร้านนี้ กรุณาตรวจการตั้งค่ารายงานของระบบ
                  </p>
                </div>
              </div>
            )}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="ผลล่าสุดของรายงานที่เลือก" />
          <PanelBody spaced>
            {selectedRun ? (
              <RunDetail run={selectedRun} snapshot={selectedSnapshot ?? null} tenantId={tenantId} />
            ) : (
              <div className="flex flex-col items-center gap-3 rounded-lg bg-gray-50 p-5 text-center dark:bg-white/[0.02] sm:p-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                  <InfoIcon className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
                    ยังไม่มีรอบรัน
                  </p>
                  <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-gray-500 dark:text-gray-400">
                    ยังไม่มีประวัติรันของรายงานนี้ กดรันรายงานเมื่อ SML พร้อม
                  </p>
                </div>
              </div>
            )}
          </PanelBody>
        </Panel>

        {progress ? (
          <Panel>
            <PanelHeader title="ความคืบหน้าการรันเบื้องหลัง" />
            <PanelBody spaced>
              <ProgressCard progress={progress} />
            </PanelBody>
          </Panel>
        ) : null}
      </div>
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
          <Fact
            label="รอบรัน"
            value={latestRun ? formatRunStatus(latestRun.status) : "ยังไม่มี"}
          />
          <Fact
            label="ข้อมูลล่าสุด"
            value={
              latestSnapshot ? formatDateTime(latestSnapshot.generated_at) : "ยังไม่มี"
            }
          />
        </div>
      </div>
    </button>
  );
}

function EmptyState({ text, title }: { text: string; title: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg bg-gray-50 p-5 text-center dark:bg-white/[0.02] sm:p-6">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
        <InfoIcon className="h-6 w-6" />
      </div>
      <div>
        <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
          {title}
        </p>
        <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-gray-500 dark:text-gray-400">
          {text}
        </p>
      </div>
    </div>
  );
}

function RunDetail({
  run,
  snapshot,
  tenantId,
}: {
  run: ReportRunRecord;
  snapshot: OwnerV2ReportSetupPayload["latest_snapshots"][number] | null;
  tenantId: string;
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
            ใช้สำหรับตรวจสถานะรายงานก่อนเปิดรอบแจ้งเตือน
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Fact label="จำนวนแถว" value={run.row_count.toLocaleString("th-TH")} />
        <Fact label="เวลาที่ใช้" value={formatRunDuration(run)} />
        <Fact
          label="ช่วงข้อมูล"
          value={formatReportPeriod(run.params.date_from, run.params.date_to)}
        />
        <Fact
          label="ข้อมูลล่าสุด"
          value={snapshot ? formatDateTime(snapshot.generated_at) : "ยังไม่มี"}
        />
      </div>
      {run.failure_phase || run.failure_kind || run.safe_error_message ? (
        <Notice
          tone="error"
          title={run.safe_error_message ?? "รันไม่สำเร็จ กรุณาตรวจการเชื่อมต่อ SML แล้วลองใหม่"}
          text="ดูรายละเอียดเทคนิคด้านล่างหากต้องตรวจขั้นตอนที่ล้มเหลว"
        />
      ) : null}
      <TechnicalDetails embedded title="รายละเอียดเทคนิคของรอบรัน">
        <div className="grid gap-3 sm:grid-cols-3">
          <Fact label="รหัสรอบ" tone="light" value={run.id} />
          <Fact
            label="ขั้นตอนระบบ"
            tone="light"
            value={run.failure_phase ?? "ไม่มีข้อผิดพลาด"}
          />
          <Fact
            label="ประเภทปัญหา"
            tone="light"
            value={run.failure_kind ?? "ไม่มีข้อผิดพลาด"}
          />
        </div>
      </TechnicalDetails>
      {run.report_key === "sales_goods_services" && run.status === "success" ? (
        <ReportSignoffPanel run={run} tenantId={tenantId} />
      ) : null}
    </div>
  );
}

function ReportSignoffPanel({
  run,
  tenantId,
}: {
  run: ReportRunRecord;
  tenantId: string;
}) {
  const [signedBy, setSignedBy] = useState("");
  const [systemTotal, setSystemTotal] = useState("");
  const [referenceTotal, setReferenceTotal] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const system = Number(systemTotal || 0);
  const reference = Number(referenceTotal || 0);
  const difference = Number.isFinite(reference) && Number.isFinite(system) ? reference - system : 0;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) {
      return;
    }
    if (signedBy.trim().length < 2) {
      setResult({ tone: "error", text: "ระบุชื่อผู้รับรองอย่างน้อย 2 ตัวอักษร" });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      await ownerV2Fetch(
        `/api/owner/tenants/${encodeURIComponent(tenantId)}/reports/sales_goods_services/validation-signoff`,
        {
          method: "POST",
          body: {
            run_id: run.id,
            date_from: run.params.date_from,
            date_to: run.params.date_to,
            system_total: system,
            reference_total: reference,
            signed_by: signedBy.trim(),
            note: note.trim() || undefined,
          },
        },
      );
      const verdict =
        Math.abs(difference) < 1 ? "ตรง" : `ต่าง ${difference.toLocaleString("th-TH")} บาท`;
      setResult({
        tone: "success",
        text: `บันทึกการรับรองแล้ว (${verdict})`,
      });
    } catch (error) {
      setResult({
        tone: "error",
        text: error instanceof Error ? error.message : "บันทึกการรับรองไม่สำเร็จ",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="rounded-xl border border-gray-200 p-4 dark:border-gray-800"
      onSubmit={submit}
    >
      <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
        รับรองยอดรายงาน
      </p>
      <p className="mt-1 text-theme-xs leading-5 text-gray-500 dark:text-gray-400">
        บันทึกว่าใครตรวจยอดแล้ว และยอดในรายงานตรงกับแหล่งอ้างอิงหรือไม่
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
            ชื่อผู้รับรอง
          </span>
          <input
            className="owner-v2-input"
            onChange={(event) => setSignedBy(event.target.value)}
            placeholder="เช่น คุณสมชาย"
            value={signedBy}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
            ยอดในระบบ (บาท)
          </span>
          <input
            className="owner-v2-input"
            inputMode="numeric"
            onChange={(event) => setSystemTotal(event.target.value)}
            placeholder="0"
            type="number"
            value={systemTotal}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
            ยอดอ้างอิง (บาท)
          </span>
          <input
            className="owner-v2-input"
            inputMode="numeric"
            onChange={(event) => setReferenceTotal(event.target.value)}
            placeholder="0"
            type="number"
            value={referenceTotal}
          />
        </label>
      </div>
      <label className="mt-3 block">
        <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
          หมายเหตุ
        </span>
        <textarea
          className="owner-v2-input min-h-20"
          onChange={(event) => setNote(event.target.value)}
          placeholder="ถ้าต่างให้บอกสาเหตุ เช่น ยังไม่ปิดรอบ"
          value={note}
        />
      </label>
      {referenceTotal && systemTotal ? (
        <p className={`mt-2 text-theme-xs ${Math.abs(difference) < 1 ? "text-success-600" : "text-warning-600"}`}>
          {Math.abs(difference) < 1
            ? "ยอดตรง"
            : `ต่าง ${difference.toLocaleString("th-TH")} บาท`}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button disabled={busy} size="sm" type="submit">
          {busy ? "กำลังบันทึก..." : "บันทึกการรับรอง"}
        </Button>
        {result ? (
          <span className={`text-theme-xs ${result.tone === "error" ? "text-error-600" : "text-success-600"}`}>
            {result.text}
          </span>
        ) : null}
      </div>
    </form>
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
        <Fact
          label="ช่วงข้อมูลที่ทำเสร็จ"
          value={`${progress.chunk_summary.done}/${progress.chunk_summary.total}`}
        />
        <Fact
          label="จำนวนแถวที่อ่านแล้ว"
          value={progress.chunk_summary.rows_processed.toLocaleString("th-TH")}
        />
      </div>
      <p className="mt-3 text-theme-xs leading-5 text-gray-500 dark:text-gray-400">
        {progress.next_action_message}
      </p>
    </div>
  );
}


function ReportsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
      <Panel>
        <PanelHeader title="กำลังโหลดรายการรายงาน" />
        <PanelBody spaced>
          <MiniSkeleton rows={6} />
        </PanelBody>
      </Panel>
      <Panel>
        <PanelHeader title="กำลังโหลดเครื่องมือรันรายงาน" />
        <PanelBody spaced>
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

function formatProgressStage(stage: string | null) {
  if (!stage) {
    return "กำลังเตรียมงาน";
  }
  const labels: Record<string, string> = {
    chunking: "แบ่งช่วงข้อมูล",
    finalizing: "รวมผลลัพธ์",
    queued: "รอคิว",
    running: "กำลังรัน",
    success: "สำเร็จ",
  };
  return labels[stage] ?? "กำลังประมวลผล";
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
