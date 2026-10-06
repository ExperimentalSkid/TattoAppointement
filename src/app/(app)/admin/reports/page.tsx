import { getAdminReports } from "@/lib/admin-data";
import { getLocale } from "@/i18n";
import { LocalDateTime } from "@/components/local-date-time";

export default async function ReportsPage() {
  const [result, locale] = await Promise.all([getAdminReports(), getLocale()]);
  const es = locale === "es";
  return <section className="workspace-section">
    <div className="section-intro admin-ledger-heading"><h2>{es ? "Informes de problemas" : "Problem reports"}</h2><p>{es ? `Los últimos ${result.limit} informes enviados, dentro de ${result.retentionDays} días. La descripción aparece tal como la escribió el artista.` : `The latest ${result.limit} submitted reports, within ${result.retentionDays} days. Descriptions appear as the artist wrote them.`}</p></div>
    {!result.available ? <p className="muted-copy" role="status">{es ? "Los informes no están disponibles en este entorno." : "Reports are unavailable in this environment."}</p> : !result.reports.length ? <p className="muted-copy">{es ? "No hay informes recientes." : "There are no recent reports."}</p> : <div className="admin-report-list">{result.reports.map(report => <article className="admin-report-row data-row" key={report.id}>
      <div className="admin-report-heading"><h3>{report.userName ?? (es ? "Sin cuenta identificada" : "No identified account")}</h3><LocalDateTime iso={report.createdAt} locale={locale} /></div>
      {report.userEmail ? <p className="muted-copy admin-report-email">{report.userEmail}</p> : null}
      <p className="admin-report-message">{report.message}</p>
      <dl className="admin-report-context">
        <div><dt>{es ? "Página" : "Page"}</dt><dd>{report.route}</dd></div>
        <div><dt>{es ? "Vista" : "View"}</dt><dd>{report.pageview}</dd></div>
        <div><dt>{es ? "Dispositivo" : "Device"}</dt><dd>{report.deviceCategory}</dd></div>
        <div><dt>{es ? "Momento del informe" : "Report submitted at"}</dt><dd><LocalDateTime iso={report.clickedAt} locale={locale} /></dd></div>
        {report.calendarAnchor ? <div><dt>{es ? "Fecha del calendario" : "Calendar date"}</dt><dd>{report.calendarAnchor}</dd></div> : null}
        <div><dt>{es ? "Versión" : "Version"}</dt><dd>{report.appVersion}</dd></div>
        <div><dt>{es ? "Referencia" : "Reference"}</dt><dd>{report.id}</dd></div>
      </dl>
    </article>)}</div>}
  </section>;
}
