import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Check the connection and migrated application schema without returning data.
    await Promise.all([
      prisma.$queryRaw`SELECT "activatedAt", "lastSignInAt" FROM "user" LIMIT 1`,
      prisma.$queryRaw`SELECT 1 FROM "beta_invitation" LIMIT 1`,
      prisma.$queryRaw`SELECT 1 FROM "invitation_attempt_window" LIMIT 1`,
    ]);
    return NextResponse.json({ status: "ready" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "unavailable" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
