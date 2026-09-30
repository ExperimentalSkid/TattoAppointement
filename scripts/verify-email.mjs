import assert from "node:assert/strict";
import { isPasswordRecoveryConfigured, sendPasswordResetEmail } from "../src/lib/email.ts";

const original = Object.fromEntries(["RESEND_API_KEY", "EMAIL_FROM", "BETTER_AUTH_URL"].map((key) => [key, process.env[key]]));
let captured;
const fakeFetch = async (url, options) => {
  captured = { url, ...options, body: JSON.parse(options.body) };
  return Response.json({ id: "mock-email-id" });
};
try {
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  assert.equal(isPasswordRecoveryConfigured(), false);
  await assert.rejects(sendPasswordResetEmail({ email: "artist@example.com", url: "https://studio.example/reset" }, fakeFetch), /not configured/);
  assert.equal(captured, undefined, "unconfigured recovery must not send or pretend to send mail");

  process.env.RESEND_API_KEY = "mock-api-key";
  process.env.EMAIL_FROM = "Tinta <accounts@studio.example>";
  process.env.BETTER_AUTH_URL = "https://studio.example";
  assert.equal(isPasswordRecoveryConfigured(), true);
  const url = "https://studio.example/api/auth/reset-password/mock-token?callbackURL=https%3A%2F%2Fstudio.example%2Freset-password";
  await sendPasswordResetEmail({ email: "artist@example.com", name: "A <b>name</b>", url, locale: "en" }, fakeFetch);
  assert.equal(captured.url, "https://api.resend.com/emails");
  assert.equal(captured.method, "POST");
  assert.equal(captured.headers.Authorization, "Bearer mock-api-key");
  assert.deepEqual(captured.body.to, ["artist@example.com"]);
  assert.equal(captured.body.from, "Tinta <accounts@studio.example>");
  assert.match(captured.body.text, /expires in one hour/);
  assert.ok(captured.body.text.includes(url));
  assert.ok(captured.body.html.includes("A &lt;b&gt;name&lt;/b&gt;"));
  assert.ok(!captured.body.html.includes("A <b>name</b>"));
  assert.ok(!captured.headers["Idempotency-Key"].includes("mock-token"));
  await sendPasswordResetEmail({ email: "artist@example.com", url, locale: "es" }, fakeFetch);
  assert.match(captured.body.subject, /Restablece/);
  await assert.rejects(sendPasswordResetEmail({ email: "artist@example.com", url: "https://wrong.example/reset" }, fakeFetch), /origin/);
  await assert.rejects(sendPasswordResetEmail({ email: "artist@example.com", url }, async () => new Response(null, { status: 500 })), /delivery failed/);
} finally {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
console.log("Password recovery email checks passed (mock transport; no messages sent)");
