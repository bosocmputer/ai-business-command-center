"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ApexOptions } from "apexcharts";
import {
  formatSmlBranchLabel,
  type BranchSales,
  type ReportKey,
  type ReportSnapshot,
  type SalesDetailRow,
  type SalesDocumentDetail,
  type SalesDocumentListItem,
  type SalesDocumentPage,
  type TopProduct,
  type TopSupplier,
} from "@ai-bcc/shared";
import { getCommandCenterApiBaseUrl } from "./apiBaseUrl";

const API_BASE_URL = getCommandCenterApiBaseUrl();
const ReactApexChart = dynamic(() => import("react-apexcharts"), {
  ssr: false,
});

type SnapshotResponse = {
  data?: ReportSnapshot;
  error?: string;
};

type ViewerRunResponse = {
  data?: ReportSnapshot;
  error?: string;
};

type DocumentPageResponse = {
  data?: SalesDocumentPage;
  error?: string;
};

type DocumentDetailResponse = {
  data?: SalesDocumentDetail;
  error?: string;
};

type LoadState =
  | { status: "loading" }
  | { status: "ready"; snapshot: ReportSnapshot }
  | { status: "error"; message: string };

type DocumentsState =
  | { status: "idle" | "loading" }
  | { status: "ready"; page: SalesDocumentPage }
  | { status: "error"; message: string };

type DetailState =
  | { status: "idle" }
  | { status: "loading"; docNo: string }
  | { status: "ready"; detail: SalesDocumentDetail }
  | { status: "error"; docNo: string; message: string };

type ViewerParams = {
  tenantId: string;
  reportKey: ReportKey;
  runId: string;
  token: string;
};

type ReportCopy = {
  title: string;
  shortTitle: string;
  totalLabel: string;
  documentLabel: string;
  lineLabel: string;
  qtyLabel: string;
  detailsTitle: string;
  searchPlaceholder: string;
  documentColumn: string;
  partyColumn: string;
  amountColumn: string;
  itemSectionTitle: string;
  partyLabel: string;
  amountDetailLabel: string;
  primaryChartTitle: string;
  primaryChartCaption: string;
  secondaryChartTitle: string;
  secondaryChartCaption: string;
  emptyDocuments: string;
};

const reportCopy: Record<ReportKey, ReportCopy> = {
  sales_goods_services: {
    title: "รายงานขายสินค้าและบริการ",
    shortTitle: "รายงานขาย",
    totalLabel: "ยอดขายสุทธิ",
    documentLabel: "บิลขาย",
    lineLabel: "รายการขาย",
    qtyLabel: "จำนวนขายรวม",
    detailsTitle: "รายละเอียดบิลขาย",
    searchPlaceholder: "ค้นหาเลขบิล ลูกค้า สาขา หรือยอดขาย",
    documentColumn: "บิลขาย",
    partyColumn: "ลูกค้า",
    amountColumn: "ยอดขายบิลนี้",
    itemSectionTitle: "สินค้าในบิลนี้",
    partyLabel: "ลูกค้า",
    amountDetailLabel: "ยอดขายบิลนี้",
    primaryChartTitle: "ยอดขายตามสาขา",
    primaryChartCaption: "ดูว่าสาขาไหนเป็นตัวขับยอดหลัก",
    secondaryChartTitle: "สินค้าขายดี",
    secondaryChartCaption: "สินค้าที่สร้างยอดขายสูงสุด",
    emptyDocuments: "ไม่มีบิลขายในช่วงวันที่นี้",
  },
  purchase_goods_payables: {
    title: "รายงานซื้อสินค้า/ตั้งหนี้",
    shortTitle: "รายงานซื้อ",
    totalLabel: "ยอดซื้อ/ตั้งหนี้",
    documentLabel: "เอกสารซื้อ",
    lineLabel: "รายการสินค้า",
    qtyLabel: "จำนวนซื้อรวม",
    detailsTitle: "รายละเอียดเอกสารซื้อ",
    searchPlaceholder: "ค้นหาเลขเอกสาร ผู้จำหน่าย สาขา หรือยอดซื้อ",
    documentColumn: "เอกสารซื้อ",
    partyColumn: "ผู้จำหน่าย",
    amountColumn: "ยอดซื้อเอกสารนี้",
    itemSectionTitle: "สินค้าในเอกสารนี้",
    partyLabel: "ผู้จำหน่าย",
    amountDetailLabel: "ยอดซื้อเอกสารนี้",
    primaryChartTitle: "ผู้จำหน่ายหลัก",
    primaryChartCaption: "ดูว่ายอดซื้อมาจากผู้จำหน่ายใดเป็นหลัก",
    secondaryChartTitle: "สินค้าที่ซื้อสูงสุด",
    secondaryChartCaption: "สินค้าที่รับเข้าหรือมีมูลค่าซื้อสูงสุด",
    emptyDocuments: "ไม่มีเอกสารซื้อ/ตั้งหนี้ในช่วงวันที่นี้",
  },
};

export function CommandCenterBriefFallback() {
  return (
    <main className="min-h-screen bg-[#f5f7fb] px-4 py-4 text-gray-800">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="h-28 animate-pulse rounded-2xl bg-white" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-24 animate-pulse rounded-2xl bg-white" />
          ))}
        </div>
      </div>
    </main>
  );
}

export default function CommandCenterBriefViewer() {
  const searchParams = useSearchParams();
  const tenantId = searchParams.get("tenant_id");
  const reportKey = (searchParams.get("report_key") ||
    "sales_goods_services") as ReportKey;
  const runId = searchParams.get("run_id");
  const token = searchParams.get("token");
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    if (!tenantId || !runId || !token || !isReportKey(reportKey)) {
      setState({
        status: "error",
        message: "ลิงก์รายงานไม่ครบถ้วน กรุณาเปิดจากข้อความ LINE ล่าสุดอีกครั้ง",
      });
      return;
    }

    const safeTenantId = tenantId;
    const safeRunId = runId;
    const safeToken = token;
    const safeReportKey = reportKey;
    const controller = new AbortController();
    async function loadSnapshot() {
      setState({ status: "loading" });
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/reports/${encodeURIComponent(
            safeTenantId,
          )}/${encodeURIComponent(safeReportKey)}/snapshots/${encodeURIComponent(
            safeRunId,
          )}?token=${encodeURIComponent(safeToken)}`,
          { signal: controller.signal },
        );
        const payload = (await response.json()) as SnapshotResponse;
        if (!response.ok || !payload.data) {
          throw new Error(payload.error || "เปิดรายงานไม่สำเร็จ");
        }
        setState({ status: "ready", snapshot: payload.data });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "เปิดรายงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
        });
      }
    }

    void loadSnapshot();
    return () => controller.abort();
  }, [reportKey, runId, tenantId, token]);

  if (state.status === "loading") {
    return <CommandCenterBriefFallback />;
  }

  if (state.status === "error") {
    return <BriefErrorState message={state.message} />;
  }

  return (
    <PremiumReportViewer
      initialSnapshot={state.snapshot}
      viewer={{
        tenantId: tenantId!,
        reportKey: state.snapshot.report_key,
        runId: runId!,
        token: token!,
      }}
    />
  );
}

function PremiumReportViewer({
  initialSnapshot,
  viewer,
}: {
  initialSnapshot: ReportSnapshot;
  viewer: ViewerParams;
}) {
  const [snapshot, setSnapshot] = useState<ReportSnapshot>(initialSnapshot);
  const [dateFrom, setDateFrom] = useState(initialSnapshot.params.date_from);
  const [dateTo, setDateTo] = useState(initialSnapshot.params.date_to);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [documentsState, setDocumentsState] = useState<DocumentsState>({
    status: "idle",
  });
  const [detailState, setDetailState] = useState<DetailState>({
    status: "idle",
  });
  const [expandedDocNo, setExpandedDocNo] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");

  const copy = reportCopy[snapshot.report_key];
  const totalAmount = getSnapshotTotal(snapshot);
  const topItem = snapshot.top_products[0] ?? null;
  const primaryRanking = getPrimaryRanking(snapshot);
  const generatedAt = formatDateTime(snapshot.generated_at);
  const hasWarning =
    snapshot.quality_status === "reconciled_with_warning" ||
    Math.abs(snapshot.reconciliation.difference_amount) > 0.01;

  const runRange = useCallback(
    async (nextDateFrom = dateFrom, nextDateTo = dateTo) => {
      setRangeLoading(true);
      setRangeError(null);
      setExpandedDocNo(null);
      setDetailState({ status: "idle" });
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/reports/${encodeURIComponent(
            viewer.tenantId,
          )}/${encodeURIComponent(viewer.reportKey)}/viewer-run`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              token: viewer.token,
              run_id: viewer.runId,
              date_from: nextDateFrom,
              date_to: nextDateTo,
            }),
          },
        );
        const payload = (await response.json()) as ViewerRunResponse;
        if (!response.ok || !payload.data) {
          throw new Error(payload.error || "โหลดรายงานไม่สำเร็จ");
        }
        setSnapshot(payload.data);
        setDateFrom(payload.data.params.date_from);
        setDateTo(payload.data.params.date_to);
        setPage(1);
        setSubmittedSearch("");
        setSearch("");
      } catch (error) {
        setRangeError(
          error instanceof Error
            ? error.message
            : "โหลดรายงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
        );
      } finally {
        setRangeLoading(false);
      }
    },
    [dateFrom, dateTo, viewer],
  );

  const loadDocuments = useCallback(
    async (nextPage = page, nextSearch = submittedSearch) => {
      setDocumentsState({ status: "loading" });
      try {
        const params = new URLSearchParams({
          token: viewer.token,
          run_id: viewer.runId,
          date_from: snapshot.params.date_from,
          date_to: snapshot.params.date_to,
          page: String(nextPage),
          page_size: "10",
          search: nextSearch,
        });
        const response = await fetch(
          `${API_BASE_URL}/api/reports/${encodeURIComponent(
            viewer.tenantId,
          )}/${encodeURIComponent(viewer.reportKey)}/viewer-documents?${params}`,
        );
        const payload = (await response.json()) as DocumentPageResponse;
        if (!response.ok || !payload.data) {
          throw new Error(payload.error || "โหลดรายการเอกสารไม่สำเร็จ");
        }
        setDocumentsState({ status: "ready", page: payload.data });
      } catch (error) {
        setDocumentsState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "โหลดรายการเอกสารไม่สำเร็จ",
        });
      }
    },
    [
      page,
      snapshot.params.date_from,
      snapshot.params.date_to,
      submittedSearch,
      viewer,
    ],
  );

  useEffect(() => {
    void loadDocuments(page, submittedSearch);
  }, [loadDocuments, page, submittedSearch]);

  async function loadDetail(document: SalesDocumentListItem) {
    if (expandedDocNo === document.doc_no) {
      setExpandedDocNo(null);
      setDetailState({ status: "idle" });
      return;
    }

    setExpandedDocNo(document.doc_no);
    setDetailState({ status: "loading", docNo: document.doc_no });
    try {
      const params = new URLSearchParams({
        token: viewer.token,
        run_id: viewer.runId,
        date_from: snapshot.params.date_from,
        date_to: snapshot.params.date_to,
        doc_no: document.doc_no,
      });
      const response = await fetch(
        `${API_BASE_URL}/api/reports/${encodeURIComponent(
          viewer.tenantId,
        )}/${encodeURIComponent(viewer.reportKey)}/viewer-document-detail?${params}`,
      );
      const payload = (await response.json()) as DocumentDetailResponse;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error || "โหลดรายละเอียดไม่สำเร็จ");
      }
      setDetailState({ status: "ready", detail: payload.data });
    } catch (error) {
      setDetailState({
        status: "error",
        docNo: document.doc_no,
        message:
          error instanceof Error
            ? error.message
            : "โหลดรายละเอียดไม่สำเร็จ กรุณาลองใหม่",
      });
    }
  }

  function applyPreset(preset: "yesterday" | "month" | "quarter" | "year") {
    const range = buildPresetRange(preset);
    setDateFrom(range.date_from);
    setDateTo(range.date_to);
    void runRange(range.date_from, range.date_to);
  }

  const documentPage =
    documentsState.status === "ready" ? documentsState.page : null;
  const documents = documentPage?.documents ?? [];
  const totalPages = documentPage?.pagination.total_pages ?? 1;

  return (
    <main className="min-h-screen bg-[#f4f6fb] text-slate-900">
      <div className="border-b border-white/60 bg-[radial-gradient(circle_at_top_left,#e8efff,transparent_35%),linear-gradient(135deg,#071022,#172554_48%,#0f766e)] text-white">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:py-7">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-cyan-100">
                <span>AI Business Executive Viewer</span>
                <span className="rounded-full bg-white/12 px-2 py-1 text-white/90">
                  {formatSource(snapshot.source)}
                </span>
                <span
                  className={`rounded-full px-2 py-1 ${
                    hasWarning
                      ? "bg-amber-300/20 text-amber-100"
                      : "bg-emerald-300/20 text-emerald-100"
                  }`}
                >
                  {hasWarning ? "ควรตรวจยอด" : "พร้อมใช้"}
                </span>
              </div>
              <h1 className="mt-3 text-2xl font-semibold tracking-normal sm:text-3xl">
                {copy.title}
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-200">
                {formatTenantName(snapshot.tenant_id)} · ช่วงข้อมูล{" "}
                {formatReportPeriod(
                  snapshot.params.date_from,
                  snapshot.params.date_to,
                )}{" "}
                · อัปเดต {generatedAt}
              </p>
            </div>
            <a
              href="#documents"
              className="inline-flex h-11 w-fit items-center justify-center rounded-full bg-white px-5 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-950/20 transition hover:bg-cyan-50"
            >
              ดูรายละเอียดเอกสาร
            </a>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <PremiumKpi
              label={copy.totalLabel}
              value={`${formatMoney(totalAmount)} บาท`}
              emphasis
            />
            <PremiumKpi
              label={copy.documentLabel}
              value={`${formatInteger(snapshot.summary.document_count)} ใบ`}
            />
            <PremiumKpi
              label={copy.lineLabel}
              value={`${formatInteger(snapshot.summary.line_count)} รายการ`}
            />
            <PremiumKpi
              label={copy.qtyLabel}
              value={formatQty(snapshot.summary.total_qty)}
            />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-4 px-4 py-4 sm:px-6 lg:space-y-5 lg:py-6">
        <section className="rounded-2xl border border-white bg-white/90 p-3 shadow-sm shadow-slate-200/80 backdrop-blur sm:p-4">
          <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                เลือกช่วงรายงาน
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <PresetButton label="เมื่อวาน" onClick={() => applyPreset("yesterday")} />
                <PresetButton label="เดือนนี้" onClick={() => applyPreset("month")} />
                <PresetButton label="ไตรมาสนี้" onClick={() => applyPreset("quarter")} />
                <PresetButton label="ปีนี้" onClick={() => applyPreset("year")} />
              </div>
            </div>
            <form
              className="grid gap-2 sm:grid-cols-[140px_140px_auto]"
              onSubmit={(event) => {
                event.preventDefault();
                void runRange();
              }}
            >
              <DateInput label="จากวันที่" value={dateFrom} onChange={setDateFrom} />
              <DateInput label="ถึงวันที่" value={dateTo} onChange={setDateTo} />
              <button
                className="h-11 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 sm:self-end"
                disabled={rangeLoading}
                type="submit"
              >
                {rangeLoading ? "กำลังโหลด" : "ดูรายงาน"}
              </button>
            </form>
          </div>
          {rangeError && (
            <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {rangeError}
            </p>
          )}
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
          <div className="space-y-4">
            <ExecutiveInsights
              copy={copy}
              snapshot={snapshot}
              topItem={topItem}
              primaryRanking={primaryRanking}
              hasWarning={hasWarning}
            />

            <section className="grid gap-4 lg:grid-cols-2">
              <ChartPanel
                title={copy.primaryChartTitle}
                caption={copy.primaryChartCaption}
                color="#2563eb"
                data={primaryRanking.map((item) => ({
                  label: item.label,
                  value: item.value,
                }))}
              />
              <ChartPanel
                title={copy.secondaryChartTitle}
                caption={copy.secondaryChartCaption}
                color="#10b981"
                data={snapshot.top_products.slice(0, 6).map((item) => ({
                  label: item.item_name,
                  value: item.sum_amount,
                }))}
              />
            </section>
          </div>

          <aside className="space-y-4">
            <ComparisonPanel snapshot={snapshot} />
            <TrustPanel snapshot={snapshot} />
          </aside>
        </div>

        <section
          id="documents"
          className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm shadow-slate-200/80 sm:p-4"
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
                Drilldown
              </p>
              <h2 className="mt-1 text-lg font-semibold text-slate-950">
                {copy.detailsTitle}
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                กดเอกสารเพื่อดูสินค้าและยอดที่ประกอบขึ้นมาในเอกสารนั้น
                รายการโหลดจาก SML เฉพาะตอนเปิดดู
              </p>
            </div>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                setPage(1);
                setSubmittedSearch(search);
              }}
            >
              <input
                className="h-10 min-w-0 rounded-xl border border-slate-200 px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                placeholder={copy.searchPlaceholder}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <button
                className="h-10 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                type="submit"
              >
                ค้นหา
              </button>
            </form>
          </div>

          <div className="mt-4 space-y-2">
            {documentsState.status === "loading" && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                กำลังโหลดรายการเอกสาร...
              </div>
            )}
            {documentsState.status === "error" && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {documentsState.message}
              </div>
            )}
            {documentsState.status === "ready" && !documents.length && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                {copy.emptyDocuments}
              </div>
            )}
            {documents.map((document) => (
              <DocumentCard
                key={`${document.doc_date}-${document.doc_no}`}
                copy={copy}
                detailState={detailState}
                document={document}
                expanded={expandedDocNo === document.doc_no}
                onToggle={() => void loadDetail(document)}
                reportKey={snapshot.report_key}
              />
            ))}
          </div>

          {documentPage && (
            <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-3 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
              <span>
                หน้า {formatInteger(documentPage.pagination.page)} จาก{" "}
                {formatInteger(totalPages)} · ทั้งหมด{" "}
                {formatInteger(documentPage.pagination.total_items)} เอกสาร
              </span>
              <div className="flex gap-2">
                <PagerButton
                  disabled={page <= 1}
                  label="ก่อนหน้า"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                />
                <PagerButton
                  disabled={page >= totalPages}
                  label="ถัดไป"
                  onClick={() =>
                    setPage((current) => Math.min(totalPages, current + 1))
                  }
                />
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function ExecutiveInsights({
  copy,
  snapshot,
  topItem,
  primaryRanking,
  hasWarning,
}: {
  copy: ReportCopy;
  snapshot: ReportSnapshot;
  topItem: TopProduct | null;
  primaryRanking: Array<{ label: string; meta: string; value: number }>;
  hasWarning: boolean;
}) {
  const total = getSnapshotTotal(snapshot);
  const primary = primaryRanking[0] ?? null;
  const partyTitle =
    snapshot.report_key === "purchase_goods_payables"
      ? "ผู้จำหน่ายที่ควรจับตา"
      : "สาขาที่ทำยอดหลัก";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/80">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
            Executive Insight
          </p>
          <h2 className="mt-1 text-lg font-semibold text-slate-950">
            ผู้บริหารควรรู้อะไร
          </h2>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            hasWarning
              ? "bg-amber-50 text-amber-700"
              : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {hasWarning ? "ควรตรวจยอด" : "พร้อมใช้"}
        </span>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <InsightCard
          index={1}
          title={copy.totalLabel}
          body={`${formatMoney(total)} บาท จาก ${formatInteger(
            snapshot.summary.document_count,
          )} เอกสาร`}
        />
        <InsightCard
          index={2}
          title={partyTitle}
          body={
            primary
              ? `${primary.label} มูลค่า ${formatMoney(primary.value)} บาท`
              : "ยังไม่มีข้อมูลในช่วงวันที่นี้"
          }
        />
        <InsightCard
          index={3}
          title={copy.secondaryChartTitle}
          body={
            topItem
              ? `${topItem.item_name} มูลค่า ${formatMoney(topItem.sum_amount)} บาท`
              : "ยังไม่มีสินค้าในช่วงวันที่นี้"
          }
        />
      </div>
    </section>
  );
}

function ChartPanel({
  title,
  caption,
  data,
  color,
}: {
  title: string;
  caption: string;
  data: Array<{ label: string; value: number }>;
  color: string;
}) {
  const chartData = data.filter((item) => item.value > 0).slice(0, 6);
  const options: ApexOptions = {
    chart: {
      fontFamily: "Outfit, sans-serif",
      toolbar: { show: false },
      type: "bar",
    },
    colors: [color],
    plotOptions: {
      bar: {
        borderRadius: 6,
        horizontal: true,
      },
    },
    dataLabels: { enabled: false },
    grid: { borderColor: "#eef2f7" },
    xaxis: {
      categories: chartData.map((item) => truncateLabel(item.label)),
      labels: {
        formatter: (value) => compactMoney(Number(value)),
      },
    },
    tooltip: {
      y: { formatter: (value) => `${formatMoney(value)} บาท` },
    },
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/80">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">{caption}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
          Top {chartData.length || 0}
        </span>
      </div>
      {chartData.length ? (
        <div className="mt-3">
          <ReactApexChart
            height={260}
            options={options}
            series={[{ name: title, data: chartData.map((item) => item.value) }]}
            type="bar"
          />
        </div>
      ) : (
        <div className="mt-4 rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          ไม่มีข้อมูลเพียงพอสำหรับกราฟในช่วงวันที่นี้
        </div>
      )}
    </section>
  );
}

function ComparisonPanel({ snapshot }: { snapshot: ReportSnapshot }) {
  const comparison =
    snapshot.report_key === "sales_goods_services" ? snapshot.comparison : null;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/80">
      <h2 className="text-base font-semibold text-slate-950">เทียบยอด</h2>
      <div className="mt-3 space-y-2">
        <ComparisonRow
          title="ช่วงก่อนหน้า"
          value={
            comparison?.previous_day
              ? `${formatSignedMoney(
                  comparison.previous_day.difference_amount,
                )} บาท`
              : "ยังไม่มีข้อมูลอ้างอิง"
          }
        />
        <ComparisonRow
          title="ช่วงเดียวกันปีก่อน"
          value="กำลังเตรียมข้อมูลเปรียบเทียบรายปี"
        />
      </div>
    </section>
  );
}

function TrustPanel({ snapshot }: { snapshot: ReportSnapshot }) {
  const hasWarning = Math.abs(snapshot.reconciliation.difference_amount) > 0.01;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/80">
      <h2 className="text-base font-semibold text-slate-950">
        ความน่าเชื่อถือข้อมูล
      </h2>
      <div className="mt-3 space-y-3 text-sm leading-6 text-slate-600">
        <p>
          ระบบใช้ยอดหัวเอกสารจาก SML เป็นตัวเลขหลัก และใช้รายละเอียดสินค้าเพื่ออธิบายที่มา
        </p>
        {hasWarning && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-amber-700">
            ยอดหัวเอกสารและยอดรายละเอียดต่างกัน{" "}
            {formatMoney(snapshot.reconciliation.difference_amount)} บาท
          </p>
        )}
        <details className="rounded-xl border border-slate-200 bg-slate-50">
          <summary className="cursor-pointer px-3 py-2 font-semibold text-slate-700">
            รายละเอียดเทคนิค
          </summary>
          <dl className="grid gap-2 border-t border-slate-200 px-3 py-3 text-xs sm:grid-cols-2">
            <Fact label="Run ID" value={snapshot.run_id} />
            <Fact
              label="ช่วงวันที่"
              value={formatReportPeriod(
                snapshot.params.date_from,
                snapshot.params.date_to,
              )}
            />
            <Fact
              label="ยอดหัวเอกสาร"
              value={`${formatMoney(snapshot.reconciliation.header_total_amount)} บาท`}
            />
            <Fact
              label="ยอดรายละเอียด"
              value={`${formatMoney(snapshot.reconciliation.detail_sum_amount)} บาท`}
            />
          </dl>
        </details>
      </div>
    </section>
  );
}

function DocumentCard({
  copy,
  detailState,
  document,
  expanded,
  onToggle,
  reportKey,
}: {
  copy: ReportCopy;
  detailState: DetailState;
  document: SalesDocumentListItem;
  expanded: boolean;
  onToggle: () => void;
  reportKey: ReportKey;
}) {
  const branchLabel =
    document.resolved_branch_label ??
    formatSmlBranchLabel(document.resolved_branch_code || document.branch_code);
  const party = document.cust_name || document.cust_code || "-";

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <button
        className="grid w-full gap-3 px-3 py-3 text-left transition hover:bg-slate-50 sm:grid-cols-[minmax(0,1.35fr)_minmax(0,0.9fr)_120px_120px] sm:items-center"
        onClick={onToggle}
        type="button"
      >
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-slate-950">
            {document.doc_no}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {formatThaiDate(document.doc_date)}
            {document.doc_time ? ` · ${formatTime(document.doc_time)}` : ""}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {copy.partyColumn}
          </p>
          <p className="mt-1 truncate text-sm font-medium text-slate-700">
            {party}
          </p>
          <p className="mt-0.5 truncate text-xs text-slate-500">{branchLabel}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {copy.amountColumn}
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-950">
            {formatMoney(document.total_amount)} บาท
          </p>
        </div>
        <div className="flex items-center justify-between gap-3 sm:justify-end">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            {formatInteger(document.detail_line_count)} รายการ
          </span>
          <span className="text-lg text-blue-600">{expanded ? "−" : "+"}</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50 px-3 py-3">
          {detailState.status === "loading" && detailState.docNo === document.doc_no && (
            <div className="rounded-xl bg-white px-4 py-6 text-center text-sm text-slate-500">
              กำลังโหลดรายละเอียด...
            </div>
          )}
          {detailState.status === "error" && detailState.docNo === document.doc_no && (
            <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {detailState.message}
            </div>
          )}
          {detailState.status === "ready" &&
            detailState.detail.document.doc_no === document.doc_no && (
              <DocumentDetailPanel
                copy={copy}
                detail={detailState.detail}
                reportKey={reportKey}
              />
            )}
        </div>
      )}
    </article>
  );
}

function DocumentDetailPanel({
  copy,
  detail,
  reportKey,
}: {
  copy: ReportCopy;
  detail: SalesDocumentDetail;
  reportKey: ReportKey;
}) {
  const totalQty = detail.lines.reduce((sum, line) => sum + line.qty, 0);
  const detailTotal = detail.lines.reduce((sum, line) => sum + line.sum_amount, 0);
  const party = detail.document.cust_name || detail.document.cust_code || "-";

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
      <section className="rounded-xl bg-white p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
              {copy.itemSectionTitle}
            </p>
            <h3 className="mt-1 text-base font-semibold text-slate-950">
              {detail.document.doc_no}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {formatThaiDate(detail.document.doc_date)}
              {detail.document.doc_time
                ? ` · ${formatTime(detail.document.doc_time)}`
                : ""}{" "}
              · {party}
            </p>
          </div>
          <div className="rounded-xl bg-slate-950 px-4 py-2 text-white">
            <p className="text-xs text-slate-300">{copy.amountDetailLabel}</p>
            <p className="text-lg font-semibold">
              {formatMoney(detail.document.total_amount)} บาท
            </p>
          </div>
        </div>

        <div className="mt-3 space-y-2">
          {detail.lines.map((line, index) => (
            <LineItem
              index={index + 1}
              key={`${line.doc_no}-${line.item_code}-${line.line_number ?? index}`}
              line={line}
            />
          ))}
          {!detail.lines.length && (
            <div className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
              ไม่พบรายการสินค้าในเอกสารนี้
            </div>
          )}
        </div>
      </section>

      <aside className="rounded-xl bg-white p-3">
        <h4 className="text-sm font-semibold text-slate-950">สรุปเอกสาร</h4>
        <dl className="mt-3 grid gap-3 text-sm">
          <Fact label={copy.partyLabel} value={party} />
          <Fact
            label="จำนวนรวม"
            value={`${formatQty(totalQty)} ${
              reportKey === "sales_goods_services" ? "หน่วยขาย" : "หน่วยซื้อ"
            }`}
          />
          <Fact
            label="ยอดรวมสินค้า"
            value={`${formatMoney(detailTotal)} บาท`}
          />
          <Fact
            label="VAT"
            value={`${formatMoney(detail.document.total_vat_value)} บาท`}
          />
          <Fact
            label="ส่วนลดรวม"
            value={`${formatMoney(detail.document.total_discount)} บาท`}
          />
        </dl>
      </aside>
    </div>
  );
}

function LineItem({ index, line }: { index: number; line: SalesDetailRow }) {
  const branch = formatSmlBranchLabel(line.branch_code);
  return (
    <div className="rounded-xl border border-slate-100 bg-white px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-blue-600">รายการที่ {index}</p>
          <p className="mt-1 line-clamp-2 font-semibold text-slate-950">
            {line.item_name || line.item_code || "-"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {line.item_code || "-"} · {branch}
          </p>
        </div>
        <p className="shrink-0 text-right text-sm font-semibold text-slate-950">
          {formatMoney(line.sum_amount)} บาท
        </p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500 sm:grid-cols-4">
        <Fact label="จำนวน" value={formatQty(line.qty)} />
        <Fact label="ราคา" value={formatMoney(line.price)} />
        <Fact
          label="ส่วนลด"
          value={
            line.discount_amount ? `${formatMoney(line.discount_amount)} บาท` : "-"
          }
        />
        <Fact label="Barcode" value={line.barcode || "-"} />
      </div>
    </div>
  );
}

function PremiumKpi({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/15 bg-white/12 p-3 shadow-lg shadow-slate-950/10 backdrop-blur">
      <p className="text-xs font-medium text-slate-200">{label}</p>
      <p
        className={`mt-2 truncate font-semibold tracking-normal text-white ${
          emphasis ? "text-xl sm:text-2xl" : "text-lg"
        }`}
        title={value}
      >
        {value}
      </p>
    </div>
  );
}

function InsightCard({
  index,
  title,
  body,
}: {
  index: number;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
      <div className="flex gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
          {index}
        </span>
        <div>
          <p className="font-semibold text-slate-950">{title}</p>
          <p className="mt-1 text-sm leading-6 text-slate-600">{body}</p>
        </div>
      </div>
    </div>
  );
}

function ComparisonRow({ title, value }: { title: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-3 text-sm">
      <span className="font-medium text-slate-600">{title}</span>
      <span className="text-right font-semibold text-slate-950">{value}</span>
    </div>
  );
}

function PresetButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="h-9 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function DateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <input
        className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function PagerButton({
  disabled,
  label,
  onClick,
}: {
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="h-9 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-slate-400">{label}</dt>
      <dd className="mt-1 break-words font-medium text-slate-800">{value}</dd>
    </div>
  );
}

function BriefErrorState({ message }: { message: string }) {
  return (
    <main className="min-h-screen bg-[#f4f6fb] px-4 py-6">
      <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
          AI Business Center
        </p>
        <h1 className="mt-2 text-xl font-semibold text-slate-950">
          เปิดรายงานไม่ได้
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">{message}</p>
        <p className="mt-4 text-xs leading-5 text-slate-500">
          เพื่อความปลอดภัย ลิงก์รายงานจาก LINE จะผูกกับบริษัทและรายงานที่ส่งจริงเท่านั้น
        </p>
      </div>
    </main>
  );
}

function getSnapshotTotal(snapshot: ReportSnapshot) {
  return snapshot.report_key === "purchase_goods_payables"
    ? snapshot.summary.total_purchase
    : snapshot.summary.total_sales;
}

function getPrimaryRanking(snapshot: ReportSnapshot) {
  if (snapshot.report_key === "purchase_goods_payables") {
    return snapshot.top_suppliers.slice(0, 6).map((supplier: TopSupplier) => ({
      label: supplier.supplier_name,
      meta: `${formatInteger(supplier.document_count)} เอกสาร`,
      value: supplier.total_amount,
    }));
  }

  return snapshot.branch_sales.slice(0, 6).map((branch: BranchSales) => ({
    label: formatSmlBranchLabel(
      branch.branch_code,
      branch.branch_name ?? branch.branch_label,
    ),
    meta: `${formatInteger(branch.document_count)} บิล`,
    value: branch.total_amount,
  }));
}

function buildPresetRange(preset: "yesterday" | "month" | "quarter" | "year") {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = addDays(today, -1);
  if (preset === "yesterday") {
    return {
      date_from: toIsoDate(yesterday),
      date_to: toIsoDate(yesterday),
    };
  }

  if (preset === "year") {
    return {
      date_from: `${yesterday.getFullYear()}-01-01`,
      date_to: toIsoDate(yesterday),
    };
  }

  if (preset === "quarter") {
    const quarterStartMonth = Math.floor(yesterday.getMonth() / 3) * 3;
    return {
      date_from: toIsoDate(
        new Date(yesterday.getFullYear(), quarterStartMonth, 1),
      ),
      date_to: toIsoDate(yesterday),
    };
  }

  return {
    date_from: toIsoDate(new Date(yesterday.getFullYear(), yesterday.getMonth(), 1)),
    date_to: toIsoDate(yesterday),
  };
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isReportKey(value: string): value is ReportKey {
  return value === "sales_goods_services" || value === "purchase_goods_payables";
}

function truncateLabel(value: string) {
  return value.length > 28 ? `${value.slice(0, 28)}...` : value;
}

function compactMoney(value: number) {
  if (!Number.isFinite(value)) {
    return "";
  }
  if (Math.abs(value) >= 1_000_000) {
    return `${Math.round(value / 1_000_000)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${Math.round(value / 1_000)}K`;
  }
  return `${Math.round(value)}`;
}

function formatTenantName(tenantId: string) {
  if (tenantId === "tenant_demo_remote") {
    return "DEMO SHOP";
  }
  if (tenantId === "tenant_office_sml1_2026") {
    return "248 SHOP";
  }
  return tenantId;
}

function formatSource(source: ReportSnapshot["source"]) {
  return source === "sml_postgres" ? "ข้อมูลจาก SML" : "ข้อมูลตัวอย่าง";
}

function formatReportPeriod(dateFrom: string, dateTo: string) {
  if (dateFrom === dateTo) {
    return formatThaiDate(dateFrom);
  }
  return `${formatThaiDate(dateFrom)} - ${formatThaiDate(dateTo)}`;
}

function formatThaiDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return value;
  }
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(date);
}

function formatTime(value: string) {
  return value.slice(0, 5);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("th-TH", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(value || 0);
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("th-TH", {
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatQty(value: number) {
  return new Intl.NumberFormat("th-TH", {
    maximumFractionDigits: 3,
  }).format(value || 0);
}

function formatSignedMoney(value: number) {
  const formatted = formatMoney(Math.abs(value));
  if (value > 0) {
    return `+${formatted}`;
  }
  if (value < 0) {
    return `-${formatted}`;
  }
  return formatted;
}
