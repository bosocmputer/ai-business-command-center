import { NextRequest, NextResponse } from "next/server";
import {
  createOwnerSessionToken,
  getOwnerAuthSecret,
  OWNER_AUTH_COOKIE,
} from "@/lib/ownerAuth";

const SESSION_TTL_SECONDS = 12 * 60 * 60;
const REMEMBERED_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const remember = Boolean(body?.remember);

  if (!username || !password) {
    return NextResponse.json(
      { error: "กรุณากรอก username และ password" },
      { status: 400 },
    );
  }

  const authResponse = await fetch(`${getApiBaseUrl()}/api/auth/owner/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const authPayload = (await authResponse.json().catch(() => ({}))) as {
    error?: string;
    subject?: string;
  };

  if (!authResponse.ok || !authPayload.subject) {
    return NextResponse.json(
      { error: authPayload.error || "username หรือ password ไม่ถูกต้อง" },
      { status: authResponse.status || 401 },
    );
  }

  const ttlSeconds = remember
    ? REMEMBERED_SESSION_TTL_SECONDS
    : SESSION_TTL_SECONDS;
  const token = await createOwnerSessionToken({
    secret: getOwnerAuthSecret(),
    ttlSeconds,
    username: authPayload.subject,
  });
  const response = NextResponse.json({
    ok: true,
    role: "owner_admin",
    expires_in: ttlSeconds,
  });
  response.cookies.set(OWNER_AUTH_COOKIE, token, {
    httpOnly: true,
    maxAge: ttlSeconds,
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
