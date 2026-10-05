import Link from "next/link";
import { getAdminSnapshot } from "@/lib/admin-data";
import { getLocale } from "@/i18n";
import { LocalDateTime } from "@/components/local-date-time";

export default async function ArtistsPage({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  const params = await searchParams;
  const requestedPage = typeof params.page === "string" && /^[1-9][0-9]{0,6}$/.test(params.page) ? Number(params.page) : 1;
  const [snapshot, locale] = await Promise.all([getAdminSnapshot(requestedPage), getLocale()]);
  const es = locale === "es";
  return <div className="workspace-stack">
    <dl className="admin-summary">
      <div><dt>{es ? "Cuentas de artistas" : "Artist accounts"}</dt><dd>{snapshot.summary.artists}</dd></div>
      <div><dt>{es ? "Activadas" : "Activated"}</dt><dd>{snapshot.summary.activated}</dd></div>
      <div><dt>{es ? "Pendientes" : "Pending"}</dt><dd>{snapshot.summary.pending}</dd></div>
      <div><dt>{es ? "Acceso en los últimos 7 días" : "Signed in within 7 days"}</dt><dd>{snapshot.summary.signInsLast7Days}</dd></div>
    </dl>
    <section className="workspace-section">
      <div className="section-intro admin-ledger-heading"><h2>{es ? "Cuentas y registros" : "Accounts and records"}</h2><p>{es ? "Totales de registros y fechas de acceso. La actividad opcional no está disponible." : "Record totals and sign-in dates. Optional activity is unavailable."}</p></div>
      <div className="admin-artist-list">{snapshot.users.map(artist => <article className="admin-artist-row data-row" key={artist.id}>
        <div className="admin-artist-identity"><h3>{artist.name}</h3><p>{artist.email}</p><span className="admin-identity-state">{artist.deletionRequestedAt ? (es ? "Eliminación solicitada" : "Deletion requested") : artist.activatedAt ? (es ? "Activada" : "Activated") : (es ? "Pendiente de invitación" : "Awaiting invitation")}{" · "}{artist.emailVerified ? (es ? "Correo verificado" : "Email verified") : (es ? "Correo sin verificar" : "Email unverified")}</span><span className="admin-reference">{artist.id}</span></div>
        <dl className="admin-artist-dates">
          <div><dt>{es ? "Cuenta creada" : "Account created"}</dt><dd><LocalDateTime iso={artist.createdAt.toISOString()} locale={locale} /></dd></div>
          <div><dt>{es ? "Activación" : "Activation"}</dt><dd>{artist.activatedAt ? <LocalDateTime iso={artist.activatedAt.toISOString()} locale={locale} /> : "—"}</dd></div>
          <div><dt>{es ? "Último acceso" : "Last sign-in"}</dt><dd>{artist.lastSignInAt ? <LocalDateTime iso={artist.lastSignInAt.toISOString()} locale={locale} /> : "—"}</dd></div>
          <div><dt>{es ? "Último cambio en registros" : "Last record change"}</dt><dd>{artist.lastRecordChangeAt ? <LocalDateTime iso={artist.lastRecordChangeAt.toISOString()} locale={locale} /> : "—"}</dd></div>
        </dl>
        <dl className="admin-record-totals"><div><dt>{es ? "Clientes" : "Clients"}</dt><dd>{artist.totals.clients}</dd></div><div><dt>{es ? "Citas" : "Appointments"}</dt><dd>{artist.totals.appointments}</dd></div><div><dt>{es ? "Diseños" : "Designs"}</dt><dd>{artist.totals.designs}</dd></div><div><dt>{es ? "Pagos" : "Payments"}</dt><dd>{artist.totals.payments}</dd></div></dl>
      </article>)}</div>
      {snapshot.pagination.totalPages > 1 ? <nav className="admin-pagination" aria-label={es ? "Páginas de artistas" : "Artist pages"}>
        {snapshot.pagination.page > 1 ? <Link className="text-link" href={`/admin/artists?page=${snapshot.pagination.page - 1}`}>{es ? "Anterior" : "Previous"}</Link> : <span />}
        <span>{es ? "Página" : "Page"} {snapshot.pagination.page} / {snapshot.pagination.totalPages}</span>
        {snapshot.pagination.page < snapshot.pagination.totalPages ? <Link className="text-link" href={`/admin/artists?page=${snapshot.pagination.page + 1}`}>{es ? "Siguiente" : "Next"}</Link> : <span />}
      </nav> : null}
    </section>
  </div>;
}
