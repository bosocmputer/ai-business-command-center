export type AiCeoOpsStatus = string | null | undefined;

export function shouldSendNotificationSummaryOpsAlert(input: {
  mode: "dry_run" | "send";
  degradedReportCount: number;
  deliveryStatuses: string[];
}) {
  if (input.mode !== "send") {
    return false;
  }
  const failedDeliveryCount = input.deliveryStatuses.filter(
    (status) => status !== "success",
  ).length;
  const noDeliveryCount = input.deliveryStatuses.length === 0 ? 1 : 0;
  return input.degradedReportCount + failedDeliveryCount + noDeliveryCount > 0;
}

export function shouldSendAiCeoFailureOpsAlert(input: {
  mode: "dry_run" | "send";
  aiCeoEnabled: boolean;
  aiCeoStatus: AiCeoOpsStatus;
  safeErrorMessage: string | null | undefined;
}) {
  if (input.mode !== "send" || !input.aiCeoEnabled) {
    return false;
  }
  if (input.safeErrorMessage?.trim()) {
    return true;
  }
  return Boolean(
    input.aiCeoStatus &&
      input.aiCeoStatus !== "success" &&
      input.aiCeoStatus !== "success_with_warnings",
  );
}

export function buildAiCeoFailureOpsAction(safeErrorMessage?: string | null) {
  const message = safeErrorMessage ?? "";
  if (message.includes("HTTP 402") || message.includes("เครดิต OpenRouter")) {
    return "เติมเครดิต OpenRouter หรือเปลี่ยน API key/model แล้วกด dry-run ทดสอบ AI CEO";
  }
  if (message.includes("HTTP 429") || message.includes("จำกัดความถี่")) {
    return "รอให้ rate limit คลายตัว หรือกระจายรอบส่ง/เปลี่ยน model แล้วกด dry-run ทดสอบ AI CEO";
  }
  if (message.includes("API key") || message.includes("ไม่มีสิทธิ์")) {
    return "ตรวจ OpenRouter API key, สิทธิ์ model และ key mode ของร้านในหน้า AI CEO";
  }
  if (message.includes("รูปแบบ") || message.includes("JSON")) {
    return "ลองเปลี่ยน model หรือปรับ prompt ให้ตอบ JSON ตาม schema แล้วกด dry-run ทดสอบ";
  }
  if (message.includes("timeout") || message.includes("provider")) {
    return "ลองใหม่อีกครั้ง ถ้ายังซ้ำให้เปลี่ยน model หรือรอ provider กลับมาปกติ";
  }
  return "ตรวจหน้า AI CEO ของร้าน ดู model/key/prompt และกด dry-run ก่อนรอบส่งถัดไป";
}
