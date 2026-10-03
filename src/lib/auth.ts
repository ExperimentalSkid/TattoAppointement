import { prismaAdapter } from "@better-auth/prisma-adapter";
import { betterAuth } from "better-auth/minimal";
import { nextCookies } from "better-auth/next-js";
import { APIError } from "better-auth/api";
import { google, verifyGoogleIdToken } from "better-auth/social-providers";
import { prisma } from "@/lib/prisma";
import { isPasswordRecoveryConfigured, sendPasswordResetEmail } from "@/lib/email";
import { isAllowedGoogleIdentity, isAllowedStudioEmail, isGoogleSignInConfigured, STUDIO_OWNER_SLOT } from "@/lib/studio-access";

const googleOptions = {
  clientId: process.env.GOOGLE_CLIENT_ID?.trim() ?? "",
  clientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "",
};
const verifiedGoogleProvider = isGoogleSignInConfigured() ? google(googleOptions) : null;

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
    transaction: true,
  }),
  socialProviders: verifiedGoogleProvider ? {
    google: {
      ...googleOptions,
      disableSignUp: process.env.DISABLE_SIGN_UP === "true",
      getUserInfo: async (token) => {
        if (!token.idToken) return null;
        const claims = await verifyGoogleIdToken({ token: token.idToken, audience: googleOptions.clientId });
        if (!claims || typeof claims.sub !== "string") return null;
        const info = await verifiedGoogleProvider.getUserInfo(token);
        if (!info) return null;
        const user = { ...info.user, id: claims.sub };
        if (!isAllowedGoogleIdentity(user)) return null;
        const owner = await prisma.user.findUnique({
          where: { ownerSlot: STUDIO_OWNER_SLOT },
          select: { email: true },
        });
        return isAllowedGoogleIdentity(user, owner?.email) ? { ...info, user } : null;
      },
    },
  } : {},
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google"],
      allowDifferentEmails: false,
      updateUserInfoOnLink: false,
      requireLocalEmailVerified: true,
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (!isAllowedStudioEmail(user.email)) {
            throw new APIError("FORBIDDEN", { code: "STUDIO_ACCESS_DENIED", message: "This workspace is reserved for its artist." });
          }
          if (await prisma.user.count()) {
            throw new APIError("FORBIDDEN", { code: "STUDIO_ALREADY_CONFIGURED", message: "This workspace already has an artist account." });
          }
        },
      },
    },
    session: {
      create: {
        before: async (session, context) => {
          // The internal adapter observes the current signup transaction.
          // Every stored user occupies the database's unique owner slot.
          const owner = context
            ? await context.context.internalAdapter.findUserById(session.userId)
            : await prisma.user.findUnique({ where: { id: session.userId }, select: { email: true } });
          if (!owner || !isAllowedStudioEmail(owner.email)) {
            throw new APIError("FORBIDDEN", { code: "STUDIO_ACCESS_DENIED", message: "This workspace is reserved for its artist." });
          }
        },
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    disableSignUp: process.env.DISABLE_SIGN_UP === "true",
    minPasswordLength: 8,
    maxPasswordLength: 128,
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: isPasswordRecoveryConfigured()
      ? async ({ user, url }) => {
          void sendPasswordResetEmail({
            email: user.email,
            name: user.name,
            url,
            locale: "language" in user ? String(user.language) : "es",
          }).catch(() => console.error("Password recovery email delivery failed."));
        }
      : undefined,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  user: {
    additionalFields: {
      language: {
        type: "string",
        required: false,
        defaultValue: "es",
        input: false,
      },
      studioName: {
        type: "string",
        required: false,
        input: false,
      },
    },
  },
  plugins: [nextCookies()],
});
