import { getReportCatalogEntry } from "@ai-bcc/shared";
import type { ReportDefinitionSeed } from "./system-store.js";

export const reportDefinitionSeeds: ReportDefinitionSeed[] = [
  {
    report_key: "sales_goods_services",
    name: getReportCatalogEntry("sales_goods_services").definitionName,
    version: "0.1.0",
    contract_json: {
      report_key: "sales_goods_services",
      params: ["date_from", "date_to"],
      financial_truth: "ic_trans.total_amount",
      detail_truth: "ic_trans_detail.sum_amount",
      branch_fallback: "detail.branch_code -> header.branch_code -> no_branch",
    },
  },
  {
    report_key: "purchase_goods_payables",
    name: getReportCatalogEntry("purchase_goods_payables").definitionName,
    version: "0.1.0",
    contract_json: {
      report_key: "purchase_goods_payables",
      params: ["date_from", "date_to"],
      financial_truth: "ic_trans.total_amount",
      detail_truth: "ic_trans_detail.sum_amount",
      supplier_lookup: "ap_supplier.name_1",
      branch_fallback: "detail.branch_code -> header.branch_code -> no_branch",
    },
  },
  {
    report_key: "gross_profit_by_product",
    name: getReportCatalogEntry("gross_profit_by_product").definitionName,
    version: "0.1.0",
    contract_json: {
      report_key: "gross_profit_by_product",
      params: ["date_from", "date_to"],
      financial_truth:
        "ic_trans_detail.sum_amount_exclude_vat - ic_trans_detail.sum_of_cost",
      cost_truth: "ic_trans_detail.sum_of_cost",
      item_lookup: "ic_inventory.name_1, ic_unit.name_1",
      sensitivity: "contains_cost_and_margin",
    },
  },
  {
    report_key: "gross_profit_by_ar_customer",
    name: getReportCatalogEntry("gross_profit_by_ar_customer").definitionName,
    version: "0.1.0",
    contract_json: {
      report_key: "gross_profit_by_ar_customer",
      params: ["date_from", "date_to"],
      financial_truth:
        "ic_trans_detail.sum_amount_exclude_vat - ic_trans_detail.sum_of_cost",
      cost_truth: "ic_trans_detail.sum_of_cost",
      customer_lookup: "ic_trans.cust_code -> ar_customer.name_1",
      sensitivity: "contains_cost_and_margin",
    },
  },
];
