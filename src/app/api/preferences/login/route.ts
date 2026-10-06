import { NextResponse } from "next/server";
import { LOGIN_PREFERENCE_COOKIE, MAX_LOGIN_PREFERENCE_BYTES, REMEMBER_LOGIN_SECONDS, parseLoginPreference } from "@/lib/login-preference";

const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  try {
    const expected = new URL(process.env.BETTER_AUTH_URL ?? request.url).origin;
    if (request.headers.get("origin") !== expected || request.headers.get("sec-fetch-site") === "cross-site") {
      return NextResponse.json({ error: "forbidden" }, { status: 403, headers });
    }
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers });
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "") || !request.body) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400, headers });
  }
  if (Number(request.headers.get("content-length")) > MAX_LOGIN_PREFERENCE_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 413, headers });
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let preference: ReturnType<typeof parseLoginPreference> = null;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_LOGIN_PREFERENCE_BYTES) {
        await reader.cancel();
        return NextResponse.json({ error: "too_large" }, { status: 413, headers });
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    preference = parseLoginPreference(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400, headers });
  } finally {
    reader.releaseLock();
  }
  if (!preference) return NextResponse.json({ error: "invalid_body" }, { status: 400, headers });

  const response = NextResponse.json({ ok: true, remember: preference.remember }, { headers });
  response.cookies.set(LOGIN_PREFERENCE_COOKIE, preference.remember ? "1" : "", {
    path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    maxAge: preference.remember ? REMEMBER_LOGIN_SECONDS : 0,
  });
  return response;
}
