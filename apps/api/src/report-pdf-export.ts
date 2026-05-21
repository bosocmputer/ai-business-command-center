import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import {
  type ReportKey,
  type ReportSnapshot,
  type SalesDetailRow,
  type SalesGoodsServicesParams,
  type SalesHeaderRow,
  type TenantId,
} from "@ai-bcc/shared";
import type { ReportPdfRows } from "./report-runner.js";

export const REPORT_PDF_LAYOUT_VERSION = "sml-row-v1";
export const REPORT_PDF_MAX_DOCUMENTS = 300;
export const REPORT_PDF_MAX_DETAIL_ROWS = 5000;
export const REPORT_PDF_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let browserPromise: Promise<Browser> | null = null;

export type ReportPdfCacheIdentity = {
  tenantId: TenantId;
  reportKey: ReportKey;
  runId: string;
  dateFrom: string;
  dateTo: string;
  layoutVersion?: string;
};

export type ReportPdfLimitResult =
  | { ok: true }
  | { ok: false; statusCode: 422; error: string };

export type ReportPdfBuildResult = {
  pdf: Buffer;
  filename: string;
  cacheHit: boolean;
  cachePath: string;
};

export type CachedReportPdf = {
  pdf: Buffer;
  filename: string;
  cachePath: string;
};

export function getReportPdfCacheDir() {
  const configuredDir = process.env.PDF_CACHE_DIR?.trim();
  if (configuredDir) {
    return configuredDir;
  }

  return process.env.NODE_ENV === "production"
    ? "/app/.data/pdf-cache"
    : path.join(process.cwd(), ".data/pdf-cache");
}

export function buildReportPdfCacheKey(input: ReportPdfCacheIdentity) {
  const layoutVersion = input.layoutVersion ?? REPORT_PDF_LAYOUT_VERSION;
  return createHash("sha256")
    .update(
      [
        input.tenantId,
        input.reportKey,
        input.runId,
        input.dateFrom,
        input.dateTo,
        layoutVersion,
      ].join("|"),
    )
    .digest("hex");
}

export function buildReportPdfFilename(input: {
  tenantId: TenantId;
  tenantSlug?: string | null;
  reportKey: ReportKey;
  dateFrom: string;
  dateTo: string;
}) {
  const tenantLabel = (input.tenantSlug || input.tenantId)
    .replace(/^tenant[_-]/, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase()
    .slice(0, 48);
  const dateLabel =
    input.dateFrom === input.dateTo
      ? input.dateFrom
      : `${input.dateFrom}_to_${input.dateTo}`;
  return `${tenantLabel || "TENANT"}_${input.reportKey}_${dateLabel}.pdf`;
}

export function validateReportPdfLimits(input: {
  documentCount: number;
  detailRowCount: number;
}): ReportPdfLimitResult {
  if (input.documentCount > REPORT_PDF_MAX_DOCUMENTS) {
    return {
      ok: false,
      statusCode: 422,
      error: `ช่วงนี้มี ${input.documentCount.toLocaleString("th-TH")} เอกสาร ซึ่งเกินขีดจำกัด PDF pilot (${REPORT_PDF_MAX_DOCUMENTS.toLocaleString("th-TH")} เอกสาร) กรุณาเลือกช่วงวันที่สั้นลง`,
    };
  }

  if (input.detailRowCount > REPORT_PDF_MAX_DETAIL_ROWS) {
    return {
      ok: false,
      statusCode: 422,
      error: `ช่วงนี้มีรายละเอียด ${input.detailRowCount.toLocaleString("th-TH")} แถว ซึ่งเกินขีดจำกัด PDF pilot (${REPORT_PDF_MAX_DETAIL_ROWS.toLocaleString("th-TH")} แถว) กรุณาเลือกช่วงวันที่สั้นลง`,
    };
  }

  return { ok: true };
}

export async function cleanupReportPdfCache(input?: {
  cacheDir?: string;
  now?: Date;
}) {
  const cacheDir = input?.cacheDir ?? getReportPdfCacheDir();
  const nowMs = (input?.now ?? new Date()).getTime();
  await mkdir(cacheDir, { recursive: true });
  const files = await readdir(cacheDir, { withFileTypes: true });

  await Promise.all(
    files
      .filter((file) => file.isFile() && file.name.endsWith(".pdf"))
      .map(async (file) => {
        const filePath = path.join(cacheDir, file.name);
        const fileStat = await stat(filePath).catch(() => null);
        if (!fileStat) {
          return;
        }
        if (nowMs - fileStat.mtime.getTime() > REPORT_PDF_CACHE_TTL_MS) {
          await unlink(filePath).catch(() => undefined);
        }
      }),
  );
}

export async function buildReportPdf(input: {
  cacheDir?: string;
  tenantName?: string | null;
  tenantSlug?: string | null;
  snapshot: ReportSnapshot;
  rows: ReportPdfRows;
  tokenRunId: string;
  params: SalesGoodsServicesParams;
}): Promise<ReportPdfBuildResult> {
  const cacheDir = input.cacheDir ?? getReportPdfCacheDir();
  await mkdir(cacheDir, { recursive: true });

  const cacheKey = buildReportPdfCacheKey({
    tenantId: input.snapshot.tenant_id,
    reportKey: input.snapshot.report_key,
    runId: input.tokenRunId,
    dateFrom: input.params.date_from,
    dateTo: input.params.date_to,
  });
  const cachePath = path.join(cacheDir, `${cacheKey}.pdf`);
  const filename = buildReportPdfFilename({
    tenantId: input.snapshot.tenant_id,
    tenantSlug: input.tenantSlug,
    reportKey: input.snapshot.report_key,
    dateFrom: input.params.date_from,
    dateTo: input.params.date_to,
  });
  const cachedPdf = await readFile(cachePath).catch(() => null);
  if (cachedPdf) {
    return {
      pdf: cachedPdf,
      filename,
      cacheHit: true,
      cachePath,
    };
  }

  const html = renderReportPdfHtml({
    tenantName: input.tenantName ?? input.snapshot.tenant_id,
    snapshot: input.snapshot,
    rows: input.rows,
    params: input.params,
  });
  const pdf = await renderHtmlToPdf(html);
  await writeFile(cachePath, pdf);

  return {
    pdf,
    filename,
    cacheHit: false,
    cachePath,
  };
}

export async function readCachedReportPdf(input: {
  cacheDir?: string;
  tenantId: TenantId;
  tenantSlug?: string | null;
  reportKey: ReportKey;
  runId: string;
  dateFrom: string;
  dateTo: string;
}): Promise<CachedReportPdf | null> {
  const cacheDir = input.cacheDir ?? getReportPdfCacheDir();
  await mkdir(cacheDir, { recursive: true });
  const cacheKey = buildReportPdfCacheKey({
    tenantId: input.tenantId,
    reportKey: input.reportKey,
    runId: input.runId,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
  });
  const cachePath = path.join(cacheDir, `${cacheKey}.pdf`);
  const pdf = await readFile(cachePath).catch(() => null);
  if (!pdf) {
    return null;
  }

  return {
    pdf,
    filename: buildReportPdfFilename({
      tenantId: input.tenantId,
      tenantSlug: input.tenantSlug,
      reportKey: input.reportKey,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
    }),
    cachePath,
  };
}

export async function closeReportPdfBrowser() {
  const browser = await browserPromise?.catch(() => null);
  browserPromise = null;
  await browser?.close().catch(() => undefined);
}

export function renderReportPdfHtml(input: {
  tenantName: string;
  snapshot: ReportSnapshot;
  rows: ReportPdfRows;
  params: SalesGoodsServicesParams;
}) {
  const copy = getReportCopy(input.snapshot.report_key);
  const generatedAt = new Date().toISOString();
  const linesByDocument = groupLinesByDocument(input.rows.lines);
  const totalAmount = input.rows.documents.reduce(
    (sum, document) => sum + safeNumber(document.total_amount),
    0,
  );
  const totalQty = input.rows.lines.reduce((sum, line) => sum + safeNumber(line.qty), 0);
  const totalLineRows = input.rows.lines.length;

  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(copy.title)} ${escapeHtml(input.params.date_from)}</title>
  <style>
    @page { size: A4 landscape; margin: 8mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #101828;
      font-family: "Noto Sans Thai", "Noto Sans", Tahoma, Arial, sans-serif;
      font-size: 8px;
      line-height: 1.35;
      background: #ffffff;
    }
    .report-header {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding-bottom: 6px;
      border-bottom: 1px solid #98a2b3;
      margin-bottom: 6px;
    }
    .eyebrow {
      margin: 0 0 2px;
      color: #475467;
      font-size: 7px;
      font-weight: 700;
      text-transform: uppercase;
    }
    h1 {
      margin: 0;
      font-size: 13px;
      line-height: 1.25;
      font-weight: 700;
      letter-spacing: 0;
    }
    .subtitle,
    .meta p {
      margin: 2px 0 0;
      color: #475467;
      font-size: 7.5px;
    }
    .meta {
      min-width: 230px;
      text-align: right;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 5px;
      margin-bottom: 6px;
    }
    .summary div {
      border: 1px solid #d0d5dd;
      padding: 4px 5px;
      min-height: 30px;
    }
    .summary span {
      display: block;
      color: #667085;
      font-size: 6.8px;
    }
    .summary strong {
      display: block;
      margin-top: 1px;
      font-size: 9px;
      color: #101828;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
    th,
    td {
      border: 0.5px solid #98a2b3;
      padding: 2px 3px;
      vertical-align: top;
      overflow-wrap: anywhere;
    }
    th {
      background: #eef2f6;
      font-weight: 700;
      text-align: left;
    }
    .detail-head th {
      background: #f8fafc;
      color: #344054;
    }
    tr { page-break-inside: avoid; }
    .doc-row td {
      background: #ffffff;
      font-weight: 700;
    }
    .detail-row td {
      color: #344054;
      background: #ffffff;
    }
    .empty-row td {
      color: #667085;
      font-style: italic;
    }
    .numeric { text-align: right; white-space: nowrap; }
    .muted {
      display: block;
      color: #667085;
      font-size: 6.5px;
      font-weight: 400;
    }
    .col-date { width: 7%; }
    .col-doc { width: 9%; }
    .col-time { width: 5%; }
    .col-ref { width: 8%; }
    .col-code { width: 7%; }
    .col-name { width: 15%; }
    .col-money { width: 7%; }
    .col-rate { width: 5%; }
    .col-tax { width: 5%; }
    .col-user { width: 6%; }
  </style>
</head>
<body>
  <header class="report-header">
    <div>
      <p class="eyebrow">AI Business Center - SML Detailed Row Export</p>
      <h1>${escapeHtml(copy.title)}</h1>
      <p class="subtitle">${escapeHtml(input.tenantName)} - ${escapeHtml(formatReportPeriod(input.params))}</p>
    </div>
    <div class="meta">
      <p>Generated: ${escapeHtml(formatDateTime(generatedAt))}</p>
      <p>Run ID: ${escapeHtml(input.snapshot.run_id)}</p>
      <p>Layout: ${REPORT_PDF_LAYOUT_VERSION}</p>
    </div>
  </header>
  <section class="summary">
    <div><span>${escapeHtml(copy.totalLabel)}</span><strong>${escapeHtml(formatMoney(totalAmount))} THB</strong></div>
    <div><span>${escapeHtml(copy.documentLabel)}</span><strong>${escapeHtml(formatInteger(input.rows.documents.length))}</strong></div>
    <div><span>${escapeHtml(copy.lineLabel)}</span><strong>${escapeHtml(formatInteger(totalLineRows))}</strong></div>
    <div><span>${escapeHtml(copy.qtyLabel)}</span><strong>${escapeHtml(formatQty(totalQty))}</strong></div>
    <div><span>Data source</span><strong>${escapeHtml(input.snapshot.source)}</strong></div>
  </section>
  <table>
    <colgroup>
      <col class="col-date" />
      <col class="col-doc" />
      <col class="col-time" />
      <col class="col-ref" />
      <col class="col-code" />
      <col class="col-name" />
      <col class="col-money" />
      <col class="col-money" />
      <col class="col-money" />
      <col class="col-money" />
      <col class="col-rate" />
      <col class="col-money" />
      <col class="col-tax" />
      <col class="col-money" />
      <col class="col-user" />
    </colgroup>
    <thead>
      <tr>
        <th>เอกสารวันที่</th>
        <th>เอกสารเลขที่</th>
        <th>เวลา</th>
        <th>เอกสารอ้างอิง</th>
        <th>รหัส${escapeHtml(copy.partyLabel)}</th>
        <th>ชื่อ${escapeHtml(copy.partyLabel)}</th>
        <th class="numeric">มูลค่าสินค้า</th>
        <th class="numeric">มูลค่าส่วนลด</th>
        <th class="numeric">หลังหักส่วนลด</th>
        <th class="numeric">ยกเว้นภาษี</th>
        <th class="numeric">อัตราภาษี</th>
        <th class="numeric">ภาษี</th>
        <th>ประเภทภาษี</th>
        <th class="numeric">มูลค่าสุทธิ</th>
        <th>Cashier</th>
      </tr>
      <tr class="detail-head">
        <th>เอกสารวันที่</th>
        <th>ชื่อ${escapeHtml(copy.partyLabel)}</th>
        <th colspan="2">รหัสสินค้า / Barcode</th>
        <th colspan="2">ชื่อสินค้า</th>
        <th>คลัง</th>
        <th>พื้นที่เก็บ</th>
        <th>หน่วยนับ</th>
        <th class="numeric">จำนวน</th>
        <th class="numeric">ราคา</th>
        <th>ส่วนลด</th>
        <th class="numeric">มูลค่าส่วนลด</th>
        <th class="numeric">รวมมูลค่า</th>
        <th>ประเภทภาษี</th>
      </tr>
    </thead>
    <tbody>
      ${input.rows.documents
        .map((document, index) =>
          renderDocumentRows({
            document,
            lines: linesByDocument.get(documentKey(document)) ?? [],
            index: index + 1,
            partyLabel: copy.partyLabel,
          }),
        )
        .join("")}
    </tbody>
  </table>
</body>
</html>`;
}

async function renderHtmlToPdf(html: string) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    return await page.pdf({
      format: "A4",
      landscape: true,
      printBackground: true,
      margin: {
        top: "8mm",
        right: "8mm",
        bottom: "8mm",
        left: "8mm",
      },
      preferCSSPageSize: true,
    });
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function getBrowser() {
  browserPromise ??= chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  return browserPromise;
}

function renderDocumentRows(input: {
  document: SalesHeaderRow;
  lines: SalesDetailRow[];
  index: number;
  partyLabel: string;
}) {
  const party = input.document.cust_name || input.document.cust_code || "-";
  const docRow = `<tr class="doc-row">
    <td>${escapeHtml(formatSmlDate(input.document.doc_date))}</td>
    <td>${escapeHtml(input.document.doc_no)}<span class="muted">#${escapeHtml(formatInteger(input.index))}</span></td>
    <td>${escapeHtml(input.document.doc_time ? formatTime(input.document.doc_time) : "")}</td>
    <td>${escapeHtml(input.document.doc_ref || "")}</td>
    <td>${escapeHtml(input.document.cust_code || "")}</td>
    <td>${escapeHtml(party)}</td>
    <td class="numeric">${escapeHtml(formatMoney(input.document.total_value))}</td>
    <td class="numeric">${escapeHtml(formatOptionalMoney(input.document.total_discount))}</td>
    <td class="numeric">${escapeHtml(formatMoney(input.document.total_except_discount))}</td>
    <td class="numeric">${escapeHtml(formatMoney(input.document.total_except_vat))}</td>
    <td class="numeric">${escapeHtml(formatOptionalQty(input.document.vat_rate))}</td>
    <td class="numeric">${escapeHtml(formatOptionalMoney(input.document.total_vat_value))}</td>
    <td>${escapeHtml(input.document.vat_type || "")}</td>
    <td class="numeric">${escapeHtml(formatMoney(input.document.total_amount))}</td>
    <td>${escapeHtml(input.document.cashier_code || "")}</td>
  </tr>`;

  if (!input.lines.length) {
    return `${docRow}<tr class="empty-row"><td colspan="15">ไม่พบรายละเอียดสินค้าในเอกสารนี้</td></tr>`;
  }

  const detailRows = input.lines
    .map(
      (line) => `<tr class="detail-row">
    <td>${escapeHtml(formatSmlDate(line.doc_date || input.document.doc_date))}</td>
    <td>${escapeHtml(line.cust_name || party)}</td>
    <td colspan="2">${escapeHtml(line.item_code || "")}${line.barcode ? `<span class="muted">Barcode: ${escapeHtml(line.barcode)}</span>` : ""}</td>
    <td colspan="2">${escapeHtml(line.item_name || "")}</td>
    <td>${escapeHtml(line.wh_code || "")}</td>
    <td>${escapeHtml(line.shelf_code || "")}</td>
    <td>${escapeHtml(line.unit_name || line.unit_code || "")}</td>
    <td class="numeric">${escapeHtml(formatQty(line.qty))}</td>
    <td class="numeric">${escapeHtml(formatOptionalMoney(line.price))}</td>
    <td>${escapeHtml(line.discount || "")}</td>
    <td class="numeric">${escapeHtml(formatOptionalMoney(line.discount_amount))}</td>
    <td class="numeric">${escapeHtml(formatMoney(line.sum_amount))}</td>
    <td>${escapeHtml([line.vat_type, line.tax_type].filter(Boolean).join(" / "))}</td>
  </tr>`,
    )
    .join("");

  return `${docRow}${detailRows}`;
}

function groupLinesByDocument(lines: SalesDetailRow[]) {
  const map = new Map<string, SalesDetailRow[]>();
  for (const line of lines) {
    const key = documentKey(line);
    const current = map.get(key) ?? [];
    current.push(line);
    map.set(key, current);
  }
  return map;
}

function documentKey(row: { doc_date: string; doc_no: string }) {
  return `${row.doc_date}\u0000${row.doc_no}`;
}

function getReportCopy(reportKey: ReportKey) {
  if (reportKey === "purchase_goods_payables") {
    return {
      title: "รายงานซื้อสินค้า/ตั้งหนี้",
      totalLabel: "ยอดซื้อ/ตั้งหนี้",
      documentLabel: "เอกสารซื้อ",
      lineLabel: "รายการสินค้า",
      qtyLabel: "จำนวนซื้อรวม",
      partyLabel: "ผู้จำหน่าย",
    };
  }

  return {
    title: "รายงานขายสินค้าและบริการ",
    totalLabel: "ยอดขายสุทธิ",
    documentLabel: "บิลขาย",
    lineLabel: "รายการขาย",
    qtyLabel: "จำนวนขายรวม",
    partyLabel: "ลูกค้า",
  };
}

function formatReportPeriod(params: SalesGoodsServicesParams) {
  return params.date_from === params.date_to
    ? params.date_from
    : `${params.date_from} to ${params.date_to}`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

function formatSmlDate(value: string) {
  return value ? value.slice(0, 10) : "";
}

function formatTime(value: string) {
  return value.length >= 5 ? value.slice(0, 5) : value;
}

function formatMoney(value: number) {
  return safeNumber(value).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatOptionalMoney(value: number) {
  return Math.abs(safeNumber(value)) < 0.000001 ? "" : formatMoney(value);
}

function formatQty(value: number) {
  return safeNumber(value).toLocaleString("th-TH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function formatOptionalQty(value: number) {
  return Math.abs(safeNumber(value)) < 0.000001 ? "" : formatQty(value);
}

function formatInteger(value: number) {
  return Math.floor(safeNumber(value)).toLocaleString("th-TH");
}

function safeNumber(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
