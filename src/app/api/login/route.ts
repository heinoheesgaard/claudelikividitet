import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/session";

const loginSchema = z.object({ password: z.string().min(1) });

const WINDOW_MINUTES = 15;
const MAX_FAILED_ATTEMPTS = 8;

function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(request: NextRequest) {
  const appPassword = process.env.APP_PASSWORD;
  if (!appPassword) {
    return NextResponse.json(
      { error: "Adgangskode er ikke konfigureret på serveren." },
      { status: 500 },
    );
  }

  const ipAddress = getClientIp(request);
  const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000);

  prisma.loginAttempt
    .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } })
    .catch(() => {});

  const recentFailedAttempts = await prisma.loginAttempt.count({
    where: { ipAddress, success: false, createdAt: { gte: windowStart } },
  });

  if (recentFailedAttempts >= MAX_FAILED_ATTEMPTS) {
    return NextResponse.json(
      { error: "For mange forsøg. Prøv igen om lidt." },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Udfyld en adgangskode." }, { status: 400 });
  }

  if (parsed.data.password !== appPassword) {
    await prisma.loginAttempt.create({ data: { ipAddress, success: false } });
    return NextResponse.json({ error: "Forkert adgangskode." }, { status: 401 });
  }

  await prisma.loginAttempt.create({ data: { ipAddress, success: true } });

  const token = await createSessionToken();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
