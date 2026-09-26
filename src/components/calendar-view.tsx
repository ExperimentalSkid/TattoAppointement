"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/i18n/dictionaries";
import type { AppointmentStatusValue } from "@/lib/appointments";

type CalendarAppointment = {
  id: string;
  startsAtIso: string;
  durationMinutes: number;
  status: AppointmentStatusValue;
  client: {
    name: string;
    phone: string;
  };
};

type CalendarViewMode = "day" | "week";

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function weekStart(date: Date) {
  const result = new Date(date);
  const day = result.getDay();
  const distance = day === 0 ? -6 : 1 - day;
  result.setDate(result.getDate() + distance);
  return result;
}

function overlaps(first: CalendarAppointment, second: CalendarAppointment) {
  if (first.status === "CANCELLED" || second.status === "CANCELLED") return false;
  const firstStart = new Date(first.startsAtIso).getTime();
  const secondStart = new Date(second.startsAtIso).getTime();
  const firstEnd = firstStart + first.durationMinutes * 60_000;
  const secondEnd = secondStart + second.durationMinutes * 60_000;
  return firstStart < secondEnd && secondStart < firstEnd;
}

export function CalendarView({
  appointments,
  anchor,
  mode,
  locale,
  copy,
  statuses,
}: {
  appointments: CalendarAppointment[];
  anchor: string;
  mode: CalendarViewMode;
  locale: "en" | "es";
  copy: Dictionary["calendar"];
  statuses: Dictionary["appointments"]["statuses"];
}) {
  const router = useRouter();
  const anchorDate = useMemo(() => dateFromKey(anchor), [anchor]);
  const [mobileSelectedDay, setMobileSelectedDay] = useState(anchor);
  const localeName = locale === "es" ? "es-ES" : "en-GB";

  const appointmentsByDay = useMemo(() => {
    const grouped = new Map<string, CalendarAppointment[]>();
    for (const appointment of appointments) {
      const key = dateKey(new Date(appointment.startsAtIso));
      const current = grouped.get(key) ?? [];
      current.push(appointment);
      grouped.set(key, current);
    }
    for (const values of grouped.values()) {
      values.sort(
        (a, b) => new Date(a.startsAtIso).getTime() - new Date(b.startsAtIso).getTime(),
      );
    }
    return grouped;
  }, [appointments]);

  const conflictIds = useMemo(() => {
    const ids = new Set<string>();
    for (const values of appointmentsByDay.values()) {
      for (let firstIndex = 0; firstIndex < values.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < values.length; secondIndex += 1) {
          if (overlaps(values[firstIndex], values[secondIndex])) {
            ids.add(values[firstIndex].id);
            ids.add(values[secondIndex].id);
          }
        }
      }
    }
    return ids;
  }, [appointmentsByDay]);

  const start = weekStart(anchorDate);
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  const activeMobileDay = mode === "week" ? mobileSelectedDay : anchor;

  const dateFormatter = new Intl.DateTimeFormat(localeName, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const fullDateFormatter = new Intl.DateTimeFormat(localeName, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const timeFormatter = new Intl.DateTimeFormat(localeName, {
    hour: "2-digit",
    minute: "2-digit",
  });

  function navigate(nextMode: CalendarViewMode, nextDate: Date) {
    router.push(`/calendar?view=${nextMode}&anchor=${dateKey(nextDate)}`);
  }

  function AppointmentCard({ appointment }: { appointment: CalendarAppointment }) {
    const conflicted = conflictIds.has(appointment.id);
    return (
      <article
        className="calendar-appointment"
        data-status={appointment.status}
        data-conflict={conflicted}
      >
        <div className="calendar-appointment-main">
          <div className="calendar-time-row">
            <strong>{timeFormatter.format(new Date(appointment.startsAtIso))}</strong>
            <span>{appointment.durationMinutes} {copy.minutes}</span>
          </div>
          <h3>{appointment.client.name}</h3>
          <p>{statuses[appointment.status]}</p>
          {conflicted ? (
            <p className="calendar-conflict" title={copy.overlapHelp}>
              {copy.overlap}
            </p>
          ) : null}
        </div>
        <div className="calendar-card-actions">
          <Link href={`/appointments/${appointment.id}`}>{copy.open}</Link>
          <Link href={`/appointments/${appointment.id}/edit`}>{copy.reschedule}</Link>
        </div>
      </article>
    );
  }

  function DayAgenda({ dayKey, heading }: { dayKey: string; heading?: boolean }) {
    const values = appointmentsByDay.get(dayKey) ?? [];
    return (
      <section className="calendar-agenda">
        {heading ? <h2>{fullDateFormatter.format(dateFromKey(dayKey))}</h2> : null}
        {values.length ? (
          <div className="calendar-agenda-list">
            {values.map((appointment) => (
              <AppointmentCard key={appointment.id} appointment={appointment} />
            ))}
          </div>
        ) : (
          <div className="calendar-empty">{copy.noAppointments}</div>
        )}
      </section>
    );
  }

  const periodLabel =
    mode === "day"
      ? fullDateFormatter.format(anchorDate)
      : `${dateFormatter.format(weekDays[0])} – ${dateFormatter.format(weekDays[6])}`;

  return (
    <section className="calendar-page">
      <div className="calendar-title-row">
        <div>
          <h1 className="page-heading">{periodLabel}</h1>
        </div>
        <Link className="primary-button button-link" href="/new-appointment">
          {copy.newAppointment}
        </Link>
      </div>

      <div className="calendar-toolbar">
        <div className="calendar-view-switch" role="group">
          <button
            type="button"
            data-active={mode === "day"}
            onClick={() => navigate("day", anchorDate)}
          >
            {copy.day}
          </button>
          <button
            type="button"
            data-active={mode === "week"}
            onClick={() => navigate("week", anchorDate)}
          >
            {copy.week}
          </button>
        </div>

        <div className="calendar-navigation" role="group">
          <button
            type="button"
            aria-label={copy.previous}
            onClick={() => navigate(mode, addDays(anchorDate, mode === "week" ? -7 : -1))}
          >
            ←
          </button>
          <button type="button" onClick={() => navigate(mode, new Date())}>
            {copy.today}
          </button>
          <button
            type="button"
            aria-label={copy.next}
            onClick={() => navigate(mode, addDays(anchorDate, mode === "week" ? 7 : 1))}
          >
            →
          </button>
        </div>
      </div>

      {mode === "day" ? <DayAgenda dayKey={anchor} /> : null}

      {mode === "week" ? (
        <>
          <div className="calendar-week-grid">
            {weekDays.map((day) => {
              const key = dateKey(day);
              const values = appointmentsByDay.get(key) ?? [];
              return (
                <section className="calendar-week-day" key={key}>
                  <button
                    type="button"
                    className="calendar-day-heading"
                    onClick={() => navigate("day", day)}
                  >
                    {dateFormatter.format(day)}
                  </button>
                  <div className="calendar-week-list">
                    {values.length ? (
                      values.map((appointment) => (
                        <AppointmentCard key={appointment.id} appointment={appointment} />
                      ))
                    ) : (
                      <div className="calendar-empty compact">—</div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>

          <div className="calendar-mobile-week">
            <div className="calendar-mobile-days" role="tablist">
              {weekDays.map((day) => {
                const key = dateKey(day);
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={mobileSelectedDay === key}
                    data-active={mobileSelectedDay === key}
                    onClick={() => setMobileSelectedDay(key)}
                  >
                    <span>{new Intl.DateTimeFormat(localeName, { weekday: "short" }).format(day)}</span>
                    <strong>{day.getDate()}</strong>
                  </button>
                );
              })}
            </div>
            <DayAgenda dayKey={activeMobileDay} heading />
          </div>
        </>
      ) : null}
    </section>
  );
}
