import {
  getReportCatalogEntry,
  type BusinessSignalCategory,
  type BusinessSignalRecord,
  type BusinessSignalSeverity,
  type GrossProfitByArCustomerSnapshot,
  type GrossProfitByProductSnapshot,
  type PurchaseGoodsPayablesSnapshot,
  type ReportKey,
  type ReportLinePreview,
  type ReportSnapshot,
  type SalesGoodsServicesSnapshot,
  type TenantId,
} from "@ai-bcc/shared";
import {
  buildExecutiveDigestFlexMessage,
  isValidLineUri,
  truncateLineText,
  type ExecutiveDigestStatus,
} from "./line-flex.js";

export const BUSINESS_SIGNAL_RULE_VERSION = "business_signals_v1";

export type BusinessSignalThresholds = {
  lowGrossMarginPercent: number;
  salesDropPercent: number;
  salesDropAmount: number;
  purchaseConcentrationPercent: number;
  missingBranchAmount: number;
  negativeGrossProfitAmount: number;
  noSalesEnabled: boolean;
};

export const defaultBusinessSignalThresholds: BusinessSignalThresholds = {
  lowGrossMarginPercent: 5,
  salesDropPercent: 20,
  salesDropAmount: 1000,
  purchaseConcentrationPercent: 80,
  missingBranchAmount: 0,
  negativeGrossProfitAmount: 0,
  noSalesEnabled: true,
};

export type DigestIssue = {
  issue_key: string;
  title: string;
  category: BusinessSignalCategory;
  severity: BusinessSignalSeverity;
  insight: string;
  recommended_action: string;
  amount_impact: number | null;
  tenant_id: TenantId;
  period_from: string;
  period_to: string;
  generated_at: string;
  primary_report_key: ReportKey;
  primary_run_id: string;
  source_report_keys: ReportKey[];
  raw_signal_ids: string[];
  raw_signal_keys: string[];
  signals: BusinessSignalRecord[];
};

export type BusinessSignalDigestSelection = {
  issues: DigestIssue[];
  totalIssueCount: number;
  criticalIssueCount: number;
  warningIssueCount: number;
  infoIssueCount: number;
  allIssueKeys: string[];
};

const ACTION_DIGEST_ISSUE_LIMIT = 2;

export function buildBusinessSignalsForSnapshots(input: {
  snapshots: ReportSnapshot[];
  now?: string;
  thresholds?: Partial<BusinessSignalThresholds>;
}): BusinessSignalRecord[] {
  const thresholds = {
    ...defaultBusinessSignalThresholds,
    ...input.thresholds,
  };
  const now = input.now ?? new Date().toISOString();

  return input.snapshots.flatMap((snapshot) => {
    if (!getReportCatalogEntry(snapshot.report_key).capabilities.businessSignals) {
      return [];
    }

    const baseSignals = buildDataQualitySignals(snapshot, now);
    if (snapshot.quality_status === "failed" || snapshot.quality_status === "stale") {
      return baseSignals;
    }

    if (snapshot.report_key === "sales_goods_services") {
      return [
        ...baseSignals,
        ...buildSalesSignals(snapshot, thresholds, now),
      ];
    }

    if (snapshot.report_key === "purchase_goods_payables") {
      return [
        ...baseSignals,
        ...buildPurchaseSignals(snapshot, thresholds, now),
      ];
    }

    if (
      snapshot.report_key === "gross_profit_by_product" ||
      snapshot.report_key === "gross_profit_by_ar_customer"
    ) {
      return [
        ...baseSignals,
        ...buildGrossProfitSignals(snapshot, thresholds, now),
      ];
    }

    return baseSignals;
  });
}

export function buildReportFailureBusinessSignal(input: {
  tenant_id: TenantId;
  report_key: ReportKey;
  run_id: string;
  period_from: string;
  period_to: string;
  safe_error_message: string;
  now?: string;
}): BusinessSignalRecord {
  const now = input.now ?? new Date().toISOString();
  return makeSignal({
    tenant_id: input.tenant_id,
    signal_key: `${input.report_key}:run_failed`,
    category: "data_quality",
    severity: "critical",
    title: "รายงานรันไม่สำเร็จ",
    insight:
      "ระบบยังอ่านข้อมูลจาก SML สำหรับรายงานนี้ไม่ได้ จึงไม่ควรสรุปยอดธุรกิจจากรอบนี้",
    recommended_action:
      "ตรวจการเชื่อม SML JavaWS แล้วรันทดสอบรายงานนี้อีกครั้ง",
    amount_impact: null,
    source_report_key: input.report_key,
    source_run_id: input.run_id,
    period_from: input.period_from,
    period_to: input.period_to,
    dimension_type: "report",
    dimension_id: input.report_key,
    evidence_json: {
      safe_error_message: input.safe_error_message,
      quality_status: "failed",
    },
    now,
  });
}

export function selectPriorityBusinessSignals(
  signals: BusinessSignalRecord[],
  limit = 3,
) {
  const openSignals = signals.filter((signal) => signal.status === "open");
  const priority = openSignals.filter((signal) => signal.severity !== "info");
  const candidates = priority.length ? priority : openSignals;
  return [...candidates].sort(compareSignalsByPriority).slice(0, limit);
}

export function selectBusinessSignalDigestIssues(
  signals: BusinessSignalRecord[],
  options?: {
    limit?: number;
    thresholds?: Partial<BusinessSignalThresholds>;
  },
): BusinessSignalDigestSelection {
  const thresholds = {
    ...defaultBusinessSignalThresholds,
    ...options?.thresholds,
  };
  const openSignals = signals.filter((signal) => signal.status === "open");
  const priority = openSignals.filter((signal) => signal.severity !== "info");
  const baseCandidates = priority.length ? priority : openSignals;
  const candidates = baseCandidates.filter((signal) =>
    shouldIncludeSignalInDigest(signal, thresholds),
  );
  const rankedIssues = groupDigestIssues(candidates).sort(
    compareDigestIssuesByPriority,
  );
  const limit = options?.limit ?? ACTION_DIGEST_ISSUE_LIMIT;
  return {
    issues: rankedIssues.slice(0, limit),
    totalIssueCount: rankedIssues.length,
    criticalIssueCount: rankedIssues.filter(
      (issue) => issue.severity === "critical",
    ).length,
    warningIssueCount: rankedIssues.filter(
      (issue) => issue.severity === "warning",
    ).length,
    infoIssueCount: rankedIssues.filter((issue) => issue.severity === "info")
      .length,
    allIssueKeys: rankedIssues.map((issue) => issue.issue_key),
  };
}

export function buildBusinessSignalDigestPreview(input: {
  tenantName: string;
  signals: BusinessSignalRecord[];
  digestSelection?: BusinessSignalDigestSelection;
  dashboardUrls?: Partial<Record<ReportKey, string | null>>;
  thresholds?: Partial<BusinessSignalThresholds>;
}): ReportLinePreview | null {
  const selection =
    input.digestSelection ??
    selectBusinessSignalDigestIssues(input.signals, {
      limit: ACTION_DIGEST_ISSUE_LIMIT,
      thresholds: input.thresholds,
    });
  const primaryIssue = selection.issues[0];
  if (!primaryIssue) {
    return null;
  }

  const summaryBubble = buildDigestSummaryBubble({
    selection,
    tenantName: input.tenantName,
    dashboardUrl: getIssueDashboardUrl(primaryIssue, input.dashboardUrls),
  }).contents;
  const issueBubbles = selection.issues.map(
    (issue) =>
      buildDigestIssueBubble({
        issue,
        tenantName: input.tenantName,
        dashboardUrl: getIssueDashboardUrl(issue, input.dashboardUrls),
      }).contents,
  );
  const bubbles = [summaryBubble, ...issueBubbles].filter(
    (contents): contents is Record<string, unknown> => Boolean(contents),
  );
  const flexMessage = {
    type: "flex" as const,
    altText: truncateLineText(
      `AI Business: วันนี้มี ${selection.totalIssueCount.toLocaleString(
        "th-TH",
      )} เรื่องต้องดู`,
      300,
    ),
    contents: {
      type: "carousel",
      contents: bubbles,
    },
  };
  const lines = [
    "AI Business Action Digest",
    "",
    `บริษัท: ${input.tenantName}`,
    `ช่วงข้อมูล: ${formatDateRange(primaryIssue.period_from, primaryIssue.period_to)}`,
    `วันนี้มี ${selection.totalIssueCount.toLocaleString("th-TH")} เรื่องต้องดู`,
    `${selection.criticalIssueCount.toLocaleString(
      "th-TH",
    )} เรื่องควรตรวจทันที, ${selection.warningIssueCount.toLocaleString(
      "th-TH",
    )} เรื่องมีข้อสังเกต`,
    "",
    ...selection.issues.flatMap((issue, index) => [
      `${index + 1}. ${issue.title}`,
      `สถานะ: ${formatSeverity(issue.severity)}`,
      `สรุป: ${issue.insight}`,
      `ควรทำต่อ: ${issue.recommended_action}`,
      ...(issue.amount_impact !== null
        ? [`มูลค่าที่เกี่ยวข้อง: ${formatMoney(issue.amount_impact)} บาท`]
        : []),
      "",
    ]),
    "เปิดรายละเอียด: กดปุ่มใน LINE เพื่อดูรายงานต้นทางตามสิทธิ์",
  ];

  return {
    tenant_id: primaryIssue.tenant_id,
    report_key: primaryIssue.primary_report_key,
    run_id: primaryIssue.primary_run_id,
    generated_at: primaryIssue.generated_at,
    source: "sml_javaws",
    line_message_type: "flex",
    title: "AI Business Action Digest",
    text: lines.join("\n"),
    lines,
    flex_message: flexMessage,
    warnings: selection.issues.map((issue) => issue.title),
    dashboard_url: getIssueDashboardUrl(primaryIssue, input.dashboardUrls),
  } as ReportLinePreview;
}

function buildDataQualitySignals(
  snapshot: ReportSnapshot,
  now: string,
): BusinessSignalRecord[] {
  const signals: BusinessSignalRecord[] = [];
  if (snapshot.source === "sample_snapshot") {
    signals.push(
      makeSignal({
        tenant_id: snapshot.tenant_id,
        signal_key: `${snapshot.report_key}:sample_data`,
        category: "data_quality",
        severity: "warning",
        title: "รายงานนี้ยังเป็นข้อมูลตัวอย่าง",
        insight:
          "ข้อมูลรอบนี้ไม่ได้มาจาก SML สด จึงใช้เพื่อ demo หรือทดสอบหน้าจอเท่านั้น",
        recommended_action: "เชื่อม SML JavaWS และรันรายงานจริงก่อนส่งให้ลูกค้า",
        amount_impact: null,
        snapshot,
        dimension_type: "report",
        dimension_id: snapshot.report_key,
        evidence_json: {
          source: snapshot.source,
          quality_status: snapshot.quality_status,
        },
        now,
      }),
    );
  }

  if (
    snapshot.quality_status === "partial" ||
    snapshot.quality_status === "reconciled_with_warning"
  ) {
    signals.push(
      makeSignal({
        tenant_id: snapshot.tenant_id,
        signal_key: `${snapshot.report_key}:data_quality_warning`,
        category: "data_quality",
        severity: "warning",
        title: "ข้อมูลรายงานมีข้อสังเกต",
        insight:
          "ยอดหรือรายละเอียดบางส่วนควรตรวจซ้ำก่อนใช้ตัดสินใจรอบสำคัญ",
        recommended_action: "เปิดรายละเอียดแล้วตรวจ section รายละเอียดตรวจสอบ",
        amount_impact: null,
        snapshot,
        dimension_type: "report",
        dimension_id: snapshot.report_key,
        evidence_json: {
          quality_status: snapshot.quality_status,
          reconciliation:
            "reconciliation" in snapshot ? snapshot.reconciliation : null,
        },
        now,
      }),
    );
  }

  return signals;
}

function buildSalesSignals(
  snapshot: SalesGoodsServicesSnapshot,
  thresholds: BusinessSignalThresholds,
  now: string,
) {
  const signals: BusinessSignalRecord[] = [];
  if (
    thresholds.noSalesEnabled &&
    snapshot.summary.total_sales === 0 &&
    snapshot.summary.document_count === 0
  ) {
    signals.push(
      makeSignal({
        tenant_id: snapshot.tenant_id,
        signal_key: "sales:no_sales",
        category: "sales",
        severity: "warning",
        title: "ยังไม่พบยอดขายในช่วงนี้",
        insight:
          "ถ้าไม่ใช่วันหยุดขาย ควรตรวจว่ามีการปิดบิลหรือส่งข้อมูลเข้า SML แล้วหรือยัง",
        recommended_action: "ตรวจรายการขายใน SML และรันรายงานซ้ำ",
        amount_impact: 0,
        snapshot,
        dimension_type: "report",
        dimension_id: "sales_goods_services",
        evidence_json: {
          total_sales: snapshot.summary.total_sales,
          document_count: snapshot.summary.document_count,
        },
        now,
      }),
    );
  }

  const missingBranch = snapshot.branch_sales.find(
    (branch) =>
      branch.branch_code === "no_branch" ||
      branch.branch_label === "ไม่ระบุสาขา",
  );
  if (
    missingBranch &&
    missingBranch.total_amount > thresholds.missingBranchAmount
  ) {
    signals.push(
      makeSignal({
        tenant_id: snapshot.tenant_id,
        signal_key: "sales:missing_branch",
        category: "data_quality",
        severity: "warning",
        title: "มีรายการขายไม่ระบุสาขา",
        insight:
          "ยอดขายบางส่วนยังไม่ผูกสาขา ทำให้ผู้บริหารอ่านยอดตามสาขาได้ไม่ครบ",
        recommended_action: "ตรวจการตั้งค่าสาขาหรือการบันทึกสาขาใน SML",
        amount_impact: missingBranch.total_amount,
        snapshot,
        dimension_type: "branch",
        dimension_id: missingBranch.branch_code,
        evidence_json: missingBranch,
        now,
      }),
    );
  }

  const previousDay = snapshot.comparison?.previous_day;
  if (
    previousDay?.direction === "down" &&
    previousDay.difference_percent !== null &&
    Math.abs(previousDay.difference_percent) >= thresholds.salesDropPercent &&
    Math.abs(previousDay.difference_amount) >= thresholds.salesDropAmount
  ) {
    signals.push(
      makeSignal({
        tenant_id: snapshot.tenant_id,
        signal_key: "sales:drop_vs_previous_day",
        category: "sales",
        severity:
          Math.abs(previousDay.difference_percent) >= 50 ? "critical" : "warning",
        title: "ยอดขายลดลงจากวันก่อนหน้า",
        insight: `ยอดขายลดลง ${formatPercent(Math.abs(previousDay.difference_percent))} เทียบกับวันก่อนหน้า`,
        recommended_action: "ตรวจสาขา สินค้าหลัก และจำนวนบิลที่ลดลง",
        amount_impact: Math.abs(previousDay.difference_amount),
        snapshot,
        dimension_type: "comparison",
        dimension_id: "previous_day",
        evidence_json: previousDay,
        now,
      }),
    );
  }

  return signals;
}

function buildPurchaseSignals(
  snapshot: PurchaseGoodsPayablesSnapshot,
  thresholds: BusinessSignalThresholds,
  now: string,
) {
  const topSupplier = snapshot.top_suppliers[0];
  if (!topSupplier || snapshot.summary.total_purchase <= 0) {
    return [];
  }

  const concentration =
    (topSupplier.total_amount / snapshot.summary.total_purchase) * 100;
  if (concentration < thresholds.purchaseConcentrationPercent) {
    return [];
  }

  return [
    makeSignal({
      tenant_id: snapshot.tenant_id,
      signal_key: "purchase:supplier_concentration",
      category: "purchase",
      severity: "warning",
      title: "ยอดซื้อกระจุกที่ผู้จำหน่ายรายเดียว",
      insight: `${truncateLineText(
        topSupplier.supplier_name,
        40,
      )} คิดเป็น ${formatPercent(concentration)} ของยอดซื้อรวม`,
      recommended_action:
        "ตรวจว่าเป็นรายการปกติ เช่น ค่าธนาคาร/เงินกู้ หรือเป็นความเสี่ยงด้าน supplier",
      amount_impact: topSupplier.total_amount,
      snapshot,
      dimension_type: "supplier",
      dimension_id: topSupplier.supplier_code || topSupplier.supplier_name,
      evidence_json: {
        ...topSupplier,
        total_purchase: snapshot.summary.total_purchase,
        concentration_percent: round(concentration),
      },
      now,
    }),
  ];
}

function buildGrossProfitSignals(
  snapshot: GrossProfitByProductSnapshot | GrossProfitByArCustomerSnapshot,
  thresholds: BusinessSignalThresholds,
  now: string,
) {
  const signals: BusinessSignalRecord[] = [];
  const dimensionLabel =
    snapshot.report_key === "gross_profit_by_product" ? "สินค้า" : "ลูกหนี้";
  if (snapshot.summary.gross_profit < 0) {
    signals.push(
      makeSignal({
        tenant_id: snapshot.tenant_id,
        signal_key: `${snapshot.report_key}:negative_total_gross_profit`,
        category: "profit",
        severity: "critical",
        title: `กำไรขั้นต้น${dimensionLabel}ติดลบ`,
        insight:
          "ยอดขายสุทธิหลังคืนต่ำกว่าต้นทุนสุทธิในช่วงข้อมูลนี้",
        recommended_action:
          "ตรวจราคาขาย ต้นทุน และรายการคืนสินค้าก่อนตัดสินใจจากยอดรวม",
        amount_impact: Math.abs(snapshot.summary.gross_profit),
        snapshot,
        dimension_type: "report",
        dimension_id: snapshot.report_key,
        evidence_json: snapshot.summary,
        now,
      }),
    );
  }

  if (snapshot.summary.negative_gross_profit_count > 0) {
    signals.push(
      makeSignal({
        tenant_id: snapshot.tenant_id,
        signal_key: `${snapshot.report_key}:negative_rows`,
        category: "profit",
        severity: "warning",
        title: `พบ${dimensionLabel}กำไรติดลบ`,
        insight: `มี ${snapshot.summary.negative_gross_profit_count.toLocaleString(
          "th-TH",
        )} รายการที่กำไรขั้นต้นติดลบ`,
        recommended_action:
          snapshot.report_key === "gross_profit_by_product"
            ? "เปิดรายละเอียดเพื่อตรวจสินค้าที่กำไรติดลบก่อน"
            : "เปิดรายละเอียดเพื่อตรวจลูกหนี้ที่ทำกำไรติดลบก่อน",
        amount_impact: sumNegativeImpact(snapshot.negative_rows),
        snapshot,
        dimension_type: "report",
        dimension_id: snapshot.report_key,
        evidence_json: {
          negative_gross_profit_count:
            snapshot.summary.negative_gross_profit_count,
          negative_rows: snapshot.negative_rows.slice(0, 3),
        },
        now,
      }),
    );
  }

  if (
    snapshot.summary.gross_margin_percent !== null &&
    snapshot.summary.net_amount > 0 &&
    snapshot.summary.gross_margin_percent < thresholds.lowGrossMarginPercent
  ) {
    signals.push(
      makeSignal({
        tenant_id: snapshot.tenant_id,
        signal_key: `${snapshot.report_key}:low_margin`,
        category: "profit",
        severity: "warning",
        title: `Margin ${dimensionLabel}ต่ำ`,
        insight: `อัตรากำไรขั้นต้นอยู่ที่ ${formatPercent(
          snapshot.summary.gross_margin_percent,
        )} ต่ำกว่าเกณฑ์ ${formatPercent(thresholds.lowGrossMarginPercent)}`,
        recommended_action:
          "ตรวจกลุ่มรายการที่ขายเยอะแต่ margin ต่ำ หรือมีต้นทุนผิดปกติ",
        amount_impact: null,
        snapshot,
        dimension_type: "report",
        dimension_id: snapshot.report_key,
        evidence_json: snapshot.summary,
        now,
      }),
    );
  }

  return signals;
}

function shouldIncludeSignalInDigest(
  signal: BusinessSignalRecord,
  thresholds: BusinessSignalThresholds,
) {
  if (
    thresholds.negativeGrossProfitAmount > 0 &&
    isNegativeGrossProfitSignal(signal)
  ) {
    return (signal.amount_impact ?? 0) >= thresholds.negativeGrossProfitAmount;
  }
  return true;
}

function groupDigestIssues(signals: BusinessSignalRecord[]) {
  const groups = new Map<string, BusinessSignalRecord[]>();
  for (const signal of signals) {
    const groupKey = getDigestIssueKey(signal);
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), signal]);
  }
  return Array.from(groups.entries()).map(([issueKey, groupedSignals]) =>
    buildDigestIssue(issueKey, groupedSignals),
  );
}

function getDigestIssueKey(signal: BusinessSignalRecord) {
  if (isNegativeGrossProfitSignal(signal)) {
    return "profit_negative";
  }
  return signal.signal_key;
}

function isNegativeGrossProfitSignal(signal: BusinessSignalRecord) {
  const grossProfit =
    typeof signal.evidence_json.gross_profit === "number"
      ? signal.evidence_json.gross_profit
      : null;
  return (
    signal.category === "profit" &&
    (signal.signal_key.endsWith(":negative_total_gross_profit") ||
      signal.signal_key.endsWith(":negative_rows") ||
      (signal.signal_key.endsWith(":low_margin") &&
        grossProfit !== null &&
        grossProfit < 0))
  );
}

function buildDigestIssue(
  issueKey: string,
  groupedSignals: BusinessSignalRecord[],
): DigestIssue {
  const signals = [...groupedSignals].sort(compareSignalsByPriority);
  const primarySignal = signals[0];
  if (!primarySignal) {
    throw new Error("Digest issue requires at least one signal.");
  }

  const sourceReportKeys = uniqueReportKeys(
    signals.map((signal) => signal.source_report_key),
  );
  if (issueKey === "profit_negative") {
    const reportList = formatIssueReportKeys(sourceReportKeys);
    return {
      issue_key: issueKey,
      title: "กำไรติดลบ",
      category: "profit",
      severity: mostSevere(signals),
      insight:
        sourceReportKeys.length > 1
          ? `พบกำไรติดลบในมุม ${reportList} ปัญหานี้เป็นเรื่องเดียวกันในมุมเจ้าของร้าน`
          : `พบกำไรติดลบในมุม ${reportList} ควรตรวจราคาขาย ต้นทุน หรือรายการคืนสินค้า`,
      recommended_action:
        "เปิดรายละเอียดเพื่อตรวจราคาขาย ต้นทุน รายการคืนสินค้า และดูแยกตามสินค้า/ลูกหนี้ตามสิทธิ์",
      amount_impact: maxSignalAmountImpact(signals),
      tenant_id: primarySignal.tenant_id,
      period_from: primarySignal.period_from,
      period_to: primarySignal.period_to,
      generated_at: primarySignal.created_at,
      primary_report_key: primarySignal.source_report_key,
      primary_run_id: primarySignal.source_run_id,
      source_report_keys: sourceReportKeys,
      raw_signal_ids: signals.map((signal) => signal.id),
      raw_signal_keys: signals.map((signal) => signal.signal_key),
      signals,
    };
  }

  return {
    issue_key: issueKey,
    title: primarySignal.title,
    category: primarySignal.category,
    severity: primarySignal.severity,
    insight: primarySignal.insight,
    recommended_action: primarySignal.recommended_action,
    amount_impact: primarySignal.amount_impact,
    tenant_id: primarySignal.tenant_id,
    period_from: primarySignal.period_from,
    period_to: primarySignal.period_to,
    generated_at: primarySignal.created_at,
    primary_report_key: primarySignal.source_report_key,
    primary_run_id: primarySignal.source_run_id,
    source_report_keys: sourceReportKeys,
    raw_signal_ids: signals.map((signal) => signal.id),
    raw_signal_keys: signals.map((signal) => signal.signal_key),
    signals,
  };
}

function makeSignal(input: {
  tenant_id: TenantId;
  signal_key: string;
  category: BusinessSignalCategory;
  severity: BusinessSignalSeverity;
  title: string;
  insight: string;
  recommended_action: string;
  amount_impact: number | null;
  snapshot?: ReportSnapshot;
  source_report_key?: ReportKey;
  source_run_id?: string;
  period_from?: string;
  period_to?: string;
  dimension_type: string;
  dimension_id: string;
  evidence_json: Record<string, unknown>;
  now: string;
}): BusinessSignalRecord {
  const sourceReportKey = input.source_report_key ?? input.snapshot?.report_key;
  const sourceRunId = input.source_run_id ?? input.snapshot?.run_id;
  const periodFrom = input.period_from ?? input.snapshot?.params.date_from;
  const periodTo = input.period_to ?? input.snapshot?.params.date_to;
  if (!sourceReportKey || !sourceRunId || !periodFrom || !periodTo) {
    throw new Error("Business signal requires source report and period.");
  }

  const dimensionType = input.dimension_type || "report";
  const dimensionId = input.dimension_id || sourceReportKey;
  return {
    id: [
      "business_signal",
      input.tenant_id,
      input.signal_key,
      periodFrom,
      periodTo,
      dimensionType,
      dimensionId,
    ]
      .map(toSafeIdPart)
      .join("_")
      .slice(0, 220),
    tenant_id: input.tenant_id,
    signal_key: input.signal_key,
    category: input.category,
    severity: input.severity,
    title: input.title,
    insight: input.insight,
    recommended_action: input.recommended_action,
    amount_impact:
      input.amount_impact === null ? null : round(input.amount_impact),
    source_report_key: sourceReportKey,
    source_run_id: sourceRunId,
    period_from: periodFrom,
    period_to: periodTo,
    dimension_type: dimensionType,
    dimension_id: dimensionId,
    rule_version: BUSINESS_SIGNAL_RULE_VERSION,
    status: "open",
    evidence_json: input.evidence_json,
    created_at: input.now,
    updated_at: input.now,
  };
}

function buildDigestSummaryBubble(input: {
  selection: BusinessSignalDigestSelection;
  tenantName: string;
  dashboardUrl: string | null;
}) {
  const status =
    input.selection.criticalIssueCount > 0
      ? ({ text: "ควรตรวจทันที", severity: "critical" } satisfies ExecutiveDigestStatus)
      : input.selection.warningIssueCount > 0
        ? ({ text: "มีข้อสังเกต", severity: "notice" } satisfies ExecutiveDigestStatus)
        : ({ text: "ข้อมูลประกอบ", severity: "ready" } satisfies ExecutiveDigestStatus);
  const shownIssueCount = input.selection.issues.length;
  const primaryIssue = input.selection.issues[0];
  return buildExecutiveDigestFlexMessage({
    title: `วันนี้มี ${input.selection.totalIssueCount.toLocaleString(
      "th-TH",
    )} เรื่องต้องดู`,
    subtitle: input.tenantName,
    altText: `AI Business: วันนี้มี ${input.selection.totalIssueCount.toLocaleString(
      "th-TH",
    )} เรื่องต้องดู`,
    generatedAt: primaryIssue
      ? formatThaiDateTime(primaryIssue.generated_at)
      : formatThaiDateTime(new Date().toISOString()),
    status,
    primaryAmount: `${input.selection.totalIssueCount.toLocaleString(
      "th-TH",
    )} เรื่อง`,
    primaryAmountColor:
      input.selection.criticalIssueCount > 0 ? "#B42318" : undefined,
    metrics: [
      {
        label: "ควรตรวจทันที",
        value: `${input.selection.criticalIssueCount.toLocaleString("th-TH")} เรื่อง`,
      },
      {
        label: "มีข้อสังเกต",
        value: `${input.selection.warningIssueCount.toLocaleString("th-TH")} เรื่อง`,
      },
      {
        label: "แสดงใน LINE",
        value:
          input.selection.totalIssueCount > shownIssueCount
            ? `${shownIssueCount.toLocaleString("th-TH")} เรื่องแรก`
            : `${shownIssueCount.toLocaleString("th-TH")} เรื่อง`,
      },
    ],
    insight:
      input.selection.totalIssueCount > shownIssueCount
        ? `คัด ${shownIssueCount.toLocaleString(
            "th-TH",
          )} เรื่องสำคัญแรกจากทั้งหมดเพื่อให้เริ่มตรวจได้เร็ว`
        : "คัดเฉพาะเรื่องที่ควรดูจากรายงานล่าสุด ไม่ส่งทุก report ให้รบกวน",
    topLine: primaryIssue
      ? {
          label: "เริ่มจาก",
          value: primaryIssue.title,
        }
      : null,
    dashboardUrl: isValidLineUri(input.dashboardUrl)
      ? input.dashboardUrl
      : null,
    actionLabel: "เปิดภาพรวม",
  });
}

function buildDigestIssueBubble(input: {
  issue: DigestIssue;
  tenantName: string;
  dashboardUrl: string | null;
}) {
  const status = toDigestStatus(input.issue.severity);
  return buildExecutiveDigestFlexMessage({
    title: truncateLineText(input.issue.title, 34),
    subtitle: `${input.tenantName} · ${formatDateRange(
      input.issue.period_from,
      input.issue.period_to,
    )}`,
    altText: `${input.issue.title}: ${input.issue.insight}`,
    generatedAt: formatThaiDateTime(input.issue.generated_at),
    status,
    primaryAmount:
      input.issue.amount_impact !== null
        ? `${formatMoney(input.issue.amount_impact)} บาท`
        : formatSeverity(input.issue.severity),
    primaryAmountColor:
      input.issue.severity === "critical" ? "#B42318" : undefined,
    metrics: [
      { label: "หมวด", value: formatCategory(input.issue.category) },
      { label: "รายงาน", value: formatIssueReportKeys(input.issue.source_report_keys) },
      { label: "สถานะ", value: formatSeverity(input.issue.severity) },
    ],
    insight: input.issue.insight,
    topLine: {
      label: "ควรทำต่อ",
      value: input.issue.recommended_action,
    },
    dashboardUrl: isValidLineUri(input.dashboardUrl)
      ? input.dashboardUrl
      : null,
  });
}

function getIssueDashboardUrl(
  issue: DigestIssue,
  dashboardUrls?: Partial<Record<ReportKey, string | null>>,
) {
  for (const reportKey of issue.source_report_keys) {
    const dashboardUrl = dashboardUrls?.[reportKey] ?? null;
    if (isValidLineUri(dashboardUrl)) {
      return dashboardUrl;
    }
  }
  return null;
}

function compareSignalsByPriority(
  left: BusinessSignalRecord,
  right: BusinessSignalRecord,
) {
  const severityDelta =
    severityRank(right.severity) - severityRank(left.severity);
  if (severityDelta) {
    return severityDelta;
  }
  return (right.amount_impact ?? 0) - (left.amount_impact ?? 0);
}

function compareDigestIssuesByPriority(left: DigestIssue, right: DigestIssue) {
  const severityDelta =
    severityRank(right.severity) - severityRank(left.severity);
  if (severityDelta) {
    return severityDelta;
  }
  return (right.amount_impact ?? 0) - (left.amount_impact ?? 0);
}

function severityRank(severity: BusinessSignalSeverity) {
  if (severity === "critical") {
    return 3;
  }
  if (severity === "warning") {
    return 2;
  }
  return 1;
}

function toDigestStatus(severity: BusinessSignalSeverity): ExecutiveDigestStatus {
  if (severity === "critical") {
    return { text: "ควรตรวจทันที", severity: "critical" };
  }
  if (severity === "warning") {
    return { text: "มีข้อสังเกต", severity: "notice" };
  }
  return { text: "ข้อมูลประกอบ", severity: "ready" };
}

function sumNegativeImpact(rows: Array<{ gross_profit: number }>) {
  const total = rows.reduce(
    (sum, row) => sum + (row.gross_profit < 0 ? Math.abs(row.gross_profit) : 0),
    0,
  );
  return total > 0 ? round(total) : null;
}

function maxSignalAmountImpact(signals: BusinessSignalRecord[]) {
  const amounts = signals
    .map((signal) => signal.amount_impact)
    .filter((amount): amount is number => amount !== null);
  if (!amounts.length) {
    return null;
  }
  return round(Math.max(...amounts));
}

function mostSevere(signals: BusinessSignalRecord[]) {
  return signals.reduce<BusinessSignalSeverity>(
    (highest, signal) =>
      severityRank(signal.severity) > severityRank(highest)
        ? signal.severity
        : highest,
    "info",
  );
}

function uniqueReportKeys(reportKeys: ReportKey[]) {
  return reportKeys.filter(
    (reportKey, index, all) => all.indexOf(reportKey) === index,
  );
}

function formatIssueReportKeys(reportKeys: ReportKey[]) {
  return reportKeys.map((reportKey) => formatReportKey(reportKey)).join("/");
}

function formatMoney(value: number) {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPercent(value: number) {
  return `${round(value).toLocaleString("th-TH", {
    maximumFractionDigits: 1,
  })}%`;
}

function formatDateRange(dateFrom: string, dateTo: string) {
  return dateFrom === dateTo ? dateFrom : `${dateFrom} - ${dateTo}`;
}

function formatThaiDateTime(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

function formatSeverity(severity: BusinessSignalSeverity) {
  if (severity === "critical") {
    return "ควรตรวจทันที";
  }
  if (severity === "warning") {
    return "มีข้อสังเกต";
  }
  return "ข้อมูลประกอบ";
}

function formatCategory(category: BusinessSignalCategory) {
  const labels: Record<BusinessSignalCategory, string> = {
    sales: "ยอดขาย",
    profit: "กำไร",
    purchase: "ซื้อ/ตั้งหนี้",
    stock: "สต็อก",
    ar: "ลูกหนี้",
    data_quality: "คุณภาพข้อมูล",
  };
  return labels[category];
}

function formatReportKey(reportKey: ReportKey) {
  const labels: Record<ReportKey, string> = {
    sales_goods_services: "ขาย",
    purchase_goods_payables: "ซื้อ",
    gross_profit_by_product: "กำไรสินค้า",
    gross_profit_by_ar_customer: "กำไรลูกหนี้",
    stock_balance: "สต็อกคงเหลือ",
    stock_reorder: "ถึงจุดสั่งซื้อ",
    ar_customer_movement: "เคลื่อนไหวลูกหนี้",
    ar_debt_receipt: "รับชำระหนี้",
  };
  return labels[reportKey];
}

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toSafeIdPart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}
