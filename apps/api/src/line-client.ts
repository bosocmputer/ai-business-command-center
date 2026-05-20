import type {
  LineDeliveryRecord,
  LineMessageType,
  LineSendMode,
  SalesGoodsServicesLinePreview,
  TenantId,
} from "@ai-bcc/shared";
import type { LineChannelConfig } from "./config.js";

const LINE_PUSH_ENDPOINT = "https://api.line.me/v2/bot/message/push";

export type SendLineBriefInput = {
  tenantId: TenantId;
  mode: LineSendMode;
  preview: SalesGoodsServicesLinePreview;
  config: LineChannelConfig | null;
  deliveryKey?: string | null;
  deliveryType?: LineDeliveryRecord["delivery_type"];
  periodFrom?: string | null;
  periodTo?: string | null;
};

export async function sendLineBrief(
  input: SendLineBriefInput,
): Promise<LineDeliveryRecord> {
  const now = new Date().toISOString();
  const configured = Boolean(input.config);
  const lineMessage = input.preview.flex_message ?? {
    type: "text" as const,
    text: input.preview.text,
  };
  const messageType: LineMessageType = input.preview.flex_message ? "flex" : "text";
  const baseDelivery = {
    id: createLineDeliveryId(input.tenantId),
    tenant_id: input.tenantId,
    report_key: input.preview.report_key,
    report_run_id: input.preview.run_id,
    delivery_key: input.deliveryKey ?? null,
    delivery_type: input.deliveryType ?? "manual_test",
    period_from: input.periodFrom ?? null,
    period_to: input.periodTo ?? null,
    target_id_masked: input.config ? maskTargetId(input.config.targetId) : null,
    message_type: messageType,
    sent_at: null,
    provider_response_json: null,
    safe_error_message: null,
    created_at: now,
  };

  if (input.mode === "dry_run") {
    return {
      ...baseDelivery,
      status: "dry_run",
      safe_error_message: configured
        ? null
        : "LINE channel is not configured. Add channel access token and target id to environment.",
    };
  }

  if (!input.config) {
    return {
      ...baseDelivery,
      status: "skipped",
      safe_error_message:
        "LINE channel is not configured. Add channel access token and target id to environment.",
    };
  }

  try {
    const response = await fetch(LINE_PUSH_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.config.channelAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: input.config.targetId,
        messages: [lineMessage],
      }),
    });

    const responseText = await response.text();
    const providerResponse = parseProviderResponse(responseText);

    if (!response.ok) {
      return {
        ...baseDelivery,
        status: "failed",
        provider_response_json: providerResponse,
        safe_error_message: `LINE push failed with status ${response.status}.`,
      };
    }

    return {
      ...baseDelivery,
      status: "success",
      sent_at: new Date().toISOString(),
      provider_response_json: providerResponse,
    };
  } catch {
    return {
      ...baseDelivery,
      status: "failed",
      safe_error_message: "LINE push failed due to network or provider error.",
    };
  }
}

function createLineDeliveryId(tenantId: TenantId) {
  return `line_${tenantId}_${Date.now()}`;
}

function maskTargetId(value: string) {
  if (value.length <= 8) {
    return "********";
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function parseProviderResponse(value: string): Record<string, unknown> {
  if (!value.trim()) {
    return {};
  }

  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return { raw: value.slice(0, 500) };
  }
}
