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

export const REPORT_PDF_LAYOUT_VERSION = "sml-row-v3";
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
  const linesByDocument = groupLinesByDocument(input.rows.lines);
  const totals = calculateDocumentTotals(input.rows.documents);

  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(copy.title)} ${escapeHtml(input.params.date_from)}</title>
  <style>
    @page { size: A4 landscape; margin: 10mm 8mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #111111;
      font-family: "Noto Serif Thai", "Noto Sans Thai", Tahoma, Arial, sans-serif;
      font-size: 7.2px;
      line-height: 1.22;
      background: #ffffff;
    }
    .report-header {
      margin-bottom: 5px;
      text-align: center;
    }
    h1 {
      margin: 0 0 1px;
      font-size: 10px;
      line-height: 1.15;
      font-weight: 700;
      letter-spacing: 0;
    }
    .subtitle {
      margin: 0;
      font-size: 7.2px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    thead { display: table-header-group; }
    th,
    td {
      border: 0;
      border-bottom: 0.35px solid #d4d4d4;
      padding: 1.35px 2px;
      vertical-align: top;
      overflow-wrap: anywhere;
    }
    th {
      border-top: 0.6px solid #111111;
      border-bottom: 0.6px solid #111111;
      background: #ffffff;
      font-weight: 700;
      text-align: left;
    }
    .detail-head th,
    .detail-head .numeric {
      border-top: 0;
      font-weight: 400;
    }
    tr { break-inside: avoid; page-break-inside: avoid; }
    tbody.document-group.small {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .doc-row td {
      border-top: 0.55px solid #8a8a8a;
      border-bottom: 0;
      background: #ffffff;
      font-weight: 700;
    }
    .detail-row td {
      border-bottom: 0;
      color: #111111;
      background: #ffffff;
    }
    .continuation-row td {
      border-top: 0.55px solid #8a8a8a;
      border-bottom: 0;
      padding-top: 3px;
      color: #444444;
      font-weight: 700;
    }
    .continuation-row.page-start {
      break-before: page;
      page-break-before: always;
    }
    .doc-row.page-start {
      break-before: page;
      page-break-before: always;
    }
    .empty-row td {
      border-bottom: 0;
      color: #666666;
      font-style: italic;
    }
    .numeric { text-align: right; white-space: nowrap; }
    .item-code {
      padding-left: 12px;
      font-style: italic;
      white-space: nowrap;
    }
    .item-name {
      font-style: italic;
    }
    .muted {
      display: block;
      color: #666666;
      font-size: 6.4px;
      font-weight: 400;
    }
    tbody.report-total {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .total-row td {
      border-top: 0.7px solid #111111;
      border-bottom: 0.7px solid #111111;
      font-weight: 700;
    }
    .col-date { width: 6%; }
    .col-doc { width: 7%; }
    .col-time { width: 4.2%; }
    .col-ref-date { width: 6%; }
    .col-ref { width: 6.3%; }
    .col-code { width: 6%; }
    .col-name { width: 11.5%; }
    .col-money { width: 6.4%; }
    .col-rate { width: 4%; }
    .col-tax { width: 4.5%; }
    .col-user { width: 6%; }
  </style>
</head>
<body>
  <header class="report-header">
    <h1>${escapeHtml(input.tenantName)}</h1>
    <p class="subtitle">${escapeHtml(copy.title)}</p>
    <p class="subtitle">${escapeHtml(formatReportPeriod(input.params))}</p>
  </header>
  <table>
    <colgroup>
      <col class="col-date" />
      <col class="col-doc" />
      <col class="col-time" />
      <col class="col-ref-date" />
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
        <th>วันที่อ้างอิง</th>
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
        <th></th>
        <th colspan="2">รหัสสินค้า</th>
        <th colspan="4">ชื่อสินค้า</th>
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
    <tbody class="report-total">
      <tr class="total-row">
        <td colspan="7" class="numeric">รวมทั้งหมด</td>
        <td class="numeric">${escapeHtml(formatMoney(totals.totalValue))}</td>
        <td class="numeric">${escapeHtml(formatOptionalMoney(totals.totalDiscount))}</td>
        <td class="numeric">${escapeHtml(formatMoney(totals.totalExceptDiscount))}</td>
        <td class="numeric">${escapeHtml(formatMoney(totals.totalExceptVat))}</td>
        <td></td>
        <td class="numeric">${escapeHtml(formatOptionalMoney(totals.totalVat))}</td>
        <td></td>
        <td class="numeric">${escapeHtml(formatMoney(totals.totalAmount))}</td>
        <td></td>
      </tr>
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
    const printDate = escapeHtml(formatPrintDateTime(new Date().toISOString()));
    return await page.pdf({
      format: "A4",
      landscape: true,
      displayHeaderFooter: true,
      headerTemplate: `<div style="width:100%; margin:0 8mm; font-family:'Noto Sans Thai', Tahoma, Arial, sans-serif; font-size:6px; color:#111;">
        <span>Print Date : ${printDate}</span>
        <span style="float:right;">Page No. : <span class="pageNumber"></span>/<span class="totalPages"></span></span>
      </div>`,
      footerTemplate: `<div></div>`,
      printBackground: true,
      margin: {
        top: "10mm",
        right: "8mm",
        bottom: "10mm",
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
  const isLargeDocument = input.lines.length > 5;
  const groupClass = isLargeDocument ? "document-group large" : "document-group small";
  const forcePageStart = isLargeDocument && input.index > 1;
  const docRow = `<tr class="doc-row${forcePageStart ? " page-start" : ""}">
    <td>${escapeHtml(formatSmlDate(input.document.doc_date))}</td>
    <td>${escapeHtml(input.document.doc_no)}<span class="muted">#${escapeHtml(formatInteger(input.index))}</span></td>
    <td>${escapeHtml(input.document.doc_time ? formatTime(input.document.doc_time) : "")}</td>
    <td>${escapeHtml(input.document.doc_ref_date ? formatSmlDate(input.document.doc_ref_date) : "")}</td>
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
    return `<tbody class="${groupClass}">${docRow}<tr class="empty-row"><td colspan="16">ไม่พบรายละเอียดสินค้าในเอกสารนี้</td></tr></tbody>`;
  }

  const detailRows = chunkDetailRows(input.lines, 24)
    .map((chunk, chunkIndex) => {
      const continuationRow =
        chunkIndex === 0
          ? ""
          : `<tr class="continuation-row page-start"><td colspan="16">ต่อจากเอกสาร ${escapeHtml(input.document.doc_no)} / ${escapeHtml(party)}</td></tr>`;

      return `${continuationRow}${chunk
        .map(
          (line) => `<tr class="detail-row">
    <td></td>
    <td class="item-code" colspan="2">${escapeHtml(line.item_code || "")}</td>
    <td class="item-name" colspan="4">${escapeHtml(line.item_name || "")}</td>
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
        .join("")}`;
    })
    .join("");

  return `<tbody class="${groupClass}">${docRow}${detailRows}</tbody>`;
}

function calculateDocumentTotals(documents: SalesHeaderRow[]) {
  return documents.reduce(
    (totals, document) => ({
      totalValue: totals.totalValue + safeNumber(document.total_value),
      totalDiscount: totals.totalDiscount + safeNumber(document.total_discount),
      totalExceptDiscount:
        totals.totalExceptDiscount + safeNumber(document.total_except_discount),
      totalExceptVat: totals.totalExceptVat + safeNumber(document.total_except_vat),
      totalVat: totals.totalVat + safeNumber(document.total_vat_value),
      totalAmount: totals.totalAmount + safeNumber(document.total_amount),
    }),
    {
      totalValue: 0,
      totalDiscount: 0,
      totalExceptDiscount: 0,
      totalExceptVat: 0,
      totalVat: 0,
      totalAmount: 0,
    },
  );
}

function chunkDetailRows(lines: SalesDetailRow[], chunkSize: number) {
  const chunks: SalesDetailRow[][] = [];
  for (let index = 0; index < lines.length; index += chunkSize) {
    chunks.push(lines.slice(index, index + chunkSize));
  }
  return chunks;
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
    ? `วันที่ : ${formatSmlDate(params.date_from)}`
    : `จากวันที่ : ${formatSmlDate(params.date_from)} ถึงวันที่ : ${formatSmlDate(params.date_to)}`;
}

function formatSmlDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) {
    return value ? value.slice(0, 10) : "";
  }

  return `${match[3]}/${Number(match[2])}/${Number(match[1]) + 543}`;
}

function formatPrintDateTime(value: string) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Bangkok",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const buddhistYear = String(Number(byType.year) + 543);
  return `${byType.day}/${byType.month}/${buddhistYear} ${byType.hour}:${byType.minute}`;
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
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
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
