import {
  getReportCatalogEntry,
  reportKeyValues,
  type GrossProfitByArCustomerSnapshot,
  type GrossProfitByProductSnapshot,
  type PurchaseGoodsPayablesSnapshot,
  type ReportCatalogEntry,
  type ReportKey,
  type ReportLinePreview,
  type ReportRunRecord,
  type ReportSnapshot,
  type SalesGoodsServicesParams,
  type SalesGoodsServicesSnapshot,
  type StockBalanceSnapshot,
  type TenantId,
} from "@ai-bcc/shared";
import {
  renderGrossProfitLinePreview,
  renderPurchaseGoodsPayablesLinePreview,
  renderSalesGoodsServicesLinePreview,
  renderStockBalanceLinePreview,
} from "@ai-bcc/reports";

export type ReportRuntimeRunInput = {
  tenantId: TenantId;
  params: SalesGoodsServicesParams;
  requestAction: string;
};

export type ReportRuntimeRunOutcome =
  | {
      ok: true;
      snapshot: ReportSnapshot;
      runRecord: ReportRunRecord;
    }
  | {
      ok: false;
      statusCode: 424 | 500;
      error: string;
      runRecord: ReportRunRecord;
    };

export type ReportRuntimeRegistryDependencies = {
  runSalesGoodsServicesReport: (
    input: ReportRuntimeRunInput,
  ) => Promise<ReportRuntimeRunOutcome>;
  runPurchaseGoodsPayablesReport: (
    input: ReportRuntimeRunInput,
  ) => Promise<ReportRuntimeRunOutcome>;
  runGrossProfitReport: (
    input: ReportRuntimeRunInput & {
      reportKey: "gross_profit_by_product" | "gross_profit_by_ar_customer";
    },
  ) => Promise<ReportRuntimeRunOutcome>;
  runStockBalanceReport: (
    input: ReportRuntimeRunInput,
  ) => Promise<ReportRuntimeRunOutcome>;
};

export type ReportRuntimeEntry = {
  key: ReportKey;
  catalog: ReportCatalogEntry;
  supportsSignedViewer: boolean;
  supportsPdf: boolean;
  sensitive: boolean;
  run: (input: ReportRuntimeRunInput) => Promise<ReportRuntimeRunOutcome>;
  renderLinePreview: (input: {
    snapshot: ReportSnapshot;
    dashboardUrl: string | null;
    tenantName?: string | null;
  }) => ReportLinePreview;
};

export type ReportRuntimeRegistry = Readonly<Record<ReportKey, ReportRuntimeEntry>>;

export function createReportRuntimeRegistry(
  dependencies: ReportRuntimeRegistryDependencies,
): ReportRuntimeRegistry {
  return {
    sales_goods_services: buildRuntimeEntry({
      key: "sales_goods_services",
      run: dependencies.runSalesGoodsServicesReport,
      renderLinePreview: (input) =>
        renderSalesGoodsServicesLinePreview({
          snapshot: input.snapshot as SalesGoodsServicesSnapshot,
          dashboardUrl: input.dashboardUrl,
          tenantName: input.tenantName,
        }),
    }),
    purchase_goods_payables: buildRuntimeEntry({
      key: "purchase_goods_payables",
      run: dependencies.runPurchaseGoodsPayablesReport,
      renderLinePreview: (input) =>
        renderPurchaseGoodsPayablesLinePreview({
          snapshot: input.snapshot as PurchaseGoodsPayablesSnapshot,
          dashboardUrl: input.dashboardUrl,
          tenantName: input.tenantName,
        }),
    }),
    gross_profit_by_product: buildRuntimeEntry({
      key: "gross_profit_by_product",
      run: (input) =>
        dependencies.runGrossProfitReport({
          ...input,
          reportKey: "gross_profit_by_product",
        }),
      renderLinePreview: (input) =>
        renderGrossProfitLinePreview({
          snapshot: input.snapshot as GrossProfitByProductSnapshot,
          dashboardUrl: input.dashboardUrl,
          tenantName: input.tenantName,
        }),
    }),
    gross_profit_by_ar_customer: buildRuntimeEntry({
      key: "gross_profit_by_ar_customer",
      run: (input) =>
        dependencies.runGrossProfitReport({
          ...input,
          reportKey: "gross_profit_by_ar_customer",
        }),
      renderLinePreview: (input) =>
        renderGrossProfitLinePreview({
          snapshot: input.snapshot as GrossProfitByArCustomerSnapshot,
          dashboardUrl: input.dashboardUrl,
          tenantName: input.tenantName,
        }),
    }),
    stock_balance: buildRuntimeEntry({
      key: "stock_balance",
      run: dependencies.runStockBalanceReport,
      renderLinePreview: (input) =>
        renderStockBalanceLinePreview({
          snapshot: input.snapshot as StockBalanceSnapshot,
          dashboardUrl: input.dashboardUrl,
          tenantName: input.tenantName,
        }),
    }),
  } satisfies Record<ReportKey, ReportRuntimeEntry>;
}

export function getReportRuntimeEntry(
  registry: Partial<ReportRuntimeRegistry>,
  reportKey: ReportKey,
) {
  return registry[reportKey] ?? null;
}

export async function runReportRuntimeEntry(
  registry: Partial<ReportRuntimeRegistry>,
  reportKey: ReportKey,
  input: ReportRuntimeRunInput,
) {
  const entry = getReportRuntimeEntry(registry, reportKey);
  if (!entry) {
    return null;
  }

  return entry.run(input);
}

export function renderReportLinePreview(
  registry: Partial<ReportRuntimeRegistry>,
  input: {
    snapshot: ReportSnapshot;
    dashboardUrl: string | null;
    tenantName?: string | null;
  },
) {
  const entry = getReportRuntimeEntry(registry, input.snapshot.report_key);
  if (!entry) {
    return null;
  }

  return entry.renderLinePreview(input);
}

function buildRuntimeEntry(input: {
  key: ReportKey;
  run: (input: ReportRuntimeRunInput) => Promise<ReportRuntimeRunOutcome>;
  renderLinePreview: ReportRuntimeEntry["renderLinePreview"];
}): ReportRuntimeEntry {
  const catalog = getReportCatalogEntry(input.key);
  return {
    key: input.key,
    catalog,
    supportsSignedViewer: catalog.capabilities.signedViewer,
    supportsPdf: catalog.capabilities.pdf,
    sensitive: catalog.sensitive,
    run: input.run,
    renderLinePreview: input.renderLinePreview,
  };
}

export function assertReportRuntimeRegistryComplete(
  registry: Partial<ReportRuntimeRegistry>,
) {
  return reportKeyValues.every((reportKey) => Boolean(registry[reportKey]));
}
