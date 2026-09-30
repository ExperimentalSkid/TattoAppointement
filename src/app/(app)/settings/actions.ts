"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireArtistId } from "@/lib/session";
import { validateNewPassword, validatePasswordChange, validateProfile } from "@/lib/settings-validation";

export type ProfileFormState = { error: "name" | "studio" | "save" | null; saved: boolean };
export type PasswordFormState = { error: "current" | "length" | "match" | "same" | "save" | null; saved: boolean };

export async function updateProfile(_previous: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const artistId = await requireArtistId();
  const profile = validateProfile(formData.get("name"), formData.get("studioName"));
  if (!profile.ok) return { error: profile.error, saved: false };
  try {
    await prisma.user.update({ where: { id: artistId }, data: { name: profile.name, studioName: profile.studioName } });
  } catch {
    return { error: "save", saved: false };
  }
  revalidatePath("/", "layout");
  return { error: null, saved: true };
}

export async function changePassword(_previous: PasswordFormState, formData: FormData): Promise<PasswordFormState> {
  const artistId = await requireArtistId();
  const hasPassword = Boolean(await prisma.account.findFirst({ where: { userId: artistId, providerId: "credential", password: { not: null } }, select: { id: true } }));
  const currentPassword = formData.get("currentPassword");
  const newPassword = formData.get("newPassword");
  const error = hasPassword
    ? validatePasswordChange(currentPassword, newPassword, formData.get("confirmPassword"))
    : validateNewPassword(newPassword, formData.get("confirmPassword"));
  if (error) return { error, saved: false };
  try {
    if (hasPassword) {
      await auth.api.changePassword({ headers: await headers(), body: { currentPassword: currentPassword as string, newPassword: newPassword as string, revokeOtherSessions: true } });
    } else {
      await auth.api.setPassword({ headers: await headers(), body: { newPassword: newPassword as string } });
      await auth.api.revokeOtherSessions({ headers: await headers() });
    }
  } catch (error) {
    const code = error && typeof error === "object" && "body" in error ? (error.body as { code?: string } | undefined)?.code : undefined;
    return { error: code === "INVALID_PASSWORD" ? "current" : "save", saved: false };
  }
  revalidatePath("/settings");
  return { error: null, saved: true };
}
