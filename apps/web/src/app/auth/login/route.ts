import { NextRequest, NextResponse } from "next/server";
import {
  createOwnerSessionToken,
  getOwnerAuthSecret,
  OWNER_AUTH_COOKIE,
} from "@/lib/ownerAuth";

const DEFAULT_OWNER_USERNAME = "superadmin";
const DEFAULT_OWNER_PASSWORD = "superadmin";
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

  if (
    username !== (process.env.OWNER_ADMIN_USERNAME || DEFAULT_OWNER_USERNAME) ||
    password !== (process.env.OWNER_ADMIN_PASSWORD || DEFAULT_OWNER_PASSWORD)
  ) {
    return NextResponse.json(
      { error: "username หรือ password ไม่ถูกต้อง" },
      { status: 401 },
    );
  }

  const ttlSeconds = remember
    ? REMEMBERED_SESSION_TTL_SECONDS
    : SESSION_TTL_SECONDS;
  const token = await createOwnerSessionToken({
    secret: getOwnerAuthSecret(),
    ttlSeconds,
    username,
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
