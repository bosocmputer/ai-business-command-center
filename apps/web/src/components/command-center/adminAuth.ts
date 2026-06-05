export type AdminRequestOptions = {
  actionLabel?: string;
  description?: string;
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
let pendingConfirmationRequest:
  | (AdminConfirmationRequest & { resolve: (confirmed: boolean) => void })
  | null = null;

const confirmationRequestListeners = new Set<
  (request: AdminConfirmationRequest | null) => void
>();

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

export async function buildAdminJsonHeaders(options: AdminRequestOptions = {}) {
  void options;
  return buildOwnerSessionJsonHeaders();
}

export function buildRememberedAdminJsonHeaders() {
  return buildOwnerSessionJsonHeaders();
}

export function forgetAdminToken() {
  // Kept as a compatibility no-op for legacy components that clear auth on 401.
}

function buildOwnerSessionJsonHeaders() {
  return {
    "Content-Type": "application/json",
  };
}

function emitConfirmationRequest() {
  const publicRequest = pendingConfirmationRequest
    ? toPublicConfirmationRequest(pendingConfirmationRequest)
    : null;
  confirmationRequestListeners.forEach((listener) => listener(publicRequest));
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
