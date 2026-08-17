import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/session";

const PUBLIC_PATHS = [
  "/login",
  "/api/login",
  "/api/bilag/inbound",
  "/api/bilag/ingest",
  "/api/cron/sync-bilag",
  // Called by the server itself (see src/lib/sync-job.ts) to chain the next
  // burst of a long-running Gmail sync — never by a browser, so it checks
  // its own bearer secret rather than carrying a session cookie.
  "/api/bilag/sync-job/continue",
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.includes(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const authenticated = await verifySessionToken(token);

  if (authenticated) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Ikke logget ind." }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
