import { describe, expect, it } from "vitest";
import {
  applyLineAccessProfileDefaults,
  buildAssignedLineTarget,
  buildEnvFallbackLineTarget,
  buildPendingWebhookLineTarget,
  canAccessLineReport,
} from "./line-targets.js";

describe("LINE target permission profiles", () => {
  const executiveTarget = buildEnvFallbackLineTarget({
    tenantId: "tenant_demo_remote",
    config: {
      channelAccessToken: "line-token",
      targetId: "C1234567890abcdef1234567890abcdef",
      targetType: "group",
    },
  });

  it("allows executive targets to receive the sales morning brief", () => {
    expect(
      canAccessLineReport({
        tenantId: "tenant_demo_remote",
        target: executiveTarget,
        reportKey: "sales_goods_services",
        action: "receive_morning_brief",
      }),
    ).toMatchObject({
      allowed: true,
      reason: "allowed",
    });
  });

  it("denies staff targets for sales reports", () => {
    const staffTarget = applyLineAccessProfileDefaults(
      {
        ...executiveTarget,
        id: "line_target_staff",
        access_profile_key: "staff",
        approved: true,
        enabled: true,
      },
      "staff",
    );

    expect(
      canAccessLineReport({
        tenantId: "tenant_demo_remote",
        target: staffTarget,
        reportKey: "sales_goods_services",
        action: "receive_morning_brief",
      }),
    ).toMatchObject({
      allowed: false,
      reason: "action_not_allowed",
    });
  });

  it("denies disabled and unapproved targets before checking report access", () => {
    expect(
      canAccessLineReport({
        tenantId: "tenant_demo_remote",
        target: {
          ...executiveTarget,
          approved: false,
          enabled: true,
        },
        reportKey: "sales_goods_services",
        action: "receive_morning_brief",
      }),
    ).toMatchObject({
      allowed: false,
      reason: "target_not_approved",
    });

    expect(
      canAccessLineReport({
        tenantId: "tenant_demo_remote",
        target: {
          ...executiveTarget,
          approved: true,
          enabled: false,
        },
        reportKey: "sales_goods_services",
        action: "receive_morning_brief",
      }),
    ).toMatchObject({
      allowed: false,
      reason: "target_disabled",
    });
  });

  it("denies cross-tenant target reuse", () => {
    expect(
      canAccessLineReport({
        tenantId: "tenant_office_sml1_2026",
        target: executiveTarget,
        reportKey: "sales_goods_services",
        action: "receive_morning_brief",
      }),
    ).toMatchObject({
      allowed: false,
      reason: "tenant_mismatch",
    });
  });

  it("creates a tenant-specific assignment for a shared recipient without changing the source target", () => {
    const assignedTarget = buildAssignedLineTarget({
      tenantId: "seaandhill_demo",
      sourceTarget: executiveTarget,
      lineChannelId: "line_channel_owner_shared",
      profileKey: "sales_manager",
    });

    expect(assignedTarget).toMatchObject({
      id: "line_target_seaandhill_demo_a8af2cbc4928007e",
      tenant_id: "seaandhill_demo",
      line_channel_id: "line_channel_owner_shared",
      display_name: executiveTarget.display_name,
      target_id_masked: executiveTarget.target_id_masked,
      target_id_hash: executiveTarget.target_id_hash,
      access_profile_key: "sales_manager",
      approved: true,
      enabled: true,
      source: "manual",
      allowed_report_keys: ["sales_goods_services"],
      allowed_actions: [
        "receive_morning_brief",
        "ask_report",
        "open_signed_viewer",
      ],
    });
    expect(executiveTarget.tenant_id).toBe("tenant_demo_remote");
  });

  it("can create assignments with report permissions supplied by a tenant matrix", () => {
    const assignedTarget = buildAssignedLineTarget({
      tenantId: "seaandhill_demo",
      sourceTarget: executiveTarget,
      lineChannelId: "line_channel_owner_shared",
      profileKey: "sales_manager",
      allowedReportKeys: ["purchase_goods_payables"],
    });

    expect(assignedTarget.allowed_report_keys).toEqual([
      "purchase_goods_payables",
    ]);
    expect(assignedTarget.allowed_actions).toEqual([
      "receive_morning_brief",
      "ask_report",
      "open_signed_viewer",
    ]);
  });

  it("discovers personal LINE targets as pending staff with a one-recipient estimate", () => {
    const target = buildPendingWebhookLineTarget({
      tenantId: "tenant_demo_remote",
      event: {
        id: "event_1",
        event_type: "message",
        source_type: "user",
        source_id: "U1234567890abcdef1234567890abcdef",
        source_id_masked: "U1234...bcdef",
        user_id: "U1234567890abcdef1234567890abcdef",
        message_text: "test",
        raw_event_json: {},
        created_at: "2026-05-21T01:00:00.000Z",
      },
    });

    expect(target).toMatchObject({
      target_type: "user",
      access_profile_key: "staff",
      approved: false,
      enabled: false,
      allowed_report_keys: [],
      allowed_actions: [],
      recipient_count_estimate: 1,
    });
  });

  it("discovers LINE groups as pending staff without an automatic recipient estimate", () => {
    const target = buildPendingWebhookLineTarget({
      tenantId: "tenant_demo_remote",
      event: {
        id: "event_2",
        event_type: "message",
        source_type: "group",
        source_id: "C1234567890abcdef1234567890abcdef",
        source_id_masked: "C1234...bcdef",
        user_id: "U1234567890abcdef1234567890abcdef",
        message_text: "test",
        raw_event_json: {},
        created_at: "2026-05-21T01:00:00.000Z",
      },
    });

    expect(target).toMatchObject({
      target_type: "group",
      access_profile_key: "staff",
      approved: false,
      enabled: false,
      recipient_count_estimate: null,
    });
  });
});
