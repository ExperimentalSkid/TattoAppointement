export function FoundationPage({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <section>
      <h1 className="page-heading">{title}</h1>
      <div className="foundation-card">
        <p>{message}</p>
      </div>
    </section>
  );
}
