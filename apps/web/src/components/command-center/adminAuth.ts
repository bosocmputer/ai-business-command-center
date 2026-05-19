const ADMIN_TOKEN_STORAGE_KEY = "ai_bcc_admin_token";

export function getAdminToken() {
  if (typeof window === "undefined") {
    return null;
  }

  const storedToken = window.sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
  if (storedToken?.trim()) {
    return storedToken.trim();
  }

  const promptedToken = window.prompt(
    "กรอก Admin token เพื่อทำรายการที่เปลี่ยนข้อมูล เช่น รันรายงานหรือส่ง LINE",
  );
  if (!promptedToken?.trim()) {
    return null;
  }

  const token = promptedToken.trim();
  window.sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
  return token;
}

export function buildAdminJsonHeaders() {
  const token = getAdminToken();
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
