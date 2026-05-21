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
  type SalesComparisonPoint,
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
  reportKey: ReportKey;
  runId: string;
  token: string;
};

const DETAILED_PRINT_PAGE_SIZE = 50;
const DETAILED_PRINT_MAX_DOCUMENTS = 300;
const DETAILED_PRINT_MAX_DETAIL_LINES = 5000;
const DETAILED_PRINT_DETAIL_CONCURRENCY = 4;
const REPORT_PDF_LAYOUT_VERSION = "sml-row-v4";
const PDF_PROGRESS_STAGES = [
  { delayMs: 0, progress: 5, stage: "ตรวจสิทธิ์ลิงก์รายงาน" },
  { delayMs: 250, progress: 15, stage: "เช็กไฟล์ PDF ใน cache" },
  { delayMs: 700, progress: 30, stage: "ตรวจจำนวนเอกสารและรายการ" },
  { delayMs: 1300, progress: 50, stage: "ดึงข้อมูลจาก SML" },
  { delayMs: 2400, progress: 80, stage: "สร้างไฟล์ PDF" },
  { delayMs: 3800, progress: 95, stage: "บันทึกไฟล์ลง cache" },
] as const;

type DetailedPrintDocument = {
  document: SalesDocumentListItem;
  detail: SalesDocumentDetail | null;
  error: string | null;
};

type DetailedPrintState =
  | { status: "idle" }
  | {
      status: "loading";
      phase: "documents" | "details";
      totalDocuments: number | null;
      loadedDocuments: number;
      loadedDetails: number;
      loadedLines: number;
    }
  | {
      status: "ready";
      generatedAt: string;
      dateFrom: string;
      dateTo: string;
      reportKey: ReportKey;
      totalDocuments: number;
      documents: DetailedPrintDocument[];
    }
  | { status: "error"; message: string };

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
  const [detailedPrintState, setDetailedPrintState] =
    useState<DetailedPrintState>({ status: "idle" });
  const [showDetailedPrintView, setShowDetailedPrintView] = useState(false);
  const [pdfDownloadState, setPdfDownloadState] = useState<PdfDownloadState>({
    status: "idle",
  });

  const copy = reportCopy[snapshot.report_key];
  const totalAmount = getSnapshotTotal(snapshot);
  const topItem = snapshot.top_products[0] ?? null;
  const primaryRanking = getPrimaryRanking(snapshot);
  const generatedAt = formatDateTime(snapshot.generated_at);
  const hasWarning =
    snapshot.quality_status === "reconciled_with_warning" ||
    Math.abs(snapshot.reconciliation.difference_amount) > 0.01;

  useEffect(() => {
    document.title = `${copy.title} | AI Business Center`;
  }, [copy.title]);

  useEffect(() => {
    setDetailedPrintState({ status: "idle" });
    setShowDetailedPrintView(false);
    setPdfDownloadState({ status: "idle" });
  }, [
    snapshot.params.date_from,
    snapshot.params.date_to,
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

  async function fetchPrintDocumentPage(nextPage: number) {
    const params = new URLSearchParams({
      token: viewer.token,
      run_id: viewer.runId,
      date_from: snapshot.params.date_from,
      date_to: snapshot.params.date_to,
      page: String(nextPage),
      page_size: String(DETAILED_PRINT_PAGE_SIZE),
      search: "",
    });
    const response = await fetch(
      `${API_BASE_URL}/api/reports/${encodeURIComponent(
        viewer.tenantId,
      )}/${encodeURIComponent(viewer.reportKey)}/viewer-documents?${params}`,
    );
    const payload = (await response.json()) as DocumentPageResponse;
    if (!response.ok || !payload.data) {
      throw new Error(payload.error || "โหลดรายการเอกสารสำหรับ PDF ไม่สำเร็จ");
    }
    return payload.data;
  }

  async function fetchPrintDocumentDetail(document: SalesDocumentListItem) {
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
      throw new Error(payload.error || "โหลดรายละเอียดเอกสารไม่สำเร็จ");
    }
    return payload.data;
  }

  async function prepareDetailedPrint() {
    if (
      detailedPrintState.status === "ready" &&
      detailedPrintState.reportKey === snapshot.report_key &&
      detailedPrintState.dateFrom === snapshot.params.date_from &&
      detailedPrintState.dateTo === snapshot.params.date_to
    ) {
      setShowDetailedPrintView(true);
      return;
    }

    setShowDetailedPrintView(false);
    setDetailedPrintState({
      status: "loading",
      phase: "documents",
      totalDocuments: null,
      loadedDocuments: 0,
      loadedDetails: 0,
      loadedLines: 0,
    });

    try {
      const firstPage = await fetchPrintDocumentPage(1);
      const totalDocuments = firstPage.pagination.total_items;
      if (snapshot.summary.line_count > DETAILED_PRINT_MAX_DETAIL_LINES) {
        throw new Error(
          `รายงานนี้มีรายละเอียด ${formatInteger(
            snapshot.summary.line_count,
          )} แถว ซึ่งมากเกินสำหรับพิมพ์ผ่าน browser กรุณาเลือกช่วงวันที่สั้นลงไม่เกิน ${formatInteger(
            DETAILED_PRINT_MAX_DETAIL_LINES,
          )} แถว`,
        );
      }
      if (totalDocuments > DETAILED_PRINT_MAX_DOCUMENTS) {
        throw new Error(
          `ช่วงนี้มี ${formatInteger(
            totalDocuments,
          )} เอกสาร ซึ่งมากเกินสำหรับ PDF รายละเอียดในเบราว์เซอร์ กรุณาเลือกช่วงวันที่ให้ไม่เกิน ${formatInteger(
            DETAILED_PRINT_MAX_DOCUMENTS,
          )} เอกสาร`,
        );
      }

      const documents = [...firstPage.documents];
      setDetailedPrintState({
        status: "loading",
        phase: "documents",
        totalDocuments,
        loadedDocuments: documents.length,
        loadedDetails: 0,
        loadedLines: 0,
      });

      for (let nextPage = 2; nextPage <= firstPage.pagination.total_pages; nextPage += 1) {
        const pageResult = await fetchPrintDocumentPage(nextPage);
        documents.push(...pageResult.documents);
        setDetailedPrintState({
          status: "loading",
          phase: "documents",
          totalDocuments,
          loadedDocuments: documents.length,
          loadedDetails: 0,
          loadedLines: 0,
        });
      }

      const detailedDocuments: DetailedPrintDocument[] = new Array(
        documents.length,
      );
      let cursor = 0;
      let loadedDetails = 0;
      let loadedLines = 0;
      let abortError: Error | null = null;

      setDetailedPrintState({
        status: "loading",
        phase: "details",
        totalDocuments,
        loadedDocuments: documents.length,
        loadedDetails: 0,
        loadedLines: 0,
      });

      async function worker() {
        for (;;) {
          if (abortError) {
            return;
          }
          const currentIndex = cursor;
          cursor += 1;
          if (currentIndex >= documents.length) {
            return;
          }
          const document = documents[currentIndex];
          try {
            const detail = await fetchPrintDocumentDetail(document);
            loadedLines += detail.lines.length;
            detailedDocuments[currentIndex] = {
              document,
              detail,
              error: null,
            };
            if (loadedLines > DETAILED_PRINT_MAX_DETAIL_LINES) {
              abortError = new Error(
                `รายงานนี้มีรายละเอียดมากกว่า ${formatInteger(
                  DETAILED_PRINT_MAX_DETAIL_LINES,
                )} แถว ซึ่งมากเกินสำหรับพิมพ์ผ่าน browser กรุณาเลือกช่วงวันที่สั้นลง`,
              );
            }
          } catch (error) {
            detailedDocuments[currentIndex] = {
              document,
              detail: null,
              error:
                error instanceof Error
                  ? error.message
                  : "โหลดรายละเอียดเอกสารนี้ไม่สำเร็จ",
            };
          } finally {
            loadedDetails += 1;
            setDetailedPrintState({
              status: "loading",
              phase: "details",
              totalDocuments,
              loadedDocuments: documents.length,
              loadedDetails,
              loadedLines,
            });
          }
        }
      }

      await Promise.all(
        Array.from({
          length: Math.min(
            DETAILED_PRINT_DETAIL_CONCURRENCY,
            Math.max(1, documents.length),
          ),
        }).map(() => worker()),
      );
      if (abortError) {
        throw abortError;
      }

      const readyState: DetailedPrintState = {
        status: "ready",
        generatedAt: new Date().toISOString(),
        dateFrom: snapshot.params.date_from,
        dateTo: snapshot.params.date_to,
        reportKey: snapshot.report_key,
        totalDocuments,
        documents: detailedDocuments,
      };
      setDetailedPrintState(readyState);
      setShowDetailedPrintView(true);
    } catch (error) {
      setDetailedPrintState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "เตรียมรายงาน PDF แบบละเอียดไม่สำเร็จ",
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
    });
    const downloadUrl = buildViewerPdfUrl({
      viewer,
      dateFrom: snapshot.params.date_from,
      dateTo: snapshot.params.date_to,
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
  const isDetailedPrintReady = detailedPrintState.status === "ready";
  const showDetailedPrintScreen = isDetailedPrintReady && showDetailedPrintView;
  const detailedPdfUrl = buildViewerPdfUrl({
    viewer,
    dateFrom: snapshot.params.date_from,
    dateTo: snapshot.params.date_to,
  });

  return (
    <main
      className={`min-h-screen bg-[#F6F7F9] text-[#101828] ${
        isDetailedPrintReady ? "detailed-print-ready" : ""
      } ${showDetailedPrintScreen ? "detailed-print-screen-mode" : ""}`}
    >
      <DetailedPrintStyles />
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
                {formatTenantName(snapshot.tenant_id)} · ช่วงข้อมูล{" "}
                {formatReportPeriod(
                  snapshot.params.date_from,
                  snapshot.params.date_to,
                )}{" "}
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
          <DetailedPrintNotice
            state={detailedPrintState}
            onOpenDetailed={() => setShowDetailedPrintView(true)}
          />
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

        <section className="rounded-xl border border-[#E4E7EC] bg-white p-3 shadow-sm sm:p-4 print:hidden">
          <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <p className="text-[12px] font-medium leading-[18px] text-[#667085]">
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
        </section>

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
    <section className="rounded-xl border border-[#E4E7EC] bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-medium leading-[18px] text-[#2563EB]">
            สรุปผู้บริหาร
          </p>
          <h2 className="mt-1 text-[18px] font-semibold leading-7 text-[#101828]">
            ผู้บริหารควรรู้อะไร
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

function ComparisonPanel({ snapshot }: { snapshot: ReportSnapshot }) {
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

function TrustPanel({ snapshot }: { snapshot: ReportSnapshot }) {
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
            รายละเอียดเทคนิค
          </summary>
          <dl className="grid gap-2 border-t border-[#E4E7EC] px-3 py-3 text-[12px] leading-[18px] sm:grid-cols-2">
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

function DetailedPrintNotice({
  state,
  onOpenDetailed,
}: {
  state: DetailedPrintState;
  onOpenDetailed: () => void;
}) {
  if (state.status === "idle") {
    return null;
  }

  if (state.status === "error") {
    return (
      <div className="mt-4 rounded-lg border border-[#FECDCA] bg-[#FEF3F2] px-4 py-3 text-[14px] leading-[22px] text-[#B42318] print:hidden">
        {state.message}
      </div>
    );
  }

  if (state.status === "ready") {
    const failedCount = state.documents.filter((item) => item.error).length;
    return (
      <div className="mt-4 flex flex-col gap-3 rounded-lg border border-[#ABEFC6] bg-[#ECFDF3] px-4 py-3 text-[14px] leading-[22px] text-[#027A48] sm:flex-row sm:items-center sm:justify-between print:hidden">
        <span>
          รายงานละเอียดพร้อมเปิดดูแล้ว ·{" "}
          {formatInteger(state.totalDocuments)} เอกสาร
          {failedCount ? ` · มี ${formatInteger(failedCount)} เอกสารที่โหลดรายละเอียดไม่ครบ` : ""}
        </span>
        <button
          className="h-9 rounded-lg bg-[#027A48] px-4 text-[14px] font-semibold leading-[22px] text-white"
          onClick={onOpenDetailed}
          type="button"
        >
          เปิดรายงานละเอียด
        </button>
      </div>
    );
  }

  const total = state.totalDocuments ?? state.loadedDocuments;
  const loaded =
    state.phase === "documents" ? state.loadedDocuments : state.loadedDetails;
  const progress =
    total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 12;
  const label =
    state.phase === "documents"
      ? "กำลังโหลดหัวเอกสาร"
      : "กำลังโหลดรายละเอียดสินค้าในเอกสาร";

  return (
    <div className="mt-4 rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] px-4 py-3 print:hidden">
      <div className="flex items-center justify-between gap-3 text-[14px] leading-[22px]">
        <span className="font-semibold text-[#1D4ED8]">{label}</span>
        <span className="text-[#475467]">
          {formatInteger(loaded)}
          {total ? ` / ${formatInteger(total)}` : ""} เอกสาร
          {state.phase === "details"
            ? ` · ${formatInteger(state.loadedLines)} แถว`
            : ""}
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
        <div
          className="h-full rounded-full bg-[#2563EB] transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="mt-2 text-[12px] leading-[18px] text-[#667085]">
        รายงานออนไลน์จะดึงข้อมูลจาก SML ตามช่วงวันที่นี้ จำกัดไม่เกิน{" "}
        {formatInteger(DETAILED_PRINT_MAX_DOCUMENTS)} เอกสาร และ{" "}
        {formatInteger(DETAILED_PRINT_MAX_DETAIL_LINES)} แถวรายละเอียด
      </p>
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

function DetailedPrintReport({
  copy,
  onBack,
  onPrint,
  printState,
  snapshot,
}: {
  copy: ReportCopy;
  onBack: () => void;
  onPrint: () => void;
  printState: DetailedPrintState;
  snapshot: ReportSnapshot;
}) {
  if (printState.status !== "ready") {
    return <section aria-hidden="true" className="detailed-print-report" />;
  }

  const totalLines = printState.documents.reduce(
    (sum, item) => sum + (item.detail?.lines.length ?? 0),
    0,
  );
  const failedCount = printState.documents.filter((item) => item.error).length;

  return (
    <section className="detailed-print-report bg-white text-[#101828]">
      <div className="print-screen-toolbar">
        <div>
          <p className="text-[12px] font-semibold leading-[18px] text-[#2563EB]">
            รายงานละเอียดออนไลน์
          </p>
          <p className="mt-1 text-[14px] leading-[22px] text-[#475467]">
            ใช้หน้านี้สำหรับตรวจรายละเอียดเอกสาร ส่วนไฟล์ PDF ให้ดาวน์โหลดจากปุ่มหลักด้านบน
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="h-10 rounded-lg border border-[#D0D5DD] bg-white px-4 text-[14px] font-semibold leading-[22px] text-[#344054]"
            onClick={onBack}
            type="button"
          >
            กลับหน้าสรุป
          </button>
          <button
            className="h-10 rounded-lg bg-[#2563EB] px-4 text-[14px] font-semibold leading-[22px] text-white"
            onClick={onPrint}
            type="button"
          >
            เปิดหน้าต่างพิมพ์
          </button>
        </div>
      </div>
      <div className="print-page">
        <header className="print-report-header">
          <div>
            <p className="print-eyebrow">AI Business Center · รายงานละเอียดจาก SML</p>
            <h1>{copy.title}</h1>
            <p className="print-subtitle">
              {formatTenantName(snapshot.tenant_id)} · ช่วงข้อมูล{" "}
              {formatReportPeriod(printState.dateFrom, printState.dateTo)}
            </p>
          </div>
          <div className="print-header-meta">
            <p>จัดทำเมื่อ {formatDateTime(printState.generatedAt)}</p>
            <p>{formatReportPeriod(printState.dateFrom, printState.dateTo)}</p>
          </div>
        </header>

        <section className="print-summary-grid">
          <PrintSummaryItem label={copy.totalLabel} value={`${formatMoney(getSnapshotTotal(snapshot))} บาท`} />
          <PrintSummaryItem label={copy.documentLabel} value={`${formatInteger(snapshot.summary.document_count)} ใบ`} />
          <PrintSummaryItem label={copy.lineLabel} value={`${formatInteger(snapshot.summary.line_count)} รายการ`} />
          <PrintSummaryItem label={copy.qtyLabel} value={formatQty(snapshot.summary.total_qty)} />
          <PrintSummaryItem label="เอกสารใน PDF" value={`${formatInteger(printState.totalDocuments)} ใบ`} />
          <PrintSummaryItem label="แถวรายละเอียด" value={`${formatInteger(totalLines)} แถว`} />
        </section>

        {failedCount > 0 && (
          <p className="print-warning">
            หมายเหตุ: มี {formatInteger(failedCount)} เอกสารที่โหลดรายละเอียดไม่ครบ
            กรุณาตรวจซ้ำในหน้ารายงานออนไลน์
          </p>
        )}

        <div className="print-sml-table-wrap">
          <table className="print-sml-table">
            <colgroup>
              <col className="sml-col-date" />
              <col className="sml-col-doc" />
              <col className="sml-col-time" />
              <col className="sml-col-ref" />
              <col className="sml-col-code" />
              <col className="sml-col-name" />
              <col className="sml-col-money" />
              <col className="sml-col-money" />
              <col className="sml-col-money" />
              <col className="sml-col-money" />
              <col className="sml-col-rate" />
              <col className="sml-col-money" />
              <col className="sml-col-tax" />
              <col className="sml-col-money" />
              <col className="sml-col-user" />
            </colgroup>
            <thead>
              <tr className="print-sml-section-row">
                <th colSpan={15}>หัวเอกสาร</th>
              </tr>
              <tr className="print-sml-doc-header">
                <th>เอกสารวันที่</th>
                <th>เอกสารเลขที่</th>
                <th>เวลา</th>
                <th>เอกสารอ้างอิง</th>
                <th>รหัส{copy.partyLabel}</th>
                <th>ชื่อ{copy.partyLabel}</th>
                <th className="numeric">มูลค่าสินค้า</th>
                <th className="numeric">มูลค่าส่วนลด</th>
                <th className="numeric">มูลค่าหลังหักส่วนลด</th>
                <th className="numeric">มูลค่ายกเว้นภาษี</th>
                <th className="numeric">อัตราภาษี</th>
                <th className="numeric">ภาษีมูลค่าเพิ่ม</th>
                <th>ประเภทภาษี</th>
                <th className="numeric">มูลค่าสุทธิ</th>
                <th>Cashier</th>
              </tr>
              <tr className="print-sml-detail-header">
                <th>เอกสารวันที่</th>
                <th>ชื่อ{copy.partyLabel}</th>
                <th>รหัสสินค้า</th>
                <th>ชื่อสินค้า</th>
                <th>คลัง</th>
                <th>พื้นที่เก็บ</th>
                <th>หน่วยนับ</th>
                <th className="numeric">จำนวน</th>
                <th className="numeric">ราคา</th>
                <th>ส่วนลด</th>
                <th className="numeric">มูลค่าส่วนลด</th>
                <th className="numeric">รวมมูลค่า</th>
                <th>ประเภทภาษี</th>
                <th />
                <th />
              </tr>
            </thead>
            <tbody>
              {printState.documents.map((entry, index) => (
                <DetailedPrintSmlRows
                  entry={entry}
                  index={index + 1}
                  key={`${entry.document.doc_date}-${entry.document.doc_no}`}
                />
              ))}
            </tbody>
          </table>
        </div>

        <footer className="print-footer">
          AI Business Center · {formatTenantName(snapshot.tenant_id)} ·{" "}
          {copy.title} · รายงานนี้ใช้ยอดหัวเอกสารจาก SML เป็นยอดหลัก
        </footer>
      </div>
    </section>
  );
}

function PrintSummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="print-summary-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DetailedPrintSmlRows({
  entry,
  index,
}: {
  entry: DetailedPrintDocument;
  index: number;
}) {
  const document = entry.detail?.document ?? entry.document;
  const party = document.cust_name || document.cust_code || "-";
  const lines = entry.detail?.lines ?? [];

  return (
    <>
      <tr className="print-sml-doc-row">
        <td>{formatSmlDate(document.doc_date)}</td>
        <td>
          <strong>{document.doc_no}</strong>
          <span className="print-muted">ลำดับ {formatInteger(index)}</span>
        </td>
        <td>{document.doc_time ? formatTime(document.doc_time) : ""}</td>
        <td>{document.doc_ref || ""}</td>
        <td>{document.cust_code || ""}</td>
        <td>{party}</td>
        <td className="numeric">{formatMoney(document.total_value)}</td>
        <td className="numeric">{formatSmlOptionalMoney(document.total_discount)}</td>
        <td className="numeric">{formatMoney(document.total_except_discount)}</td>
        <td className="numeric">{formatMoney(document.total_except_vat)}</td>
        <td className="numeric">{formatSmlOptionalQty(document.vat_rate)}</td>
        <td className="numeric">{formatSmlOptionalMoney(document.total_vat_value)}</td>
        <td>{document.vat_type || ""}</td>
        <td className="numeric">
          <strong>{formatMoney(document.total_amount)}</strong>
        </td>
        <td>{document.cashier_code || ""}</td>
      </tr>
      {entry.error ? (
        <tr className="print-sml-error-row">
          <td colSpan={15}>{entry.error}</td>
        </tr>
      ) : lines.length ? (
        lines.map((line, lineIndex) => (
          <tr
            className="print-sml-detail-row"
            key={`${line.doc_no}-${line.line_number ?? lineIndex}`}
          >
            <td>{formatSmlDate(line.doc_date || document.doc_date)}</td>
            <td>{line.cust_name || party}</td>
            <td>
              {line.item_code || ""}
              {line.barcode ? (
                <span className="print-muted">Barcode: {line.barcode}</span>
              ) : null}
            </td>
            <td>{line.item_name || ""}</td>
            <td>{line.wh_code || ""}</td>
            <td>{line.shelf_code || ""}</td>
            <td>{line.unit_name || line.unit_code || ""}</td>
            <td className="numeric">{formatQty(line.qty)}</td>
            <td className="numeric">{formatSmlOptionalMoney(line.price)}</td>
            <td>{line.discount || ""}</td>
            <td className="numeric">{formatSmlOptionalMoney(line.discount_amount)}</td>
            <td className="numeric">{formatMoney(line.sum_amount)}</td>
            <td>{[line.vat_type, line.tax_type].filter(Boolean).join(" / ")}</td>
            <td />
            <td />
          </tr>
        ))
      ) : (
        <tr className="print-sml-empty-row">
          <td colSpan={15}>ไม่พบรายละเอียดสินค้าในเอกสารนี้</td>
        </tr>
      )}
    </>
  );
}

function DetailedPrintStyles() {
  return (
    <style>{`
      @media screen {
        .detailed-print-report {
          display: none;
        }

        .detailed-print-screen-mode .screen-report-viewer {
          display: none;
        }

        .detailed-print-screen-mode .detailed-print-report {
          display: block;
          min-height: 100vh;
          overflow-x: auto;
          padding: 16px;
        }

        .detailed-print-screen-mode .print-screen-toolbar {
          align-items: flex-start;
          background: #ffffff;
          border: 1px solid #e4e7ec;
          border-radius: 12px;
          box-shadow: 0 1px 3px rgba(16, 24, 40, 0.08);
          display: flex;
          gap: 16px;
          justify-content: space-between;
          margin: 0 auto 12px;
          max-width: 1280px;
          padding: 14px 16px;
        }

        .detailed-print-screen-mode .print-page {
          background: #ffffff;
          border: 1px solid #e4e7ec;
          border-radius: 12px;
          box-shadow: 0 1px 3px rgba(16, 24, 40, 0.08);
          color: #101828;
          font-family: Arial, "Noto Sans Thai", "Tahoma", sans-serif;
          font-size: 11px;
          line-height: 1.45;
          margin: 0 auto;
          max-width: 1280px;
          min-width: 1100px;
          padding: 18px;
        }

        .detailed-print-screen-mode .print-report-header {
          align-items: flex-start;
          border-bottom: 1px solid #d0d5dd;
          display: flex;
          justify-content: space-between;
          gap: 18px;
          padding-bottom: 10px;
        }

        .detailed-print-screen-mode .print-report-header h1 {
          color: #101828;
          font-size: 22px;
          font-weight: 700;
          line-height: 1.25;
          margin: 4px 0 0;
        }

        .detailed-print-screen-mode .print-eyebrow,
        .detailed-print-screen-mode .print-subtitle,
        .detailed-print-screen-mode .print-header-meta,
        .detailed-print-screen-mode .print-footer,
        .detailed-print-screen-mode .print-muted {
          color: #667085;
        }

        .detailed-print-screen-mode .print-eyebrow {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0;
          margin: 0;
        }

        .detailed-print-screen-mode .print-subtitle,
        .detailed-print-screen-mode .print-header-meta p {
          font-size: 11px;
          margin: 3px 0 0;
        }

        .detailed-print-screen-mode .print-header-meta {
          text-align: right;
          white-space: nowrap;
        }

        .detailed-print-screen-mode .print-summary-grid {
          display: grid;
          grid-template-columns: repeat(6, minmax(0, 1fr));
          gap: 8px;
          margin: 12px 0;
        }

        .detailed-print-screen-mode .print-summary-item {
          border: 1px solid #e4e7ec;
          border-radius: 8px;
          padding: 8px 10px;
        }

        .detailed-print-screen-mode .print-summary-item span {
          color: #667085;
          display: block;
          font-size: 10px;
        }

        .detailed-print-screen-mode .print-summary-item strong {
          color: #101828;
          display: block;
          font-size: 13px;
          margin-top: 3px;
        }

        .detailed-print-screen-mode .print-warning {
          background: #fffaeb;
          border: 1px solid #fedf89;
          border-radius: 8px;
          color: #93370d;
          margin: 0 0 10px;
          padding: 8px 10px;
        }

        .detailed-print-screen-mode .print-sml-table-wrap {
          border: 1px solid #d0d5dd;
          border-radius: 8px;
          overflow-x: auto;
        }

        .detailed-print-screen-mode .print-sml-table {
          border-collapse: collapse;
          min-width: 1320px;
          table-layout: fixed;
          width: 100%;
        }

        .detailed-print-screen-mode .print-sml-table th,
        .detailed-print-screen-mode .print-sml-table td {
          border: 1px solid #d0d5dd;
          padding: 5px 6px;
          text-align: left;
          vertical-align: top;
          word-break: break-word;
        }

        .detailed-print-screen-mode .print-sml-table th {
          color: #344054;
          font-size: 10px;
          font-weight: 700;
        }

        .detailed-print-screen-mode .print-sml-section-row th {
          background: #e0f2fe;
          color: #075985;
          font-size: 11px;
          text-align: left;
        }

        .detailed-print-screen-mode .print-sml-doc-header th {
          background: #f2f4f7;
        }

        .detailed-print-screen-mode .print-sml-detail-header th {
          background: #f9fafb;
          color: #667085;
        }

        .detailed-print-screen-mode .print-sml-doc-row td {
          background: #ffffff;
          color: #101828;
          font-size: 10.5px;
          font-weight: 600;
        }

        .detailed-print-screen-mode .print-sml-detail-row td {
          background: #fcfcfd;
          color: #344054;
          font-size: 10px;
        }

        .detailed-print-screen-mode .print-sml-error-row td,
        .detailed-print-screen-mode .print-sml-empty-row td {
          background: #fff7ed;
          color: #b42318;
          font-size: 10px;
        }

        .detailed-print-screen-mode .sml-col-date {
          width: 78px;
        }

        .detailed-print-screen-mode .sml-col-doc,
        .detailed-print-screen-mode .sml-col-ref {
          width: 104px;
        }

        .detailed-print-screen-mode .sml-col-time,
        .detailed-print-screen-mode .sml-col-rate,
        .detailed-print-screen-mode .sml-col-tax {
          width: 58px;
        }

        .detailed-print-screen-mode .sml-col-code,
        .detailed-print-screen-mode .sml-col-user {
          width: 78px;
        }

        .detailed-print-screen-mode .sml-col-name {
          width: 220px;
        }

        .detailed-print-screen-mode .sml-col-money {
          width: 88px;
        }

        .detailed-print-screen-mode .print-document-list {
          display: grid;
          gap: 12px;
        }

        .detailed-print-screen-mode .print-document-block {
          background: #ffffff;
          border: 1px solid #d0d5dd;
          border-radius: 10px;
          overflow: hidden;
        }

        .detailed-print-screen-mode .print-document-heading {
          background: #f8fafc;
          border-bottom: 1px solid #e4e7ec;
          display: grid;
          gap: 12px;
          grid-template-columns: 220px minmax(0, 1fr);
          padding: 10px 12px;
        }

        .detailed-print-screen-mode .print-document-title span,
        .detailed-print-screen-mode .print-meta-item span,
        .detailed-print-screen-mode .print-amount-item span {
          color: #667085;
          display: block;
          font-size: 10px;
          font-weight: 600;
        }

        .detailed-print-screen-mode .print-document-title strong {
          color: #101828;
          display: block;
          font-size: 16px;
          line-height: 1.25;
          margin-top: 3px;
        }

        .detailed-print-screen-mode .print-document-title small {
          color: #667085;
          display: block;
          font-size: 10px;
          margin-top: 3px;
        }

        .detailed-print-screen-mode .print-document-meta-grid {
          display: grid;
          gap: 8px;
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }

        .detailed-print-screen-mode .print-meta-item strong {
          color: #101828;
          display: block;
          font-size: 11px;
          line-height: 1.35;
          margin-top: 2px;
        }

        .detailed-print-screen-mode .print-amount-strip {
          display: grid;
          gap: 0;
          grid-template-columns: repeat(5, minmax(0, 1fr));
        }

        .detailed-print-screen-mode .print-amount-item {
          border-bottom: 1px solid #e4e7ec;
          border-right: 1px solid #e4e7ec;
          padding: 8px 10px;
        }

        .detailed-print-screen-mode .print-amount-item:last-child {
          border-right: 0;
        }

        .detailed-print-screen-mode .print-amount-item strong {
          color: #101828;
          display: block;
          font-size: 12px;
          line-height: 1.25;
          margin-top: 3px;
        }

        .detailed-print-screen-mode .print-amount-item.is-emphasis strong {
          color: #1d4ed8;
          font-size: 14px;
        }

        .detailed-print-screen-mode .print-document-technical {
          align-items: center;
          background: #f9fafb;
          border-top: 1px solid #e4e7ec;
          color: #667085;
          display: flex;
          flex-wrap: wrap;
          gap: 6px 12px;
          padding: 7px 10px;
        }

        .detailed-print-screen-mode .print-document-technical span {
          color: #344054;
          font-weight: 700;
        }

        .detailed-print-screen-mode .print-document-technical small {
          font-size: 10px;
        }

        .detailed-print-screen-mode .print-line-table {
          border-collapse: collapse;
          table-layout: fixed;
          width: 100%;
        }

        .detailed-print-screen-mode .print-line-table th,
        .detailed-print-screen-mode .print-line-table td {
          border: 1px solid #d0d5dd;
          padding: 5px 6px;
          text-align: left;
          vertical-align: top;
          word-break: break-word;
        }

        .detailed-print-screen-mode .print-line-table th {
          background: #f2f4f7;
          color: #344054;
          font-size: 10px;
          font-weight: 700;
        }

        .detailed-print-screen-mode .print-line-table td strong,
        .detailed-print-screen-mode .print-muted {
          display: block;
        }

        .detailed-print-screen-mode .print-muted {
          font-size: 9px;
          margin-top: 2px;
        }

        .detailed-print-screen-mode .print-line-table th,
        .detailed-print-screen-mode .print-line-table td {
          border-color: #e4e7ec;
        }

        .detailed-print-screen-mode .line-index-col {
          width: 42px;
        }

        .detailed-print-screen-mode .line-code-col {
          width: 138px;
        }

        .detailed-print-screen-mode .line-location-col {
          width: 142px;
        }

        .detailed-print-screen-mode .line-number-col {
          width: 82px;
        }

        .detailed-print-screen-mode .line-money-col {
          width: 110px;
        }

        .detailed-print-screen-mode .line-tax-col {
          width: 82px;
        }

        .detailed-print-screen-mode .numeric {
          text-align: right !important;
          white-space: nowrap;
        }

        .detailed-print-screen-mode .print-detail-error,
        .detailed-print-screen-mode .print-empty-line {
          color: #b42318;
          padding: 8px 10px;
        }

        .detailed-print-screen-mode .print-footer {
          border-top: 1px solid #d0d5dd;
          font-size: 10px;
          margin-top: 10px;
          padding-top: 8px;
        }
      }

      @media print {
        @page {
          size: A4 landscape;
          margin: 8mm;
        }

        html,
        body {
          background: #ffffff !important;
        }

        .detailed-print-ready .screen-report-viewer {
          display: none !important;
        }

        .detailed-print-ready .detailed-print-report {
          display: block !important;
        }

        .detailed-print-report {
          display: none;
          color: #111827;
          font-family: Arial, "Noto Sans Thai", "Tahoma", sans-serif;
          font-size: 9px;
          line-height: 1.35;
        }

        .print-screen-toolbar {
          display: none !important;
        }

        .print-page {
          width: 100%;
        }

        .print-report-header {
          align-items: flex-start;
          border-bottom: 1px solid #d0d5dd;
          display: flex;
          justify-content: space-between;
          gap: 18px;
          padding-bottom: 8px;
        }

        .print-report-header h1 {
          color: #101828;
          font-size: 18px;
          font-weight: 700;
          line-height: 1.2;
          margin: 2px 0 0;
        }

        .print-eyebrow,
        .print-subtitle,
        .print-header-meta,
        .print-footer,
        .print-muted {
          color: #667085;
        }

        .print-eyebrow {
          font-size: 8.5px;
          font-weight: 700;
          letter-spacing: 0;
          margin: 0;
        }

        .print-subtitle,
        .print-header-meta p {
          font-size: 9px;
          margin: 2px 0 0;
        }

        .print-header-meta {
          text-align: right;
          white-space: nowrap;
        }

        .print-summary-grid {
          display: grid;
          grid-template-columns: repeat(6, minmax(0, 1fr));
          gap: 5px;
          margin: 8px 0;
        }

        .print-summary-item {
          border: 1px solid #e4e7ec;
          border-radius: 4px;
          padding: 5px 6px;
        }

        .print-summary-item span {
          color: #667085;
          display: block;
          font-size: 8px;
        }

        .print-summary-item strong {
          color: #101828;
          display: block;
          font-size: 10px;
          margin-top: 2px;
        }

        .print-warning {
          background: #fffaeb;
          border: 1px solid #fedf89;
          border-radius: 4px;
          color: #93370d;
          margin: 0 0 8px;
          padding: 5px 6px;
        }

        .print-sml-table-wrap {
          overflow: visible;
        }

        .print-sml-table {
          border-collapse: collapse;
          table-layout: fixed;
          width: 100%;
        }

        .print-sml-table thead {
          display: table-header-group;
        }

        .print-sml-table th,
        .print-sml-table td {
          border: 1px solid #cbd5e1;
          padding: 2.5px 3px;
          text-align: left;
          vertical-align: top;
          word-break: break-word;
        }

        .print-sml-table th {
          color: #344054;
          font-size: 6.8px;
          font-weight: 700;
        }

        .print-sml-table td {
          font-size: 6.8px;
        }

        .print-sml-section-row th {
          background: #e0f2fe;
          color: #075985;
          text-align: left;
        }

        .print-sml-doc-header th {
          background: #f2f4f7;
        }

        .print-sml-detail-header th {
          background: #f9fafb;
          color: #667085;
        }

        .print-sml-doc-row {
          break-after: avoid;
          page-break-after: avoid;
        }

        .print-sml-doc-row td {
          background: #ffffff;
          color: #101828;
          font-weight: 700;
        }

        .print-sml-detail-row {
          break-inside: avoid;
          page-break-inside: avoid;
        }

        .print-sml-detail-row td {
          background: #fcfcfd;
          color: #344054;
        }

        .print-sml-error-row td,
        .print-sml-empty-row td {
          background: #fff7ed;
          color: #b42318;
        }

        .sml-col-date {
          width: 7%;
        }

        .sml-col-doc,
        .sml-col-ref {
          width: 8%;
        }

        .sml-col-time,
        .sml-col-rate,
        .sml-col-tax {
          width: 4.8%;
        }

        .sml-col-code,
        .sml-col-user {
          width: 6.3%;
        }

        .sml-col-name {
          width: 15%;
        }

        .sml-col-money {
          width: 7%;
        }

        .print-document-list {
          display: grid;
          gap: 7px;
        }

        .print-document-block {
          background: #ffffff;
          border: 1px solid #d0d5dd;
          border-radius: 4px;
          break-inside: avoid;
          overflow: hidden;
          page-break-inside: avoid;
        }

        .print-document-heading {
          background: #f8fafc;
          border-bottom: 1px solid #e4e7ec;
          display: grid;
          gap: 7px;
          grid-template-columns: 142px minmax(0, 1fr);
          padding: 5px 6px;
        }

        .print-document-title span,
        .print-meta-item span,
        .print-amount-item span {
          color: #667085;
          display: block;
          font-size: 7px;
          font-weight: 700;
        }

        .print-document-title strong {
          color: #101828;
          display: block;
          font-size: 11px;
          line-height: 1.2;
          margin-top: 1px;
        }

        .print-document-title small {
          color: #667085;
          display: block;
          font-size: 7px;
          margin-top: 1px;
        }

        .print-document-meta-grid {
          display: grid;
          gap: 4px 6px;
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }

        .print-meta-item strong {
          color: #101828;
          display: block;
          font-size: 8px;
          line-height: 1.25;
          margin-top: 1px;
        }

        .print-amount-strip {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
        }

        .print-amount-item {
          border-bottom: 1px solid #e4e7ec;
          border-right: 1px solid #e4e7ec;
          padding: 4px 5px;
        }

        .print-amount-item:last-child {
          border-right: 0;
        }

        .print-amount-item strong {
          color: #101828;
          display: block;
          font-size: 8px;
          line-height: 1.2;
          margin-top: 1px;
        }

        .print-amount-item.is-emphasis strong {
          color: #1d4ed8;
          font-size: 9px;
        }

        .print-document-technical {
          align-items: center;
          background: #f9fafb;
          border-top: 1px solid #e4e7ec;
          color: #667085;
          display: flex;
          flex-wrap: wrap;
          gap: 3px 8px;
          padding: 4px 5px;
        }

        .print-document-technical span {
          color: #344054;
          font-weight: 700;
        }

        .print-document-technical small {
          font-size: 7px;
        }

        .print-line-table {
          border-collapse: collapse;
          table-layout: fixed;
          width: 100%;
        }

        .print-line-table th,
        .print-line-table td {
          border: 1px solid #d0d5dd;
          padding: 3px 4px;
          text-align: left;
          vertical-align: top;
          word-break: break-word;
        }

        .print-line-table th {
          background: #f2f4f7;
          color: #344054;
          font-size: 8px;
          font-weight: 700;
        }

        .print-line-table td strong,
        .print-muted {
          display: block;
          font-size: 7.5px;
          margin-top: 1px;
        }

        .print-line-table th,
        .print-line-table td {
          border-color: #e4e7ec;
        }

        .print-line-table tr {
          break-inside: avoid;
          page-break-inside: avoid;
        }

        .line-index-col {
          width: 28px;
        }

        .line-code-col {
          width: 98px;
        }

        .line-location-col {
          width: 98px;
        }

        .line-number-col {
          width: 58px;
        }

        .line-money-col {
          width: 76px;
        }

        .line-tax-col {
          width: 58px;
        }

        .numeric {
          text-align: right !important;
          white-space: nowrap;
        }

        .print-detail-error,
        .print-empty-line {
          color: #b42318;
          padding: 5px 6px;
        }

        .print-footer {
          border-top: 1px solid #d0d5dd;
          font-size: 8px;
          margin-top: 8px;
          padding-top: 5px;
        }
      }
    `}</style>
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

function buildViewerPdfUrl(input: {
  viewer: ViewerParams;
  dateFrom: string;
  dateTo: string;
}) {
  const params = new URLSearchParams({
    token: input.viewer.token,
    run_id: input.viewer.runId,
    date_from: input.dateFrom,
    date_to: input.dateTo,
    pdf_layout: REPORT_PDF_LAYOUT_VERSION,
  });
  return `${API_BASE_URL}/api/reports/${encodeURIComponent(
    input.viewer.tenantId,
  )}/${encodeURIComponent(input.viewer.reportKey)}/pdf?${params}`;
}

function buildViewerPdfPrepareUrl(input: {
  viewer: ViewerParams;
  dateFrom: string;
  dateTo: string;
}) {
  const params = new URLSearchParams({
    token: input.viewer.token,
    run_id: input.viewer.runId,
    date_from: input.dateFrom,
    date_to: input.dateTo,
    pdf_layout: REPORT_PDF_LAYOUT_VERSION,
  });
  return `${API_BASE_URL}/api/reports/${encodeURIComponent(
    input.viewer.tenantId,
  )}/${encodeURIComponent(input.viewer.reportKey)}/pdf/prepare?${params}`;
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

function formatSmlDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return value;
  }
  return `${day}/${month}/${year + 543}`;
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

function formatSmlOptionalMoney(value: number) {
  return value ? formatMoney(value) : "";
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

function formatSmlOptionalQty(value: number) {
  return value ? formatQty(value) : "";
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
