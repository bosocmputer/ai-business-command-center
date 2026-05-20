import { NextResponse } from "next/server";
import { OWNER_AUTH_COOKIE } from "@/lib/ownerAuth";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(OWNER_AUTH_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
  });
  return response;
}
