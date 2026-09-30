import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAllowedStudioEmail, STUDIO_OWNER_SLOT } from "@/lib/studio-access";

export async function getSession() {
  // Server Actions can rotate cookies before their UI is rendered again.
  const sessionHeaders = new Headers(await headers());
  sessionHeaders.set("cookie", (await cookies()).toString());
  const session = await auth.api.getSession({
    headers: sessionHeaders,
  });
  if (!session) return null;
  const owner = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, ownerSlot: true },
  });
  return owner?.ownerSlot === STUDIO_OWNER_SLOT && isAllowedStudioEmail(owner.email) ? session : null;
}

export async function requireSession() {
  const session = await getSession();

  if (!session) {
    redirect("/sign-in");
  }

  return session;
}

export async function requireArtistId() {
  const session = await requireSession();
  return session.user.id;
}
