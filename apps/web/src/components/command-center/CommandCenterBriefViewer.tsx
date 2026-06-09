"use client";

import dynamic from "next/dynamic";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ApexOptions } from "apexcharts";
import {
  formatSmlBranchLabel,
  isReportKey,
  type ArDebtReceiptCustomerSummary,
  type ArDebtReceiptRow,
  type ArDebtReceiptSnapshot,
  type ArCustomerMovementCustomerSummary,
  type ArCustomerMovementRow,
  type ArCustomerMovementSnapshot,
  type BranchSales,
  type GrossProfitBaseRow,
  type GrossProfitByArCustomerRow,
  type GrossProfitByArCustomerSnapshot,
  type GrossProfitByProductRow,
  type GrossProfitByProductSnapshot,
  type ReportKey,
  type ReportSnapshot,
  type SalesComparisonPoint,
  type SalesDetailRow,
  type SalesDocumentDetail,
  type SalesDocumentListItem,
  type SalesDocumentPage,
  type StockBalanceRow,
  type StockBalanceSnapshot,
  type StockReorderRow,
  type StockReorderSnapshot,
  type Tenant,
  type TopProduct,
  type TopSupplier,
} from "@ai-bcc/shared";
import { getCommandCenterApiBaseUrl } from "./apiBaseUrl";
import { ExecutiveDetailDashboardV2 } from "./ExecutiveDetailDashboardV2";

const API_BASE_URL = getCommandCenterApiBaseUrl();
const ReactApexChart = dynamic(() => import("react-apexcharts"), {
  ssr: false,
});

type SnapshotResponse = {
  data?: ViewerReportSnapshot;
  dashboard_access?: DashboardAccess | null;
  error?: string;
};

type TenantsResponse = {
  data?: Tenant[];
  error?: string;
};

type ViewerRunResponse = {
  data?: ViewerReportSnapshot;
  error?: string;
};

type DashboardAccess = {
  token: string;
  expires_at: string;
  source_run_id: string;
  allowed_report_keys: ReportKey[];
  max_date_window_days: number;
  lookback_days: number;
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
  snapshots: ViewerReportSnapshot[];
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

type DocumentPageResponse = {
  data?: SalesDocumentPage;
  error?: string;
};

type DocumentDetailResponse = {
  data?: SalesDocumentDetail;
  error?: string;
};

type PdfPrepareResponse = {
  data?: {
    ready: boolean;
    filename: string;
    cache_hit: boolean;
    document_count: number;
    detail_row_count: number;
    pdf_bytes: number;
    layout_version: string;
  };
  error?: string;
};

type LoadState =
  | { status: "loading" }
  | {
      status: "ready";
      snapshot: ViewerReportSnapshot;
      dashboardAccess: DashboardAccess | null;
    }
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

type PdfDownloadState =
  | { status: "idle" }
  | { status: "preparing"; progress: number; stage: string }
  | {
      status: "ready";
      filename: string;
      cacheHit: boolean;
      documentCount: number;
      detailRowCount: number;
      pdfBytes: number;
    }
  | { status: "error"; message: string };

type ViewerParams = {
  tenantId: string;
  reportKey: ViewerReportKey;
  runId: string;
  token: string;
};

type ClassicViewerReportKey = Extract<
  ReportKey,
  "sales_goods_services" | "purchase_goods_payables"
>;

type GrossProfitViewerReportKey = Extract<
  ReportKey,
  "gross_profit_by_product" | "gross_profit_by_ar_customer"
>;

type StockBalanceViewerReportKey = Extract<ReportKey, "stock_balance">;
type StockReorderViewerReportKey = Extract<ReportKey, "stock_reorder">;
type ArCustomerMovementViewerReportKey = Extract<
  ReportKey,
  "ar_customer_movement"
>;
type ArDebtReceiptViewerReportKey = Extract<ReportKey, "ar_debt_receipt">;

type ViewerReportKey =
  | ClassicViewerReportKey
  | GrossProfitViewerReportKey
  | StockBalanceViewerReportKey
  | StockReorderViewerReportKey
  | ArCustomerMovementViewerReportKey
  | ArDebtReceiptViewerReportKey;

type ViewerReportSnapshot = Extract<
  ReportSnapshot,
  { report_key: ViewerReportKey }
>;

type ClassicViewerReportSnapshot = Extract<
  ReportSnapshot,
  { report_key: ClassicViewerReportKey }
>;

type GrossProfitViewerReportSnapshot =
  | GrossProfitByProductSnapshot
  | GrossProfitByArCustomerSnapshot;

type StockBalanceViewerReportSnapshot = StockBalanceSnapshot;
type StockReorderViewerReportSnapshot = StockReorderSnapshot;
type ArCustomerMovementViewerReportSnapshot = ArCustomerMovementSnapshot;
type ArDebtReceiptViewerReportSnapshot = ArDebtReceiptSnapshot;

const REPORT_PDF_LAYOUT_VERSION = "sml-row-v5";
const PDF_PROGRESS_STAGES = [
  { delayMs: 0, progress: 5, stage: "ตรวจสิทธิ์ลิงก์รายงาน" },
  { delayMs: 250, progress: 15, stage: "เช็กไฟล์ PDF ใน cache" },
  { delayMs: 700, progress: 30, stage: "ตรวจจำนวนเอกสารและรายการ" },
  { delayMs: 1300, progress: 50, stage: "ดึงข้อมูลจาก SML" },
  { delayMs: 2400, progress: 80, stage: "สร้างไฟล์ PDF" },
  { delayMs: 3800, progress: 95, stage: "บันทึกไฟล์ลง cache" },
] as const;

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

const reportCopy: Record<ClassicViewerReportKey, ReportCopy> = {
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
    <main className="min-h-screen bg-[#F6F7F9] px-4 py-4 text-[#101828]">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="h-28 animate-pulse rounded-xl border border-[#E4E7EC] bg-white" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div
              key={item}
              className="h-24 animate-pulse rounded-xl border border-[#E4E7EC] bg-white"
            />
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
  const viewerVersion = searchParams.get("viewer_version");
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
          { signal: controller.signal, credentials: "include" },
        );
        const payload = (await response.json()) as SnapshotResponse;
        if (!response.ok || !payload.data) {
          const rawError = payload.error || "เปิดรายงานไม่สำเร็จ";
          const friendlyError = rawError.includes("another device")
            ? "ลิงก์นี้เปิดอยู่บนอีกเครื่องหนึ่ง กรุณาเปิดจาก LINE บนเครื่องเดิม"
            : rawError.includes("expired")
              ? "ลิงก์รายงานหมดอายุแล้ว กรุณาขอลิงก์ใหม่จาก LINE"
              : rawError;
          throw new Error(friendlyError);
        }
        setState({
          status: "ready",
          snapshot: payload.data,
          dashboardAccess: payload.dashboard_access ?? null,
        });
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

  const viewer = {
    tenantId: tenantId!,
    reportKey: state.snapshot.report_key,
    runId: runId!,
    token: token!,
  };

  if (viewerVersion === "v1") {
    return (
      <PremiumReportViewer
        dashboardAccess={state.dashboardAccess}
        initialSnapshot={state.snapshot}
        viewer={viewer}
      />
    );
  }

  return (
    <ExecutiveDetailDashboardV2
      dashboardAccess={state.dashboardAccess}
      initialSnapshot={state.snapshot}
      viewer={viewer}
    />
  );
}

function PremiumReportViewer({
  dashboardAccess,
  initialSnapshot,
  viewer,
}: {
  dashboardAccess: DashboardAccess | null;
  initialSnapshot: ViewerReportSnapshot;
  viewer: ViewerParams;
}) {
  const [snapshot, setSnapshot] = useState<ViewerReportSnapshot>(initialSnapshot);
  const [tenantDisplayName, setTenantDisplayName] = useState<string | null>(null);
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
  const [pdfDownloadState, setPdfDownloadState] = useState<PdfDownloadState>({
    status: "idle",
  });
  const [dashboardPanelOpen, setDashboardPanelOpen] = useState(false);

  const title = getViewerReportTitle(snapshot);
  const generatedAt = formatDateTime(snapshot.generated_at);
  const tenantName = tenantDisplayName ?? snapshot.tenant_id;

  useEffect(() => {
    document.title = `${title} | AI Business Center`;
  }, [title]);

  useEffect(() => {
    let cancelled = false;
    async function loadTenantName() {
      try {
        const response = await fetch(`${API_BASE_URL}/api/tenants`);
        const payload = (await response.json()) as TenantsResponse;
        const tenant = payload.data?.find((item) => item.id === snapshot.tenant_id);
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
  }, [snapshot.tenant_id]);

  useEffect(() => {
    setPdfDownloadState({ status: "idle" });
  }, [
    snapshot.params.date_from,
    snapshot.params.date_to,
    snapshot.params.time_from,
    snapshot.params.time_to,
    snapshot.report_key,
    snapshot.run_id,
  ]);

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
      if (!isClassicSnapshot(snapshot)) {
        setDocumentsState({ status: "idle" });
        return;
      }

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
        appendPeriodTimeParams(params, snapshot.params);
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
      snapshot,
      submittedSearch,
      viewer,
    ],
  );

  useEffect(() => {
    if (!isClassicSnapshot(snapshot)) {
      setDocumentsState({ status: "idle" });
      return;
    }

    void loadDocuments(page, submittedSearch);
  }, [loadDocuments, page, submittedSearch, snapshot]);

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
      appendPeriodTimeParams(params, snapshot.params);
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

  async function handleDownloadPdf() {
    if (pdfDownloadState.status === "preparing") {
      return;
    }

    const prepareUrl = buildViewerPdfPrepareUrl({
      viewer,
      dateFrom: snapshot.params.date_from,
      dateTo: snapshot.params.date_to,
      timeFrom: snapshot.params.time_from,
      timeTo: snapshot.params.time_to,
    });
    const downloadUrl = buildViewerPdfUrl({
      viewer,
      dateFrom: snapshot.params.date_from,
      dateTo: snapshot.params.date_to,
      timeFrom: snapshot.params.time_from,
      timeTo: snapshot.params.time_to,
    });
    const timers: number[] = [];

    try {
      setPdfDownloadState({
        status: "preparing",
        progress: PDF_PROGRESS_STAGES[0].progress,
        stage: PDF_PROGRESS_STAGES[0].stage,
      });
      for (const stage of PDF_PROGRESS_STAGES.slice(1)) {
        timers.push(
          window.setTimeout(() => {
            setPdfDownloadState({
              status: "preparing",
              progress: stage.progress,
              stage: stage.stage,
            });
          }, stage.delayMs),
        );
      }

      const response = await fetch(prepareUrl, {
        method: "GET",
        headers: { accept: "application/json" },
      });
      const payload = (await response.json().catch(() => ({}))) as PdfPrepareResponse;
      if (!response.ok || !payload.data?.ready) {
        throw new Error(
          payload.error ||
            "สร้างไฟล์ PDF ไม่สำเร็จ กรุณาลองใหม่หรือเลือกช่วงวันที่สั้นลง",
        );
      }

      timers.forEach((timer) => window.clearTimeout(timer));
      setPdfDownloadState({
        status: "preparing",
        progress: 100,
        stage: "พร้อมดาวน์โหลด",
      });
      window.setTimeout(() => {
        setPdfDownloadState({
          status: "ready",
          filename: payload.data!.filename,
          cacheHit: payload.data!.cache_hit,
          documentCount: payload.data!.document_count,
          detailRowCount: payload.data!.detail_row_count,
          pdfBytes: payload.data!.pdf_bytes,
        });
      }, 180);
      openPdfDownloadUrl(downloadUrl);
    } catch (error) {
      timers.forEach((timer) => window.clearTimeout(timer));
      setPdfDownloadState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "สร้างไฟล์ PDF ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
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
  const detailedPdfUrl = buildViewerPdfUrl({
    viewer,
    dateFrom: snapshot.params.date_from,
    dateTo: snapshot.params.date_to,
    timeFrom: snapshot.params.time_from,
    timeTo: snapshot.params.time_to,
  });
  const dashboardModePanel = dashboardAccess ? (
    <ExecutiveDashboardModePanel
      access={dashboardAccess}
      evidenceSnapshot={initialSnapshot}
      open={dashboardPanelOpen}
      onOpenChange={setDashboardPanelOpen}
      tenantId={viewer.tenantId}
      tenantName={tenantName}
    />
  ) : null;
  const dashboardNotice = dashboardAccess ? (
    <ExecutiveDashboardAccessNotice
      access={dashboardAccess}
      evidenceSnapshot={initialSnapshot}
      onOpen={() => setDashboardPanelOpen(true)}
      tenantName={tenantName}
    />
  ) : null;
  const renderWithDashboardShell = (children: ReactNode) => (
    <>
      {dashboardNotice}
      {children}
      {dashboardModePanel}
    </>
  );

  if (isStockReorderSnapshot(snapshot)) {
    return renderWithDashboardShell(
        <StockReorderReportViewer
          generatedAt={generatedAt}
          snapshot={snapshot}
          tenantName={tenantName}
        />
    );
  }

  if (isArCustomerMovementSnapshot(snapshot)) {
    return renderWithDashboardShell(
        <ArCustomerMovementReportViewer
          generatedAt={generatedAt}
          snapshot={snapshot}
          tenantName={tenantName}
        />
    );
  }

  if (isArDebtReceiptSnapshot(snapshot)) {
    return renderWithDashboardShell(
        <ArDebtReceiptReportViewer
          generatedAt={generatedAt}
          snapshot={snapshot}
          tenantName={tenantName}
        />
    );
  }

  if (isStockBalanceSnapshot(snapshot)) {
    return renderWithDashboardShell(
        <StockBalanceReportViewer
          dateFrom={dateFrom}
          dateTo={dateTo}
          generatedAt={generatedAt}
          onApplyPreset={applyPreset}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
          onRunRange={() => void runRange()}
          rangeError={rangeError}
          rangeLoading={rangeLoading}
          snapshot={snapshot}
          tenantName={tenantName}
        />
    );
  }

  if (isGrossProfitSnapshot(snapshot)) {
    return renderWithDashboardShell(
        <GrossProfitReportViewer
          dateFrom={dateFrom}
          dateTo={dateTo}
          generatedAt={generatedAt}
          onApplyPreset={applyPreset}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
          onRunRange={() => void runRange()}
          rangeError={rangeError}
          rangeLoading={rangeLoading}
          snapshot={snapshot}
          tenantName={tenantName}
        />
    );
  }

  const copy = reportCopy[snapshot.report_key];
  const totalAmount = getSnapshotTotal(snapshot);
  const topItem = snapshot.top_products[0] ?? null;
  const primaryRanking = getPrimaryRanking(snapshot);
  const hasWarning =
    snapshot.quality_status === "reconciled_with_warning" ||
    Math.abs(snapshot.reconciliation.difference_amount) > 0.01;

  return renderWithDashboardShell(
    <main className="min-h-screen bg-[#F6F7F9] text-[#101828]">
      <div className="screen-report-viewer">
      <div className="border-b border-[#E4E7EC] bg-white">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[12px] font-medium leading-[18px] text-[#667085]">
                <span className="rounded-full border border-[#D0D5DD] bg-white px-2.5 py-1 text-[#344054]">
                  รายงานผู้บริหาร
                </span>
                <span className="rounded-full border border-[#D0D5DD] bg-[#F9FAFB] px-2.5 py-1 text-[#475467]">
                  {formatSource(snapshot.source)}
                </span>
                <span
                  className={`rounded-full border px-2.5 py-1 ${
                    hasWarning
                      ? "border-[#FEDF89] bg-[#FFFAEB] text-[#B54708]"
                      : "border-[#ABEFC6] bg-[#ECFDF3] text-[#027A48]"
                  }`}
                >
                  {hasWarning ? "ควรตรวจยอด" : "พร้อมใช้"}
                </span>
              </div>
              <h1 className="mt-3 text-[24px] font-semibold leading-8 tracking-normal text-[#101828] sm:text-[28px] sm:leading-9">
                {copy.title}
              </h1>
              <p className="mt-2 text-[14px] leading-[22px] text-[#667085]">
                {tenantName} · ช่วงข้อมูล{" "}
                {formatReportPeriodFromParams(snapshot.params)}{" "}
                · อัปเดต {generatedAt}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 print:hidden">
              <button
                className="inline-flex h-10 w-fit items-center justify-center rounded-lg border border-[#D0D5DD] bg-white px-4 text-[14px] font-semibold leading-[22px] text-[#344054] shadow-sm transition hover:bg-[#F9FAFB] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={pdfDownloadState.status === "preparing"}
                onClick={handleDownloadPdf}
                type="button"
              >
                {pdfDownloadState.status === "preparing"
                  ? "กำลังสร้าง PDF..."
                  : "ดาวน์โหลด PDF"}
              </button>
              <a
                href="#documents"
                className="inline-flex h-10 w-fit items-center justify-center rounded-lg bg-[#2563EB] px-4 text-[14px] font-semibold leading-[22px] text-white shadow-sm transition hover:bg-[#1D4ED8]"
              >
                ดูรายละเอียดเอกสาร
              </a>
            </div>
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
          <PdfDownloadProgressDialog
            downloadUrl={detailedPdfUrl}
            onClose={() => setPdfDownloadState({ status: "idle" })}
            state={pdfDownloadState}
          />
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-4 px-4 py-4 sm:px-6 lg:space-y-5 lg:py-6">
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

        <AdvancedRangeControls
          dateFrom={dateFrom}
          dateTo={dateTo}
          onApplyPreset={applyPreset}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
          onRunRange={() => void runRange()}
          rangeError={rangeError}
          rangeLoading={rangeLoading}
        />

        <section
          id="documents"
          className="rounded-xl border border-[#E4E7EC] bg-white p-3 shadow-sm sm:p-4"
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[12px] font-medium leading-[18px] text-[#2563EB]">
                รายละเอียดเอกสาร
              </p>
              <h2 className="mt-1 text-[18px] font-semibold leading-7 text-[#101828]">
                {copy.detailsTitle}
              </h2>
              <p className="mt-1 text-[14px] leading-[22px] text-[#667085]">
                กดเอกสารเพื่อดูสินค้าและยอดที่ประกอบขึ้นมาในเอกสารนั้น
                รายละเอียดนี้ผูกกับรอบรายงานและช่วงข้อมูลเดียวกับข้อความ LINE
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
                className="h-10 min-w-0 rounded-lg border border-[#D0D5DD] px-3 text-[14px] leading-[22px] outline-none transition focus:border-[#2563EB] focus:ring-4 focus:ring-[#DBEAFE]"
                placeholder={copy.searchPlaceholder}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <button
                className="h-10 rounded-lg border border-[#D0D5DD] bg-white px-4 text-[14px] font-semibold leading-[22px] text-[#344054] transition hover:bg-[#F9FAFB]"
                type="submit"
              >
                ค้นหา
              </button>
            </form>
          </div>

          <div className="mt-4 space-y-2">
            {documentsState.status === "loading" && (
              <div className="rounded-lg border border-[#E4E7EC] bg-[#F9FAFB] px-4 py-6 text-center text-[14px] leading-[22px] text-[#667085]">
                กำลังโหลดรายการเอกสาร...
              </div>
            )}
            {documentsState.status === "error" && (
              <div className="rounded-lg border border-[#FECDCA] bg-[#FEF3F2] px-4 py-3 text-[14px] leading-[22px] text-[#B42318]">
                {documentsState.message}
              </div>
            )}
            {documentsState.status === "ready" && !documents.length && (
              <div className="rounded-lg border border-[#E4E7EC] bg-[#F9FAFB] px-4 py-6 text-center text-[14px] leading-[22px] text-[#667085]">
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
            <div className="mt-4 flex flex-col gap-2 border-t border-[#EAECF0] pt-3 text-[14px] leading-[22px] text-[#667085] sm:flex-row sm:items-center sm:justify-between">
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
      </div>
    </main>
  );
}

function ExecutiveDashboardAccessNotice({
  access,
  evidenceSnapshot,
  onOpen,
  tenantName,
}: {
  access: DashboardAccess;
  evidenceSnapshot: ViewerReportSnapshot;
  onOpen: () => void;
  tenantName: string;
}) {
  return (
    <div className="border-b border-[#D0D5DD] bg-[#EFF6FF] px-4 py-3 text-[#101828] print:hidden sm:px-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-[#B2DDFF] bg-white px-2.5 py-1 text-[12px] font-semibold leading-[18px] text-[#175CD3]">
              Dashboard Mode พร้อมใช้
            </span>
            <span className="rounded-full border border-[#D0D5DD] bg-white px-2.5 py-1 text-[12px] font-semibold leading-[18px] text-[#475467]">
              {formatInteger(access.allowed_report_keys.length)} รายงาน
            </span>
          </div>
          <p className="mt-2 text-[14px] font-semibold leading-[22px]">
            หน้านี้ยังเป็นหลักฐานจาก LINE รอบเดิม แต่สามารถเลือกวันที่อื่นเพื่อสร้าง dashboard ใหม่ได้
          </p>
          <p className="mt-1 text-[13px] leading-5 text-[#475467]">
            {tenantName} · รอบ LINE {formatReportPeriodFromParams(
              evidenceSnapshot.params,
            )} · ย้อนหลังได้ {formatInteger(access.lookback_days)} วัน
          </p>
        </div>
        <button
          className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-[#2563EB] px-5 text-[14px] font-semibold leading-[22px] text-white shadow-sm transition hover:bg-[#1D4ED8] sm:w-fit"
          onClick={onOpen}
          type="button"
        >
          วิเคราะห์วันที่อื่น
        </button>
      </div>
    </div>
  );
}

function GrossProfitReportViewer({
  snapshot,
  generatedAt,
  tenantName,
  dateFrom,
  dateTo,
  rangeLoading,
  rangeError,
  onDateFromChange,
  onDateToChange,
  onRunRange,
  onApplyPreset,
}: {
  snapshot: GrossProfitViewerReportSnapshot;
  generatedAt: string;
  tenantName: string;
  dateFrom: string;
  dateTo: string;
  rangeLoading: boolean;
  rangeError: string | null;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onRunRange: () => void;
  onApplyPreset: (preset: "yesterday" | "month" | "quarter" | "year") => void;
}) {
  const title = getGrossProfitTitle(snapshot.report_key);
  const rowLabel =
    snapshot.report_key === "gross_profit_by_product" ? "สินค้า" : "ลูกหนี้";
  const hasWarning =
    snapshot.summary.gross_profit < 0 ||
    snapshot.summary.negative_gross_profit_count > 0;
  const topRows = snapshot.top_rows.slice(0, 8);
  const negativeRows = snapshot.negative_rows.slice(0, 6);

  return (
    <main className="min-h-screen bg-[#F6F7F9] text-[#101828]">
      <div className="screen-report-viewer">
        <div className="border-b border-[#E4E7EC] bg-white">
          <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:py-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-[12px] font-medium leading-[18px] text-[#667085]">
                  <span className="rounded-full border border-[#D0D5DD] bg-white px-2.5 py-1 text-[#344054]">
                    รายงานผู้บริหาร
                  </span>
                  <span className="rounded-full border border-[#D0D5DD] bg-[#F9FAFB] px-2.5 py-1 text-[#475467]">
                    {formatSource(snapshot.source)}
                  </span>
                  <span
                    className={`rounded-full border px-2.5 py-1 ${
                      hasWarning
                        ? "border-[#FEDF89] bg-[#FFFAEB] text-[#B54708]"
                        : "border-[#ABEFC6] bg-[#ECFDF3] text-[#027A48]"
                    }`}
                  >
                    {hasWarning ? "ควรตรวจต้นทุน" : "พร้อมใช้"}
                  </span>
                  <span className="rounded-full border border-[#FEDF89] bg-[#FFFAEB] px-2.5 py-1 text-[#B54708]">
                    ข้อมูลต้นทุน
                  </span>
                </div>
                <h1 className="mt-3 text-[24px] font-semibold leading-8 tracking-normal text-[#101828] sm:text-[28px] sm:leading-9">
                  {title}
                </h1>
                <p className="mt-2 text-[14px] leading-[22px] text-[#667085]">
                  {tenantName} · ช่วงข้อมูล{" "}
                  {formatReportPeriodFromParams(snapshot.params)}{" "}
                  · อัปเดต {generatedAt}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 print:hidden">
                {negativeRows.length > 0 && (
                  <a
                    href="#gross-profit-negative"
                    className="inline-flex h-10 w-fit items-center justify-center rounded-lg border border-[#FEDF89] bg-[#FFFAEB] px-4 text-[14px] font-semibold leading-[22px] text-[#B54708] shadow-sm transition hover:bg-[#FEF0C7]"
                  >
                    ดูรายการติดลบ
                  </a>
                )}
                <a
                  href="#gross-profit-table"
                  className="inline-flex h-10 w-fit items-center justify-center rounded-lg bg-[#2563EB] px-4 text-[14px] font-semibold leading-[22px] text-white shadow-sm transition hover:bg-[#1D4ED8]"
                >
                  ดูรายการกำไร
                </a>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <PremiumKpi
                label="กำไรขั้นต้น"
                value={`${formatMoney(snapshot.summary.gross_profit)} บาท`}
                emphasis
              />
              <PremiumKpi
                label="ยอดขายสุทธิหลังคืน"
                value={`${formatMoney(snapshot.summary.net_amount)} บาท`}
              />
              <PremiumKpi
                label="ต้นทุนสุทธิ"
                value={`${formatMoney(snapshot.summary.net_cost)} บาท`}
              />
              <PremiumKpi
                label="Margin"
                value={formatMargin(snapshot.summary.gross_margin_percent)}
              />
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-7xl space-y-4 px-4 py-4 sm:px-6 lg:space-y-5 lg:py-6">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
            <section className="rounded-xl border border-[#E4E7EC] bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[12px] font-medium leading-[18px] text-[#2563EB]">
                    สรุปผู้บริหาร
                  </p>
                  <h2 className="mt-1 text-[18px] font-semibold leading-7 text-[#101828]">
                    สิ่งที่ควรดู
                  </h2>
                </div>
                <span
                  className={`rounded-full border px-3 py-1 text-[12px] font-semibold leading-[18px] ${
                    hasWarning
                      ? "border-[#FEDF89] bg-[#FFFAEB] text-[#B54708]"
                      : "border-[#ABEFC6] bg-[#ECFDF3] text-[#027A48]"
                  }`}
                >
                  {hasWarning ? "ควรตรวจต้นทุน" : "พร้อมใช้"}
                </span>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                <InsightCard
                  index={1}
                  title="กำไรขั้นต้น"
                  body={`${formatMoney(snapshot.summary.gross_profit)} บาท จาก ${formatInteger(
                    snapshot.summary.row_count,
                  )} ${rowLabel}`}
                />
                <InsightCard
                  index={2}
                  title={`Top ${rowLabel}`}
                  body={
                    topRows[0]
                      ? `${getGrossProfitRowLabel(snapshot, topRows[0])} กำไร ${formatMoney(
                          topRows[0].gross_profit,
                        )} บาท`
                      : "ยังไม่มีข้อมูลในช่วงวันที่นี้"
                  }
                />
                <InsightCard
                  index={3}
                  title="รายการที่ควรตรวจ"
                  body={
                    snapshot.summary.negative_gross_profit_count > 0
                      ? `${formatInteger(
                          snapshot.summary.negative_gross_profit_count,
                        )} รายการมีกำไรติดลบ`
                      : "ยังไม่พบรายการกำไรติดลบ"
                  }
                />
              </div>
            </section>

            <section className="rounded-xl border border-[#E4E7EC] bg-white p-4 shadow-sm">
              <h2 className="text-[18px] font-semibold leading-7 text-[#101828]">
                ความน่าเชื่อถือข้อมูล
              </h2>
              <div className="mt-3 space-y-3 text-[14px] leading-[22px] text-[#475467]">
                <p>
                  ระบบคำนวณจากยอดขาย หักคืนสินค้า และต้นทุนจาก SML ตามช่วงวันที่ที่เลือก
                </p>
                <p className="rounded-lg border border-[#D0D5DD] bg-[#F9FAFB] px-3 py-2 text-[#475467]">
                  รายงานกำไรขั้นต้นสินค้าและลูกหนี้ใช้ transaction ชุดเดียวกัน
                  ยอดรวมจึงควรเท่ากัน แต่แยกมุมมองคนละแบบ
                </p>
                {hasWarning && (
                  <p className="rounded-lg border border-[#FEDF89] bg-[#FFFAEB] px-3 py-2 text-[#B54708]">
                    พบยอดสุทธิติดลบหรือรายการกำไรติดลบ ควรตรวจต้นทุนสินค้า ราคาขาย
                    และเอกสารคืนสินค้า
                  </p>
                )}
                <dl className="grid gap-3 text-[14px] leading-[22px] sm:grid-cols-2">
                  <Fact
                    label="ยอดขายรวมก่อนคืน"
                    value={`${formatMoney(snapshot.summary.total_sales)} บาท`}
                  />
                  <Fact
                    label="ยอดคืนสินค้า"
                    value={`${formatMoney(snapshot.summary.total_returns)} บาท`}
                  />
                  <Fact
                    label={`${rowLabel}ที่มีรายการ`}
                    value={`${formatInteger(snapshot.summary.row_count)} รายการ`}
                  />
                  <Fact
                    label="แหล่งข้อมูล"
                    value={formatSource(snapshot.source)}
                  />
                </dl>
              </div>
            </section>
          </div>

          <AdvancedRangeControls
            dateFrom={dateFrom}
            dateTo={dateTo}
            onApplyPreset={onApplyPreset}
            onDateFromChange={onDateFromChange}
            onDateToChange={onDateToChange}
            onRunRange={onRunRange}
            rangeError={rangeError}
            rangeLoading={rangeLoading}
          />

          <section
            id="gross-profit-table"
            className="rounded-xl border border-[#E4E7EC] bg-white p-3 shadow-sm sm:p-4"
          >
            <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-[12px] font-medium leading-[18px] text-[#2563EB]">
                  รายละเอียดกำไรขั้นต้น
                </p>
                <h2 className="mt-1 text-[18px] font-semibold leading-7 text-[#101828]">
                  Top {rowLabel}ตามกำไรขั้นต้น
                </h2>
              </div>
              <span className="rounded-full border border-[#E4E7EC] bg-[#F9FAFB] px-3 py-1 text-[12px] font-semibold leading-[18px] text-[#475467]">
                {formatInteger(snapshot.summary.row_count)} รายการ
              </span>
            </div>
            <GrossProfitRowsTable
              emptyText={`ยังไม่มี${rowLabel}ในช่วงวันที่นี้`}
              rows={topRows}
              snapshot={snapshot}
            />
          </section>

          {negativeRows.length > 0 && (
            <section
              id="gross-profit-negative"
              className="rounded-xl border border-[#FEDF89] bg-[#FFFAEB] p-3 shadow-sm sm:p-4"
            >
              <div>
                <p className="text-[12px] font-medium leading-[18px] text-[#B54708]">
                  รายการที่ควรตรวจ
                </p>
                <h2 className="mt-1 text-[18px] font-semibold leading-7 text-[#101828]">
                  {rowLabel}ที่กำไรติดลบ
                </h2>
              </div>
              <GrossProfitRowsTable
                emptyText="ไม่พบรายการกำไรติดลบ"
                rows={negativeRows}
                snapshot={snapshot}
              />
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

function StockBalanceReportViewer({
  snapshot,
  generatedAt,
  tenantName,
  dateFrom,
  dateTo,
  rangeLoading,
  rangeError,
  onDateFromChange,
  onDateToChange,
  onRunRange,
  onApplyPreset,
}: {
  snapshot: StockBalanceViewerReportSnapshot;
  generatedAt: string;
  tenantName: string;
  dateFrom: string;
  dateTo: string;
  rangeLoading: boolean;
  rangeError: string | null;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onRunRange: () => void;
  onApplyPreset: (preset: "yesterday" | "month" | "quarter" | "year") => void;
}) {
  const hasWarning =
    snapshot.summary.negative_stock_count > 0 ||
    snapshot.summary.zero_or_missing_cost_count > 0;
  const topRows = snapshot.top_items_by_value.slice(0, 10);
  const negativeRows = snapshot.negative_items.slice(0, 10);
  const topItem = topRows[0] ?? null;
  const inboundLabel = formatStockMovementLabel(
    "รับเข้า",
    snapshot.params.date_from,
    snapshot.params.date_to,
  );
  const outboundLabel = formatStockMovementLabel(
    "จ่ายออก",
    snapshot.params.date_from,
    snapshot.params.date_to,
  );

  return (
    <main className="min-h-screen bg-[#F6F7F9] text-[#101828]">
      <div className="screen-report-viewer">
        <div className="border-b border-[#E4E7EC] bg-white">
          <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:py-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-[12px] font-medium leading-[18px] text-[#667085]">
                  <span className="rounded-full border border-[#D0D5DD] bg-white px-2.5 py-1 text-[#344054]">
                    รายงานผู้บริหาร
                  </span>
                  <span className="rounded-full border border-[#D0D5DD] bg-[#F9FAFB] px-2.5 py-1 text-[#475467]">
                    {formatSource(snapshot.source)}
                  </span>
                  <span
                    className={`rounded-full border px-2.5 py-1 ${
                      hasWarning
                        ? "border-[#FEDF89] bg-[#FFFAEB] text-[#B54708]"
                        : "border-[#ABEFC6] bg-[#ECFDF3] text-[#027A48]"
                    }`}
                  >
                    {hasWarning ? "ควรตรวจคลัง" : "พร้อมใช้"}
                  </span>
                  <span className="rounded-full border border-[#FEDF89] bg-[#FFFAEB] px-2.5 py-1 text-[#B54708]">
                    ข้อมูลต้นทุน
                  </span>
                </div>
                <h1 className="mt-3 text-[24px] font-semibold leading-8 tracking-normal text-[#101828] sm:text-[28px] sm:leading-9">
                  รายงานสต็อกคงเหลือ
                </h1>
                <p className="mt-2 text-[14px] leading-[22px] text-[#667085]">
                  {tenantName} · คงเหลือ ณ{" "}
                  {formatThaiDate(snapshot.params.date_to)}{" "}
                  · อัปเดต {generatedAt}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 print:hidden">
                {negativeRows.length > 0 && (
                  <a
                    href="#negative-stock-items"
                    className="inline-flex h-10 w-fit items-center justify-center rounded-lg border border-[#FEDF89] bg-[#FFFAEB] px-4 text-[14px] font-semibold leading-[22px] text-[#B54708] shadow-sm transition hover:bg-[#FEF0C7]"
                  >
                    ดูสินค้าติดลบ
                  </a>
                )}
                <a
                  href="#stock-items"
                  className="inline-flex h-10 w-fit items-center justify-center rounded-lg bg-[#2563EB] px-4 text-[14px] font-semibold leading-[22px] text-white shadow-sm transition hover:bg-[#1D4ED8]"
                >
                  ดูรายการสินค้า
                </a>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <PremiumKpi
                label="มูลค่าสต็อกคงเหลือ"
                value={`${formatMoney(snapshot.summary.stock_value)} บาท`}
                emphasis
              />
              <PremiumKpi
                label="จำนวนสินค้า"
                value={`${formatInteger(snapshot.summary.sku_count)} รายการ`}
              />
              <PremiumKpi
                label={inboundLabel}
                value={`${formatMoney(snapshot.summary.amount_in)} บาท`}
              />
              <PremiumKpi
                label={outboundLabel}
                value={`${formatMoney(snapshot.summary.amount_out)} บาท`}
              />
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-7xl space-y-4 px-4 py-4 sm:px-6 lg:space-y-5 lg:py-6">
          <section className="rounded-xl border border-[#E4E7EC] bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[12px] font-medium leading-[18px] text-[#2563EB]">
                  สรุปผู้บริหาร
                </p>
                <h2 className="mt-1 text-[18px] font-semibold leading-7 text-[#101828]">
                  สิ่งที่ควรดู
                </h2>
              </div>
              <span
                className={`rounded-full border px-3 py-1 text-[12px] font-semibold leading-[18px] ${
                  hasWarning
                    ? "border-[#FEDF89] bg-[#FFFAEB] text-[#B54708]"
                    : "border-[#ABEFC6] bg-[#ECFDF3] text-[#027A48]"
                }`}
              >
                {hasWarning ? "มีข้อสังเกต" : "พร้อมใช้"}
              </span>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              <InsightCard
                index={1}
                title="มูลค่าสต็อกคงเหลือ"
                body={`${formatMoney(snapshot.summary.stock_value)} บาท จาก ${formatInteger(
                  snapshot.summary.sku_count,
                )} รายการสินค้า`}
              />
              <InsightCard
                index={2}
                title="สินค้ามูลค่าสูง"
                body={
                  topItem
                    ? `${topItem.ic_name || topItem.ic_code} มูลค่า ${formatMoney(
                        topItem.balance_amount,
                      )} บาท`
                    : "ยังไม่มีข้อมูลในช่วงวันที่นี้"
                }
              />
              <InsightCard
                index={3}
                title="รายการที่ควรตรวจ"
                body={
                  hasWarning
                    ? `${formatInteger(
                        snapshot.summary.negative_stock_count,
                      )} รายการติดลบ · ${formatInteger(
                        snapshot.summary.zero_or_missing_cost_count,
                      )} รายการไม่มีต้นทุนเฉลี่ย`
                    : "ยังไม่พบสินค้าติดลบหรือต้นทุนเฉลี่ยหาย"
                }
              />
            </div>

            {snapshot.summary.zero_or_missing_cost_count > 0 && (
              <p className="mt-4 rounded-lg border border-[#FEDF89] bg-[#FFFAEB] px-3 py-2 text-[14px] leading-[22px] text-[#B54708]">
                พบสินค้าต้นทุนเป็นศูนย์หรือไม่มีต้นทุนเฉลี่ย{" "}
                {formatInteger(snapshot.summary.zero_or_missing_cost_count)} รายการ
                ควรตรวจข้อมูลต้นทุนก่อนใช้มูลค่าสต็อกตัดสินใจ
              </p>
            )}
          </section>

          <AdvancedRangeControls
            dateFrom={dateFrom}
            dateTo={dateTo}
            onApplyPreset={onApplyPreset}
            onDateFromChange={onDateFromChange}
            onDateToChange={onDateToChange}
            onRunRange={onRunRange}
            rangeError={rangeError}
            rangeLoading={rangeLoading}
          />

          <section
            id="stock-items"
            className="rounded-xl border border-[#E4E7EC] bg-white p-3 shadow-sm sm:p-4"
          >
            <div>
              <p className="text-[12px] font-medium leading-[18px] text-[#2563EB]">
                รายการสินค้า
              </p>
              <h2 className="mt-1 text-[18px] font-semibold leading-7 text-[#101828]">
                สินค้ามูลค่าสต็อกสูงสุด
              </h2>
              <p className="mt-1 text-[14px] leading-[22px] text-[#667085]">
                แสดงรายการสำคัญจากรอบเดียวกับข้อความ LINE ไม่ดึงข้อมูลใหม่ตอนเปิดหน้านี้
              </p>
            </div>
            <StockBalanceRowsTable
              emptyText="ยังไม่มีสินค้าที่มีมูลค่าสต็อกในช่วงวันที่นี้"
              inboundLabel={inboundLabel}
              outboundLabel={outboundLabel}
              rows={topRows}
            />
          </section>

          {negativeRows.length > 0 && (
            <section
              id="negative-stock-items"
              className="rounded-xl border border-[#FEDF89] bg-[#FFFAEB] p-3 shadow-sm sm:p-4"
            >
              <div>
                <p className="text-[12px] font-medium leading-[18px] text-[#B54708]">
                  รายการที่ควรตรวจ
                </p>
                <h2 className="mt-1 text-[18px] font-semibold leading-7 text-[#101828]">
                  สินค้าคงเหลือติดลบ
                </h2>
              </div>
              <StockBalanceRowsTable
                emptyText="ไม่พบสินค้าคงเหลือติดลบ"
                inboundLabel={inboundLabel}
                outboundLabel={outboundLabel}
                rows={negativeRows}
              />
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

function StockReorderReportViewer({
  snapshot,
  tenantName,
  generatedAt,
}: {
  snapshot: StockReorderViewerReportSnapshot;
  tenantName: string;
  generatedAt: string;
}) {
  const hasOutOfStock = snapshot.summary.out_of_stock_count > 0;
  const rows = snapshot.top_items.slice(0, 20);
  const topItem = rows[0] ?? null;

  return (
    <main className="min-h-screen bg-[#F6F7F9] text-[#101828]">
      <div className="screen-report-viewer">
        <div className="border-b border-[#E4E7EC] bg-white">
          <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:py-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-[12px] font-medium leading-[18px] text-[#667085]">
                  <span className="rounded-full border border-[#D0D5DD] bg-white px-2.5 py-1 text-[#344054]">
                    รายงานคลังสินค้า
                  </span>
                  <span className="rounded-full border border-[#D0D5DD] bg-[#F9FAFB] px-2.5 py-1 text-[#475467]">
                    {formatSource(snapshot.source)}
                  </span>
                  <span
                    className={`rounded-full border px-2.5 py-1 ${
                      hasOutOfStock
                        ? "border-[#FEDF89] bg-[#FFFAEB] text-[#B54708]"
                        : snapshot.summary.low_stock_count > 0
                          ? "border-[#FEDF89] bg-[#FFFAEB] text-[#B54708]"
                          : "border-[#ABEFC6] bg-[#ECFDF3] text-[#027A48]"
                    }`}
                  >
                    {hasOutOfStock
                      ? "ควรตรวจสั่งซื้อ"
                      : snapshot.summary.low_stock_count > 0
                        ? "มีข้อสังเกต"
                        : "พร้อมใช้"}
                  </span>
                </div>
                <h1 className="mt-3 text-[24px] font-semibold leading-8 tracking-normal text-[#101828] sm:text-[28px] sm:leading-9">
                  รายงานสินค้าถึงจุดสั่งซื้อ
                </h1>
                <p className="mt-2 text-[14px] leading-[22px] text-[#667085]">
                  {tenantName} · ข้อมูลล่าสุดจาก SML ·
                  อัปเดต {generatedAt}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 print:hidden">
                <a
                  href="#reorder-items"
                  className="inline-flex h-10 w-fit items-center justify-center rounded-lg bg-[#2563EB] px-4 text-[14px] font-semibold leading-[22px] text-white shadow-sm transition hover:bg-[#1D4ED8]"
                >
                  ดูรายการสินค้า
                </a>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <PremiumKpi
                label="ถึงจุดสั่งซื้อ"
                value={`${formatInteger(snapshot.summary.reorder_count)} รายการ`}
                emphasis
              />
              <PremiumKpi
                label="ของหมด"
                value={`${formatInteger(snapshot.summary.out_of_stock_count)} รายการ`}
              />
              <PremiumKpi
                label="ใกล้หมด"
                value={`${formatInteger(snapshot.summary.low_stock_count)} รายการ`}
              />
              <PremiumKpi
                label="ค้างรับเข้า"
                value={formatQty(snapshot.summary.purchase_balance_qty_total)}
              />
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-7xl space-y-4 px-4 py-4 sm:px-6 lg:space-y-5 lg:py-6">
          <section className="rounded-xl border border-[#E4E7EC] bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[12px] font-medium leading-[18px] text-[#2563EB]">
                  สรุปผู้บริหาร
                </p>
                <h2 className="mt-1 text-[18px] font-semibold leading-7 text-[#101828]">
                  สิ่งที่ควรดู
                </h2>
              </div>
              <span
                className={`rounded-full border px-3 py-1 text-[12px] font-semibold leading-[18px] ${
                  hasOutOfStock
                    ? "border-[#FEDF89] bg-[#FFFAEB] text-[#B54708]"
                    : "border-[#ABEFC6] bg-[#ECFDF3] text-[#027A48]"
                }`}
              >
                {hasOutOfStock ? "ควรตรวจทันที" : "พร้อมใช้"}
              </span>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              <InsightCard
                index={1}
                title="รายการที่ถึงจุดสั่งซื้อ"
                body={`${formatInteger(snapshot.summary.reorder_count)} รายการ จากข้อมูลล่าสุดใน SML`}
              />
              <InsightCard
                index={2}
                title="ของหมดหรือคงเหลือติดลบ"
                body={
                  hasOutOfStock
                    ? `${formatInteger(snapshot.summary.out_of_stock_count)} รายการควรตรวจสั่งซื้อก่อน`
                    : "ยังไม่พบรายการที่คงเหลือ 0 หรือติดลบ"
                }
              />
              <InsightCard
                index={3}
                title="รายการแรกที่ควรดู"
                body={
                  topItem
                    ? `${topItem.ic_name || topItem.ic_code} ขาดอีก ${formatQty(
                        topItem.shortage_qty,
                      )} ${topItem.ic_unit_code || ""}`
                    : "ยังไม่มีสินค้าต่ำกว่าจุดสั่งซื้อ"
                }
              />
            </div>
          </section>

          <section
            id="reorder-items"
            className="rounded-xl border border-[#E4E7EC] bg-white p-3 shadow-sm sm:p-4"
          >
            <div>
              <p className="text-[12px] font-medium leading-[18px] text-[#2563EB]">
                รายการสินค้า
              </p>
              <h2 className="mt-1 text-[18px] font-semibold leading-7 text-[#101828]">
                สินค้าที่ต่ำกว่าจุดสั่งซื้อ
              </h2>
              <p className="mt-1 text-[14px] leading-[22px] text-[#667085]">
                เรียงของหมดก่อน แล้วตามด้วยจำนวนที่ขาดมากไปน้อย โดยใช้ข้อมูลรอบเดียวกับข้อความ LINE
              </p>
            </div>
            <StockReorderRowsTable rows={rows} />
          </section>
        </div>
      </div>
    </main>
  );
}

function ArCustomerMovementReportViewer({
  snapshot,
  tenantName,
  generatedAt,
}: {
  snapshot: ArCustomerMovementViewerReportSnapshot;
  tenantName: string;
  generatedAt: string;
}) {
  const topCustomers = snapshot.top_customers.slice(0, 10);
  const topDocuments = snapshot.top_documents.slice(0, 20);
  const topCustomer = topCustomers[0] ?? null;
  const arSettlementAmount =
    snapshot.summary.ar_decrease_amount + snapshot.summary.receipt_amount;
  const hasMovement = snapshot.summary.document_count > 0;
  const hasNetIncrease = snapshot.summary.net_movement_amount > 0;

  return (
    <main className="min-h-screen bg-[#F6F7F9] text-[#101828]">
      <div className="screen-report-viewer">
        <div className="border-b border-[#E4E7EC] bg-white">
          <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:py-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-[12px] font-medium leading-[18px] text-[#667085]">
                  <span className="rounded-full border border-[#D0D5DD] bg-white px-2.5 py-1 text-[#344054]">
                    รายงานลูกหนี้
                  </span>
                  <span className="rounded-full border border-[#D0D5DD] bg-[#F9FAFB] px-2.5 py-1 text-[#475467]">
                    {formatSource(snapshot.source)}
                  </span>
                  <span
                    className={`rounded-full border px-2.5 py-1 ${
                      hasNetIncrease
                        ? "border-[#FEDF89] bg-[#FFFAEB] text-[#B54708]"
                        : "border-[#ABEFC6] bg-[#ECFDF3] text-[#027A48]"
                    }`}
                  >
                    {hasNetIncrease ? "มีข้อสังเกต" : "พร้อมใช้"}
                  </span>
                  <span className="rounded-full border border-[#FEDF89] bg-[#FFFAEB] px-2.5 py-1 text-[#B54708]">
                    ข้อมูลลูกหนี้
                  </span>
                </div>
                <h1 className="mt-3 text-[24px] font-semibold leading-8 tracking-normal text-[#101828] sm:text-[28px] sm:leading-9">
                  รายงานเคลื่อนไหวลูกหนี้
                </h1>
                <p className="mt-2 text-[14px] leading-[22px] text-[#667085]">
                  {tenantName} · ข้อมูลถึงวันที่{" "}
                  {formatThaiDate(snapshot.params.date_to)} จาก SML · อัปเดต{" "}
                  {generatedAt}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 print:hidden">
                <a
                  href="#ar-customers"
                  className="inline-flex h-10 w-fit items-center justify-center rounded-lg bg-[#2563EB] px-4 text-[14px] font-semibold leading-[22px] text-white shadow-sm transition hover:bg-[#1D4ED8]"
                >
                  ดูลูกหนี้สำคัญ
                </a>
                <a
                  href="#ar-documents"
                  className="inline-flex h-10 w-fit items-center justify-center rounded-lg border border-[#D0D5DD] bg-white px-4 text-[14px] font-semibold leading-[22px] text-[#344054] shadow-sm transition hover:bg-[#F9FAFB]"
                >
                  ดูเอกสารสำคัญ
                </a>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <PremiumKpi
                label="ยอดเคลื่อนไหวสุทธิ"
                value={`${formatMoney(snapshot.summary.net_movement_amount)} บาท`}
                emphasis
              />
              <PremiumKpi
                label="ลูกหนี้"
                value={`${formatInteger(snapshot.summary.customer_count)} ราย`}
              />
              <PremiumKpi
                label="เอกสาร"
                value={`${formatInteger(snapshot.summary.document_count)} ใบ`}
              />
              <PremiumKpi
                label="รับชำระ/ลดหนี้"
                value={`${formatMoney(arSettlementAmount)} บาท`}
              />
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-7xl space-y-4 px-4 py-4 sm:px-6 lg:space-y-5 lg:py-6">
          <section className="rounded-xl border border-[#E4E7EC] bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[12px] font-medium leading-[18px] text-[#2563EB]">
                  สรุปผู้บริหาร
                </p>
                <h2 className="mt-1 text-[18px] font-semibold leading-7 text-[#101828]">
                  สิ่งที่ควรดู
                </h2>
              </div>
              <span
                className={`rounded-full border px-3 py-1 text-[12px] font-semibold leading-[18px] ${
                  hasNetIncrease
                    ? "border-[#FEDF89] bg-[#FFFAEB] text-[#B54708]"
                    : "border-[#ABEFC6] bg-[#ECFDF3] text-[#027A48]"
                }`}
              >
                {hasNetIncrease ? "มีข้อสังเกต" : "พร้อมใช้"}
              </span>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              <InsightCard
                index={1}
                title="ข้อมูลถึงวันที่"
                body={`รวมเอกสารเคลื่อนไหวลูกหนี้ถึงวันที่ ${formatThaiDate(
                  snapshot.params.date_to,
                )} จาก SML`}
              />
              <InsightCard
                index={2}
                title="ใช้ดูการเคลื่อนไหว"
                body="รายงานนี้ใช้ดูการเคลื่อนไหวสะสมถึงวันที่ ไม่ใช่รายงานอายุหนี้หรือยอดคงค้าง และไม่ตัดตามเวลาแจ้งเตือน"
              />
              <InsightCard
                index={3}
                title="ลูกหนี้มูลค่าสูง"
                body={
                  topCustomer
                    ? `${topCustomer.cust_name || topCustomer.cust_code} สุทธิ ${formatMoney(
                        topCustomer.net_movement_amount,
                      )} บาท`
                    : "ยังไม่มีเอกสารเคลื่อนไหวลูกหนี้ถึงวันที่นี้"
                }
              />
            </div>

            {!hasMovement && (
              <p className="mt-4 rounded-lg border border-[#D0D5DD] bg-[#F9FAFB] px-3 py-2 text-[14px] leading-[22px] text-[#475467]">
                ยังไม่พบเอกสารเคลื่อนไหวลูกหนี้ในข้อมูลถึงวันที่นี้
              </p>
            )}
          </section>

          <section
            id="ar-customers"
            className="rounded-xl border border-[#E4E7EC] bg-white p-3 shadow-sm sm:p-4"
          >
            <div>
              <p className="text-[12px] font-medium leading-[18px] text-[#2563EB]">
                ลูกหนี้สำคัญ
              </p>
              <h2 className="mt-1 text-[18px] font-semibold leading-7 text-[#101828]">
                ลูกหนี้ที่มียอดเคลื่อนไหวสูงสุด
              </h2>
              <p className="mt-1 text-[14px] leading-[22px] text-[#667085]">
                แสดงรายการสรุปจากรอบเดียวกับข้อความ LINE ไม่ดึงข้อมูลใหม่ตอนเปิดหน้านี้
              </p>
            </div>
            <ArCustomerRowsTable rows={topCustomers} />
          </section>

          <section
            id="ar-documents"
            className="rounded-xl border border-[#E4E7EC] bg-white p-3 shadow-sm sm:p-4"
          >
            <div>
              <p className="text-[12px] font-medium leading-[18px] text-[#2563EB]">
                เอกสารสำคัญ
              </p>
              <h2 className="mt-1 text-[18px] font-semibold leading-7 text-[#101828]">
                เอกสารมูลค่าสูงสุด
              </h2>
              <p className="mt-1 text-[14px] leading-[22px] text-[#667085]">
                ใช้ดูเอกสารที่ควรตรวจต่อก่อนตัดสินใจ ไม่ใช่ตารางรายการทั้งหมด
              </p>
            </div>
            <ArCustomerDocumentRowsTable rows={topDocuments} />
          </section>
        </div>
      </div>
    </main>
  );
}

function ArCustomerRowsTable({
  rows,
}: {
  rows: ArCustomerMovementCustomerSummary[];
}) {
  if (!rows.length) {
    return (
      <div className="mt-4 rounded-lg border border-[#E4E7EC] bg-[#F9FAFB] px-4 py-8 text-center text-[14px] leading-[22px] text-[#667085]">
        ยังไม่มีลูกหนี้ที่มีเอกสารเคลื่อนไหวถึงวันที่นี้
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-[#E4E7EC]">
      <div className="hidden bg-[#F9FAFB] px-3 py-2 text-[12px] font-semibold leading-[18px] text-[#667085] md:grid md:grid-cols-[minmax(0,1fr)_90px_130px_130px_130px] md:gap-3">
        <span>ลูกหนี้</span>
        <span className="text-right">เอกสาร</span>
        <span className="text-right">เพิ่มลูกหนี้</span>
        <span className="text-right">ลด/รับชำระ</span>
        <span className="text-right">สุทธิ</span>
      </div>
      <div className="divide-y divide-[#EAECF0] bg-white">
        {rows.map((row) => {
          const settlementAmount = row.ar_decrease_amount + row.receipt_amount;
          return (
            <div
              key={row.cust_code || row.cust_name}
              className="grid gap-3 px-3 py-3 text-[14px] leading-[22px] md:grid-cols-[minmax(0,1fr)_90px_130px_130px_130px] md:items-center"
            >
              <div className="min-w-0">
                <p className="break-words font-semibold text-[#101828]">
                  {row.cust_name || "ไม่ระบุชื่อลูกหนี้"}
                </p>
                <p className="mt-0.5 break-all text-[12px] leading-[18px] text-[#667085]">
                  รหัส {row.cust_code || "-"}
                </p>
              </div>
              <MobileFact
                label="เอกสาร"
                value={`${formatInteger(row.document_count)} ใบ`}
              />
              <MobileFact
                label="เพิ่มลูกหนี้"
                value={`${formatMoney(row.ar_increase_amount)} บาท`}
              />
              <MobileFact
                label="ลด/รับชำระ"
                value={`${formatMoney(settlementAmount)} บาท`}
              />
              <MobileFact
                danger={row.net_movement_amount > 0}
                label="สุทธิ"
                value={`${formatSignedMoney(row.net_movement_amount)} บาท`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ArCustomerDocumentRowsTable({
  rows,
}: {
  rows: ArCustomerMovementRow[];
}) {
  if (!rows.length) {
    return (
      <div className="mt-4 rounded-lg border border-[#E4E7EC] bg-[#F9FAFB] px-4 py-8 text-center text-[14px] leading-[22px] text-[#667085]">
        ยังไม่มีเอกสารเคลื่อนไหวลูกหนี้ถึงวันที่นี้
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-[#E4E7EC]">
      <div className="hidden bg-[#F9FAFB] px-3 py-2 text-[12px] font-semibold leading-[18px] text-[#667085] md:grid md:grid-cols-[110px_minmax(0,1fr)_minmax(0,1fr)_120px_130px] md:gap-3">
        <span>วันที่</span>
        <span>ลูกหนี้</span>
        <span>เอกสาร</span>
        <span>ประเภท</span>
        <span className="text-right">ยอดเงิน</span>
      </div>
      <div className="divide-y divide-[#EAECF0] bg-white">
        {rows.map((row, index) => (
          <div
            key={`${row.doc_no}-${row.doc_date}-${index}`}
            className="grid gap-3 px-3 py-3 text-[14px] leading-[22px] md:grid-cols-[110px_minmax(0,1fr)_minmax(0,1fr)_120px_130px] md:items-center"
          >
            <MobileFact label="วันที่" value={formatThaiDate(row.doc_date)} />
            <div className="min-w-0">
              <p className="break-words font-semibold text-[#101828]">
                {row.cust_name || "ไม่ระบุชื่อลูกหนี้"}
              </p>
              <p className="mt-0.5 break-all text-[12px] leading-[18px] text-[#667085]">
                รหัส {row.cust_code || "-"}
              </p>
            </div>
            <div className="min-w-0">
              <p className="break-all font-semibold text-[#101828]">
                {row.doc_no || "-"}
              </p>
              <p className="mt-0.5 break-all text-[12px] leading-[18px] text-[#667085]">
                {row.tax_doc_no || row.doc_ref || "ไม่มีเลขอ้างอิง"}
              </p>
            </div>
            <MobileFact
              label="ประเภท"
              value={formatArMovementType(row.movement_type)}
            />
            <MobileFact
              danger={row.movement_type === "ar_increase"}
              label="ยอดเงิน"
              value={`${formatMoney(row.amount)} บาท`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function ArDebtReceiptReportViewer({
  snapshot,
  tenantName,
  generatedAt,
}: {
  snapshot: ArDebtReceiptViewerReportSnapshot;
  tenantName: string;
  generatedAt: string;
}) {
  const topCustomers = snapshot.top_customers.slice(0, 10);
  const topReceipts = snapshot.top_receipts.slice(0, 20);
  const topCustomer = topCustomers[0] ?? null;
  const hasWarning = snapshot.summary.unmatched_payment_count > 0;

  return (
    <main className="min-h-screen bg-[#F6F7F9] text-[#101828]">
      <div className="screen-report-viewer">
        <div className="border-b border-[#E4E7EC] bg-white">
          <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:py-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-[12px] font-medium leading-[18px] text-[#667085]">
                  <span className="rounded-full border border-[#D0D5DD] bg-white px-2.5 py-1 text-[#344054]">
                    รายงานลูกหนี้
                  </span>
                  <span className="rounded-full border border-[#D0D5DD] bg-[#F9FAFB] px-2.5 py-1 text-[#475467]">
                    {formatSource(snapshot.source)}
                  </span>
                  <span
                    className={`rounded-full border px-2.5 py-1 ${
                      hasWarning
                        ? "border-[#FEDF89] bg-[#FFFAEB] text-[#B54708]"
                        : "border-[#ABEFC6] bg-[#ECFDF3] text-[#027A48]"
                    }`}
                  >
                    {hasWarning ? "ควรตรวจยอด" : "พร้อมใช้"}
                  </span>
                  <span className="rounded-full border border-[#FEDF89] bg-[#FFFAEB] px-2.5 py-1 text-[#B54708]">
                    ข้อมูลลูกหนี้
                  </span>
                </div>
                <h1 className="mt-3 text-[24px] font-semibold leading-8 tracking-normal text-[#101828] sm:text-[28px] sm:leading-9">
                  รายงานรับชำระหนี้
                </h1>
                <p className="mt-2 text-[14px] leading-[22px] text-[#667085]">
                  {tenantName} · วันที่รับชำระ{" "}
                  {formatReportPeriod(
                    snapshot.params.date_from,
                    snapshot.params.date_to,
                  )}{" "}
                  จาก SML · อัปเดต {generatedAt}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 print:hidden">
                <a
                  href="#ar-debt-receipts"
                  className="inline-flex h-10 w-fit items-center justify-center rounded-lg bg-[#2563EB] px-4 text-[14px] font-semibold leading-[22px] text-white shadow-sm transition hover:bg-[#1D4ED8]"
                >
                  ดูเอกสารรับชำระ
                </a>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <PremiumKpi
                label="ยอดรับชำระรวม"
                value={`${formatMoney(snapshot.summary.total_received_amount)} บาท`}
                emphasis
              />
              <PremiumKpi
                label="ลูกหนี้"
                value={`${formatInteger(snapshot.summary.customer_count)} ราย`}
              />
              <PremiumKpi
                label="เอกสาร"
                value={`${formatInteger(snapshot.summary.receipt_count)} ใบ`}
              />
              <PremiumKpi
                label="เงินสด/โอน"
                value={`${formatMoney(snapshot.summary.cash_amount)} / ${formatMoney(
                  snapshot.summary.transfer_amount,
                )} บาท`}
              />
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-7xl space-y-4 px-4 py-4 sm:px-6 lg:space-y-5 lg:py-6">
          <section className="rounded-xl border border-[#E4E7EC] bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[12px] font-medium leading-[18px] text-[#2563EB]">
                  สรุปผู้บริหาร
                </p>
                <h2 className="mt-1 text-[18px] font-semibold leading-7 text-[#101828]">
                  สิ่งที่ควรดู
                </h2>
              </div>
              <span
                className={`rounded-full border px-3 py-1 text-[12px] font-semibold leading-[18px] ${
                  hasWarning
                    ? "border-[#FEDF89] bg-[#FFFAEB] text-[#B54708]"
                    : "border-[#ABEFC6] bg-[#ECFDF3] text-[#027A48]"
                }`}
              >
                {hasWarning ? "มีข้อสังเกต" : "พร้อมใช้"}
              </span>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              <InsightCard
                index={1}
                title="ยอดรับชำระรวม"
                body={`${formatMoney(
                  snapshot.summary.total_received_amount,
                )} บาท จาก ${formatInteger(snapshot.summary.receipt_count)} เอกสาร`}
              />
              <InsightCard
                index={2}
                title="อิงวันที่รับชำระ"
                body="รายงานนี้อิงวันที่เอกสารรับชำระ ไม่ตัดตามเวลาแจ้งเตือน"
              />
              <InsightCard
                index={3}
                title="ลูกหนี้รับชำระสูงสุด"
                body={
                  topCustomer
                    ? `${topCustomer.cust_name || topCustomer.cust_code} ${formatMoney(
                        topCustomer.total_received_amount,
                      )} บาท`
                    : "ยังไม่มีเอกสารรับชำระหนี้ในช่วงวันที่นี้"
                }
              />
            </div>

            {snapshot.data_quality_notes.length > 0 && (
              <div className="mt-4 space-y-2">
                {snapshot.data_quality_notes.map((note) => (
                  <p
                    className="rounded-lg border border-[#FEDF89] bg-[#FFFAEB] px-3 py-2 text-[14px] leading-[22px] text-[#B54708]"
                    key={note}
                  >
                    {note}
                  </p>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-[#E4E7EC] bg-white p-3 shadow-sm sm:p-4">
            <div>
              <p className="text-[12px] font-medium leading-[18px] text-[#2563EB]">
                ลูกหนี้สำคัญ
              </p>
              <h2 className="mt-1 text-[18px] font-semibold leading-7 text-[#101828]">
                ลูกหนี้ที่รับชำระสูงสุด
              </h2>
              <p className="mt-1 text-[14px] leading-[22px] text-[#667085]">
                แสดงรายการสรุปจากรอบเดียวกับข้อความ LINE ไม่ดึงข้อมูลใหม่ตอนเปิดหน้านี้
              </p>
            </div>
            <ArDebtReceiptCustomerRowsTable rows={topCustomers} />
          </section>

          <section
            id="ar-debt-receipts"
            className="rounded-xl border border-[#E4E7EC] bg-white p-3 shadow-sm sm:p-4"
          >
            <div>
              <p className="text-[12px] font-medium leading-[18px] text-[#2563EB]">
                เอกสารรับชำระ
              </p>
              <h2 className="mt-1 text-[18px] font-semibold leading-7 text-[#101828]">
                เอกสารรับชำระมูลค่าสูงสุด
              </h2>
              <p className="mt-1 text-[14px] leading-[22px] text-[#667085]">
                ใช้ตรวจเอกสารรับชำระสำคัญและช่องทางรับเงินก่อนปิดยอด
              </p>
            </div>
            <ArDebtReceiptRowsTable rows={topReceipts} />
          </section>
        </div>
      </div>
    </main>
  );
}

function ArDebtReceiptCustomerRowsTable({
  rows,
}: {
  rows: ArDebtReceiptCustomerSummary[];
}) {
  if (!rows.length) {
    return (
      <div className="mt-4 rounded-lg border border-[#E4E7EC] bg-[#F9FAFB] px-4 py-8 text-center text-[14px] leading-[22px] text-[#667085]">
        ยังไม่มีลูกหนี้ที่มีเอกสารรับชำระในช่วงวันที่นี้
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-[#E4E7EC]">
      <div className="hidden bg-[#F9FAFB] px-3 py-2 text-[12px] font-semibold leading-[18px] text-[#667085] md:grid md:grid-cols-[minmax(0,1fr)_90px_120px_120px_130px_100px] md:gap-3">
        <span>ลูกหนี้</span>
        <span className="text-right">เอกสาร</span>
        <span className="text-right">เงินสด</span>
        <span className="text-right">โอน</span>
        <span className="text-right">รวม</span>
        <span className="text-right">ควรตรวจ</span>
      </div>
      <div className="divide-y divide-[#EAECF0] bg-white">
        {rows.map((row) => (
          <div
            key={row.cust_code || row.cust_name}
            className="grid gap-3 px-3 py-3 text-[14px] leading-[22px] md:grid-cols-[minmax(0,1fr)_90px_120px_120px_130px_100px] md:items-center"
          >
            <div className="min-w-0">
              <p className="break-words font-semibold text-[#101828]">
                {row.cust_name || "ไม่ระบุชื่อลูกหนี้"}
              </p>
              <p className="mt-0.5 break-all text-[12px] leading-[18px] text-[#667085]">
                รหัส {row.cust_code || "-"}
              </p>
            </div>
            <MobileFact
              label="เอกสาร"
              value={`${formatInteger(row.receipt_count)} ใบ`}
            />
            <MobileFact
              label="เงินสด"
              value={`${formatMoney(row.cash_amount)} บาท`}
            />
            <MobileFact
              label="โอน"
              value={`${formatMoney(row.transfer_amount)} บาท`}
            />
            <MobileFact
              label="รวม"
              value={`${formatMoney(row.total_received_amount)} บาท`}
            />
            <MobileFact
              danger={row.unmatched_payment_count > 0}
              label="ควรตรวจ"
              value={`${formatInteger(row.unmatched_payment_count)} ใบ`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function ArDebtReceiptRowsTable({ rows }: { rows: ArDebtReceiptRow[] }) {
  if (!rows.length) {
    return (
      <div className="mt-4 rounded-lg border border-[#E4E7EC] bg-[#F9FAFB] px-4 py-8 text-center text-[14px] leading-[22px] text-[#667085]">
        ยังไม่มีเอกสารรับชำระหนี้ในช่วงวันที่นี้
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-[#E4E7EC]">
      <div className="hidden bg-[#F9FAFB] px-3 py-2 text-[12px] font-semibold leading-[18px] text-[#667085] md:grid md:grid-cols-[110px_minmax(0,1fr)_minmax(0,1fr)_150px_130px_130px] md:gap-3">
        <span>วันที่รับชำระ</span>
        <span>ลูกหนี้</span>
        <span>เอกสาร</span>
        <span>เงินสด/โอน</span>
        <span className="text-right">ยอดรับชำระ</span>
        <span className="text-right">สถานะ</span>
      </div>
      <div className="divide-y divide-[#EAECF0] bg-white">
        {rows.map((row, index) => (
          <div
            key={`${row.doc_no}-${row.doc_date}-${index}`}
            className="grid gap-3 px-3 py-3 text-[14px] leading-[22px] md:grid-cols-[110px_minmax(0,1fr)_minmax(0,1fr)_150px_130px_130px] md:items-center"
          >
            <MobileFact
              label="วันที่รับชำระ"
              value={formatThaiDate(row.doc_date)}
            />
            <div className="min-w-0">
              <p className="break-words font-semibold text-[#101828]">
                {row.cust_name || "ไม่ระบุชื่อลูกหนี้"}
              </p>
              <p className="mt-0.5 break-all text-[12px] leading-[18px] text-[#667085]">
                รหัส {row.cust_code || "-"}
              </p>
            </div>
            <div className="min-w-0">
              <p className="break-all font-semibold text-[#101828]">
                {row.doc_no || "-"}
              </p>
              <p className="mt-0.5 break-words text-[12px] leading-[18px] text-[#667085]">
                วันที่วางบิล{" "}
                {row.billing_date ? formatThaiDate(row.billing_date) : "-"}
              </p>
            </div>
            <MobileFact
              label="เงินสด/โอน"
              value={`${formatMoney(row.cash_amount)} / ${formatMoney(
                row.transfer_amount,
              )} บาท`}
            />
            <MobileFact
              label="ยอดรับชำระ"
              value={`${formatMoney(row.total_received_amount)} บาท`}
            />
            <MobileFact
              danger={row.payment_status !== "matched"}
              label="สถานะ"
              value={formatArDebtReceiptStatus(row)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function StockReorderRowsTable({ rows }: { rows: StockReorderRow[] }) {
  if (!rows.length) {
    return (
      <div className="mt-4 rounded-lg border border-[#E4E7EC] bg-[#F9FAFB] px-4 py-8 text-center text-[14px] leading-[22px] text-[#667085]">
        ยังไม่พบสินค้าต่ำกว่าจุดสั่งซื้อจากข้อมูลล่าสุด
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-[#E4E7EC]">
      <div className="hidden bg-[#F9FAFB] px-3 py-2 text-[12px] font-semibold leading-[18px] text-[#667085] md:grid md:grid-cols-[minmax(0,1fr)_110px_110px_110px_110px] md:gap-3">
        <span>สินค้า</span>
        <span className="text-right">คงเหลือ</span>
        <span className="text-right">จุดสั่งซื้อ</span>
        <span className="text-right">ขาดอีก</span>
        <span className="text-right">ค้างรับเข้า</span>
      </div>
      <div className="divide-y divide-[#EAECF0] bg-white">
        {rows.map((row) => (
          <div
            key={row.ic_code}
            className="grid gap-3 px-3 py-3 text-[14px] leading-[22px] md:grid-cols-[minmax(0,1fr)_110px_110px_110px_110px] md:items-center"
          >
            <div className="min-w-0">
              <p className="break-words font-semibold text-[#101828]">
                {row.ic_name || "ไม่ระบุชื่อสินค้า"}
              </p>
              <p className="mt-0.5 break-all text-[12px] leading-[18px] text-[#667085]">
                SKU {row.ic_code || "-"} · {row.ic_unit_code || "-"}
              </p>
            </div>
            <MobileFact
              danger={row.status === "out_of_stock"}
              label="คงเหลือ"
              value={`${formatQty(row.balance_qty)} ${row.ic_unit_code || ""}`}
            />
            <MobileFact
              label="จุดสั่งซื้อ"
              value={`${formatQty(row.purchase_point)} ${row.ic_unit_code || ""}`}
            />
            <MobileFact
              danger={row.shortage_qty > 0}
              label="ขาดอีก"
              value={`${formatQty(row.shortage_qty)} ${row.ic_unit_code || ""}`}
            />
            <MobileFact
              label="ค้างรับเข้า"
              value={`${formatQty(row.purchase_balance_qty)} ${row.ic_unit_code || ""}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function StockBalanceRowsTable({
  rows,
  emptyText,
  inboundLabel,
  outboundLabel,
}: {
  rows: StockBalanceRow[];
  emptyText: string;
  inboundLabel: string;
  outboundLabel: string;
}) {
  if (!rows.length) {
    return (
      <div className="mt-4 rounded-lg border border-[#E4E7EC] bg-[#F9FAFB] px-4 py-8 text-center text-[14px] leading-[22px] text-[#667085]">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-[#E4E7EC]">
      <div className="hidden bg-[#F9FAFB] px-3 py-2 text-[12px] font-semibold leading-[18px] text-[#667085] md:grid md:grid-cols-[minmax(0,1fr)_110px_130px_120px_120px_120px] md:gap-3">
        <span>สินค้า</span>
        <span className="text-right">คงเหลือ</span>
        <span className="text-right">มูลค่าสต็อก</span>
        <span className="text-right">ต้นทุนเฉลี่ย</span>
        <span className="text-right">{inboundLabel}</span>
        <span className="text-right">{outboundLabel}</span>
      </div>
      <div className="divide-y divide-[#EAECF0] bg-white">
        {rows.map((row) => (
          <div
            key={row.ic_code}
            className="grid gap-3 px-3 py-3 text-[14px] leading-[22px] md:grid-cols-[minmax(0,1fr)_110px_130px_120px_120px_120px] md:items-center"
          >
            <div className="min-w-0">
              <p className="break-words font-semibold text-[#101828]">
                {row.ic_name || "ไม่ระบุชื่อสินค้า"}
              </p>
              <p className="mt-0.5 break-all text-[12px] leading-[18px] text-[#667085]">
                SKU {row.ic_code || "-"} · {row.ic_unit_code || "-"}
              </p>
            </div>
            <MobileFact
              danger={row.balance_qty < 0}
              label="คงเหลือ"
              value={`${formatQty(row.balance_qty)} ${row.ic_unit_code || ""}`}
            />
            <MobileFact
              danger={row.balance_amount < 0}
              label="มูลค่าสต็อก"
              value={`${formatMoney(row.balance_amount)} บาท`}
            />
            <MobileFact
              label="ต้นทุนเฉลี่ย"
              value={`${formatMoney(row.average_cost_end || row.average_cost)} บาท`}
            />
            <MobileFact
              label={inboundLabel}
              value={`${formatQty(row.qty_in)} / ${formatMoney(row.amount_in)} บาท`}
            />
            <MobileFact
              label={outboundLabel}
              value={`${formatQty(row.qty_out)} / ${formatMoney(row.amount_out)} บาท`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function GrossProfitRowsTable({
  snapshot,
  rows,
  emptyText,
}: {
  snapshot: GrossProfitViewerReportSnapshot;
  rows: Array<GrossProfitBaseRow | GrossProfitByProductRow | GrossProfitByArCustomerRow>;
  emptyText: string;
}) {
  if (!rows.length) {
    return (
      <div className="mt-4 rounded-lg border border-[#E4E7EC] bg-[#F9FAFB] px-4 py-8 text-center text-[14px] leading-[22px] text-[#667085]">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-[#E4E7EC]">
      <div className="hidden bg-[#F9FAFB] px-3 py-2 text-[12px] font-semibold leading-[18px] text-[#667085] md:grid md:grid-cols-[minmax(0,1fr)_130px_130px_130px_90px] md:gap-3">
        <span>{snapshot.report_key === "gross_profit_by_product" ? "สินค้า" : "ลูกหนี้"}</span>
        <span className="text-right">ยอดขายสุทธิ</span>
        <span className="text-right">ต้นทุนสุทธิ</span>
        <span className="text-right">กำไรขั้นต้น</span>
        <span className="text-right">Margin</span>
      </div>
      <div className="divide-y divide-[#EAECF0] bg-white">
        {rows.map((row, index) => (
          <div
            key={`${getGrossProfitRowCode(snapshot, row)}-${index}`}
            className="grid gap-3 px-3 py-3 text-[14px] leading-[22px] md:grid-cols-[minmax(0,1fr)_130px_130px_130px_90px] md:items-center"
          >
            <div className="min-w-0">
              <p className="break-words font-semibold text-[#101828]">
                {getGrossProfitRowLabel(snapshot, row)}
              </p>
              <p className="mt-0.5 break-all text-[12px] leading-[18px] text-[#667085]">
                {getGrossProfitRowCode(snapshot, row)}
              </p>
            </div>
            <MobileFact label="ยอดขายสุทธิ" value={`${formatMoney(row.net_amount)} บาท`} />
            <MobileFact label="ต้นทุนสุทธิ" value={`${formatMoney(row.net_cost)} บาท`} />
            <MobileFact
              danger={row.gross_profit < 0}
              label="กำไรขั้นต้น"
              value={`${formatMoney(row.gross_profit)} บาท`}
            />
            <MobileFact label="Margin" value={formatMargin(row.gross_margin_percent)} />
          </div>
        ))}
      </div>
    </div>
  );
}

function MobileFact({
  label,
  value,
  danger,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 md:block md:text-right">
      <span className="text-[12px] font-medium leading-[18px] text-[#667085] md:hidden">
        {label}
      </span>
      <span
        className={`break-words font-semibold ${
          danger ? "text-[#B42318]" : "text-[#101828]"
        }`}
      >
        {value}
      </span>
    </div>
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
  snapshot: ClassicViewerReportSnapshot;
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
    <section className="rounded-xl border border-[#E4E7EC] bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-medium leading-[18px] text-[#2563EB]">
            สรุปผู้บริหาร
          </p>
          <h2 className="mt-1 text-[18px] font-semibold leading-7 text-[#101828]">
            สิ่งที่ควรดู
          </h2>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-[12px] font-semibold leading-[18px] ${
            hasWarning
              ? "border-[#FEDF89] bg-[#FFFAEB] text-[#B54708]"
              : "border-[#ABEFC6] bg-[#ECFDF3] text-[#027A48]"
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
    <section className="rounded-xl border border-[#E4E7EC] bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold leading-7 text-[#101828]">
            {title}
          </h2>
          <p className="mt-1 text-[14px] leading-[22px] text-[#667085]">
            {caption}
          </p>
        </div>
        <span className="rounded-full border border-[#E4E7EC] bg-[#F9FAFB] px-3 py-1 text-[12px] font-semibold leading-[18px] text-[#475467]">
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
        <div className="mt-4 rounded-lg border border-[#E4E7EC] bg-[#F9FAFB] px-4 py-8 text-center text-[14px] leading-[22px] text-[#667085]">
          ไม่มีข้อมูลเพียงพอสำหรับกราฟในช่วงวันที่นี้
        </div>
      )}
    </section>
  );
}

function ComparisonPanel({ snapshot }: { snapshot: ClassicViewerReportSnapshot }) {
  const total = getSnapshotTotal(snapshot);
  const dayCount = getInclusiveDayCount(
    snapshot.params.date_from,
    snapshot.params.date_to,
  );
  const averagePerDay = dayCount > 0 ? total / dayCount : total;
  const averagePerDocument =
    snapshot.summary.document_count > 0
      ? total / snapshot.summary.document_count
      : null;
  const comparison =
    snapshot.report_key === "sales_goods_services" ? snapshot.comparison : null;
  const previousDay = comparison?.previous_day ?? null;
  const sameWeekdayLastWeek = comparison?.same_weekday_last_week ?? null;
  return (
    <section className="rounded-xl border border-[#E4E7EC] bg-white p-4 shadow-sm">
      <h2 className="text-[18px] font-semibold leading-7 text-[#101828]">
        แนวโน้มและค่าเฉลี่ย
      </h2>
      <p className="mt-1 text-[14px] leading-[22px] text-[#667085]">
        ใช้ช่วยอ่านภาพรวมเร็ว ๆ ก่อนลงรายละเอียดเอกสาร
      </p>
      <div className="mt-3 space-y-2">
        <ComparisonRow
          title="เฉลี่ยต่อวัน"
          value={`${formatMoney(averagePerDay)} บาท`}
        />
        <ComparisonRow
          title="เฉลี่ยต่อเอกสาร"
          value={
            averagePerDocument === null
              ? "ยังไม่มีเอกสาร"
              : `${formatMoney(averagePerDocument)} บาท`
          }
        />
        <ComparisonRow
          title="ช่วงก่อนหน้า"
          value={previousDay ? formatComparisonPoint(previousDay) : "ยังไม่มีข้อมูลอ้างอิง"}
        />
        <ComparisonRow
          title="วันเดียวกันสัปดาห์ก่อน"
          value={
            sameWeekdayLastWeek
              ? formatComparisonPoint(sameWeekdayLastWeek)
              : snapshot.report_key === "sales_goods_services"
                ? "ยังไม่มีข้อมูลอ้างอิง"
                : "จะเปิดเมื่อเริ่มเก็บ baseline รายงานซื้อ"
          }
        />
      </div>
      <p className="mt-3 rounded-lg border border-[#E4E7EC] bg-[#F9FAFB] px-3 py-2 text-[12px] leading-[18px] text-[#667085]">
        เทียบช่วงเดียวกันปีก่อนจะเปิดหลังมีข้อมูลย้อนหลังครบพอสำหรับแต่ละร้าน
      </p>
    </section>
  );
}

function TrustPanel({ snapshot }: { snapshot: ClassicViewerReportSnapshot }) {
  const hasWarning = Math.abs(snapshot.reconciliation.difference_amount) > 0.01;
  return (
    <section className="rounded-xl border border-[#E4E7EC] bg-white p-4 shadow-sm">
      <h2 className="text-[18px] font-semibold leading-7 text-[#101828]">
        ความน่าเชื่อถือข้อมูล
      </h2>
      <div className="mt-3 space-y-3 text-[14px] leading-[22px] text-[#475467]">
        <p>
          ระบบใช้ยอดหัวเอกสารจาก SML เป็นตัวเลขหลัก และใช้รายละเอียดสินค้าเพื่ออธิบายที่มา
        </p>
        {hasWarning && (
          <p className="rounded-lg border border-[#FEDF89] bg-[#FFFAEB] px-3 py-2 text-[#B54708]">
            ยอดหัวเอกสารและยอดรายละเอียดต่างกัน{" "}
            {formatMoney(snapshot.reconciliation.difference_amount)} บาท
          </p>
        )}
        <details className="rounded-lg border border-[#E4E7EC] bg-[#F9FAFB]">
          <summary className="cursor-pointer px-3 py-2 font-semibold text-[#344054]">
            ที่มาของตัวเลข
          </summary>
          <dl className="grid gap-2 border-t border-[#E4E7EC] px-3 py-3 text-[12px] leading-[18px] sm:grid-cols-2">
            <Fact
              label="ช่วงวันที่"
              value={formatReportPeriodFromParams(snapshot.params)}
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
    <article className="overflow-hidden rounded-xl border border-[#E4E7EC] bg-white">
      <button
        className="grid w-full gap-3 px-3 py-3 text-left transition hover:bg-[#F9FAFB] sm:grid-cols-[minmax(0,1.35fr)_minmax(0,0.9fr)_120px_120px] sm:items-center"
        onClick={onToggle}
        type="button"
      >
        <div className="min-w-0">
          <p className="truncate text-[16px] font-semibold leading-6 text-[#101828]">
            {document.doc_no}
          </p>
          <p className="mt-1 text-[14px] leading-[22px] text-[#667085]">
            {formatThaiDate(document.doc_date)}
            {document.doc_time ? ` · ${formatTime(document.doc_time)}` : ""}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-[12px] font-medium leading-[18px] text-[#667085]">
            {copy.partyColumn}
          </p>
          <p className="mt-1 truncate text-[14px] font-medium leading-[22px] text-[#344054]">
            {party}
          </p>
          <p className="mt-0.5 truncate text-[12px] leading-[18px] text-[#667085]">
            {branchLabel}
          </p>
        </div>
        <div>
          <p className="text-[12px] font-medium leading-[18px] text-[#667085]">
            {copy.amountColumn}
          </p>
          <p className="mt-1 text-[14px] font-semibold leading-[22px] text-[#101828]">
            {formatMoney(document.total_amount)} บาท
          </p>
        </div>
        <div className="flex items-center justify-between gap-3 sm:justify-end">
          <span className="rounded-full border border-[#E4E7EC] bg-[#F9FAFB] px-3 py-1 text-[12px] font-semibold leading-[18px] text-[#475467]">
            {formatInteger(document.detail_line_count)} รายการ
          </span>
          <span className="text-lg text-[#2563EB]">{expanded ? "−" : "+"}</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[#EAECF0] bg-[#F9FAFB] px-3 py-3">
          {detailState.status === "loading" && detailState.docNo === document.doc_no && (
            <div className="rounded-lg border border-[#E4E7EC] bg-white px-4 py-6 text-center text-[14px] leading-[22px] text-[#667085]">
              กำลังโหลดรายละเอียด...
            </div>
          )}
          {detailState.status === "error" && detailState.docNo === document.doc_no && (
            <div className="rounded-lg border border-[#FECDCA] bg-[#FEF3F2] px-4 py-3 text-[14px] leading-[22px] text-[#B42318]">
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
      <section className="rounded-lg border border-[#E4E7EC] bg-white p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[12px] font-medium leading-[18px] text-[#2563EB]">
              {copy.itemSectionTitle}
            </p>
            <h3 className="mt-1 text-[16px] font-semibold leading-6 text-[#101828]">
              {detail.document.doc_no}
            </h3>
            <p className="mt-1 text-[14px] leading-[22px] text-[#667085]">
              {formatThaiDate(detail.document.doc_date)}
              {detail.document.doc_time
                ? ` · ${formatTime(detail.document.doc_time)}`
                : ""}{" "}
              · {party}
            </p>
          </div>
          <div className="rounded-lg bg-[#101828] px-4 py-2 text-white">
            <p className="text-[12px] leading-[18px] text-[#D0D5DD]">
              {copy.amountDetailLabel}
            </p>
            <p className="text-[18px] font-semibold leading-7">
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
            <div className="rounded-lg border border-[#E4E7EC] bg-[#F9FAFB] px-4 py-6 text-center text-[14px] leading-[22px] text-[#667085]">
              ไม่พบรายการสินค้าในเอกสารนี้
            </div>
          )}
        </div>
      </section>

      <aside className="rounded-lg border border-[#E4E7EC] bg-white p-3">
        <h4 className="text-[14px] font-semibold leading-[22px] text-[#101828]">
          สรุปเอกสาร
        </h4>
        <dl className="mt-3 grid gap-3 text-[14px] leading-[22px]">
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
    <div className="rounded-lg border border-[#EAECF0] bg-white px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold leading-[18px] text-[#2563EB]">
            รายการที่ {index}
          </p>
          <p className="mt-1 line-clamp-2 font-semibold text-[#101828]">
            {line.item_name || line.item_code || "-"}
          </p>
          <p className="mt-1 text-[12px] leading-[18px] text-[#667085]">
            {line.item_code || "-"} · {branch}
          </p>
        </div>
        <p className="shrink-0 text-right text-[14px] font-semibold leading-[22px] text-[#101828]">
          {formatMoney(line.sum_amount)} บาท
        </p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] leading-[18px] text-[#667085] sm:grid-cols-4">
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

function PdfDownloadProgressDialog({
  downloadUrl,
  onClose,
  state,
}: {
  downloadUrl: string;
  onClose: () => void;
  state: PdfDownloadState;
}) {
  if (state.status === "idle") {
    return null;
  }

  const progress =
    state.status === "preparing"
      ? state.progress
      : state.status === "ready"
        ? 100
        : 0;
  const title =
    state.status === "error"
      ? "สร้าง PDF ไม่สำเร็จ"
      : state.status === "ready"
        ? "PDF พร้อมดาวน์โหลด"
        : "กำลังสร้าง PDF";
  const description =
    state.status === "preparing"
      ? state.stage
      : state.status === "ready"
        ? `${state.documentCount.toLocaleString("th-TH")} เอกสาร · ${state.detailRowCount.toLocaleString("th-TH")} แถวรายละเอียด`
        : state.message;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#101828]/45 px-4 py-6 print:hidden">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[18px] font-semibold leading-7 text-[#101828]">
              {title}
            </h2>
            <p className="mt-1 text-[14px] leading-[22px] text-[#667085]">
              {description}
            </p>
          </div>
          {state.status !== "preparing" && (
            <button
              className="rounded-md px-2 py-1 text-[14px] font-semibold text-[#475467] hover:bg-[#F2F4F7]"
              onClick={onClose}
              type="button"
            >
              ปิด
            </button>
          )}
        </div>

        {state.status !== "error" && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-[12px] font-medium leading-[18px] text-[#475467]">
              <span>{state.status === "ready" ? "พร้อมแล้ว" : "กำลังดำเนินการ"}</span>
              <span>{formatInteger(progress)}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#EAECF0]">
              <div
                className="h-full rounded-full bg-[#2563EB] transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {state.status === "error" && (
            <a
              className="inline-flex h-10 items-center justify-center rounded-lg border border-[#D0D5DD] bg-white px-4 text-[14px] font-semibold leading-[22px] text-[#344054] hover:bg-[#F9FAFB]"
              href={downloadUrl}
              rel="noreferrer"
              target="_blank"
            >
              เปิด PDF โดยตรง
            </a>
          )}
          {state.status === "ready" && (
            <a
              className="inline-flex h-10 items-center justify-center rounded-lg bg-[#2563EB] px-4 text-[14px] font-semibold leading-[22px] text-white hover:bg-[#1D4ED8]"
              href={downloadUrl}
              rel="noreferrer"
              target="_blank"
            >
              เปิด PDF อีกครั้ง
            </a>
          )}
        </div>
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
    <div className="rounded-xl border border-[#E4E7EC] bg-[#F9FAFB] p-3">
      <p className="text-[12px] font-medium leading-[18px] text-[#667085]">
        {label}
      </p>
      <p
        className={`mt-2 break-words font-semibold tracking-normal text-[#101828] ${
          emphasis
            ? "text-[clamp(22px,6vw,32px)] leading-[1.15]"
            : "text-[18px] leading-7"
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
    <div className="rounded-xl border border-[#EAECF0] bg-[#F9FAFB] p-3">
      <div className="flex gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#2563EB] text-[12px] font-semibold leading-[18px] text-white">
          {index}
        </span>
        <div>
          <p className="font-semibold text-[#101828]">{title}</p>
          <p className="mt-1 text-[14px] leading-[22px] text-[#475467]">
            {body}
          </p>
        </div>
      </div>
    </div>
  );
}

function ComparisonRow({ title, value }: { title: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-[#EAECF0] bg-[#F9FAFB] px-3 py-3 text-[14px] leading-[22px]">
      <span className="font-medium text-[#475467]">{title}</span>
      <span className="text-right font-semibold text-[#101828]">{value}</span>
    </div>
  );
}

function AdvancedRangeControls({
  dateFrom,
  dateTo,
  rangeLoading,
  rangeError,
  onDateFromChange,
  onDateToChange,
  onRunRange,
  onApplyPreset,
}: {
  dateFrom: string;
  dateTo: string;
  rangeLoading: boolean;
  rangeError: string | null;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onRunRange: () => void;
  onApplyPreset: (preset: "yesterday" | "month" | "quarter" | "year") => void;
}) {
  return (
    <details className="rounded-xl border border-[#E4E7EC] bg-white p-3 shadow-sm sm:p-4 print:hidden">
      <summary className="cursor-pointer list-none text-[14px] font-semibold leading-[22px] text-[#344054]">
        ดูช่วงอื่น
        <span className="ml-2 font-normal text-[#667085]">
          ค่าเริ่มต้นคือรอบเดียวกับ LINE
        </span>
      </summary>
      <div className="mt-3 rounded-lg border border-[#D0D5DD] bg-[#F9FAFB] px-3 py-2 text-[13px] leading-[20px] text-[#475467]">
        การเปลี่ยนช่วงนี้ใช้ดูประกอบเท่านั้น ตัวเลขแรกของหน้านี้คือข้อมูลจากรอบที่ส่งใน LINE
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p className="text-[12px] font-medium leading-[18px] text-[#667085]">
            เลือกช่วงรายงาน
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <PresetButton label="เมื่อวาน" onClick={() => onApplyPreset("yesterday")} />
            <PresetButton label="เดือนนี้" onClick={() => onApplyPreset("month")} />
            <PresetButton label="ไตรมาสนี้" onClick={() => onApplyPreset("quarter")} />
            <PresetButton label="ปีนี้" onClick={() => onApplyPreset("year")} />
          </div>
        </div>
        <form
          className="grid gap-2 sm:grid-cols-[140px_140px_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            onRunRange();
          }}
        >
          <DateInput label="จากวันที่" value={dateFrom} onChange={onDateFromChange} />
          <DateInput label="ถึงวันที่" value={dateTo} onChange={onDateToChange} />
          <button
            className="h-10 rounded-lg bg-[#2563EB] px-5 text-[14px] font-semibold leading-[22px] text-white shadow-sm transition hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60 sm:self-end"
            disabled={rangeLoading}
            type="submit"
          >
            {rangeLoading ? "กำลังโหลด" : "ดูรายงาน"}
          </button>
        </form>
      </div>
      {rangeError && (
        <p className="mt-3 rounded-lg border border-[#FECDCA] bg-[#FEF3F2] px-3 py-2 text-[14px] leading-[22px] text-[#B42318]">
          {rangeError}
        </p>
      )}
    </details>
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
      className="h-9 rounded-lg border border-[#D0D5DD] bg-white px-4 text-[14px] font-semibold leading-[22px] text-[#344054] transition hover:border-[#93C5FD] hover:bg-[#EFF6FF] hover:text-[#1D4ED8]"
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
      <span className="text-[12px] font-medium leading-[18px] text-[#667085]">
        {label}
      </span>
      <input
        className="mt-1 h-10 w-full rounded-lg border border-[#D0D5DD] px-3 text-[14px] leading-[22px] outline-none transition focus:border-[#2563EB] focus:ring-4 focus:ring-[#DBEAFE]"
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
      className="h-9 rounded-lg border border-[#D0D5DD] px-4 text-[14px] font-semibold leading-[22px] text-[#344054] transition hover:bg-[#F9FAFB] disabled:cursor-not-allowed disabled:opacity-45"
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
      <dt className="text-[12px] font-medium leading-[18px] text-[#667085]">
        {label}
      </dt>
      <dd className="mt-1 break-words font-medium text-[#344054]">{value}</dd>
    </div>
  );
}

function BriefErrorState({ message }: { message: string }) {
  return (
    <main className="min-h-screen bg-[#F6F7F9] px-4 py-6">
      <div className="mx-auto max-w-xl rounded-xl border border-[#E4E7EC] bg-white p-5 shadow-sm">
        <p className="text-[12px] font-semibold leading-[18px] text-[#2563EB]">
          AI Business Center
        </p>
        <h1 className="mt-2 text-[24px] font-semibold leading-8 text-[#101828]">
          เปิดรายงานไม่ได้
        </h1>
        <p className="mt-2 text-[14px] leading-[22px] text-[#475467]">
          {message}
        </p>
        <p className="mt-4 text-[12px] leading-[18px] text-[#667085]">
          เพื่อความปลอดภัย ลิงก์รายงานจาก LINE จะผูกกับบริษัทและรายงานที่ส่งจริงเท่านั้น
        </p>
      </div>
    </main>
  );
}

function ExecutiveDashboardModePanel({
  access,
  evidenceSnapshot,
  open,
  onOpenChange,
  tenantId,
  tenantName,
}: {
  access: DashboardAccess;
  evidenceSnapshot: ViewerReportSnapshot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  tenantName: string;
}) {
  const [dateFrom, setDateFrom] = useState(evidenceSnapshot.params.date_from);
  const [dateTo, setDateTo] = useState(evidenceSnapshot.params.date_to);
  const [run, setRun] = useState<ExecutiveDashboardRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isActive = run?.status === "queued" || run?.status === "running";

  useEffect(() => {
    if (!run || !isActive) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      void fetchDashboardRun({
        access,
        runId: run.id,
        tenantId,
        signal: controller.signal,
      })
        .then((nextRun) => {
          if (nextRun) {
            setRun(nextRun);
          }
        })
        .catch(() => undefined);
    }, 2000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [access, isActive, run, tenantId]);

  async function startDashboardRun() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/reports/${encodeURIComponent(
          tenantId,
        )}/executive-dashboard-runs`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            dashboard_token: access.token,
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
        throw new Error(payload.error || "เริ่มวิเคราะห์ข้อมูลไม่สำเร็จ");
      }
      setRun(payload.data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "เริ่มวิเคราะห์ข้อมูลไม่สำเร็จ กรุณาลองใหม่",
      );
    } finally {
      setLoading(false);
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
      const range = buildPresetRange("yesterday");
      setDateFrom(range.date_from);
      setDateTo(range.date_to);
      return;
    }
    const now = new Date();
    setDateFrom(toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)));
    setDateTo(today);
  }

  const snapshots = run?.snapshots ?? [];
  const kpis = buildExecutiveDashboardKpis(snapshots);
  const progress = run?.progress_percent ?? 0;
  const progressLabel = run ? formatDashboardProgressLabel(run) : null;
  const terminalRun =
    run?.status === "success" ||
    run?.status === "success_with_warnings" ||
    run?.status === "failed"
      ? run
      : null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 print:hidden">
      <div className="mx-auto flex max-w-7xl justify-end px-3 pb-3 sm:px-6">
        {!open ? (
          <button
            className="rounded-xl bg-[#101828] px-4 py-3 text-[14px] font-semibold leading-[22px] text-white shadow-lg transition hover:bg-[#1D2939]"
            onClick={() => onOpenChange(true)}
            type="button"
          >
            วิเคราะห์วันที่อื่น
          </button>
        ) : (
          <section className="max-h-[82vh] w-full overflow-auto rounded-2xl border border-[#D0D5DD] bg-white shadow-2xl lg:w-[760px]">
            <div className="sticky top-0 z-10 border-b border-[#EAECF0] bg-white px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[12px] font-semibold leading-[18px] text-[#2563EB]">
                    Dashboard Mode
                  </p>
                  <h2 className="text-[18px] font-semibold leading-7 text-[#101828]">
                    วิเคราะห์วันที่อื่น
                  </h2>
                  <p className="mt-1 text-[13px] leading-5 text-[#667085]">
                    ค่าแรกของหน้านี้ยังเป็นข้อมูลจาก LINE รอบนี้ ส่วนนี้จะสร้างข้อมูลใหม่ตามวันที่ที่เลือก
                  </p>
                </div>
                <button
                  className="h-9 rounded-lg border border-[#D0D5DD] bg-white px-3 text-[13px] font-semibold text-[#344054]"
                  onClick={() => onOpenChange(false)}
                  type="button"
                >
                  ปิด
                </button>
              </div>
            </div>

            <div className="space-y-4 p-4">
              <div className="rounded-xl border border-[#E4E7EC] bg-[#F9FAFB] p-3">
                <div className="flex flex-wrap items-center gap-2 text-[12px] font-semibold leading-[18px]">
                  <span className="rounded-full border border-[#ABEFC6] bg-[#ECFDF3] px-2.5 py-1 text-[#027A48]">
                    ข้อมูลจาก LINE รอบนี้ยังล็อกไว้
                  </span>
                  <span className="rounded-full border border-[#D0D5DD] bg-white px-2.5 py-1 text-[#475467]">
                    เลือกย้อนหลังได้ {formatInteger(access.lookback_days)} วัน
                  </span>
                  <span className="rounded-full border border-[#D0D5DD] bg-white px-2.5 py-1 text-[#475467]">
                    สูงสุด {formatInteger(access.max_date_window_days)} วันต่อครั้ง
                  </span>
                </div>
                <p className="mt-2 text-[13px] leading-5 text-[#475467]">
                  {tenantName} · จาก LINE รอบ {formatReportPeriodFromParams(
                    evidenceSnapshot.params,
                  )}
                </p>
              </div>

              <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
                <div>
                  <div className="flex flex-wrap gap-2">
                    <PresetButton label="วันนี้" onClick={() => applyQuickChoice("today")} />
                    <PresetButton
                      label="เมื่อวาน"
                      onClick={() => applyQuickChoice("yesterday")}
                    />
                    <PresetButton label="เดือนนี้" onClick={() => applyQuickChoice("month")} />
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <DateInput label="จากวันที่" value={dateFrom} onChange={setDateFrom} />
                    <DateInput label="ถึงวันที่" value={dateTo} onChange={setDateTo} />
                  </div>
                </div>
                <button
                  className="h-10 rounded-lg bg-[#2563EB] px-5 text-[14px] font-semibold leading-[22px] text-white shadow-sm transition hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={loading || isActive}
                  onClick={() => void startDashboardRun()}
                  type="button"
                >
                  {isActive ? "กำลังสร้างข้อมูล" : loading ? "กำลังรับงาน" : "ดูข้อมูล"}
                </button>
              </div>

              {error && (
                <p className="rounded-lg border border-[#FECDCA] bg-[#FEF3F2] px-3 py-2 text-[14px] leading-[22px] text-[#B42318]">
                  {error}
                </p>
              )}

              {run && (
                <div className="rounded-xl border border-[#E4E7EC] bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[13px] font-semibold leading-5 text-[#101828]">
                        {progressLabel}
                      </p>
                      <p className="mt-1 text-[12px] leading-[18px] text-[#667085]">
                        ช่วงที่เลือก {formatReportPeriodFromParams(run.params)}
                      </p>
                    </div>
                    <span className={dashboardStatusClassName(run.status)}>
                      {formatDashboardRunStatus(run.status)}
                    </span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#EAECF0]">
                    <div
                      className="h-full rounded-full bg-[#2563EB] transition-all"
                      style={{ width: `${Math.max(5, Math.min(100, progress))}%` }}
                    />
                  </div>
                  {run.safe_error_message && (
                    <p className="mt-3 rounded-lg border border-[#FEDF89] bg-[#FFFAEB] px-3 py-2 text-[13px] leading-5 text-[#B54708]">
                      {run.safe_error_message}
                    </p>
                  )}
                </div>
              )}

              {terminalRun && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {kpis.map((kpi) => (
                      <PremiumKpi key={kpi.label} label={kpi.label} value={kpi.value} />
                    ))}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {access.allowed_report_keys.map((reportKey) => {
                      const result =
                        terminalRun.report_results.find(
                          (item) => item.report_key === reportKey,
                        ) ?? null;
                      const cardSnapshot =
                        snapshots.find((item) => item.report_key === reportKey) ??
                        null;
                      return (
                        <DashboardReportCard
                          key={reportKey}
                          reportKey={reportKey}
                          result={result}
                          snapshot={cardSnapshot}
                        />
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

async function fetchDashboardRun(input: {
  access: DashboardAccess;
  runId: string;
  tenantId: string;
  signal?: AbortSignal;
}) {
  const params = new URLSearchParams({
    dashboard_token: input.access.token,
  });
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

function DashboardReportCard({
  reportKey,
  result,
  snapshot,
}: {
  reportKey: ReportKey;
  result: ExecutiveDashboardReportResult | null;
  snapshot: ViewerReportSnapshot | null;
}) {
  const status = result ? formatDashboardFreshness(result) : "รอข้อมูล";
  return (
    <div className="rounded-xl border border-[#E4E7EC] bg-[#F9FAFB] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold leading-6 text-[#101828]">
            {getReportTitleFromKey(reportKey)}
          </h3>
          <p className="mt-1 text-[12px] leading-[18px] text-[#667085]">
            {result?.duration_ms != null
              ? `ใช้เวลา ${formatDuration(result.duration_ms)}`
              : "ยังไม่มีเวลารัน"}
            {result?.row_count != null
              ? ` · ${formatInteger(result.row_count)} rows`
              : ""}
          </p>
        </div>
        <span className={dashboardFreshnessClassName(result)}>
          {status}
        </span>
      </div>
      <p className="mt-3 break-words text-[18px] font-semibold leading-7 text-[#101828]">
        {snapshot ? getDashboardSnapshotPrimaryValue(snapshot) : "ยังไม่มีข้อมูล"}
      </p>
      {result?.degraded_reason && (
        <p className="mt-2 rounded-lg border border-[#FEDF89] bg-[#FFFAEB] px-3 py-2 text-[12px] leading-[18px] text-[#B54708]">
          ใช้ข้อมูลอ้างอิงหรือข้อมูลสดไม่พร้อมสำหรับรายงานนี้
        </p>
      )}
    </div>
  );
}

function getViewerReportTitle(snapshot: ViewerReportSnapshot) {
  if (isArDebtReceiptSnapshot(snapshot)) {
    return "รายงานรับชำระหนี้";
  }
  if (isArCustomerMovementSnapshot(snapshot)) {
    return "รายงานเคลื่อนไหวลูกหนี้";
  }
  if (isStockReorderSnapshot(snapshot)) {
    return "รายงานสินค้าถึงจุดสั่งซื้อ";
  }
  if (isStockBalanceSnapshot(snapshot)) {
    return "รายงานสต็อกคงเหลือ";
  }
  if (isGrossProfitSnapshot(snapshot)) {
    return getGrossProfitTitle(snapshot.report_key);
  }
  return reportCopy[snapshot.report_key].title;
}

function getReportTitleFromKey(reportKey: ReportKey) {
  switch (reportKey) {
    case "sales_goods_services":
      return "ขายสินค้าและบริการ";
    case "purchase_goods_payables":
      return "ซื้อ/ตั้งหนี้";
    case "gross_profit_by_product":
      return "กำไรขั้นต้นสินค้า";
    case "gross_profit_by_ar_customer":
      return "กำไรขั้นต้นลูกหนี้";
    case "stock_balance":
      return "สต็อกคงเหลือ";
    case "stock_reorder":
      return "สินค้าถึงจุดสั่งซื้อ";
    case "ar_customer_movement":
      return "เคลื่อนไหวลูกหนี้";
    case "ar_debt_receipt":
      return "รับชำระหนี้";
  }
}

function buildExecutiveDashboardKpis(snapshots: ViewerReportSnapshot[]) {
  const sales = findDashboardSnapshot(snapshots, "sales_goods_services");
  const grossProfit =
    findDashboardSnapshot(snapshots, "gross_profit_by_product") ??
    findDashboardSnapshot(snapshots, "gross_profit_by_ar_customer");
  const receipt = findDashboardSnapshot(snapshots, "ar_debt_receipt");
  const stock = findDashboardSnapshot(snapshots, "stock_balance");

  return [
    {
      label: "ยอดขาย",
      value: sales
        ? `${formatMoney(sales.summary.total_sales)} บาท`
        : "ยังไม่มีข้อมูล",
    },
    {
      label: "กำไรขั้นต้น",
      value: grossProfit
        ? `${formatMoney(grossProfit.summary.gross_profit)} บาท`
        : "ยังไม่มีข้อมูล",
    },
    {
      label: "รับชำระ",
      value: receipt
        ? `${formatMoney(receipt.summary.total_received_amount)} บาท`
        : "ยังไม่มีข้อมูล",
    },
    {
      label: "มูลค่าสต็อก",
      value: stock
        ? `${formatMoney(stock.summary.stock_value)} บาท`
        : "ยังไม่มีข้อมูล",
    },
  ];
}

function findDashboardSnapshot<K extends ViewerReportKey>(
  snapshots: ViewerReportSnapshot[],
  reportKey: K,
): Extract<ViewerReportSnapshot, { report_key: K }> | null {
  return (
    snapshots.find(
      (snapshot): snapshot is Extract<ViewerReportSnapshot, { report_key: K }> =>
        snapshot.report_key === reportKey,
    ) ?? null
  );
}

function getDashboardSnapshotPrimaryValue(snapshot: ViewerReportSnapshot) {
  if (snapshot.report_key === "sales_goods_services") {
    return `${formatMoney(snapshot.summary.total_sales)} บาท`;
  }
  if (snapshot.report_key === "purchase_goods_payables") {
    return `${formatMoney(snapshot.summary.total_purchase)} บาท`;
  }
  if (isGrossProfitSnapshot(snapshot)) {
    return `${formatMoney(snapshot.summary.gross_profit)} บาท`;
  }
  if (isStockBalanceSnapshot(snapshot)) {
    return `${formatMoney(snapshot.summary.stock_value)} บาท`;
  }
  if (isStockReorderSnapshot(snapshot)) {
    return `${formatInteger(snapshot.summary.reorder_count)} รายการ`;
  }
  if (isArCustomerMovementSnapshot(snapshot)) {
    return `${formatMoney(snapshot.summary.net_movement_amount)} บาท`;
  }
  if (isArDebtReceiptSnapshot(snapshot)) {
    return `${formatMoney(snapshot.summary.total_received_amount)} บาท`;
  }
  return "ยังไม่มีข้อมูล";
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
      ? getReportTitleFromKey(run.progress_current_report_key)
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
  if (status === "queued") {
    return "รอคิว";
  }
  if (status === "running") {
    return "กำลังรัน";
  }
  if (status === "success") {
    return "สำเร็จ";
  }
  if (status === "success_with_warnings") {
    return "สำเร็จพร้อมข้อสังเกต";
  }
  return "ไม่สำเร็จ";
}

function dashboardStatusClassName(status: ExecutiveDashboardRunStatus) {
  if (status === "failed") {
    return "rounded-full border border-[#FECDCA] bg-[#FEF3F2] px-2.5 py-1 text-[12px] font-semibold leading-[18px] text-[#B42318]";
  }
  if (status === "success_with_warnings") {
    return "rounded-full border border-[#FEDF89] bg-[#FFFAEB] px-2.5 py-1 text-[12px] font-semibold leading-[18px] text-[#B54708]";
  }
  if (status === "success") {
    return "rounded-full border border-[#ABEFC6] bg-[#ECFDF3] px-2.5 py-1 text-[12px] font-semibold leading-[18px] text-[#027A48]";
  }
  return "rounded-full border border-[#BFDBFE] bg-[#EFF6FF] px-2.5 py-1 text-[12px] font-semibold leading-[18px] text-[#1D4ED8]";
}

function formatDashboardFreshness(
  result: ExecutiveDashboardReportResult,
) {
  if (result.status === "failed") {
    return "ไม่พร้อม";
  }
  if (result.freshness === "fresh") {
    return "สด";
  }
  if (result.freshness === "reference") {
    return "ข้อมูลอ้างอิง";
  }
  return "ไม่พร้อม";
}

function dashboardFreshnessClassName(
  result: ExecutiveDashboardReportResult | null,
) {
  if (!result || result.status === "failed" || result.freshness === "unavailable") {
    return "rounded-full border border-[#FECDCA] bg-[#FEF3F2] px-2.5 py-1 text-[12px] font-semibold leading-[18px] text-[#B42318]";
  }
  if (result.freshness === "reference") {
    return "rounded-full border border-[#FEDF89] bg-[#FFFAEB] px-2.5 py-1 text-[12px] font-semibold leading-[18px] text-[#B54708]";
  }
  return "rounded-full border border-[#ABEFC6] bg-[#ECFDF3] px-2.5 py-1 text-[12px] font-semibold leading-[18px] text-[#027A48]";
}

function formatDuration(durationMs: number) {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  if (seconds < 60) {
    return `${seconds} วินาที`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} นาที ${rest} วินาที` : `${minutes} นาที`;
}

function isClassicSnapshot(
  snapshot: ViewerReportSnapshot,
): snapshot is ClassicViewerReportSnapshot {
  return (
    snapshot.report_key === "sales_goods_services" ||
    snapshot.report_key === "purchase_goods_payables"
  );
}

function isGrossProfitSnapshot(
  snapshot: ViewerReportSnapshot,
): snapshot is GrossProfitViewerReportSnapshot {
  return (
    snapshot.report_key === "gross_profit_by_product" ||
    snapshot.report_key === "gross_profit_by_ar_customer"
  );
}

function isStockBalanceSnapshot(
  snapshot: ViewerReportSnapshot,
): snapshot is StockBalanceViewerReportSnapshot {
  return snapshot.report_key === "stock_balance";
}

function isStockReorderSnapshot(
  snapshot: ViewerReportSnapshot,
): snapshot is StockReorderViewerReportSnapshot {
  return snapshot.report_key === "stock_reorder";
}

function isArCustomerMovementSnapshot(
  snapshot: ViewerReportSnapshot,
): snapshot is ArCustomerMovementViewerReportSnapshot {
  return snapshot.report_key === "ar_customer_movement";
}

function isArDebtReceiptSnapshot(
  snapshot: ViewerReportSnapshot,
): snapshot is ArDebtReceiptViewerReportSnapshot {
  return snapshot.report_key === "ar_debt_receipt";
}

function getGrossProfitTitle(reportKey: GrossProfitViewerReportKey) {
  return reportKey === "gross_profit_by_product"
    ? "รายงานกำไรขั้นต้นสินค้า"
    : "รายงานกำไรขั้นต้นลูกหนี้";
}

function getGrossProfitRowLabel(
  snapshot: GrossProfitViewerReportSnapshot,
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

function getGrossProfitRowCode(
  snapshot: GrossProfitViewerReportSnapshot,
  row: GrossProfitBaseRow | GrossProfitByProductRow | GrossProfitByArCustomerRow,
) {
  return snapshot.report_key === "gross_profit_by_product"
    ? (row as GrossProfitByProductRow).code || "-"
    : (row as GrossProfitByArCustomerRow).ar_code || "-";
}

function getSnapshotTotal(snapshot: ClassicViewerReportSnapshot) {
  return snapshot.report_key === "purchase_goods_payables"
    ? snapshot.summary.total_purchase
    : snapshot.summary.total_sales;
}

function getPrimaryRanking(snapshot: ClassicViewerReportSnapshot) {
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

function buildViewerPdfUrl(input: {
  viewer: ViewerParams;
  dateFrom: string;
  dateTo: string;
  timeFrom?: string;
  timeTo?: string;
}) {
  const params = new URLSearchParams({
    token: input.viewer.token,
    run_id: input.viewer.runId,
    date_from: input.dateFrom,
    date_to: input.dateTo,
    pdf_layout: REPORT_PDF_LAYOUT_VERSION,
  });
  appendPeriodTimeParams(params, {
    date_from: input.dateFrom,
    date_to: input.dateTo,
    time_from: input.timeFrom,
    time_to: input.timeTo,
  });
  return `${API_BASE_URL}/api/reports/${encodeURIComponent(
    input.viewer.tenantId,
  )}/${encodeURIComponent(input.viewer.reportKey)}/pdf?${params}`;
}

function buildViewerPdfPrepareUrl(input: {
  viewer: ViewerParams;
  dateFrom: string;
  dateTo: string;
  timeFrom?: string;
  timeTo?: string;
}) {
  const params = new URLSearchParams({
    token: input.viewer.token,
    run_id: input.viewer.runId,
    date_from: input.dateFrom,
    date_to: input.dateTo,
    pdf_layout: REPORT_PDF_LAYOUT_VERSION,
  });
  appendPeriodTimeParams(params, {
    date_from: input.dateFrom,
    date_to: input.dateTo,
    time_from: input.timeFrom,
    time_to: input.timeTo,
  });
  return `${API_BASE_URL}/api/reports/${encodeURIComponent(
    input.viewer.tenantId,
  )}/${encodeURIComponent(input.viewer.reportKey)}/pdf/prepare?${params}`;
}

function appendPeriodTimeParams(
  params: URLSearchParams,
  period: {
    date_from: string;
    date_to: string;
    time_from?: string;
    time_to?: string;
  },
) {
  if (period.time_from && period.time_to) {
    params.set("time_from", period.time_from);
    params.set("time_to", period.time_to);
  }
}

function openPdfDownloadUrl(downloadUrl: string) {
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.target = "_blank";
  anchor.rel = "noreferrer";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
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

function formatSource(source: ReportSnapshot["source"]) {
  return source === "sample_snapshot" ? "ข้อมูลตัวอย่าง" : "ข้อมูลจาก SML";
}

function formatReportPeriodFromParams(period: {
  date_from: string;
  date_to: string;
  time_from?: string;
  time_to?: string;
}) {
  if (period.time_from && period.time_to) {
    if (period.date_from === period.date_to) {
      return `${formatThaiDate(period.date_from)} ${period.time_from}-${period.time_to}`;
    }
    return `${formatThaiDate(period.date_from)} ${period.time_from} - ${formatThaiDate(
      period.date_to,
    )} ${period.time_to}`;
  }
  return formatReportPeriod(period.date_from, period.date_to);
}

function formatReportPeriod(dateFrom: string, dateTo: string) {
  if (dateFrom === dateTo) {
    return formatThaiDate(dateFrom);
  }
  return `${formatThaiDate(dateFrom)} - ${formatThaiDate(dateTo)}`;
}

function formatStockMovementLabel(
  prefix: "รับเข้า" | "จ่ายออก",
  dateFrom: string,
  dateTo: string,
) {
  return dateFrom === dateTo ? `${prefix}ในวัน` : `${prefix}ในช่วง`;
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

function formatMargin(value: number | null) {
  if (value === null) {
    return "ตรวจสอบ";
  }

  return `${new Intl.NumberFormat("th-TH", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(value)}%`;
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

function formatArMovementType(
  movementType: ArCustomerMovementRow["movement_type"],
) {
  if (movementType === "ar_decrease") {
    return "ลดลูกหนี้";
  }
  if (movementType === "receipt") {
    return "รับชำระ";
  }
  return "เพิ่มลูกหนี้";
}

function formatArDebtReceiptStatus(row: ArDebtReceiptRow) {
  if (row.payment_status === "missing_payment_split") {
    return "รอแยกช่องทาง";
  }
  if (row.payment_status === "mismatched_payment_split") {
    return `ต่าง ${formatMoney(row.payment_difference_amount)} บาท`;
  }
  return "ตรงกัน";
}

function formatComparisonPoint(point: SalesComparisonPoint) {
  if (point.direction === "no_reference") {
    return "ยังไม่มีข้อมูลอ้างอิง";
  }

  const directionText =
    point.direction === "up"
      ? "เพิ่มขึ้น"
      : point.direction === "down"
        ? "ลดลง"
        : "ใกล้เคียงเดิม";
  const percentText =
    point.difference_percent === null
      ? ""
      : ` (${formatPercent(point.difference_percent)})`;

  return `${directionText} ${formatSignedMoney(point.difference_amount)} บาท${percentText}`;
}

function formatPercent(value: number) {
  const formatted = new Intl.NumberFormat("th-TH", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  }).format(Math.abs(value));
  return `${value > 0 ? "+" : value < 0 ? "-" : ""}${formatted}%`;
}

function getInclusiveDayCount(dateFrom: string, dateTo: string) {
  const from = parseIsoDate(dateFrom);
  const to = parseIsoDate(dateTo);
  if (!from || !to) {
    return 1;
  }
  const diffMs = to.getTime() - from.getTime();
  if (diffMs < 0) {
    return 1;
  }
  return Math.max(1, Math.floor(diffMs / 86_400_000) + 1);
}

function parseIsoDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return null;
  }
  return new Date(year, month - 1, day);
}
