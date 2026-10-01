import { AppointmentForm } from "@/components/appointment-form";
import { prisma } from "@/lib/prisma";
import { requireArtistId } from "@/lib/session";
import { getDictionary } from "@/i18n";
import { createAppointment } from "@/app/(app)/appointments/actions";

function validCalendarDate(value: string | string[] | undefined): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return undefined;
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1] ? value : undefined;
}

export default async function NewAppointmentPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const artistId = await requireArtistId();
  const { locale, dictionary } = await getDictionary();
  const initialDate = validCalendarDate((await searchParams).date);

  const [clients, designs] = await Promise.all([
    prisma.client.findMany({
      where: { artistId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, phone: true },
    }),
    prisma.design.findMany({
      where: { artistId },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true },
    }),
  ]);

  return (
    <section className="appointment-page">
      <div className="page-title-row">
        <div>
          <h1 className="page-heading">{dictionary.pages.newAppointmentTitle}</h1>
          <p className="muted-copy">{dictionary.appointments.createIntro}</p>
        </div>
      </div>

      <AppointmentForm
        key={initialDate ?? "new"}
        action={createAppointment}
        clients={clients}
        designs={designs}
        copy={dictionary.appointments}
        initialDate={initialDate}
        artistId={artistId}
        bookingPath="/new-appointment"
        locale={locale}
      />
    </section>
  );
}
