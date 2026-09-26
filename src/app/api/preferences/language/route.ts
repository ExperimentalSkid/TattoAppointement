import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isLocale } from "@/i18n";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { language?: string }
    | null;

  if (!isLocale(body?.language)) {
    return NextResponse.json({ error: "Invalid language" }, { status: 400 });
  }

  const session = await auth.api.getSession({ headers: request.headers });

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
