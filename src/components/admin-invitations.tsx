"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthFeedback } from "@/components/auth-feedback";
import { LocalDateTime } from "@/components/local-date-time";
import type { Locale } from "@/i18n";

type CreatedInvitation = { code: string; link: string; invitation: { id: string; expiresAt: string } };

export function CreateInvitationForm({ locale }: { locale: Locale }) {
  const es = locale === "es";
  const router = useRouter();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    setCopied(null);
    const expiresInDays = Number(new FormData(event.currentTarget).get("expiresInDays"));
    try {
      const response = await fetch("/api/admin/invitations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expiresInDays }) });
      if (!response.ok) throw new Error("Could not create invitation");
      const result = await response.json() as CreatedInvitation;
      setCreated(result);
      router.refresh();
    } catch {
      setError(es ? "No se pudo crear la invitación. Inténtalo de nuevo." : "Could not create the invitation. Try again.");
    } finally { inFlight.current = false; setPending(false); }
  }

  async function copy(kind: "code" | "link") {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(kind === "code" ? created.code : created.link);
      setCopied(kind);
      setError(null);
    } catch {
      setError(es ? "No se pudo copiar. Selecciona el texto y cópialo manualmente." : "Could not copy. Select the text and copy it manually.");
    }
  }

  return <div>
    <form className="admin-create-form" onSubmit={create} aria-busy={pending}>
      <div className="field"><label htmlFor="invitation-expiry">{es ? "Caduca en" : "Expires in"}</label><select id="invitation-expiry" name="expiresInDays" defaultValue="7" disabled={pending}>{[1, 3, 7, 14, 30].map(days => <option key={days} value={days}>{days} {days === 1 ? (es ? "día" : "day") : (es ? "días" : "days")}</option>)}</select></div>
      <button className="primary-button" type="submit" disabled={pending}>{pending ? (es ? "Creando…" : "Creating…") : (es ? "Crear invitación" : "Create invitation")}</button>
    </form>
    {error ? <AuthFeedback>{error}</AuthFeedback> : null}
    {created ? <section className="admin-created-invitation" aria-label={es ? "Invitación creada" : "Invitation created"}>
      <h3>{es ? "Tu invitación está lista" : "Your invitation is ready"}</h3>
      <p className="muted-copy">{es ? "Copia el código o el enlace ahora. Solo se muestran al crearlos. Cada invitación activa una cuenta." : "Copy the code or link now. They are only shown when created. Each invitation activates one account."}</p>
      <div className="field"><label htmlFor="created-invitation-code">{es ? "Código" : "Code"}</label><input id="created-invitation-code" value={created.code} readOnly autoComplete="off" spellCheck={false} /><button type="button" className="secondary-button" onClick={() => copy("code")}>{copied === "code" ? (es ? "Código copiado" : "Code copied") : (es ? "Copiar código" : "Copy code")}</button></div>
      <div className="field"><label htmlFor="created-invitation-link">{es ? "Enlace para compartir" : "Link to share"}</label><textarea id="created-invitation-link" value={created.link} readOnly rows={3} autoComplete="off" spellCheck={false} /><button type="button" className="secondary-button" onClick={() => copy("link")}>{copied === "link" ? (es ? "Enlace copiado" : "Link copied") : (es ? "Copiar enlace" : "Copy link")}</button></div>
      <p className="muted-copy">{es ? "Caduca: " : "Expires: "}<LocalDateTime iso={created.invitation.expiresAt} locale={locale} /></p>
      <p className="admin-copy-status" role="status" aria-live="polite">{copied ? (es ? "Copiado al portapapeles." : "Copied to clipboard.") : ""}</p>
      <button className="secondary-button" type="button" onClick={() => { setCreated(null); setCopied(null); }}>{es ? "Ocultar código y enlace" : "Hide code and link"}</button>
    </section> : null}
  </div>;
}

export function RevokeInvitationButton({ id, locale }: { id: string; locale: Locale }) {
  const es = locale === "es";
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const inFlight = useRef(false);
  async function revoke() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(false);
    try {
      const response = await fetch(`/api/admin/invitations/${encodeURIComponent(id)}/revoke`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error("Could not revoke invitation");
      const result = await response.json() as { status: string };
      setStatus(result.status);
      router.refresh();
    } catch { setError(true); inFlight.current = false; }
    finally { setPending(false); }
  }
  return <div className="admin-revoke-control">
    {status ? <span role="status">{status === "already_redeemed" ? (es ? "Ya utilizada" : "Already used") : (es ? "Revocada" : "Revoked")}</span> : <button className="danger-button" type="button" onClick={revoke} disabled={pending}>{pending ? (es ? "Revocando…" : "Revoking…") : (es ? "Revocar" : "Revoke")}</button>}
    {error ? <p className="form-error" role="alert">{es ? "No se pudo revocar. Inténtalo de nuevo." : "Could not revoke. Try again."}</p> : null}
  </div>;
}
