"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
type CalendarCopy = Dictionary["calendar"];
type StatusCopy = Dictionary["appointments"]["statuses"];

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

function clientInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function CalendarAppointmentCard({
  appointment,
  conflicted,
  timeFormatter,
  copy,
  statuses,
}: {
  appointment: CalendarAppointment;
  conflicted: boolean;
  timeFormatter: Intl.DateTimeFormat;
  copy: CalendarCopy;
  statuses: StatusCopy;
}) {
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
        <div className="calendar-client-row">
          <span className="calendar-client-avatar" aria-hidden="true">
            {clientInitials(appointment.client.name)}
          </span>
          <h3>{appointment.client.name}</h3>
        </div>
        <span className="status-pill calendar-status" data-status={appointment.status}>
          {statuses[appointment.status]}
        </span>
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

function CalendarDayAgenda({
  dayKey,
  heading,
  appointmentsByDay,
  conflictIds,
  fullDateFormatter,
  timeFormatter,
  copy,
  statuses,
}: {
  dayKey: string;
  heading?: boolean;
  appointmentsByDay: Map<string, CalendarAppointment[]>;
  conflictIds: Set<string>;
  fullDateFormatter: Intl.DateTimeFormat;
  timeFormatter: Intl.DateTimeFormat;
  copy: CalendarCopy;
  statuses: StatusCopy;
}) {
  const values = appointmentsByDay.get(dayKey) ?? [];
  return (
    <section className="calendar-agenda">
      {heading ? <h2>{fullDateFormatter.format(dateFromKey(dayKey))}</h2> : null}
      {values.length ? (
        <div className="calendar-agenda-list">
          {values.map((appointment) => (
            <CalendarAppointmentCard
              key={appointment.id}
              appointment={appointment}
              conflicted={conflictIds.has(appointment.id)}
              timeFormatter={timeFormatter}
              copy={copy}
              statuses={statuses}
            />
          ))}
        </div>
      ) : (
        <div className="calendar-empty calendar-empty-featured">
          <span className="calendar-empty-icon" aria-hidden="true">+</span>
          <strong>{copy.emptyDayTitle}</strong>
          <p>{copy.emptyDayHint}</p>
          <Link href="/new-appointment" className="secondary-button button-link">
            {copy.newAppointment}
          </Link>
        </div>
      )}
    </section>
  );
}

export function CalendarView({
  appointments,
  anchor,
  anchorProvided,
  mode,
  locale,
  copy,
  statuses,
}: {
  appointments: CalendarAppointment[];
  anchor: string;
  anchorProvided: boolean;
  mode: CalendarViewMode;
  locale: "en" | "es";
  copy: CalendarCopy;
  statuses: StatusCopy;
}) {
  const router = useRouter();
  const anchorDate = useMemo(() => dateFromKey(anchor), [anchor]);
  const [mobileSelectedDay, setMobileSelectedDay] = useState(anchor);
  const localeName = locale === "es" ? "es-ES" : "en-GB";

  useEffect(() => {
    if (anchorProvided) return;
    router.replace(`/calendar?view=${mode}&anchor=${dateKey(new Date())}`);
  }, [anchorProvided, mode, router]);

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
    for (let firstIndex = 0; firstIndex < appointments.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < appointments.length; secondIndex += 1) {
        if (overlaps(appointments[firstIndex], appointments[secondIndex])) {
          ids.add(appointments[firstIndex].id);
          ids.add(appointments[secondIndex].id);
        }
      }
    }
    return ids;
  }, [appointments]);

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
  const weekdayFormatter = new Intl.DateTimeFormat(localeName, { weekday: "short" });

  function navigate(nextMode: CalendarViewMode, nextDate: Date) {
    router.push(`/calendar?view=${nextMode}&anchor=${dateKey(nextDate)}`);
  }

  const periodLabel =
    mode === "day"
      ? fullDateFormatter.format(anchorDate)
      : `${dateFormatter.format(weekDays[0])} – ${dateFormatter.format(weekDays[6])}`;
  const visibleAppointments =
    mode === "day"
      ? appointmentsByDay.get(anchor) ?? []
      : weekDays.flatMap((day) => appointmentsByDay.get(dateKey(day)) ?? []);
  const todayKey = dateKey(new Date());

  return (
    <section className="calendar-page">
      <div className="calendar-title-row">
        <div className="calendar-title-copy">
          <p className="calendar-eyebrow">{copy.scheduleLabel}</p>
          <h1 className="page-heading">{periodLabel}</h1>
          <p className="calendar-subtitle">{copy.scheduleDescription}</p>
        </div>
        <div className="calendar-title-actions">
          <div className="calendar-session-count">
            <span className="calendar-session-dot" aria-hidden="true" />
            <strong>{visibleAppointments.length}</strong>
            <span>{copy.sessions}</span>
          </div>
          <Link className="primary-button button-link calendar-new-button" href="/new-appointment">
            <span aria-hidden="true">+</span>
            {copy.newAppointment}
          </Link>
        </div>
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

      {mode === "day" ? (
        <CalendarDayAgenda
          dayKey={anchor}
          appointmentsByDay={appointmentsByDay}
          conflictIds={conflictIds}
          fullDateFormatter={fullDateFormatter}
          timeFormatter={timeFormatter}
          copy={copy}
          statuses={statuses}
        />
      ) : null}

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
                    data-today={key === todayKey}
                    aria-label={fullDateFormatter.format(day)}
                    onClick={() => navigate("day", day)}
                  >
                    <span className="calendar-day-heading-top">
                      <span>{weekdayFormatter.format(day)}</span>
                      <strong>{day.getDate()}</strong>
                    </span>
                    <span className="calendar-day-booking-count">
                      {values.length ? `${values.length} ${copy.sessions}` : copy.clearDay}
                    </span>
                    {key === todayKey ? <span className="calendar-today-label">{copy.today}</span> : null}
                  </button>
                  <div className="calendar-week-list">
                    {values.length ? (
                      values.map((appointment) => (
                        <CalendarAppointmentCard
                          key={appointment.id}
                          appointment={appointment}
                          conflicted={conflictIds.has(appointment.id)}
                          timeFormatter={timeFormatter}
                          copy={copy}
                          statuses={statuses}
                        />
                      ))
                    ) : (
                      <div className="calendar-empty compact">
                        <span aria-hidden="true">·</span>
                        <span>{copy.clearDay}</span>
                      </div>
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
                    <span>{weekdayFormatter.format(day)}</span>
                    <strong>{day.getDate()}</strong>
                    {appointmentsByDay.get(key)?.length ? (
                      <span className="calendar-tab-count">{appointmentsByDay.get(key)?.length}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <CalendarDayAgenda
              dayKey={activeMobileDay}
              heading
              appointmentsByDay={appointmentsByDay}
              conflictIds={conflictIds}
              fullDateFormatter={fullDateFormatter}
              timeFormatter={timeFormatter}
              copy={copy}
              statuses={statuses}
            />
          </div>
        </>
      ) : null}
    </section>
  );
}
