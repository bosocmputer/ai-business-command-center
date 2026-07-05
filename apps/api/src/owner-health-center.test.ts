import { describe, expect, it } from "vitest";
import {
  buildOwnerHealthCenterPayload,
  explainAiCeoSafeError,
  type OwnerHealthCenterInput,
} from "./owner-health-center.js";

const now = new Date("2026-07-05T02:00:00.000Z");

function makeInput(
  overrides: Partial<OwnerHealthCenterInput> = {},
): OwnerHealthCenterInput {
  return {
    now,
    window_hours: 24,
    tenants: [
      {
        tenant: {
          id: "tenant_a",
          name: "ร้าน A",
          databaseName: "sml_a",
          description: "",
          datasourceConfigured: true,
          status: "active",
          planCode: "business",
          suspendedReason: null,
          currentPeriodEnd: null,
          billingCycle: null,
        },
        datasource_configured: true,
        line_targets_total: 1,
        line_targets_enabled: 1,
        ai_profile: {
          tenant_id: "tenant_a",
          ai_enabled: true,
          shadow_mode_enabled: false,
          advisor_name: "AI CEO",
          business_type: "retail",
          selected_model_id: "qwen/qwen3.7-max",
          key_mode: "system_default",
          daily_token_budget: 100_000,
          monthly_token_budget: 1_000_000,
          daily_cost_budget_usd: 10,
          monthly_cost_budget_usd: 100,
          active_prompt_version_id: null,
          last_dry_run_at: null,
          last_run_at: "2026-07-05T01:00:00.000Z",
          last_status: "success",
          last_safe_error_message: null,
          created_at: "2026-07-01T00:00:00.000Z",
          updated_at: "2026-07-01T00:00:00.000Z",
        },
      },
    ],
    worker_heartbeat: {
      id: "heartbeat_1",
      worker_id: "worker_1",
      role: "notification_rule_worker",
      status: "ok",
      metadata_json: {},
      checked_at: "2026-07-05T01:59:00.000Z",
      created_at: "2026-07-05T01:59:00.000Z",
    },
    notification_rules: [
      {
        id: "rule_a",
        tenant_id: "tenant_a",
        name: "Morning brief",
        enabled: true,
        timezone: "Asia/Bangkok",
        period_preset: "yesterday",
        period_strategy: "executive_checkpoints",
        schedule: [{ weekdays: [1], times: ["08:00"] }],
        report_keys: ["sales_goods_services"],
        target_ids: ["target_a"],
        message_packaging: "digest",
        digest_mode: "all_reports",
        retry_policy: { max_attempts: 3, retry_delay_minutes: 10 },
        last_run_at: "2026-07-05T01:00:00.000Z",
        last_run_status: "success",
        last_safe_error_message: null,
        created_at: "2026-07-01T00:00:00.000Z",
        updated_at: "2026-07-01T00:00:00.000Z",
      },
    ],
    notification_runs: [
      {
        id: "notification_run_a",
        rule_id: "rule_a",
        tenant_id: "tenant_a",
        scheduled_local_date: "2026-07-05",
        scheduled_local_time: "08:00",
        timezone: "Asia/Bangkok",
        period_from: "2026-07-04",
        period_to: "2026-07-04",
        period_from_time: null,
        period_to_time: null,
        period_strategy: "executive_checkpoints",
        unknown_doc_time_count: 0,
        status: "success",
        mode: "send",
        source: "worker_due",
        attempt: 1,
        idempotency_key: "key_a",
        report_run_ids: ["report_run_a"],
        report_results: [
          {
            report_key: "sales_goods_services",
            status: "success",
            freshness: "fresh",
            run_id: "report_run_a",
            snapshot_generated_at: "2026-07-05T01:00:00.000Z",
            duration_ms: 1000,
            row_count: 0,
            degraded_reason: null,
          },
        ],
        delivery_ids: ["delivery_a"],
        safe_error_message: null,
        started_at: "2026-07-05T01:00:00.000Z",
        finished_at: "2026-07-05T01:01:00.000Z",
        queued_at: "2026-07-05T00:59:00.000Z",
        claimed_at: "2026-07-05T01:00:00.000Z",
        worker_id: "worker_1",
        client_request_id: null,
        target_ids_override: null,
        next_retry_at: null,
        progress_stage: "completed",
        progress_percent: 100,
        progress_current_report_key: null,
        progress_done_reports: 1,
        progress_total_reports: 1,
        progress_updated_at: "2026-07-05T01:01:00.000Z",
        created_at: "2026-07-05T00:59:00.000Z",
        updated_at: "2026-07-05T01:01:00.000Z",
      },
    ],
    line_deliveries: [
      {
        id: "delivery_a",
        tenant_id: "tenant_a",
        report_key: "sales_goods_services",
        report_run_id: "report_run_a",
        delivery_key: "delivery_key_a",
        delivery_type: "notification_rule",
        period_from: "2026-07-04",
        period_to: "2026-07-04",
        target_id_masked: "Uabc...",
        message_type: "flex",
        status: "success",
        sent_at: "2026-07-05T01:01:00.000Z",
        provider_response_json: {},
        safe_error_message: null,
        created_at: "2026-07-05T01:01:00.000Z",
      },
    ],
    report_runs: [
      {
        id: "report_run_a",
        tenant_id: "tenant_a",
        report_key: "sales_goods_services",
        params: { date_from: "2026-07-04", date_to: "2026-07-04" },
        status: "success",
        started_at: "2026-07-05T01:00:00.000Z",
        finished_at: "2026-07-05T01:01:00.000Z",
        row_count: 0,
        safe_error_message: null,
      },
    ],
    ai_runs: [
      {
        id: "ai_run_a",
        tenant_id: "tenant_a",
        run_date: "2026-07-05",
        trigger_type: "scheduled",
        status: "success",
        idempotency_key: "ai_key_a",
        model_provider: "openrouter",
        model_id: "qwen/qwen3.7-max",
        prompt_version_id: null,
        context_hash: "hash_a",
        source_report_keys: ["sales_goods_services"],
        input_tokens: 100,
        output_tokens: 50,
        cost_estimate_usd: 0.01,
        latency_ms: 1000,
        fallback_used: false,
        response_json: {
          summary: "ok",
          confidence: 0.8,
          caveats: [],
          top_actions: [],
        },
        safe_error_message: null,
        created_at: "2026-07-05T01:00:00.000Z",
        started_at: "2026-07-05T01:00:00.000Z",
        finished_at: "2026-07-05T01:01:00.000Z",
      },
    ],
    ai_usage: [
      {
        id: "usage_a",
        tenant_id: "tenant_a",
        provider: "openrouter",
        model_id: "qwen/qwen3.7-max",
        advisor_run_id: "ai_run_a",
        input_tokens: 100,
        output_tokens: 50,
        cost_estimate_usd: 0.01,
        usage_source: "estimated",
        created_at: "2026-07-05T01:01:00.000Z",
      },
    ],
    metric_snapshots: [
      {
        id: "metric_a",
        tenant_id: "tenant_a",
        report_key: "sales_goods_services",
        metric_date: "2026-07-04",
        period_preset: "yesterday",
        metrics_json: { total_sales: 0 },
        quality_status: "valid",
        source_run_ids: ["report_run_a"],
        created_at: "2026-07-05T01:01:00.000Z",
      },
    ],
    ...overrides,
  };
}

describe("owner health center", () => {
  it("treats zero sales as information, not an incident, when systems succeeded", () => {
    const payload = buildOwnerHealthCenterPayload(makeInput());
    expect(payload.overall.status).toBe("ok");
    expect(payload.incidents).toHaveLength(0);
    expect(payload.tenants[0].reports.status).toBe("ok");
  });

  it("marks LINE failed as critical", () => {
    const input = makeInput({
      line_deliveries: [
        {
          ...makeInput().line_deliveries[0],
          id: "delivery_failed",
          status: "failed",
          safe_error_message: "LINE provider rejected message",
        },
      ],
    });
    const payload = buildOwnerHealthCenterPayload(input);
    expect(payload.overall.status).toBe("critical");
    expect(payload.summary.line_failed_count).toBe(1);
    expect(payload.incidents[0].title).toContain("LINE");
  });

  it("marks AI CEO OpenRouter failure as warning when LINE cards succeeded", () => {
    const input = makeInput({
      ai_runs: [
        {
          ...makeInput().ai_runs[0],
          status: "failed",
          safe_error_message: "เครดิต OpenRouter ไม่พอสำหรับ API key นี้ (HTTP 402)",
        },
      ],
    });
    const payload = buildOwnerHealthCenterPayload(input);
    expect(payload.overall.status).toBe("warning");
    expect(payload.summary.ai_ceo_warning_count).toBe(1);
    expect(payload.tenants[0].line.status).toBe("ok");
    expect(payload.incidents[0].detail).toContain("เติมเครดิต");
  });

  it("marks worker stale as critical", () => {
    const payload = buildOwnerHealthCenterPayload(
      makeInput({
        worker_heartbeat: {
          ...makeInput().worker_heartbeat!,
          checked_at: "2026-07-05T01:40:00.000Z",
        },
      }),
    );
    expect(payload.summary.worker_stale).toBe(true);
    expect(payload.overall.status).toBe("critical");
  });

  it("turns report warnings into Thai incidents without report keys", () => {
    const payload = buildOwnerHealthCenterPayload(
      makeInput({
        notification_runs: [
          {
            ...makeInput().notification_runs[0],
            status: "success_with_warnings",
            report_results: [
              {
                report_key: "cash_bank_receipts",
                status: "success_with_warning",
                freshness: "fresh",
                run_id: "report_run_warning",
                snapshot_generated_at: null,
                duration_ms: 1000,
                row_count: 5,
                degraded_reason: "cash mismatch",
              },
            ],
          },
        ],
      }),
    );
    expect(payload.overall.status).toBe("warning");
    expect(JSON.stringify(payload.incidents)).not.toContain("cash_bank_receipts");
    expect(payload.incidents.some((incident) => incident.title.includes("รับเงิน"))).toBe(
      true,
    );
  });

  it("explains OpenRouter failures for admins", () => {
    expect(explainAiCeoSafeError("HTTP 402 เครดิต OpenRouter ไม่พอ")).toContain(
      "เติมเครดิต",
    );
    expect(explainAiCeoSafeError("HTTP 429 จำกัดความถี่")).toContain(
      "rate limit",
    );
    expect(explainAiCeoSafeError("invalid JSON รูปแบบไม่ตรง")).toContain(
      "schema",
    );
  });
});
