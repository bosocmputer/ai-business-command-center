import { createHash } from "node:crypto";
import {
  type AllowedLineAction,
  type LineAccessProfileKey,
  type LinePermissionDecision,
  type LineTargetRecord,
  type LineTargetType,
  type LineWebhookEventRecord,
  type ReportKey,
  type TenantId,
} from "@ai-bcc/shared";
import type { LineChannelConfig } from "./config.js";

export type StoredLineTargetRecord = LineTargetRecord & {
  target_id: string;
};

export const lineAccessProfileDefaults: Record<
  LineAccessProfileKey,
  {
    label: string;
    allowed_report_keys: ReportKey[];
    allowed_actions: AllowedLineAction[];
  }
> = {
  executive: {
    label: "ผู้บริหาร",
    allowed_report_keys: ["sales_goods_services"],
    allowed_actions: [
      "receive_morning_brief",
      "ask_report",
      "open_signed_viewer",
    ],
  },
  sales_manager: {
    label: "ผู้จัดการฝ่ายขาย",
    allowed_report_keys: ["sales_goods_services"],
    allowed_actions: [
      "receive_morning_brief",
      "ask_report",
      "open_signed_viewer",
    ],
  },
  operations: {
    label: "ปฏิบัติการ/คลังสินค้า",
    allowed_report_keys: [],
    allowed_actions: [
      "receive_morning_brief",
      "ask_report",
      "open_signed_viewer",
    ],
  },
  staff: {
    label: "พนักงานทั่วไป",
    allowed_report_keys: [],
    allowed_actions: [],
  },
};

export function buildEnvFallbackLineTarget(input: {
  tenantId: TenantId;
  config: LineChannelConfig;
}): StoredLineTargetRecord {
  const now = new Date().toISOString();
  const defaults = lineAccessProfileDefaults.executive;
  const targetIdHash = hashLineTargetId(input.config.targetId);

  return {
    id: `line_target_env_${input.tenantId}`,
    tenant_id: input.tenantId,
    line_channel_id: null,
    display_name: "Pilot LINE target",
    target_type: normalizeLineTargetType({
      value: input.config.targetType,
      targetId: input.config.targetId,
    }),
    target_id: input.config.targetId,
    target_id_masked: maskLineTargetId(input.config.targetId),
    target_id_hash: targetIdHash,
    access_profile_key: "executive",
    allowed_report_keys: defaults.allowed_report_keys,
    allowed_actions: defaults.allowed_actions,
    enabled: true,
    approved: true,
    source: "env_fallback",
    last_delivery_at: null,
    created_at: now,
    updated_at: now,
  };
}

export function buildPendingWebhookLineTarget(input: {
  tenantId: TenantId;
  event: LineWebhookEventRecord;
  lineChannelId?: string | null;
}): StoredLineTargetRecord | null {
  if (
    !input.event.source_id ||
    !isLineTargetType(input.event.source_type)
  ) {
    return null;
  }

  const now = new Date().toISOString();
  const targetIdHash = hashLineTargetId(input.event.source_id);

  return {
    id: createLineTargetId(input.tenantId, input.event.source_id),
    tenant_id: input.tenantId,
    line_channel_id: input.lineChannelId ?? null,
    display_name: `LINE ${input.event.source_type} ${maskLineTargetId(
      input.event.source_id,
    )}`,
    target_type: input.event.source_type,
    target_id: input.event.source_id,
    target_id_masked: maskLineTargetId(input.event.source_id),
    target_id_hash: targetIdHash,
    access_profile_key: "staff",
    allowed_report_keys: [],
    allowed_actions: [],
    enabled: false,
    approved: false,
    source: "webhook",
    last_delivery_at: null,
    created_at: now,
    updated_at: now,
  };
}

export function applyLineAccessProfileDefaults(
  target: StoredLineTargetRecord,
  profileKey: LineAccessProfileKey,
): StoredLineTargetRecord {
  const defaults = lineAccessProfileDefaults[profileKey];
  return {
    ...target,
    access_profile_key: profileKey,
    allowed_report_keys: [...defaults.allowed_report_keys],
    allowed_actions: [...defaults.allowed_actions],
    updated_at: new Date().toISOString(),
  };
}

export function canAccessLineReport(input: {
  tenantId: TenantId;
  target: StoredLineTargetRecord | null;
  reportKey: ReportKey;
  action: AllowedLineAction;
}): LinePermissionDecision {
  if (!input.target) {
    return deny("target_not_found", "ยังไม่ได้ลงทะเบียนปลายทาง LINE นี้");
  }

  if (input.target.tenant_id !== input.tenantId) {
    return deny("tenant_mismatch", "ปลายทาง LINE นี้ไม่ได้อยู่ในบริษัทนี้");
  }

  if (!input.target.approved) {
    return deny(
      "target_not_approved",
      "ปลายทาง LINE นี้ยังไม่ได้รับอนุมัติจากผู้ดูแล",
    );
  }

  if (!input.target.enabled) {
    return deny("target_disabled", "ปลายทาง LINE นี้ถูกปิดการใช้งาน");
  }

  if (!input.target.allowed_actions.includes(input.action)) {
    return deny("action_not_allowed", "กลุ่มนี้ไม่มีสิทธิ์ทำรายการนี้");
  }

  if (!input.target.allowed_report_keys.includes(input.reportKey)) {
    return deny("report_not_allowed", "กลุ่มนี้ไม่มีสิทธิ์ดูรายงานนี้");
  }

  return {
    allowed: true,
    reason: "allowed",
    message: "อนุญาต",
  };
}

export function toSafeLineTargetRecord(
  target: StoredLineTargetRecord,
): LineTargetRecord {
  const { target_id: _targetId, ...safeTarget } = target;
  return safeTarget;
}

export function hashLineTargetId(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function maskLineTargetId(value: string) {
  if (value.length <= 10) {
    return "********";
  }

  return `${value.slice(0, 5)}...${value.slice(-5)}`;
}

function createLineTargetId(tenantId: TenantId, targetId: string) {
  return `line_target_${tenantId}_${hashLineTargetId(targetId).slice(0, 16)}`;
}

function normalizeLineTargetType(input: {
  value?: string | null;
  targetId: string;
}): LineTargetType {
  if (isLineTargetType(input.value)) {
    return input.value;
  }

  const prefix = input.targetId.slice(0, 1);
  if (prefix === "C") {
    return "group";
  }
  if (prefix === "R") {
    return "room";
  }
  return "user";
}

function isLineTargetType(value: unknown): value is LineTargetType {
  return value === "user" || value === "group" || value === "room";
}

function deny(
  reason: Exclude<LinePermissionDecision["reason"], "allowed">,
  message: string,
): LinePermissionDecision {
  return {
    allowed: false,
    reason,
    message,
  };
}
