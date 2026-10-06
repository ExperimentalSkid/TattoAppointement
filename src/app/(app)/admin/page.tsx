import { getAdminSnapshot } from "@/lib/admin-data";
import { getLocale } from "@/i18n";
import { CreateInvitationForm, RevokeInvitationButton } from "@/components/admin-invitations";
import { LocalDateTime } from "@/components/local-date-time";

export default async function InvitationsPage() {
  const [snapshot, locale] = await Promise.all([getAdminSnapshot(), getLocale()]);
  const es = locale === "es";
  const now = new Date();
  return <div className="workspace-stack">
    <section className="workspace-section workspace-split" data-layout="labelled">
      <div className="section-intro"><h2>{es ? "Invitar a un artista" : "Invite an artist"}</h2><p>{es ? "Un código de un solo uso abre su estudio. Comparte la invitación con la persona que quieres incorporar." : "A single-use code opens their workspace. Share the invitation with the person you want to invite."}</p></div>
      <CreateInvitationForm locale={locale} />
    </section>
    <section className="workspace-section">
      <div className="section-intro admin-ledger-heading"><h2>{es ? "Invitaciones recientes" : "Recent invitations"}</h2><p>{es ? "Las últimas 100 invitaciones. Los códigos y enlaces no se recuperan desde este listado." : "The latest 100 invitations. Codes and links cannot be retrieved from this list."}</p></div>
      {snapshot.invitations.length ? <div className="admin-invitation-list">{snapshot.invitations.map(invitation => {
        const expired = invitation.expiresAt <= now;
        const status = invitation.redeemedAt ? (es ? "Utilizada" : "Used") : invitation.revokedAt ? (es ? "Revocada" : "Revoked") : expired ? (es ? "Caducada" : "Expired") : (es ? "Disponible" : "Available");
        return <article className="admin-invitation-row data-row" key={invitation.id}>
          <div><strong className="admin-row-title">{status}</strong><span className="admin-reference">{invitation.id}</span></div>
          <dl className="admin-row-dates"><div><dt>{es ? "Creada" : "Created"}</dt><dd><LocalDateTime iso={invitation.createdAt.toISOString()} locale={locale} /></dd></div><div><dt>{es ? "Caduca" : "Expires"}</dt><dd><LocalDateTime iso={invitation.expiresAt.toISOString()} locale={locale} /></dd></div></dl>
          <div className="admin-redemption">{invitation.redeemedAt ? <><span>{es ? "Activada por" : "Activated by"}</span><strong>{invitation.redeemedByName ?? (es ? "Cuenta eliminada" : "Deleted account")}</strong>{invitation.redeemedByEmail ? <span>{invitation.redeemedByEmail}</span> : null}<LocalDateTime iso={invitation.redeemedAt.toISOString()} locale={locale} /></> : invitation.revokedAt ? <><span>{es ? "Revocada el" : "Revoked on"}</span><LocalDateTime iso={invitation.revokedAt.toISOString()} locale={locale} /></> : null}</div>
          {!invitation.redeemedAt && !invitation.revokedAt && !expired ? <RevokeInvitationButton id={invitation.id} locale={locale} /> : null}
        </article>;
      })}</div> : <p className="muted-copy">{es ? "Todavía no has creado invitaciones." : "You have not created any invitations yet."}</p>}
    </section>
  </div>;
}
