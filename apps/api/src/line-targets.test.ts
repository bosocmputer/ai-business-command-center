import { describe, expect, it } from "vitest";
import {
  applyLineAccessProfileDefaults,
  buildEnvFallbackLineTarget,
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
});
