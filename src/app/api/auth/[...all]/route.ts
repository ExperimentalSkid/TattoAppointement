import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";
import { writeDiagnostic } from "@/lib/diagnostics";

const handlers = toNextJsHandler(auth);

async function handle(request: Request, method: "GET" | "POST") {
  const path = new URL(request.url).pathname;
  const signingIn = /\/api\/auth\/(?:sign-in\/(?:email|social)|callback\/google|sign-up\/email)$/.test(path);
  try {
    const response = await handlers[method](request);
    const location = response.headers.get("location");
    const redirectedFailure = location && new URL(location, request.url).searchParams.has("error");
    if (signingIn && (response.status >= 400 || redirectedFailure)) {
      await writeDiagnostic({
        code: "auth_sign_in_failed", outcome: "failed",
        ...(response.status >= 400 ? { status: response.status } : {}),
      });
    }
    return response;
  } catch (error) {
    if (signingIn) await writeDiagnostic({ code: "auth_sign_in_failed", outcome: "failed", reason: "unknown" });
    throw error;
  }
}

export function GET(request: Request) { return handle(request, "GET"); }
export function POST(request: Request) { return handle(request, "POST"); }
