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

const ownerV2HomePath = "/owner-v2";
const ownerV2CanonicalEnabled = process.env.OWNER_V2_CANONICAL === "true";

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
      return NextResponse.redirect(new URL(ownerV2HomePath, request.url));
    }

    const redirectUrl = new URL("/signin", request.url);
    redirectUrl.searchParams.set("next", ownerV2HomePath);
    return NextResponse.redirect(redirectUrl);
  }

  if (pathname === "/signin" && isSignedIn) {
    const nextPath =
      request.nextUrl.searchParams.get("next") || ownerV2HomePath;
    return NextResponse.redirect(new URL(safeNextPath(nextPath), request.url));
  }

  if (!isProtectedOwnerPath(pathname)) {
    return NextResponse.next();
  }

  const canonicalOwnerPath =
    ownerV2CanonicalEnabled && pathname.startsWith("/owner")
      ? legacyOwnerV2Path(pathname, search)
      : null;

  if (isSignedIn) {
    if (canonicalOwnerPath) {
      return withOwnerNoStoreHeaders(
        NextResponse.redirect(new URL(canonicalOwnerPath, request.url)),
      );
    }
    return withOwnerNoStoreHeaders(NextResponse.next());
  }

  const redirectUrl = new URL("/signin", request.url);
  redirectUrl.searchParams.set(
    "next",
    canonicalOwnerPath ?? `${pathname}${search}`,
  );
  return withOwnerNoStoreHeaders(NextResponse.redirect(redirectUrl));
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

  if (pathname === "/owner-v2" || pathname.startsWith("/owner-v2/")) {
    return true;
  }

  if (
    (pathname === "/command-center" || pathname.startsWith("/command-center/")) &&
    pathname !== "/command-center/brief" &&
    !pathname.startsWith("/command-center/brief/") &&
    pathname !== "/command-center/group-report-mobile"
  ) {
    return true;
  }

  return false;
}

function safeNextPath(value: string) {
  if (!value.startsWith("/") || value.startsWith("//")) {
    return ownerV2HomePath;
  }

  if (value.startsWith("/signin") || value.startsWith("/auth/")) {
    return ownerV2HomePath;
  }

  const parsed = new URL(value, "http://owner.local");
  const canonicalOwnerPath = ownerV2CanonicalEnabled
    ? legacyOwnerV2Path(parsed.pathname, parsed.search)
    : null;

  return canonicalOwnerPath ?? value;
}

function legacyOwnerV2Path(pathname: string, search: string) {
  if (pathname === ownerV2HomePath || pathname.startsWith(`${ownerV2HomePath}/`)) {
    return null;
  }

  if (pathname !== "/owner" && !pathname.startsWith("/owner/")) {
    return null;
  }

  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  const tenantId = params.get("tenant");
  const tenantBasePath = tenantId
    ? `${ownerV2HomePath}/stores/${encodeURIComponent(tenantId)}`
    : `${ownerV2HomePath}/stores`;

  switch (pathname) {
    case "/owner":
      return ownerV2HomePath;
    case "/owner/tenants":
      return `${ownerV2HomePath}/stores`;
    case "/owner/audit":
      return `${ownerV2HomePath}/ops`;
    case "/owner/settings":
      return `${ownerV2HomePath}/system`;
    case "/owner/sml-connections":
      return tenantId ? `${tenantBasePath}/sml` : tenantBasePath;
    case "/owner/line":
      return tenantId ? `${tenantBasePath}/line` : tenantBasePath;
    case "/owner/reports":
      return tenantId ? `${tenantBasePath}/reports` : tenantBasePath;
    case "/owner/report-permissions":
      return tenantId ? `${tenantBasePath}/permissions` : tenantBasePath;
    case "/owner/notifications":
      return tenantId ? `${tenantBasePath}/notifications` : tenantBasePath;
    default:
      return ownerV2HomePath;
  }
}

function withOwnerNoStoreHeaders(response: NextResponse) {
  response.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}
