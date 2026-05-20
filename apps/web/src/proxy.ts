import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  getOwnerAuthSecret,
  OWNER_AUTH_COOKIE,
  verifyOwnerSessionToken,
} from "@/lib/ownerAuth";

const retiredTemplatePaths = new Set([
  "/profile",
  "/calendar",
  "/blank",
  "/alerts",
  "/avatars",
  "/badge",
  "/buttons",
  "/images",
  "/modals",
  "/videos",
  "/basic-tables",
  "/bar-chart",
  "/line-chart",
]);

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isSignedIn = Boolean(
    await verifyOwnerSessionToken(
      request.cookies.get(OWNER_AUTH_COOKIE)?.value,
      getOwnerAuthSecret(),
    ),
  );

  if (pathname === "/signup" || retiredTemplatePaths.has(pathname)) {
    if (isSignedIn) {
      return NextResponse.redirect(new URL("/owner", request.url));
    }

    const redirectUrl = new URL("/signin", request.url);
    redirectUrl.searchParams.set("next", "/owner");
    return NextResponse.redirect(redirectUrl);
  }

  if (pathname === "/signin" && isSignedIn) {
    const nextPath = request.nextUrl.searchParams.get("next") || "/owner";
    return NextResponse.redirect(new URL(safeNextPath(nextPath), request.url));
  }

  if (!isProtectedOwnerPath(pathname)) {
    return NextResponse.next();
  }

  if (isSignedIn) {
    return NextResponse.next();
  }

  const redirectUrl = new URL("/signin", request.url);
  redirectUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(redirectUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|images/|.*\\..*).*)"],
};

function isProtectedOwnerPath(pathname: string) {
  if (pathname === "/") {
    return true;
  }

  if (pathname === "/owner" || pathname.startsWith("/owner/")) {
    return true;
  }

  if (
    (pathname === "/command-center" || pathname.startsWith("/command-center/")) &&
    !pathname.startsWith("/command-center/brief")
  ) {
    return true;
  }

  return false;
}

function safeNextPath(value: string) {
  if (!value.startsWith("/") || value.startsWith("//")) {
    return "/owner";
  }

  if (value.startsWith("/signin") || value.startsWith("/auth/")) {
    return "/owner";
  }

  return value;
}
