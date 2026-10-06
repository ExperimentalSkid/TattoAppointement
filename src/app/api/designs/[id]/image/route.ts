import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { readDesignFile } from "@/lib/design-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return new NextResponse(null, { status: 401 });
  }

  const { id } = await params;
  const design = await prisma.design.findFirst({
    where: { id, artistId: session.user.id },
    select: {
      storageKey: true,
      previewKey: true,
      mimeType: true,
    },
  });

  if (!design) {
    return new NextResponse(null, { status: 404 });
  }

  const url = new URL(request.url);
  const original = url.searchParams.get("variant") === "original";
  const key = original ? design.storageKey : (design.previewKey ?? design.storageKey);
  const contentType = original || !design.previewKey ? design.mimeType : "image/webp";

  try {
    const file = await readDesignFile(key);
    return new NextResponse(new Uint8Array(file), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(file.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
