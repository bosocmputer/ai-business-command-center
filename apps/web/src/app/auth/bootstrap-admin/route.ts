import { NextRequest, NextResponse } from "next/server";
import {
  createOwnerSessionToken,
  getOwnerAuthSecret,
  OWNER_AUTH_COOKIE,
} from "@/lib/ownerAuth";

const SESSION_TTL_SECONDS = 12 * 60 * 60;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const displayName =
    typeof body?.display_name === "string" ? body.display_name.trim() : "";

  if (!username || !password) {
    return NextResponse.json(
      { error: "กรุณากรอก username และ password" },
      { status: 400 },
    );
  }

  const authResponse = await fetch(
    `${getApiBaseUrl()}/api/auth/owner/bootstrap-admin`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        password,
        display_name: displayName || undefined,
      }),
    },
  );
  const authPayload = (await authResponse.json().catch(() => ({}))) as {
    error?: string;
    subject?: string;
  };

  if (!authResponse.ok || !authPayload.subject) {
    return NextResponse.json(
      { error: authPayload.error || "สร้างบัญชีผู้ดูแลไม่สำเร็จ" },
      { status: authResponse.status || 500 },
    );
  }

  const token = await createOwnerSessionToken({
    secret: getOwnerAuthSecret(),
    ttlSeconds: SESSION_TTL_SECONDS,
    username: authPayload.subject,
  });
  const response = NextResponse.json({
    ok: true,
    role: "owner_admin",
    expires_in: SESSION_TTL_SECONDS,
  });
  response.cookies.set(OWNER_AUTH_COOKIE, token, {
    httpOnly: true,
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
    sameSite: "lax",
  });

  return response;
}

function getApiBaseUrl() {
  return (
    process.env.API_REWRITE_BASE_URL ||
    (process.env.NODE_ENV === "production"
      ? "http://api:4000"
      : "http://127.0.0.1:4000")
  ).replace(/\/$/, "");
}
