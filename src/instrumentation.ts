import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (error, request) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { writeDiagnostic, classifyDiagnosticError } = await import("@/lib/diagnostics");
  const { defaultDiagnosticContext, normalizeDiagnosticPage } = await import("@/lib/diagnostic-context");
  let artistId: string | null = null;
  // Session resolution must not recursively report an authentication failure.
  // Request headers are used only to verify identity; they never enter a log.
  if (!request.path.startsWith("/api/auth/")) {
    try {
      const { auth } = await import("@/lib/auth");
      const { isAllowedStudioEmail } = await import("@/lib/studio-access");
      const sessionHeaders = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (value !== undefined) sessionHeaders.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      const session = await auth.api.getSession({ headers: sessionHeaders });
      if (session && isAllowedStudioEmail(session.user.email)) artistId = session.user.id;
    } catch { /* An unavailable session keeps the error anonymous. */ }
  }
  const digest = error && typeof error === "object" && "digest" in error && typeof error.digest === "string"
    && /^\d{1,32}$/.test(error.digest) ? error.digest : undefined;
  await writeDiagnostic({
    code: "server_error", artistId, outcome: "failed", reason: "unknown",
    errorKind: classifyDiagnosticError(error),
    context: { ...defaultDiagnosticContext(), page: normalizeDiagnosticPage(request.path) },
    ...(digest ? { digest } : {}),
  });
};
