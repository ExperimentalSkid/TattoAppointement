import { NextRequest, NextResponse } from "next/server";
import { readDesignImage } from "@/lib/design-storage";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const requestedVariant = request.nextUrl.searchParams.get("variant");
  const variant =
    requestedVariant === "original" || requestedVariant === "preview" || requestedVariant === "thumb"
      ? requestedVariant
      : "preview";

  const design = await prisma.design.findFirst({
    where: {
      id,
      artistId: session.user.id,
    },
    select: { imageUrl: true },
  });

  if (!design) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    const image = await readDesignImage(design.imageUrl, variant);
    return new NextResponse(new Uint8Array(image.bytes), {
      status: 200,
      headers: {
        "Content-Type": image.contentType,
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "image_missing" }, { status: 404 });
    }
    console.error(error);
    return NextResponse.json({ error: "image_failed" }, { status: 500 });
  }
}
