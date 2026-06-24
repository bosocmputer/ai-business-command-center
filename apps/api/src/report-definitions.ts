import { getReportCatalogEntry } from "@ai-bcc/shared";
import type { ReportDefinitionSeed } from "./system-store.js";

export const reportDefinitionSeeds: ReportDefinitionSeed[] = [
  {
    report_key: "sales_goods_services",
    name: getReportCatalogEntry("sales_goods_services").definitionName,
    version: "0.3.0",
    contract_json: {
      report_key: "sales_goods_services",
      params: ["date_from", "date_to"],
      financial_truth: "ic_trans.total_amount",
      detail_truth: "ic_trans_detail.sum_amount",
      branch_fallback: "header.branch_code -> no_branch",
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
  {
    report_key: "stock_balance",
    name: getReportCatalogEntry("stock_balance").definitionName,
    version: "0.1.0",
    contract_json: {
      report_key: "stock_balance",
      params: ["date_from", "date_to"],
      stock_truth: "ic_trans_detail qty/cost movement accumulated to date_to",
      movement_truth: "period qty_in/qty_out and amount_in/amount_out",
      cost_truth: "average cost and balance amount from SML inventory movement",
      sensitivity: "contains_average_cost_and_stock_value",
    },
  },
  {
    report_key: "stock_reorder",
    name: getReportCatalogEntry("stock_reorder").definitionName,
    version: "0.1.0",
    contract_json: {
      report_key: "stock_reorder",
      params: ["latest_inventory_balance"],
      reorder_truth:
        "ic_inventory.balance_qty < ic_inventory_detail.purchase_point",
      purchase_point_truth: "ic_inventory_detail.purchase_point",
      purchase_balance_truth: "ic_inventory.accrued_in_qty",
      sensitivity: "inventory_reorder_without_cost",
    },
  },
  {
    report_key: "ar_customer_movement",
    name: getReportCatalogEntry("ar_customer_movement").definitionName,
    version: "0.1.0",
    contract_json: {
      report_key: "ar_customer_movement",
      params: ["date_to"],
      ar_movement_truth:
        "ic_trans/ap_ar_trans/as_trans documents accumulated to date_to",
      customer_lookup: "cust_code -> ar_customer.name_1",
      source_basis: "ar_movement_as_of_date",
      sensitivity: "contains_customer_ar_amounts",
    },
  },
  {
    report_key: "ar_debt_receipt",
    name: getReportCatalogEntry("ar_debt_receipt").definitionName,
    version: "0.1.0",
    contract_json: {
      report_key: "ar_debt_receipt",
      params: ["date_from", "date_to"],
      receipt_truth: "ap_ar_trans.total_net_value where trans_flag = 239",
      payment_split_truth: "cb_trans.cash_amount and cb_trans.tranfer_amount",
      customer_lookup: "cust_code -> ar_customer.name_1",
      source_basis: "ar_debt_receipt_doc_date",
      sensitivity: "contains_customer_ar_receipts",
    },
  },
  {
    report_key: "cash_bank_receipts",
    name: getReportCatalogEntry("cash_bank_receipts").definitionName,
    version: "0.1.0",
    contract_json: {
      report_key: "cash_bank_receipts",
      params: ["date_from", "date_to"],
      receipt_truth: "cb_trans.total_amount where pay_type = 1",
      channel_truth:
        "cb_trans cash_amount/card_amount/chq_amount/tranfer_amount/total_income_amount/coupon_amount",
      reconciliation:
        "total_amount - channel totals is reported as unallocated_amount",
      source_basis: "cash_bank_receipts_doc_date",
      sensitivity: "contains_cash_bank_customer_receipts",
    },
  },
  {
    report_key: "cash_bank_payments",
    name: getReportCatalogEntry("cash_bank_payments").definitionName,
    version: "0.1.0",
    contract_json: {
      report_key: "cash_bank_payments",
      params: ["date_from", "date_to"],
      payment_truth: "cb_trans.total_amount where pay_type = 2",
      channel_truth:
        "cb_trans cash_amount/(card_amount + total_credit_charge)/chq_amount/tranfer_amount/total_income_amount/petty_cash_amount",
      reconciliation:
        "total_amount - channel totals is reported as unallocated_amount",
      source_basis: "cash_bank_payments_doc_date",
      sensitivity: "contains_cash_bank_supplier_payments",
    },
  },
];
