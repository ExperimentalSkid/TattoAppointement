import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { isLocale } from "@/i18n";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const expectedOrigin = new URL(process.env.BETTER_AUTH_URL ?? request.url).origin;
  const origin = request.headers.get("origin");
  if ((origin && origin !== expectedOrigin) || request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as
    | { language?: string }
    | null;

  if (!isLocale(body?.language)) {
    return NextResponse.json({ error: "Invalid language" }, { status: 400 });
  }

  const session = await getSession();

  if (session) {
    await prisma.user.update({
      where: { id: session.user.id },
      data: { language: body.language },
    });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("tattoo-language", body.language, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return response;
}
