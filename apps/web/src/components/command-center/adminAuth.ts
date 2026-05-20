const ADMIN_TOKEN_STORAGE_KEY = "ai_bcc_admin_token";

export type AdminTokenRequestOptions = {
  actionLabel?: string;
  description?: string;
};

export type AdminTokenRequest = {
  id: number;
  options: AdminTokenRequestOptions;
};

export type AdminConfirmationRequestOptions = {
  title: string;
  message: string;
  details?: Array<{
    label: string;
    value: string;
  }>;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
};

export type AdminConfirmationRequest = {
  id: number;
  options: AdminConfirmationRequestOptions;
};

let nextRequestId = 1;
let pendingTokenRequest:
  | (AdminTokenRequest & { resolve: (token: string | null) => void })
  | null = null;
let pendingConfirmationRequest:
  | (AdminConfirmationRequest & { resolve: (confirmed: boolean) => void })
  | null = null;

const tokenRequestListeners = new Set<
  (request: AdminTokenRequest | null) => void
>();
const confirmationRequestListeners = new Set<
  (request: AdminConfirmationRequest | null) => void
>();

export function subscribeAdminTokenRequests(
  listener: (request: AdminTokenRequest | null) => void,
) {
  tokenRequestListeners.add(listener);
  listener(pendingTokenRequest ? toPublicTokenRequest(pendingTokenRequest) : null);

  return () => {
    tokenRequestListeners.delete(listener);
  };
}

export function subscribeAdminConfirmationRequests(
  listener: (request: AdminConfirmationRequest | null) => void,
) {
  confirmationRequestListeners.add(listener);
  listener(
    pendingConfirmationRequest
      ? toPublicConfirmationRequest(pendingConfirmationRequest)
      : null,
  );

  return () => {
    confirmationRequestListeners.delete(listener);
  };
}

export function resolveAdminTokenRequest(
  requestId: number,
  token: string | null,
  remember = true,
) {
  if (!pendingTokenRequest || pendingTokenRequest.id !== requestId) {
    return;
  }

  const trimmedToken = token?.trim() || null;
  if (trimmedToken && remember) {
    rememberAdminToken(trimmedToken);
  }

  pendingTokenRequest.resolve(trimmedToken);
  pendingTokenRequest = null;
  emitTokenRequest();
}

export function resolveAdminConfirmationRequest(
  requestId: number,
  confirmed: boolean,
) {
  if (
    !pendingConfirmationRequest ||
    pendingConfirmationRequest.id !== requestId
  ) {
    return;
  }

  pendingConfirmationRequest.resolve(confirmed);
  pendingConfirmationRequest = null;
  emitConfirmationRequest();
}

export async function requestAdminConfirmation(
  options: AdminConfirmationRequestOptions,
) {
  if (typeof window === "undefined") {
    return false;
  }

  return new Promise<boolean>((resolve) => {
    pendingConfirmationRequest = {
      id: nextRequestId++,
      options,
      resolve,
    };
    emitConfirmationRequest();
  });
}

export async function getAdminToken(options: AdminTokenRequestOptions = {}) {
  if (typeof window === "undefined") {
    return null;
  }

  const storedToken = window.sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
  if (storedToken?.trim()) {
    return storedToken.trim();
  }

  return new Promise<string | null>((resolve) => {
    pendingTokenRequest = {
      id: nextRequestId++,
      options,
      resolve,
    };
    emitTokenRequest();
  });
}

export async function buildAdminJsonHeaders(
  options: AdminTokenRequestOptions = {},
) {
  const token = await getAdminToken(options);
  if (!token) {
    return null;
  }

  return {
    "Content-Type": "application/json",
    "x-ai-bcc-admin-token": token,
  };
}

export function buildRememberedAdminJsonHeaders() {
  const token = getRememberedAdminToken();
  if (!token) {
    return null;
  }

  return {
    "Content-Type": "application/json",
    "x-ai-bcc-admin-token": token,
  };
}

export function forgetAdminToken() {
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
  }
}

export function getRememberedAdminToken() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY)?.trim() || null;
}

export function rememberAdminToken(token: string) {
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
  }
}

function emitTokenRequest() {
  const publicRequest = pendingTokenRequest
    ? toPublicTokenRequest(pendingTokenRequest)
    : null;
  tokenRequestListeners.forEach((listener) => listener(publicRequest));
}

function emitConfirmationRequest() {
  const publicRequest = pendingConfirmationRequest
    ? toPublicConfirmationRequest(pendingConfirmationRequest)
    : null;
  confirmationRequestListeners.forEach((listener) => listener(publicRequest));
}

function toPublicTokenRequest(
  request: AdminTokenRequest & { resolve: (token: string | null) => void },
): AdminTokenRequest {
  return {
    id: request.id,
    options: request.options,
  };
}

function toPublicConfirmationRequest(
  request: AdminConfirmationRequest & {
    resolve: (confirmed: boolean) => void;
  },
): AdminConfirmationRequest {
  return {
    id: request.id,
    options: request.options,
  };
}
