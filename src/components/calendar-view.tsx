"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useSyncExternalStore, type CSSProperties, type KeyboardEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Dictionary } from "@/i18n/dictionaries";
import type { AppointmentStatusValue } from "@/lib/appointments";

type CalendarAppointment = {
  id: string;
  startsAtIso: string;
  durationMinutes: number;
  status: AppointmentStatusValue;
  client: { name: string; phone: string };
};

type CalendarViewMode = "day" | "week" | "month";
type CalendarCopy = Dictionary["calendar"];
type StatusCopy = Dictionary["appointments"]["statuses"];
const studioTimeZone = "Europe/Madrid";
const hourHeight = 68;
const studioDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: studioTimeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const studioTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: studioTimeZone,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function subscribeToClock(onChange: () => void) {
  const timer = window.setInterval(onChange, 30_000);
  window.addEventListener("focus", onChange);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener("focus", onChange);
  };
}

function clockSnapshot() {
  return Math.floor(Date.now() / 60_000);
}

function serverClockSnapshot() {
  return null;
}

// Calendar dates use UTC noon for arithmetic; appointment instants use studio time.
function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function studioDateKey(date: Date) {
  const parts = new Map(studioDateFormatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}`;
}

function dateFromKey(value: string) {
  return new Date(`${value}T12:00:00.000Z`);
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

function weekStart(date: Date) {
  return addDays(date, -((date.getUTCDay() + 6) % 7));
}

function appointmentMinute(appointment: CalendarAppointment) {
  return studioMinute(new Date(appointment.startsAtIso));
}

function studioMinute(date: Date) {
  const [hour, minute] = studioTimeFormatter.format(date).split(":").map(Number);
  return hour * 60 + minute;
}

function overlaps(first: CalendarAppointment, second: CalendarAppointment) {
  if (first.status === "CANCELLED" || second.status === "CANCELLED") return false;
  const firstStart = new Date(first.startsAtIso).getTime();
  const secondStart = new Date(second.startsAtIso).getTime();
  return firstStart < secondStart + second.durationMinutes * 60_000 && secondStart < firstStart + first.durationMinutes * 60_000;
}

function clientInitials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

// Give overlapping sessions separate lanes, including visually short sessions.
function scheduleEvents(appointments: CalendarAppointment[]) {
  const events: { appointment: CalendarAppointment; start: number; end: number; lane: number; lanes: number }[] = [];
  let group: typeof events = [];
  let laneEnds: number[] = [];
  let groupEnd = 0;
  function finishGroup() {
    for (const event of group) event.lanes = laneEnds.length;
    events.push(...group);
    group = [];
    laneEnds = [];
  }
  for (const appointment of appointments) {
    const start = appointmentMinute(appointment);
    const end = start + Math.max(appointment.durationMinutes, 44 / hourHeight * 60);
    if (group.length && start >= groupEnd) finishGroup();
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = end;
    group.push({ appointment, start, end, lane, lanes: 1 });
    groupEnd = Math.max(...laneEnds);
  }
  finishGroup();
  return events;
}

function CalendarIcon() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="15" rx="2" /><path d="M7.5 3v5M16.5 3v5M3.5 10.5h17M8 14h2M14 14h2M8 17h2" /></svg>;
}

function CalendarAppointmentCard({
  appointment, conflicted, timeFormatter, copy, statuses, timelineStyle, compact,
}: {
  appointment: CalendarAppointment;
  conflicted: boolean;
  timeFormatter: Intl.DateTimeFormat;
  copy: CalendarCopy;
  statuses: StatusCopy;
  timelineStyle?: CSSProperties;
  compact?: boolean;
}) {
  const startsAt = new Date(appointment.startsAtIso);
  const time = timeFormatter.format(startsAt);
  const label = `${time} · ${appointment.client.name} · ${statuses[appointment.status]}${conflicted ? ` · ${copy.overlap}` : ""}`;
  const canReschedule = appointment.status === "PLANNED" || appointment.status === "CONFIRMED";
  const actionHref = canReschedule ? `/appointments/${appointment.id}?reschedule=1#appointment-reschedule-form` : `/appointments/${appointment.id}/edit`;
  const actionLabel = canReschedule ? copy.reschedule : copy.edit;

  if (timelineStyle) {
    return (
      <article className="calendar-appointment calendar-time-event" data-status={appointment.status} data-conflict={conflicted} data-compact={compact} style={timelineStyle} title={label}>
        <Link className="calendar-event-details" href={`/appointments/${appointment.id}`} aria-label={label}>
          <time dateTime={appointment.startsAtIso}>{time}</time>
          <h3>{appointment.client.name}</h3>
          <span className="calendar-event-status">{conflicted ? copy.overlap : statuses[appointment.status]}</span>
        </Link>
        <Link className="calendar-event-edit" href={actionHref} aria-label={`${actionLabel}: ${appointment.client.name}`} title={actionLabel}>
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m12.5 3.5 4 4M3.5 12.5l9-9a2.8 2.8 0 0 1 4 4l-9 9-5 1 1-5Z" /></svg>
        </Link>
      </article>
    );
  }

  return (
    <article className="calendar-appointment" data-status={appointment.status} data-conflict={conflicted}>
      <div className="calendar-session-time"><strong>{time}</strong></div>
      <div className="calendar-appointment-main">
        <div className="calendar-client-row">
          <span className="calendar-client-avatar" aria-hidden="true">{clientInitials(appointment.client.name)}</span>
          <div><h3>{appointment.client.name}</h3></div>
        </div>
        {conflicted ? <p className="calendar-conflict" title={copy.overlapHelp}>{copy.overlap}</p> : null}
      </div>
      <span className="status-pill calendar-status" data-status={appointment.status}>{statuses[appointment.status]}</span>
      <div className="calendar-card-actions">
        <Link href={`/appointments/${appointment.id}`}>{copy.open}<span aria-hidden="true"> ↗</span></Link>
        <Link href={actionHref}>{actionLabel}</Link>
      </div>
    </article>
  );
}

function CalendarDayAgenda({
  dayKey, heading, appointmentsByDay, conflictIds, fullDateFormatter, timeFormatter, copy, statuses, tabPanel,
}: {
  dayKey: string;
  heading?: boolean;
  appointmentsByDay: Map<string, CalendarAppointment[]>;
  conflictIds: Set<string>;
  fullDateFormatter: Intl.DateTimeFormat;
  timeFormatter: Intl.DateTimeFormat;
  copy: CalendarCopy;
  statuses: StatusCopy;
  tabPanel?: boolean;
}) {
  const values = appointmentsByDay.get(dayKey) ?? [];
  return (
    <section className="calendar-agenda" id={tabPanel ? "calendar-day-panel" : undefined} role={tabPanel ? "tabpanel" : undefined} aria-labelledby={tabPanel ? `calendar-tab-${dayKey}` : undefined}>
      {heading ? <h2>{fullDateFormatter.format(dateFromKey(dayKey))}</h2> : null}
      {values.length ? <div className="calendar-agenda-list">{values.map((appointment) => <CalendarAppointmentCard key={appointment.id} appointment={appointment} conflicted={conflictIds.has(appointment.id)} timeFormatter={timeFormatter} copy={copy} statuses={statuses} />)}</div> : (
        <div className="calendar-empty calendar-empty-featured">
          <span className="calendar-empty-icon"><CalendarIcon /></span>
          <strong>{copy.emptyDayTitle}</strong>
          <p>{copy.emptyDayHint}</p>
          <Link href={`/new-appointment?date=${dayKey}`} className="secondary-button button-link">{copy.newAppointment}<span aria-hidden="true"> →</span></Link>
        </div>
      )}
    </section>
  );
}

export function CalendarView({
  appointments, anchor, today, anchorProvided, mode, locale, copy, statuses,
}: {
  appointments: CalendarAppointment[];
  anchor: string;
  today: string;
  anchorProvided: boolean;
  mode: CalendarViewMode;
  locale: "en" | "es";
  copy: CalendarCopy;
  statuses: StatusCopy;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const anchorDate = useMemo(() => dateFromKey(anchor), [anchor]);
  const requestedDay = searchParams.get("anchor");
  const selectedDay = mode === "week" && anchorProvided ? requestedDay ?? anchor : anchor;
  const selectedDate = dateFromKey(selectedDay);
  const weekScrollRef = useRef<HTMLDivElement>(null);
  const clockMinute = useSyncExternalStore<number | null>(subscribeToClock, clockSnapshot, serverClockSnapshot);
  const currentTime = clockMinute === null ? null : new Date(clockMinute * 60_000);
  const localeName = locale === "es" ? "es-ES" : "en-GB";
  const text = locale === "es" ? {
    subtitle: "Tu tiempo, tus sesiones. Todo en su sitio.",
    confirmed: "Confirmadas", pickDate: "Ir a una fecha", views: "Vista del calendario", navigation: "Navegar por fechas", studioTime: "Hora de Madrid", weekEmpty: "Una semana por crear", weekEmptyHint: "Añade tu próxima sesión y dale forma a tu agenda.", legend: "Estados de las citas", denseWeek: "Agenda de citas coincidentes",
  } : {
    subtitle: "Your time, your sessions. Everything in place.",
    confirmed: "Confirmed", pickDate: "Go to a date", views: "Calendar view", navigation: "Navigate dates", studioTime: "Madrid time", weekEmpty: "A week to make your own", weekEmptyHint: "Add your next session and shape your schedule.", legend: "Appointment statuses", denseWeek: "Agenda for overlapping appointments",
  };

  useEffect(() => {
    if (!anchorProvided) router.replace(`/calendar?view=${mode}&anchor=${studioDateKey(new Date())}`, { scroll: false });
  }, [anchorProvided, mode, router]);

  const appointmentsByDay = useMemo(() => {
    const grouped = new Map<string, CalendarAppointment[]>();
    for (const appointment of appointments) {
      const key = studioDateKey(new Date(appointment.startsAtIso));
      const current = grouped.get(key) ?? [];
      current.push(appointment);
      grouped.set(key, current);
    }
    for (const values of grouped.values()) values.sort((a, b) => new Date(a.startsAtIso).getTime() - new Date(b.startsAtIso).getTime());
    return grouped;
  }, [appointments]);
  const conflictIds = useMemo(() => {
    const ids = new Set<string>();
    for (let first = 0; first < appointments.length; first += 1) {
      for (let second = first + 1; second < appointments.length; second += 1) {
        if (overlaps(appointments[first], appointments[second])) {
          ids.add(appointments[first].id);
          ids.add(appointments[second].id);
        }
      }
    }
    return ids;
  }, [appointments]);

  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart(anchorDate), index));
  const dateFormatter = new Intl.DateTimeFormat(localeName, { timeZone: studioTimeZone, day: "numeric", month: "short" });
  const fullDateFormatter = new Intl.DateTimeFormat(localeName, { timeZone: studioTimeZone, weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const timeFormatter = new Intl.DateTimeFormat(localeName, { timeZone: studioTimeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const weekdayFormatter = new Intl.DateTimeFormat(localeName, { timeZone: studioTimeZone, weekday: "short" });
  const monthFormatter = new Intl.DateTimeFormat(localeName, { timeZone: studioTimeZone, month: "long", year: "numeric" });
  const todayKey = currentTime ? studioDateKey(currentTime) : today;
  const currentMinute = currentTime ? studioMinute(currentTime) : null;
  const monthGridStart = weekStart(new Date(Date.UTC(anchorDate.getUTCFullYear(), anchorDate.getUTCMonth(), 1, 12)));
  const monthDays = Array.from({ length: 42 }, (_, index) => addDays(monthGridStart, index));
  const visibleAppointments = mode === "day" ? appointmentsByDay.get(anchor) ?? [] : mode === "month" ? appointments.filter((appointment) => studioDateKey(new Date(appointment.startsAtIso)).startsWith(anchor.slice(0, 7))) : weekDays.flatMap((day) => appointmentsByDay.get(dateKey(day)) ?? []);
  const periodLabel = mode === "day" ? fullDateFormatter.format(anchorDate) : mode === "month" ? monthFormatter.format(anchorDate) : `${dateFormatter.format(weekDays[0])} – ${dateFormatter.format(weekDays[6])}, ${weekDays[6].getUTCFullYear()}`;
  const firstHour = Math.max(0, Math.min(9, ...visibleAppointments.map((appointment) => Math.floor(appointmentMinute(appointment) / 60))));
  const lastHour = Math.min(24, Math.max(20, ...visibleAppointments.map((appointment) => Math.ceil((appointmentMinute(appointment) + appointment.durationMinutes) / 60))));
  const hours = Array.from({ length: lastHour - firstHour }, (_, index) => firstHour + index);
  const timelineHeight = hours.length * hourHeight;
  const weekEvents = new Map(weekDays.map(day => [dateKey(day), scheduleEvents(appointmentsByDay.get(dateKey(day)) ?? [])]));
  const denseDays = weekDays.filter(day => weekEvents.get(dateKey(day))?.some(event => event.lanes > 1));

  useEffect(() => {
    if (mode !== "week" || !weekScrollRef.current) return;
    const now = new Date();
    const today = studioDateKey(now);
    const start = weekStart(dateFromKey(anchor));
    const thisWeek = today >= dateKey(start) && today < dateKey(addDays(start, 7));
    const targetMinute = thisWeek ? studioMinute(now) - 60 : 9 * 60;
    weekScrollRef.current.scrollTop = Math.max(0, (targetMinute - firstHour * 60) / 60 * hourHeight);
  }, [anchor, firstHour, mode]);

  function navigate(nextMode: CalendarViewMode, nextDate: Date) {
    router.push(`/calendar?view=${nextMode}&anchor=${dateKey(nextDate)}`, { scroll: false });
  }
  function navigatePeriod(direction: -1 | 1) {
    navigate(mode, mode === "month" ? new Date(Date.UTC(anchorDate.getUTCFullYear(), anchorDate.getUTCMonth() + direction, 1, 12)) : addDays(selectedDate, direction * (mode === "week" ? 7 : 1)));
  }
  function selectWeekDay(key: string) {
    window.history.replaceState(null, "", `/calendar?view=week&anchor=${key}`);
  }
  function handleDayTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % 7;
    else if (event.key === "ArrowLeft") next = (index + 6) % 7;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = 6;
    else return;
    event.preventDefault();
    selectWeekDay(dateKey(weekDays[next]));
    (event.currentTarget.parentElement?.children[next] as HTMLButtonElement | undefined)?.focus();
  }

  return (
    <section className="calendar-page">
      <header className="calendar-workspace-header">
        <div className="calendar-workspace-title"><h1>{copy.calendarTitle}</h1><p>{text.subtitle}</p></div>
        <Link className="primary-button button-link calendar-new-button" href={`/new-appointment?date=${selectedDay}`}><span aria-hidden="true">+</span>{copy.newAppointment}</Link>
      </header>

      <div className="calendar-summary">
        <div className="calendar-summary-stat calendar-session-count"><span>{copy.sessions}</span><strong>{visibleAppointments.length.toString().padStart(2, "0")}</strong></div>
        <div className="calendar-summary-stat"><span>{text.confirmed}</span><strong>{visibleAppointments.filter((appointment) => appointment.status === "CONFIRMED").length.toString().padStart(2, "0")}</strong></div>
        <div className="calendar-timezone"><span aria-hidden="true">◷</span>{text.studioTime}</div>
      </div>

      <section className="calendar-planner">
        <div className="calendar-toolbar">
          <div className="calendar-period"><h2 className="calendar-range-label">{periodLabel}</h2><label className="calendar-date-jump" title={text.pickDate}><CalendarIcon /><input type="date" aria-label={text.pickDate} value={selectedDay} onChange={(event) => { if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) navigate(mode, dateFromKey(event.target.value)); }} /></label></div>
          <div className="calendar-toolbar-controls">
            <div className="calendar-view-switch" role="group" aria-label={text.views}>{(["day", "week", "month"] as const).map((view) => <button key={view} type="button" data-active={mode === view} aria-pressed={mode === view} onClick={() => navigate(view, selectedDate)}>{copy[view]}</button>)}</div>
            <div className="calendar-navigation" role="group" aria-label={text.navigation}>
              <button type="button" aria-label={copy.previous} onClick={() => navigatePeriod(-1)}>‹</button>
              <button type="button" onClick={() => navigate(mode, dateFromKey(todayKey))}>{copy.today}</button>
              <button type="button" aria-label={copy.next} onClick={() => navigatePeriod(1)}>›</button>
            </div>
          </div>
        </div>

        {mode === "day" ? <CalendarDayAgenda dayKey={anchor} appointmentsByDay={appointmentsByDay} conflictIds={conflictIds} fullDateFormatter={fullDateFormatter} timeFormatter={timeFormatter} copy={copy} statuses={statuses} /> : null}

        {mode === "week" ? <>
          <div className="calendar-week-grid">
            <div className="calendar-week-heading"><span className="calendar-time-heading">GMT{new Intl.DateTimeFormat("en-GB", { timeZone: studioTimeZone, timeZoneName: "shortOffset" }).formatToParts(anchorDate).find((part) => part.type === "timeZoneName")?.value.replace("GMT", "")}</span>{weekDays.map((day) => {
              const key = dateKey(day);
              const count = appointmentsByDay.get(key)?.length ?? 0;
              return <button className="calendar-day-heading" key={key} type="button" data-today={key === todayKey} data-weekend={day.getUTCDay() === 0 || day.getUTCDay() === 6} aria-label={fullDateFormatter.format(day)} onClick={() => navigate("day", day)}><span>{weekdayFormatter.format(day)}</span><strong>{day.getUTCDate()}</strong><span className="calendar-day-booking-count">{count ? `${count} ${copy.sessions}` : copy.clearDay}</span></button>;
            })}</div>
            <div className="calendar-week-scroll" ref={weekScrollRef} tabIndex={0} aria-label={periodLabel}>
              <div className="calendar-week-body" style={{ height: timelineHeight, "--calendar-hour-height": `${hourHeight}px` } as CSSProperties}>
                <div className="calendar-hour-gutter" aria-hidden="true">{hours.map((hour) => <span key={hour} style={{ top: (hour - firstHour) * hourHeight }}>{String(hour).padStart(2, "0")}:00</span>)}</div>
                {weekDays.map((day) => {
                  const key = dateKey(day);
                  return <section className="calendar-week-day" key={key} aria-label={fullDateFormatter.format(day)} data-today={key === todayKey} data-weekend={day.getUTCDay() === 0 || day.getUTCDay() === 6}>{weekEvents.get(key)?.map((event) => {
                    const height = Math.max(44, Math.min(event.end, 1440) - event.start) / 60 * hourHeight;
                    return <CalendarAppointmentCard key={event.appointment.id} appointment={event.appointment} conflicted={conflictIds.has(event.appointment.id)} timeFormatter={timeFormatter} copy={copy} statuses={statuses} compact={height < 100 || event.lanes > 1} timelineStyle={{ top: (event.start - firstHour * 60) / 60 * hourHeight + 3, height: Math.max(44, height - 6), left: `calc(${event.lane / event.lanes * 100}% + 4px)`, width: `calc(${100 / event.lanes}% - 8px)` }} />;
                  })}{key === todayKey && currentTime && currentMinute !== null && currentMinute >= firstHour * 60 && currentMinute < lastHour * 60 ? <span className="calendar-now-marker" data-date={todayKey} style={{ top: (currentMinute - firstHour * 60) / 60 * hourHeight }}><time dateTime={currentTime.toISOString()}>{timeFormatter.format(currentTime)}</time></span> : null}</section>;
                })}
                {!visibleAppointments.length ? <div className="calendar-week-empty"><CalendarIcon /><strong>{text.weekEmpty}</strong><p>{text.weekEmptyHint}</p><Link className="secondary-button button-link" href={`/new-appointment?date=${selectedDay}`}>{copy.newAppointment}<span aria-hidden="true"> →</span></Link></div> : null}
              </div>
            </div>
          </div>

          {denseDays.length ? <section className="calendar-week-dense-agenda" aria-label={text.denseWeek}><h2>{text.denseWeek}</h2>{denseDays.map(day => <CalendarDayAgenda key={dateKey(day)} dayKey={dateKey(day)} heading appointmentsByDay={appointmentsByDay} conflictIds={conflictIds} fullDateFormatter={fullDateFormatter} timeFormatter={timeFormatter} copy={copy} statuses={statuses} />)}</section> : null}

          <div className="calendar-mobile-week">
            <div className="calendar-mobile-days" role="tablist" aria-label={periodLabel}>{weekDays.map((day, index) => {
              const key = dateKey(day);
              const count = appointmentsByDay.get(key)?.length ?? 0;
              return <button key={key} id={`calendar-tab-${key}`} type="button" role="tab" aria-label={`${fullDateFormatter.format(day)}${count ? `, ${count} ${copy.sessions}` : ""}`} aria-selected={selectedDay === key} aria-controls="calendar-day-panel" tabIndex={selectedDay === key ? 0 : -1} data-active={selectedDay === key} data-today={key === todayKey} onKeyDown={(event) => handleDayTabKey(event, index)} onClick={() => selectWeekDay(key)}><span>{weekdayFormatter.format(day)}</span><strong>{day.getUTCDate()}</strong><span className="calendar-tab-dot" data-booked={count > 0} aria-hidden="true" /></button>;
            })}</div>
            <CalendarDayAgenda dayKey={selectedDay} heading tabPanel appointmentsByDay={appointmentsByDay} conflictIds={conflictIds} fullDateFormatter={fullDateFormatter} timeFormatter={timeFormatter} copy={copy} statuses={statuses} />
          </div>
        </> : null}

        {mode === "month" ? <div className="calendar-month-grid">
          {weekDays.map((day) => <span className="calendar-month-weekday" key={dateKey(day)}>{weekdayFormatter.format(day)}</span>)}
          {monthDays.map((day) => {
            const key = dateKey(day);
            const values = appointmentsByDay.get(key) ?? [];
            return <section className="calendar-month-day" key={key} data-outside-month={day.getUTCMonth() !== anchorDate.getUTCMonth()} data-today={key === todayKey}>
              <button type="button" className="calendar-month-date" aria-label={fullDateFormatter.format(day)} onClick={() => navigate("day", day)}>{day.getUTCDate()}</button>
              <button type="button" className="calendar-month-open-day" aria-label={`${fullDateFormatter.format(day)}${values.length ? `, ${values.length} ${copy.sessions}` : ""}`} onClick={() => navigate("day", day)}><span>{day.getUTCDate()}</span></button>
              <div className="calendar-month-events">{values.slice(0, 3).map((appointment) => <Link className="calendar-month-event" data-status={appointment.status} key={appointment.id} href={`/appointments/${appointment.id}`} aria-label={`${timeFormatter.format(new Date(appointment.startsAtIso))} ${appointment.client.name}, ${statuses[appointment.status]}`}><time dateTime={appointment.startsAtIso}>{timeFormatter.format(new Date(appointment.startsAtIso))}</time><span>{appointment.client.name}</span></Link>)}{values.length > 3 ? <button className="calendar-month-more" type="button" onClick={() => navigate("day", day)}>+{values.length - 3} {copy.more}</button> : null}</div>
              {values.length ? <span className="calendar-month-count">{values.length} {copy.sessions}</span> : null}
            </section>;
          })}
        </div> : null}

        <div className="calendar-legend" aria-label={text.legend}>{(["PLANNED", "CONFIRMED", "COMPLETED", "NO_SHOW"] as const).map((status) => <span key={status} data-status={status}><i aria-hidden="true" />{statuses[status]}</span>)}</div>
      </section>
    </section>
  );
}
