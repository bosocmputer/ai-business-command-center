import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AiAdvisorItemRecord,
  AiAdvisorRunRecord,
  AiUsageLedgerRecord,
  BusinessSignalRecord,
  MetricSnapshotRecord,
  OpenRouterModelCatalogRecord,
  ReportKey,
  ReportSnapshot,
  Tenant,
  TenantAiProfileRecord,
  TenantAiPromptVersionRecord,
} from "@ai-bcc/shared";
import { createSampleSnapshot } from "./sample-data.js";
import {
  buildAiCeoLinePreview,
  buildAiCeoUnavailableLinePreview,
  defaultTenantAiProfile,
  runAiCeoDryRun,
  setAiCeoEnabled,
  syncOpenRouterModelCatalog,
} from "./ai-ceo-service.js";
import {
  buildAiCeoBusinessMemory,
  buildMetricSnapshotFromReportSnapshot,
} from "./ai-ceo-memory.js";
import type { SystemStore } from "./system-store.js";

const tenant: Tenant = {
  id: "tenant_demo_remote",
  name: "Demo Store",
  databaseName: "demo",
  description: "construction materials",
  datasourceConfigured: true,
  status: "active",
  planCode: "business",
  suspendedReason: null,
  currentPeriodEnd: null,
  billingCycle: null,
};

const originalAiBccSecretKey = process.env.AI_BCC_SECRET_KEY;

afterEach(() => {
  delete process.env.OPENROUTER_API_KEY;
  if (originalAiBccSecretKey) {
    process.env.AI_BCC_SECRET_KEY = originalAiBccSecretKey;
  } else {
    delete process.env.AI_BCC_SECRET_KEY;
  }
  vi.restoreAllMocks();
});

describe("AI CEO service", () => {
  it("merges OpenRouter model pricing into the curated allowlist", async () => {
    const store = createFakeStore();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          {
            id: "qwen/qwen3.7-max",
            name: "Qwen Max Remote",
            context_length: 123456,
            pricing: {
              prompt: "0.000001",
              completion: "0.000002",
            },
          },
        ],
      }),
    })) as unknown as typeof fetch;

    const models = await syncOpenRouterModelCatalog({ store, fetchImpl });
    const qwen = models.find((model) => model.model_id === "qwen/qwen3.7-max");

    expect(qwen?.display_name).toBe("Qwen Max Remote");
    expect(qwen?.context_length).toBe(123456);
    expect(qwen?.price_input_per_m).toBe(1);
    expect(qwen?.price_output_per_m).toBe(2);
    expect(store.modelCatalog.length).toBe(10);
  });

  it("lets admins disable AI CEO without an OpenRouter key but blocks unsafe enable", async () => {
    const store = createFakeStore();
    store.profile = {
      ...defaultTenantAiProfile({ tenant }),
      ai_enabled: true,
    };

    const disabled = await setAiCeoEnabled({
      actorId: "owner",
      aiEnabled: false,
      store,
      tenant,
    });

    expect(disabled.ai_enabled).toBe(false);

    await expect(
      setAiCeoEnabled({
        actorId: "owner",
        aiEnabled: true,
        store,
        tenant,
      }),
    ).rejects.toThrow("ระบบเข้ารหัสยังไม่พร้อมสำหรับเปิด AI CEO");

    process.env.AI_BCC_SECRET_KEY = "test-secret-key-for-ai-ceo-toggle";

    await expect(
      setAiCeoEnabled({
        actorId: "owner",
        aiEnabled: true,
        store,
        tenant,
      }),
    ).rejects.toThrow("ต้องมีรหัส OpenRouter ก่อนเปิด AI CEO");

    process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
    const enabled = await setAiCeoEnabled({
      actorId: "owner",
      aiEnabled: true,
      store,
      tenant,
    });

    expect(enabled.ai_enabled).toBe(true);
  });

  it("runs a dry-run, stores the advisor response, item, and usage ledger", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
    const store = createFakeStore();
    const now = new Date().toISOString();
    const prompt: TenantAiPromptVersionRecord = {
      id: "prompt_1",
      tenant_id: tenant.id,
      version: 1,
      prompt_text:
        "คุณคือ AI CEO ของร้านนี้ ให้วิเคราะห์จากรายงานที่อนุมัติแล้วเท่านั้น และตอบเป็น JSON ที่ระบบกำหนด",
      created_by: "owner",
      created_at: now,
      archived_at: null,
    };
    store.promptVersions.push(prompt);
    store.profile = {
      ...defaultTenantAiProfile({ tenant, now, activePromptVersionId: prompt.id }),
      selected_model_id: "qwen/qwen3.7-max",
      ai_enabled: true,
    };

    const result = await runAiCeoDryRun({
      store,
      tenant,
      request: { scheduled_date: "2026-06-30" },
      actorId: "owner",
      requester: async () => ({
        ok: true,
        providerStatus: 200,
        latencyMs: 42,
        content: JSON.stringify({
          summary: "ยอดขายดี แต่มีรายการขายที่ควรตรวจ",
          confidence: 0.82,
          caveats: [],
          top_actions: [
            {
              title: "ตรวจยอดขายผิดปกติ",
              reason: "พบสัญญาณจากรายงานขาย",
              recommended_action: "เปิดรายงานขายแล้วตรวจ 5 อันดับแรก",
              severity: "warning",
              confidence: 0.8,
              source_report_keys: ["sales_goods_services"],
              source_run_ids: ["sample_demo_remote"],
            },
          ],
        }),
        inputTokens: 1000,
        outputTokens: 500,
      }),
    });

    expect(result.ok).toBe(true);
    expect(result.run.status).toBe("success");
    expect(result.items).toHaveLength(1);
    expect(store.runs.at(-1)?.response_json?.summary).toContain("ยอดขายดี");
    expect(store.items.at(-1)?.title).toBe("ตรวจยอดขายผิดปกติ");
    expect(store.usageLedger.at(-1)?.input_tokens).toBe(1000);

    const preview = buildAiCeoLinePreview({
      tenant,
      run: result.run,
      items: result.items,
    });
    expect(preview?.line_message_type).toBe("text");
    expect(preview?.run_id).toBe("sample_demo_remote");
    expect(preview?.text).toContain("สรุปวันนี้");
    expect(preview?.text).toContain("อ้างอิงจากรายงานรอบนี้ 1 รายงาน");
    expect(preview?.text).toContain("ควรทำก่อน");
    expect(preview?.text).toContain("ตรวจยอดขายผิดปกติ");
    expect(preview?.text).toContain("ดู: รายงานขายสินค้าและบริการ");
    expect(preview?.flex_message).toBeUndefined();
    expect(JSON.stringify(preview)).not.toContain("api_key");
  });

  it("records actionable OpenRouter credit and rate-limit failures", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
    const store = createFakeStore();
    const now = new Date().toISOString();
    store.profile = {
      ...defaultTenantAiProfile({ tenant, now }),
      selected_model_id: "qwen/qwen3.7-max",
      ai_enabled: true,
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: "Insufficient credits",
              metadata: { error_type: "payment_required" },
            },
          }),
          { status: 402, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: "Rate limit exceeded",
              metadata: { error_type: "rate_limit_exceeded" },
            },
          }),
          {
            status: 429,
            headers: { "content-type": "application/json", "retry-after": "60" },
          },
        ),
      );

    const creditFailure = await runAiCeoDryRun({
      store,
      tenant,
      request: { scheduled_date: "2026-06-30" },
      actorId: "worker",
      triggerType: "scheduled",
    });
    const rateLimitFailure = await runAiCeoDryRun({
      store,
      tenant,
      request: { scheduled_date: "2026-06-30" },
      actorId: "worker",
      triggerType: "scheduled",
    });

    expect(creditFailure.ok).toBe(false);
    expect(creditFailure.provider_status).toBe(402);
    expect(creditFailure.safe_error_message).toContain("เครดิต OpenRouter ไม่พอ");
    expect(creditFailure.safe_error_message).toContain("HTTP 402");
    expect(rateLimitFailure.ok).toBe(false);
    expect(rateLimitFailure.provider_status).toBe(429);
    expect(rateLimitFailure.safe_error_message).toContain("จำกัดความถี่");
    expect(rateLimitFailure.safe_error_message).toContain("HTTP 429");
    expect(rateLimitFailure.safe_error_message).toContain("60");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(store.usageLedger).toHaveLength(0);
  });

  it("renders action report labels only for visible reports in the current LINE target scope", async () => {
    const now = new Date().toISOString();
    const run: AiAdvisorRunRecord = {
      id: "ai_run_visible_scope",
      tenant_id: tenant.id,
      run_date: "2026-07-04",
      trigger_type: "scheduled",
      status: "success",
      idempotency_key: "ai-ceo:test:visible-scope",
      model_provider: "openrouter",
      model_id: "qwen/qwen3.7-max",
      prompt_version_id: "prompt_1",
      context_hash: "hash",
      source_report_keys: ["cash_bank_receipts", "stock_balance"],
      input_tokens: 100,
      output_tokens: 50,
      cost_estimate_usd: 0.001,
      latency_ms: 30,
      fallback_used: false,
      response_json: {
        summary: "รับเงินและสต็อกมีจุดให้ตรวจ",
        confidence: 0.8,
        caveats: [],
        top_actions: [],
      },
      safe_error_message: null,
      created_at: now,
      started_at: now,
      finished_at: now,
    };
    const items: AiAdvisorItemRecord[] = [
      {
        id: "item_1",
        tenant_id: tenant.id,
        advisor_run_id: run.id,
        item_date: run.run_date,
        severity: "warning",
        title: "ตรวจรายการรับเงินไม่จัดสรร",
        reason: "พบยอดรับเงินไม่จัดสรร",
        recommended_action: "ให้บัญชีตรวจเอกสารรับเงินที่ยังไม่จัดสรร",
        evidence_json: {
          source_report_keys: ["cash_bank_receipts", "stock_balance"],
          source_run_ids: ["run_cash", "run_stock"],
        },
        confidence: 0.8,
        status: "new",
        created_at: now,
        updated_at: now,
        resolved_at: null,
      },
    ];

    const preview = buildAiCeoLinePreview({
      tenant,
      run,
      items,
      visibleReportKeys: ["cash_bank_receipts"],
    });

    expect(preview?.text).toContain("ดู: รายงานรับเงิน");
    expect(preview?.text).not.toContain("รายงานสต็อกคงเหลือ");
    expect(preview?.text).not.toContain("cash_bank_receipts");
    expect(preview?.text).not.toContain("stock_balance");
  });

  it("limits scheduled AI CEO context to the current notification report snapshots", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
    const store = createFakeStore();
    const now = new Date().toISOString();
    store.profile = {
      ...defaultTenantAiProfile({ tenant, now }),
      selected_model_id: "qwen/qwen3.7-max",
      ai_enabled: true,
    };
    const salesSnapshot = createScopedSnapshot({
      reportKey: "sales_goods_services",
      runId: "run_sales_current",
    });
    const cashSnapshot = createScopedSnapshot({
      reportKey: "cash_bank_receipts",
      runId: "run_cash_current",
      summary: {
        document_count: 8,
        party_count: 3,
        total_amount: 141_660,
        cash_amount: 8_200,
        card_amount: 0,
        chq_amount: 0,
        transfer_amount: 117_060,
        total_income_amount: 0,
        coupon_amount: 0,
        petty_cash_amount: 0,
        channel_total_amount: 125_260,
        unallocated_amount: 16_400,
        mismatch_document_count: 1,
        top_party_name: null,
        first_doc_time: null,
        last_doc_time: null,
      },
    });
    const currentCashMetric = buildMetricSnapshotFromReportSnapshot({
      snapshot: cashSnapshot,
      periodPreset: "yesterday",
      createdAt: "2026-07-01T01:00:00.000Z",
    });
    if (currentCashMetric) {
      store.metricSnapshots.push(currentCashMetric);
    }
    let capturedContext: Record<string, unknown> | null = null;

    const result = await runAiCeoDryRun({
      store,
      tenant,
      request: { scheduled_date: "2026-06-30" },
      actorId: "owner",
      triggerType: "scheduled",
      sourceReportKeys: ["sales_goods_services", "cash_bank_receipts"],
      sourceSnapshots: [salesSnapshot, cashSnapshot],
      requester: async ({ context }) => {
        capturedContext = context;
        return {
          ok: true,
          providerStatus: 200,
          latencyMs: 42,
          content: JSON.stringify({
            summary:
              "\u{1F4CA} ใช้ยอดขายและ cash_bank_receipts จากรอบแจ้งเตือนนี้เท่านั้น",
            confidence: 0.82,
            caveats: [],
            top_actions: [
              {
                title: "ตรวจเงินรับจาก cash_bank_receipts",
                reason: "พบยอดรับเงินที่ควรตรวจ",
                recommended_action: "เปิด cash_bank_receipts ของรอบนี้",
                severity: "warning",
                confidence: 0.8,
                source_report_keys: [
                  "cash_bank_receipts",
                  "gross_profit_by_product",
                ],
                source_run_ids: ["run_cash_current", "run_gross_profit_old"],
              },
            ],
          }),
          inputTokens: 1000,
          outputTokens: 500,
        };
      },
    });

    const context = capturedContext as unknown as {
      data_scope?: {
        mode?: string;
        available_report_keys?: string[];
        rules?: string[];
      };
      output_contract?: { cashflow_style?: string; max_top_actions?: number };
      reports?: Array<{ report_key: string; run_id: string }>;
      business_memory?: Array<{ issue_key: string; report_key: string }>;
    };
    expect(result.ok).toBe(true);
    expect(context.data_scope?.mode).toBe("notification_run");
    expect(context.data_scope?.available_report_keys).toEqual([
      "sales_goods_services",
      "cash_bank_receipts",
    ]);
    expect(context.reports?.map((report) => report.run_id)).toEqual([
      "run_sales_current",
      "run_cash_current",
    ]);
    expect(context.output_contract?.cashflow_style).toContain("เงินสดสุทธิ");
    expect(context.output_contract?.max_top_actions).toBe(2);
    expect(context.data_scope?.rules?.join(" ")).toContain("ลูกหนี้การค้า");
    expect(context.data_scope?.rules?.join(" ")).toContain("business_memory");
    expect(context.business_memory?.map((item) => item.issue_key)).toContain(
      "cash_bank_receipts:unallocated_amount",
    );
    expect(context.business_memory?.map((item) => item.report_key)).not.toContain(
      "stock_balance",
    );
    expect(result.run.source_report_keys).toEqual([
      "sales_goods_services",
      "cash_bank_receipts",
    ]);
    expect(result.response?.top_actions[0]?.source_report_keys).toEqual([
      "cash_bank_receipts",
    ]);
    expect(result.response?.top_actions[0]?.source_run_ids).toEqual([
      "run_cash_current",
    ]);
    expect(result.response?.summary).not.toContain("cash_bank_receipts");
    expect(result.response?.summary).not.toContain("\u{1F4CA}");
    expect(result.response?.summary).toContain("รายงานรับเงิน");
    expect(result.response?.top_actions[0]?.title).not.toContain(
      "cash_bank_receipts",
    );
    expect(result.response?.top_actions[0]?.recommended_action).toContain(
      "รายงานรับเงิน",
    );
    expect(result.response?.caveats.join(" ")).toContain(
      "ระบบตัดหลักฐานที่อยู่นอกชุดรายงานรอบนี้ออก",
    );
  });

  it("reuses an existing AI CEO run for the same idempotency key without calling OpenRouter again", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
    const store = createFakeStore();
    const now = new Date().toISOString();
    store.profile = {
      ...defaultTenantAiProfile({ tenant, now }),
      selected_model_id: "qwen/qwen3.7-max",
      ai_enabled: true,
    };
    const requester = vi.fn(async () => ({
      ok: true as const,
      providerStatus: 200,
      latencyMs: 42,
      content: JSON.stringify({
        summary: "ยอดขายดี แต่มีรายการขายที่ควรตรวจ",
        confidence: 0.82,
        caveats: [],
        top_actions: [
          {
            title: "ตรวจยอดขายผิดปกติ",
            reason: "พบสัญญาณจากรายงานขาย",
            recommended_action: "เปิดรายงานขายแล้วตรวจ 5 อันดับแรก",
            severity: "warning",
            confidence: 0.8,
            source_report_keys: ["sales_goods_services"],
            source_run_ids: ["sample_demo_remote"],
          },
        ],
      }),
      inputTokens: 1000,
      outputTokens: 500,
    }));

    const first = await runAiCeoDryRun({
      store,
      tenant,
      request: { scheduled_date: "2026-06-30" },
      actorId: "worker",
      triggerType: "scheduled",
      idempotencyKey: "ai-ceo:notification:rule:2026-06-30:08:00:run_1",
      requester,
    });
    const second = await runAiCeoDryRun({
      store,
      tenant,
      request: { scheduled_date: "2026-06-30" },
      actorId: "worker",
      triggerType: "scheduled",
      idempotencyKey: "ai-ceo:notification:rule:2026-06-30:08:00:run_1",
      requester,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.run.id).toBe(first.run.id);
    expect(second.items.map((item) => item.title)).toEqual([
      "ตรวจยอดขายผิดปกติ",
    ]);
    expect(requester).toHaveBeenCalledTimes(1);
    expect(store.runs).toHaveLength(1);
    expect(store.items).toHaveLength(1);
  });

  it("builds bounded business memory from stable metrics without crossing package scope", () => {
    const previousReceiptMetric = buildMetricSnapshotFromReportSnapshot({
      snapshot: createScopedSnapshot({
        reportKey: "cash_bank_receipts",
        runId: "run_receipts_previous",
        date: "2026-07-03",
        summary: {
          document_count: 4,
          party_count: 2,
          total_amount: 100_000,
          cash_amount: 0,
          card_amount: 0,
          chq_amount: 0,
          transfer_amount: 90_000,
          total_income_amount: 0,
          coupon_amount: 0,
          petty_cash_amount: 0,
          channel_total_amount: 90_000,
          unallocated_amount: 10_000,
          mismatch_document_count: 1,
          top_party_name: null,
          first_doc_time: null,
          last_doc_time: null,
        },
      }),
      periodPreset: "yesterday",
      createdAt: "2026-07-04T01:00:00.000Z",
    });
    const currentReceiptMetric = buildMetricSnapshotFromReportSnapshot({
      snapshot: createScopedSnapshot({
        reportKey: "cash_bank_receipts",
        runId: "run_receipts_current",
        date: "2026-07-04",
        summary: {
          document_count: 8,
          party_count: 3,
          total_amount: 141_660,
          cash_amount: 8_200,
          card_amount: 0,
          chq_amount: 0,
          transfer_amount: 117_060,
          total_income_amount: 0,
          coupon_amount: 0,
          petty_cash_amount: 0,
          channel_total_amount: 125_260,
          unallocated_amount: 16_400,
          mismatch_document_count: 1,
          top_party_name: null,
          first_doc_time: null,
          last_doc_time: null,
        },
      }),
      periodPreset: "yesterday",
      createdAt: "2026-07-05T01:00:00.000Z",
    });
    const stockMetric = buildMetricSnapshotFromReportSnapshot({
      snapshot: createScopedSnapshot({
        reportKey: "stock_balance",
        runId: "run_stock_current",
        date: "2026-07-04",
        summary: {
          sku_count: 10,
          stock_value: 100_000,
          balance_qty: 50,
          negative_stock_count: 3,
          zero_or_missing_cost_count: 0,
          top_stock_item_name: null,
        },
      }),
      periodPreset: "yesterday",
      createdAt: "2026-07-05T01:00:00.000Z",
    });

    const memory = buildAiCeoBusinessMemory({
      metricDateTo: "2026-07-04",
      reportKeys: ["cash_bank_receipts"],
      metrics: [previousReceiptMetric, currentReceiptMetric, stockMetric].filter(
        (metric): metric is MetricSnapshotRecord => Boolean(metric),
      ),
    });

    expect(memory.map((item) => item.issue_key)).toEqual([
      "cash_bank_receipts:unallocated_amount",
      "cash_bank_receipts:mismatch_document_count",
    ]);
    expect(memory[0]).toMatchObject({
      report_key: "cash_bank_receipts",
      current_value: 16_400,
      previous_value: 10_000,
      repeated_days: 2,
      trend: "worsened",
    });
    expect(JSON.stringify(memory)).not.toContain("stock_balance");
  });

  it("sanitizes production LINE advice for package scope and customer-safe wording", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
    const store = createFakeStore();
    const now = new Date().toISOString();
    store.profile = {
      ...defaultTenantAiProfile({ tenant, now }),
      selected_model_id: "qwen/qwen3.7-max",
      ai_enabled: true,
    };

    const result = await runAiCeoDryRun({
      store,
      tenant,
      request: { scheduled_date: "2026-06-30" },
      actorId: "owner",
      triggerType: "scheduled",
      sourceReportKeys: [
        "sales_goods_services",
        "purchase_goods_payables",
        "cash_bank_receipts",
        "cash_bank_payments",
      ],
      sourceSnapshots: [
        createScopedSnapshot({
          reportKey: "sales_goods_services",
          runId: "run_sales_current",
          summary: {
            total_sales: 132_690,
            document_count: 21,
            line_count: 24,
            total_qty: 75.5,
            top_product_name: "สินค้า A",
          },
        }),
        createScopedSnapshot({
          reportKey: "purchase_goods_payables",
          runId: "run_purchase_current",
        }),
        createScopedSnapshot({
          reportKey: "cash_bank_receipts",
          runId: "run_receipts_current",
          summary: {
            total_amount: 22_500,
          },
        }),
        createScopedSnapshot({
          reportKey: "cash_bank_payments",
          runId: "run_payments_current",
          summary: {
            total_amount: 739_953.7,
          },
        }),
      ],
      requester: async () => ({
        ok: true,
        providerStatus: 200,
        latencyMs: 42,
        content: JSON.stringify({
          summary:
            "\u{1F4CA} เงินสดสุทธิ -717,453.70 บาท จาก cash_bank_payments จ่ายออกสูงมาก",
          confidence: 0.82,
          caveats: [],
          top_actions: [
            {
              title: "ตรวจ cash_bank_payments",
              reason: "ยอดจ่ายออกสูงมาก",
              recommended_action: "เทียบเอกสาร cash_bank_payments กับเจ้าหนี้",
              severity: "warning",
              confidence: 0.8,
              source_report_keys: ["cash_bank_payments"],
              source_run_ids: ["run_payments_current"],
            },
            {
              title: "ติดตามลูกหนี้การค้า",
              reason: "ยอดขายสูงกว่ารับเงิน",
              recommended_action: "ดึงรายงานลูกหนี้ค้างชำระ (ถ้ามี)",
              severity: "warning",
              confidence: 0.7,
              source_report_keys: ["cash_bank_receipts"],
              source_run_ids: ["run_receipts_current"],
            },
            {
              title: "เร่งสั่งซื้อสินค้าขาดสต็อก",
              reason: "ควรเติมสต็อก",
              recommended_action: "เปิด stock_balance แล้วสร้างใบสั่งซื้อ",
              severity: "warning",
              confidence: 0.7,
              source_report_keys: ["sales_goods_services"],
              source_run_ids: ["run_sales_current"],
            },
          ],
        }),
        inputTokens: 1000,
        outputTokens: 500,
      }),
    });

    expect(result.ok).toBe(true);
    const rendered = buildAiCeoLinePreview({
      tenant,
      run: result.run,
      items: result.items,
    });
    const customerFacingText = [
      result.response?.summary,
      ...(result.response?.caveats ?? []),
      ...(result.response?.top_actions.flatMap((action) => [
        action.title,
        action.reason,
        action.recommended_action,
      ]) ?? []),
    ].join("\n");
    expect(customerFacingText).not.toContain("cash_bank_payments");
    expect(customerFacingText).not.toContain("stock_balance");
    expect(customerFacingText).not.toContain("\u{1F4CA}");
    expect(customerFacingText).not.toContain("ลูกหนี้การค้า");
    expect(customerFacingText).not.toContain("รายงานลูกหนี้ค้างชำระ");
    expect(result.response?.summary).toContain("รายงานจ่ายเงิน");
    expect(result.response?.summary).toContain("ยอดจ่ายออกสูง ควรตรวจเอกสารประกอบ");
    expect(result.response?.top_actions).toHaveLength(2);
    expect(result.response?.top_actions.map((action) => action.title)).not.toContain(
      "เร่งสั่งซื้อสินค้าขาดสต็อก",
    );
    expect(result.response?.caveats.join(" ")).toContain(
      "เงินสดสุทธิเป็นยอดตามเอกสารรับ/จ่าย",
    );
    expect(rendered?.text).not.toContain("cash_bank_payments");
    expect(rendered?.text).not.toContain("\u{1F4CA}");
  });

  it("renders compact owner-first AI CEO LINE text and strips broad strategy advice", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
    const store = createFakeStore();
    const now = new Date().toISOString();
    store.profile = {
      ...defaultTenantAiProfile({ tenant, now }),
      selected_model_id: "qwen/qwen3.7-max",
      ai_enabled: true,
    };

    const result = await runAiCeoDryRun({
      store,
      tenant,
      request: { scheduled_date: "2026-07-02" },
      actorId: "owner",
      triggerType: "scheduled",
      sourceReportKeys: [
        "sales_goods_services",
        "purchase_goods_payables",
        "cash_bank_receipts",
        "cash_bank_payments",
      ],
      sourceSnapshots: [
        createScopedSnapshot({
          reportKey: "sales_goods_services",
          runId: "run_sales_current",
          summary: {
            total_sales: 121_060,
            document_count: 15,
            line_count: 20,
            total_qty: 120,
          },
        }),
        createScopedSnapshot({
          reportKey: "purchase_goods_payables",
          runId: "run_purchase_current",
        }),
        createScopedSnapshot({
          reportKey: "cash_bank_receipts",
          runId: "run_receipts_current",
          summary: {
            total_amount: 109_150,
            unallocated_amount: 65_350,
            mismatch_document_count: 5,
          },
        }),
        createScopedSnapshot({
          reportKey: "cash_bank_payments",
          runId: "run_payments_current",
          summary: {
            total_amount: 4_030,
          },
        }),
      ],
      requester: async () => ({
        ok: true,
        providerStatus: 200,
        latencyMs: 42,
        content: JSON.stringify({
          summary:
            "วานนี้ขาย 121,060 บาท จาก 15 เอกสาร รับเงิน 109,150 บาท จ่ายเงิน 4,030 บาท รับเงินสุทธิ +105,120 บาท ซึ่งเป็นยอดตามเอกสารรับ/จ่ายในวันที่รายงาน ควรตรวจเอกสารก่อนสรุป และมีสถานะ reconciled_with_warning",
          confidence: 0.82,
          caveats: [
            "รายงานขายสินค้าและบริการมีสถานะ reconciled_with_warning",
            "เงินสดสุทธิเป็นยอดตามเอกสารรับ/จ่ายในวันที่รายงาน ไม่ใช่ยอดเงินฝากธนาคารคงเหลือ",
          ],
          top_actions: [
            {
              title: "ทบทวนการพึ่งพาผู้จำหน่ายรายเดียว",
              reason: "มีผู้จำหน่ายหลักรายเดียวในรอบนี้",
              recommended_action: "พิจารณาหา supplier สำรองเพื่อความเสี่ยงระยะยาว",
              severity: "warning",
              confidence: 0.7,
              source_report_keys: ["purchase_goods_payables"],
              source_run_ids: ["run_purchase_current"],
            },
            {
              title: "จัดสรรรับเงินที่ยังไม่ครบ",
              reason: "พบเอกสารรับเงินไม่ตรง 5 รายการ",
              recommended_action: "ให้ทีมบัญชีจัดสรรรับเงิน 5 รายการให้ครบก่อนปิดวัน",
              severity: "warning",
              confidence: 0.82,
              source_report_keys: ["cash_bank_receipts"],
              source_run_ids: ["run_receipts_current"],
            },
            {
              title: "แก้เอกสารขายที่ไม่ระบุสาขา",
              reason: "บิลขายบางส่วนไม่มีสาขา",
              recommended_action: "ให้ทีมขายแก้เอกสารวันที่ 2 ก.ค. ให้ระบุสาขาให้ครบ",
              severity: "warning",
              confidence: 0.74,
              source_report_keys: ["sales_goods_services"],
              source_run_ids: ["run_sales_current"],
            },
          ],
        }),
        inputTokens: 1000,
        outputTokens: 500,
      }),
    });

    expect(result.ok).toBe(true);
    expect(result.response?.summary).toContain("เมื่อวาน");
    expect(result.response?.summary).toContain("เงินสดสุทธิ");
    expect(result.response?.summary).not.toContain("วานนี้");
    expect(result.response?.summary).not.toContain("รับเงินสุทธิ");
    expect(result.response?.top_actions.map((action) => action.title)).toEqual([
      "จัดสรรรับเงินที่ยังไม่ครบ",
      "แก้เอกสารขายที่ไม่ระบุสาขา",
    ]);

    const rendered = buildAiCeoLinePreview({
      tenant,
      run: result.run,
      items: result.items,
    });
    expect(rendered?.text).toContain("อ้างอิงจากรายงานรอบนี้ 4 รายงาน");
    expect(rendered?.text).toContain("เงินสดสุทธิ");
    expect(rendered?.text).toContain("จัดสรรรับเงินที่ยังไม่ครบ");
    expect(rendered?.text).toContain("แก้เอกสารขายที่ไม่ระบุสาขา");
    expect(rendered?.text).not.toContain("3.");
    expect(rendered?.text).not.toContain("รับเงินสุทธิ");
    expect(rendered?.text).not.toContain("วานนี้");
    expect(rendered?.text).not.toContain("พึ่งพาผู้จำหน่าย");
    expect(rendered?.text).not.toContain("supplier");
    expect(rendered?.text).not.toContain("reconciled_with_warning");
    expect(rendered?.text.length ?? 0).toBeLessThan(900);
  });

  it("parses fenced OpenRouter JSON and can render an AI CEO fallback card", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
    const store = createFakeStore();
    const now = new Date().toISOString();
    store.profile = {
      ...defaultTenantAiProfile({ tenant, now }),
      selected_model_id: "qwen/qwen3.7-max",
      ai_enabled: true,
    };

    const result = await runAiCeoDryRun({
      store,
      tenant,
      request: { scheduled_date: "2026-06-30" },
      actorId: "owner",
      requester: async () => ({
        ok: true,
        providerStatus: 200,
        latencyMs: 42,
        content: [
          "```json",
          JSON.stringify({
            summary: "ควรดูยอดขายและเงินรับวันนี้",
            confidence: 82,
            caveats: "ควรตรวจข้อมูลบางส่วนซ้ำ",
            actions: [
              {
                title: "ตรวจยอดขาย",
                reason: "พบยอดที่ควรตรวจสอบจากรายงานขาย",
                action: "เปิดรายงานขายแล้วตรวจรายการที่ผิดปกติ",
                severity: "medium",
                confidence: 75,
                source_report_key: "sales_goods_services",
                source_run_id: "sample_demo_remote",
              },
            ],
          }),
          "```",
        ].join("\n"),
        inputTokens: 1000,
        outputTokens: 500,
      }),
    });

    expect(result.ok).toBe(true);
    expect(result.response?.confidence).toBe(0.82);
    expect(result.response?.caveats).toEqual(["ควรตรวจข้อมูลบางส่วนซ้ำ"]);
    expect(result.items[0]?.recommended_action).toContain("รายงานขาย");
    expect(result.items[0]?.severity).toBe("info");

    const fallback = buildAiCeoUnavailableLinePreview({
      tenant,
      run: result.run,
      fallbackReportRunId: "run_cash_1",
      safeErrorMessage: "OpenRouter ส่งคำตอบกลับมาในรูปแบบที่ระบบอ่านไม่ได้",
    });
    expect(fallback.line_message_type).toBe("text");
    expect(fallback.run_id).toBe("run_cash_1");
    expect(fallback.text).toContain("วันนี้ AI CEO ยังสรุปไม่ได้");
    expect(fallback.flex_message).toBeUndefined();
  });
});

function createFakeStore() {
  const snapshot = createSampleSnapshot(tenant.id);
  const state = {
    profile: null as TenantAiProfileRecord | null,
    promptVersions: [] as TenantAiPromptVersionRecord[],
    modelCatalog: [] as OpenRouterModelCatalogRecord[],
    runs: [] as AiAdvisorRunRecord[],
    items: [] as AiAdvisorItemRecord[],
    usageLedger: [] as AiUsageLedgerRecord[],
    metricSnapshots: [] as MetricSnapshotRecord[],
  };
  const store = {
    ...state,
    kind: "local-json",
    getTenantAiProfile: async () => state.profile,
    upsertTenantAiProfile: async (profile: TenantAiProfileRecord) => {
      state.profile = profile;
      store.profile = profile;
      return profile;
    },
    listTenantAiPromptVersions: async () => [...state.promptVersions],
    upsertTenantAiPromptVersion: async (prompt: TenantAiPromptVersionRecord) => {
      state.promptVersions.push(prompt);
      store.promptVersions = state.promptVersions;
      return prompt;
    },
    listOpenRouterModelCatalog: async () => [...state.modelCatalog],
    upsertOpenRouterModelCatalog: async (models: OpenRouterModelCatalogRecord[]) => {
      state.modelCatalog = models;
      store.modelCatalog = models;
      return models;
    },
    getSecretRecord: async () => null,
    listAiAdvisorRuns: async () => [...state.runs],
    getAiAdvisorRunByIdempotencyKey: async (input: {
      tenantId: string;
      idempotencyKey: string;
    }) =>
      state.runs.find(
        (run) =>
          run.tenant_id === input.tenantId &&
          run.idempotency_key === input.idempotencyKey,
      ) ?? null,
    upsertAiAdvisorRun: async (run: AiAdvisorRunRecord) => {
      const index = state.runs.findIndex(
        (item) =>
          item.id === run.id || item.idempotency_key === run.idempotency_key,
      );
      if (index >= 0) {
        state.runs[index] = run;
      } else {
        state.runs.push(run);
      }
      store.runs = state.runs;
      return run;
    },
    upsertAiAdvisorItems: async (items: AiAdvisorItemRecord[]) => {
      const byId = new Map(state.items.map((item) => [item.id, item]));
      for (const item of items) {
        byId.set(item.id, item);
      }
      state.items = Array.from(byId.values());
      store.items = state.items;
      return items;
    },
    listAiAdvisorItems: async (input?: {
      tenantId?: string;
      advisorRunId?: string;
    }) =>
      state.items.filter(
        (item) =>
          (!input?.tenantId || item.tenant_id === input.tenantId) &&
          (!input?.advisorRunId || item.advisor_run_id === input.advisorRunId),
      ),
    upsertAiUsageLedger: async (entry: AiUsageLedgerRecord) => {
      state.usageLedger.push(entry);
      store.usageLedger = state.usageLedger;
      return entry;
    },
    listAiUsageLedger: async () => [...state.usageLedger],
    pruneAiCeoHistory: async () => ({
      advisor_runs_deleted: 0,
      advisor_items_deleted: 0,
      usage_ledger_deleted: 0,
      metric_snapshots_deleted: 0,
    }),
    getLatestSnapshot: async (_tenantId: string, reportKey?: ReportKey) =>
      !reportKey || reportKey === snapshot.report_key ? snapshot : null,
    listBusinessSignals: async () => [] as BusinessSignalRecord[],
    upsertMetricSnapshot: async (metricSnapshot: MetricSnapshotRecord) => {
      const index = state.metricSnapshots.findIndex(
        (item) => item.id === metricSnapshot.id,
      );
      if (index >= 0) {
        state.metricSnapshots[index] = metricSnapshot;
      } else {
        state.metricSnapshots.push(metricSnapshot);
      }
      store.metricSnapshots = state.metricSnapshots;
      return metricSnapshot;
    },
    listMetricSnapshots: async (input?: {
      tenantId?: string;
      reportKeys?: ReportKey[];
      dateFrom?: string;
      dateTo?: string;
    }) => {
      const reportKeySet = input?.reportKeys?.length
        ? new Set(input.reportKeys)
        : null;
      return state.metricSnapshots.filter(
        (snapshot) =>
          (!input?.tenantId || snapshot.tenant_id === input.tenantId) &&
          (!reportKeySet || reportKeySet.has(snapshot.report_key)) &&
          (!input?.dateFrom || snapshot.metric_date >= input.dateFrom) &&
          (!input?.dateTo || snapshot.metric_date <= input.dateTo),
      );
    },
  } as unknown as SystemStore & typeof state;
  return store;
}

function createScopedSnapshot(input: {
  reportKey: ReportKey;
  runId: string;
  date?: string;
  summary?: unknown;
}): ReportSnapshot {
  const snapshot = createSampleSnapshot(tenant.id);
  const date = input.date ?? "2026-06-30";
  return {
    ...snapshot,
    report_key: input.reportKey,
    run_id: input.runId,
    summary: input.summary ?? snapshot.summary,
    generated_at: "2026-06-30T03:00:00.000Z",
    params: {
      date_from: date,
      date_to: date,
    },
  } as unknown as ReportSnapshot;
}
