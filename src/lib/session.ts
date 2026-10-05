import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAllowedStudioEmail } from "@/lib/studio-access";
import { isTintaAdminIdentity } from "@/lib/beta-access";

/** Identity access for authentication, invitation activation and own privacy. */
export async function getIdentitySession() {
  // Server Actions can rotate cookies before their UI is rendered again.
  const sessionHeaders = new Headers(await headers());
  sessionHeaders.set("cookie", (await cookies()).toString());
  const session = await auth.api.getSession({
    headers: sessionHeaders,
  });
  if (!session) return null;
  const artist = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, emailVerified: true, activatedAt: true, lastSignInAt: true, deletionRequestedAt: true },
  });
  if (!artist || artist.deletionRequestedAt || !isAllowedStudioEmail(artist.email)) return null;
  // Activation must be read from the database on every request, including just
  // after redemption; a previously issued auth response cannot grant access.
  return { ...session, user: { ...session.user, ...artist } };
}

/** Every workspace API and action must use this active account boundary. */
export async function getSession() {
  const session = await getIdentitySession();
  return session?.user.activatedAt ? session : null;
}

export async function requireSession() {
  const session = await getIdentitySession();
  if (!session) redirect("/sign-in");
  if (!session.user.activatedAt) redirect("/join");
  return session;
}

export async function getAdminSession() {
  const session = await getSession();
  return session && isTintaAdminIdentity(session.user) ? session : null;
}

export async function requireAdminSession() {
  const session = await requireSession();
  if (!isTintaAdminIdentity(session.user)) redirect("/calendar");
  return session;
}

export async function requireArtistId() {
  const session = await requireSession();
  return session.user.id;
}
