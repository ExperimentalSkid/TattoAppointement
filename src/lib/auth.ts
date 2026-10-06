import { prismaAdapter } from "@better-auth/prisma-adapter";
import { betterAuth } from "better-auth/minimal";
import { nextCookies } from "better-auth/next-js";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { expireCookie, setSessionCookie } from "better-auth/cookies";
import { google, verifyGoogleIdToken } from "better-auth/social-providers";
import { prisma } from "@/lib/prisma";
import { isPasswordRecoveryConfigured, sendPasswordResetEmail } from "@/lib/email";
import { isAllowedGoogleIdentity, isAllowedStudioEmail, isGoogleSignInConfigured } from "@/lib/studio-access";
import { writeDiagnostic } from "@/lib/diagnostics";
import { LOGIN_PREFERENCE_COOKIE } from "@/lib/login-preference";
import { invitationsRequired } from "@/lib/beta-access";

const googleOptions = {
  clientId: process.env.GOOGLE_CLIENT_ID?.trim() ?? "",
  clientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "",
};
const verifiedGoogleProvider = isGoogleSignInConfigured() ? google(googleOptions) : null;
// Google is used only to verify identity during sign-in, never to call APIs later.
// Explicit nulls are required because Better Auth merges before-hook data.
const discardedOAuthData = {
  accessToken: null,
  refreshToken: null,
  idToken: null,
  accessTokenExpiresAt: null,
  refreshTokenExpiresAt: null,
  scope: null,
};

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
        const user = { ...info.user, id: claims.sub, image: undefined };
        if (!isAllowedGoogleIdentity(user)) return null;
        return { ...info, user };
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
    account: {
      create: {
        before: async () => ({ data: discardedOAuthData }),
      },
      update: {
        before: async () => ({ data: discardedOAuthData }),
      },
    },
    user: {
      create: {
        before: async (user) => {
          if (!isAllowedStudioEmail(user.email)) {
            throw new APIError("FORBIDDEN", { code: "STUDIO_ACCESS_DENIED", message: "This account is not authorized for this installation." });
          }
          return { data: { image: null, activatedAt: invitationsRequired() ? null : new Date(), deactivatedAt: null, lastSignInAt: null } };
        },
      },
      update: {
        before: async () => ({ data: { image: null } }),
      },
    },
    session: {
      create: {
        before: async (session, context) => {
          // The internal adapter observes the current signup transaction.
          // The authenticated user's ID is their private artist workspace.
          const artist = context
            ? await context.context.internalAdapter.findUserById(session.userId)
            : await prisma.user.findUnique({ where: { id: session.userId }, select: { email: true } });
          // A new signup may exist only inside Better Auth's transaction.
          // Existing accounts pending erasure must not receive another session.
          const erasure = await prisma.user.findUnique({ where: { id: session.userId }, select: { deletionRequestedAt: true } });
          if (!artist || !isAllowedStudioEmail(artist.email) || erasure?.deletionRequestedAt) {
            throw new APIError("FORBIDDEN", { code: "STUDIO_ACCESS_DENIED", message: "This account is not authorized for this installation." });
          }
          if (context?.getCookie(LOGIN_PREFERENCE_COOKIE) !== "1") {
            return { data: { expiresAt: new Date(Math.min(session.expiresAt.getTime(), Date.now() + 86_400_000)) } };
          }
        },
        after: async (session) => {
          // Better Auth queues database after hooks until its signup transaction
          // commits. Session refreshes update rows and do not count as sign-ins.
          // A login is operational activity, not a profile edit. Update just
          // this column atomically so another device's login cannot invalidate
          // profile versions or overwrite a concurrent profile update.
          await prisma.$executeRaw`UPDATE "user" SET "lastSignInAt" = ${new Date()}
            WHERE "id" = ${session.userId} AND "deletionRequestedAt" IS NULL`
            .catch(() => console.error("Sign-in timestamp could not be saved."));
          await writeDiagnostic({ code: "auth_sign_in_success", artistId: session.userId, outcome: "saved" });
        },
      },
    },
  },
  hooks: {
    after: createAuthMiddleware(async (context) => {
      if (context.path === "/sign-out") {
        const result = context.context.returned;
        if (result && typeof result === "object" && "success" in result && result.success === true) {
          context.setCookie(LOGIN_PREFERENCE_COOKIE, "", { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 0 });
        }
        return;
      }
      const nextSession = context.context.newSession;
      if (!nextSession) return;
      const remember = context.getCookie(LOGIN_PREFERENCE_COOKIE) === "1";
      // Replace the provider's pending default with one final session cookie.
      // Expiring it here would leave an empty duplicate before the valid token.
      const cookieName = context.context.authCookies.sessionToken.name;
      for (const responseHeaders of new Set([context.responseHeaders, context.context.responseHeaders])) {
        if (!responseHeaders) continue;
        const otherCookies = responseHeaders.getSetCookie().filter(cookie =>
          !cookie.startsWith(`${cookieName}=`) && !cookie.startsWith(`${cookieName}.`));
        responseHeaders.delete("set-cookie");
        for (const cookie of otherCookies) responseHeaders.append("set-cookie", cookie);
      }
      if (remember) expireCookie(context, context.context.authCookies.dontRememberToken);
      await setSessionCookie(context, nextSession, !remember);
    }),
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
      activatedAt: {
        type: "date",
        required: false,
        input: false,
      },
      lastSignInAt: {
        type: "date",
        required: false,
        input: false,
        returned: false,
      },
      deactivatedAt: {
        type: "date",
        required: false,
        input: false,
        returned: false,
      },
    },
  },
  plugins: [nextCookies()],
});
