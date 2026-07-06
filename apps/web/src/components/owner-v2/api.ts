import { buildRememberedAdminJsonHeaders } from "@/components/command-center/adminAuth";
import { getCommandCenterApiBaseUrl } from "@/components/command-center/apiBaseUrl";

const API_BASE_URL = getCommandCenterApiBaseUrl();

export type OwnerV2FetchErrorPayload<T = unknown> = {
  data?: T;
  error?: string;
  details?: unknown;
} & Record<string, unknown>;

export type OwnerV2FetchError = Error & {
  status?: number;
  details?: unknown;
  payload?: OwnerV2FetchErrorPayload;
};

export async function ownerV2Fetch<T>(
  path: string,
  options: {
    signal?: AbortSignal;
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?: unknown;
  } = {},
) {
  const payload = await ownerV2Request<{ data?: T }>(path, options);
  return payload.data as T;
}

export async function ownerV2Request<TPayload extends OwnerV2FetchErrorPayload>(
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
  const payload = (await response.json().catch(() => ({}))) as TPayload;

  if (!response.ok) {
    const error = new Error(
      payload.error ||
        "โหลดข้อมูลไม่สำเร็จ กรุณารีเฟรชหน้า หรือลงชื่อเข้าใช้อีกครั้ง",
    ) as OwnerV2FetchError;
    error.status = response.status;
    error.details = payload.details;
    error.payload = payload;
    throw error;
  }

  return payload as TPayload;
}

export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export function isOwnerV2AuthError(error: unknown) {
  const status = (error as OwnerV2FetchError | undefined)?.status;
  return status === 401 || status === 403;
}
