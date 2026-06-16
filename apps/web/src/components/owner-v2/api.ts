import { buildRememberedAdminJsonHeaders } from "@/components/command-center/adminAuth";
import { getCommandCenterApiBaseUrl } from "@/components/command-center/apiBaseUrl";

const API_BASE_URL = getCommandCenterApiBaseUrl();

export async function ownerV2Fetch<T>(
  path: string,
  options: {
    signal?: AbortSignal;
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?: unknown;
  } = {},
) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: buildRememberedAdminJsonHeaders(),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
  const payload = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: string;
    details?: unknown;
  };

  if (!response.ok) {
    const error = new Error(
      payload.error || "โหลดข้อมูลไม่สำเร็จ กรุณารีเฟรชหรือตรวจ session ผู้ดูแล",
    );
    (error as Error & { status?: number; details?: unknown }).status =
      response.status;
    (error as Error & { status?: number; details?: unknown }).details =
      payload.details;
    throw error;
  }

  return payload.data as T;
}

export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}
