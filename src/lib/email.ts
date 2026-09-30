import { createHash } from "node:crypto";

export function isPasswordRecoveryConfigured() {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export async function sendPasswordResetEmail({
  email,
  name,
  url,
  locale = "es",
}: {
  email: string;
  name?: string;
  url: string;
  locale?: string;
}, fetcher: typeof fetch = fetch) {
  if (!isPasswordRecoveryConfigured()) throw new Error("Password recovery email is not configured.");
  const origin = new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000").origin;
  const resetUrl = new URL(url);
  if (resetUrl.origin !== origin || !["https:", "http:"].includes(resetUrl.protocol)) {
    throw new Error("Invalid password recovery origin.");
  }

  const es = locale !== "en";
  const subject = es ? "Restablece tu contraseña · Tinta" : "Reset your password · Tinta";
  const greeting = es ? `Hola${name ? `, ${name}` : ""}.` : `Hello${name ? `, ${name}` : ""}.`;
  const instruction = es ? "Usa este enlace para elegir una nueva contraseña. Caduca en una hora." : "Use this link to choose a new password. It expires in one hour.";
  const ignore = es ? "Si no lo has solicitado, puedes ignorar este correo. Tu contraseña no ha cambiado." : "If you did not request this, you can ignore this email. Your password has not changed.";
  const button = es ? "Elegir una nueva contraseña" : "Choose a new password";

  const response = await fetcher("https://api.resend.com/emails", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `password-reset-${createHash("sha256").update(email).update(url).digest("hex")}`,
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [email],
      subject,
      text: `${greeting}\n\n${instruction}\n\n${url}\n\n${ignore}\n\nTinta`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:40px auto;color:#262821;line-height:1.6"><h1 style="font-size:24px">Tinta</h1><p>${escapeHtml(greeting)}</p><p>${escapeHtml(instruction)}</p><p><a href="${escapeHtml(url)}" style="display:inline-block;background:#3e4e43;color:white;padding:12px 20px;border-radius:8px;text-decoration:none">${escapeHtml(button)}</a></p><p style="font-size:14px;color:#666">${escapeHtml(ignore)}</p></div>`,
    }),
  });
  if (!response.ok) throw new Error("Password recovery email delivery failed.");
}
