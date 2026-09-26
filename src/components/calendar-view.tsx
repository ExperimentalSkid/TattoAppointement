"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CalendarCopy } from "@/i18n/calendar-copy";

type AppointmentStatus = "PLANNED" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";

type CalendarAppointment = {
  id: string;
  startsAt: string;
  durationMinutes: number;
  status: AppointmentStatus;
  clientName: string;
  clientPhone: string;
  finalDesign: { id: string; title: string } | null;
};

type ViewMode = "day" | "week";

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function startOfWeek(value: Date) {
  const day = value.getDay();
  const distance = day === 0 ? -6 : 1 - day;
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + distance);
}

function addDays(value: Date, days: number) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + days);
}

function dateKey(value: Date) {
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function timeParts(value: Date) {
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

export function CalendarView({
  copy,
  locale,
  initialDate,
}: {
  copy: CalendarCopy;
  locale: "en" | "es";
  initialDate: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<ViewMode>("week");
  const [anchor, setAnchor] = useState(() => startOfDay(new Date(initialDate)));
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [moving, setMoving] = useState<CalendarAppointment | null>(null);
  const [moveDate, setMoveDate] = useState("");
  const [moveTime, setMoveTime] = useState("");
  const [moveDuration, setMoveDuration] = useState(120);
  const [moveSaving, setMoveSaving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [overlapWarning, setOverlapWarning] = useState(false);

  const languageTag = locale === "es" ? "es-ES" : "en-GB";
  const dayFormatter = useMemo(
    () => new Intl.DateTimeFormat(languageTag, { weekday: "short", day: "numeric", month: "short" }),
    [languageTag],
  );
  const fullDayFormatter = useMemo(
    () => new Intl.DateTimeFormat(languageTag, { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    [languageTag],
  );
  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(languageTag, { month: "long", year: "numeric" }),
    [languageTag],
  );
  const timeFormatter = useMemo(
    () => new Intl.DateTimeFormat(languageTag, { hour: "2-digit", minute: "2-digit" }),
    [languageTag],
  );

  const range = useMemo(() => {
    const start = mode === "day" ? startOfDay(anchor) : startOfWeek(anchor);
    const end = addDays(start, mode === "day" ? 1 : 7);
    return { start, end };
  }, [anchor, mode]);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(anchor), index)),
    [anchor],
  );

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const response = await fetch(
          `/api/calendar?start=${encodeURIComponent(range.start.toISOString())}&end=${encodeURIComponent(range.end.toISOString())}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("calendar_load_failed");
        const data = (await response.json()) as { appointments: CalendarAppointment[] };
        setAppointments(data.appointments);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadError(copy.errors.load);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [copy.errors.load, range.end, range.start, refreshKey]);

  function appointmentsForDay(day: Date) {
    const key = dateKey(day);
    return appointments.filter((appointment) => dateKey(new Date(appointment.startsAt)) === key);
  }

  function moveRange(direction: -1 | 1) {
    setAnchor((current) => addDays(current, direction * (mode === "day" ? 1 : 7)));
  }

  function openReschedule(appointment: CalendarAppointment) {
    const startsAt = new Date(appointment.startsAt);
    setMoving(appointment);
    setMoveDate(dateKey(startsAt));
    setMoveTime(timeParts(startsAt));
    setMoveDuration(appointment.durationMinutes);
    setMoveError(null);
    setOverlapWarning(false);
  }

  async function saveMove(allowOverlap: boolean) {
    if (!moving) return;
    const startsAt = new Date(`${moveDate}T${moveTime}`);
    if (Number.isNaN(startsAt.getTime())) {
      setMoveError(copy.errors.startInvalid);
      return;
    }

    setMoveSaving(true);
    setMoveError(null);
    try {
      const response = await fetch(`/api/appointments/${moving.id}/schedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startsAt: startsAt.toISOString(),
          durationMinutes: moveDuration,
          allowOverlap,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (response.status === 409 && data.error === "overlap") {
        setOverlapWarning(true);
        return;
      }
      if (!response.ok) {
        setMoveError(data.error === "duration_invalid" ? copy.errors.durationInvalid : copy.errors.save);
        return;
      }

      setMoving(null);
      setOverlapWarning(false);
      setRefreshKey((value) => value + 1);
    } catch {
      setMoveError(copy.errors.save);
    } finally {
      setMoveSaving(false);
    }
  }

  function renderAppointment(appointment: CalendarAppointment) {
    const start = new Date(appointment.startsAt);
    return (
      <article className="calendar-appointment" data-status={appointment.status} key={appointment.id}>
        <button
          className="calendar-appointment-open"
          type="button"
          onClick={() => router.push(`/appointments/${appointment.id}`)}
          aria-label={`${copy.open}: ${appointment.clientName}`}
        >
          <span className="calendar-appointment-time">{timeFormatter.format(start)}</span>
          <strong>{appointment.clientName}</strong>
          <span>{copy.duration.replace("{minutes}", String(appointment.durationMinutes))}</span>
          {appointment.finalDesign ? <span>{appointment.finalDesign.title}</span> : null}
          <span className="calendar-status">{copy.statuses[appointment.status]}</span>
        </button>
        <button className="calendar-move-button" type="button" onClick={() => openReschedule(appointment)}>
          {copy.move}
        </button>
      </article>
    );
  }

  const dayAppointments = appointmentsForDay(anchor);

  return (
    <div className="calendar-page">
      <div className="calendar-heading">
        <div>
          <h1 className="page-heading">{copy.title}</h1>
          <p className="page-subtitle">{copy.subtitle}</p>
        </div>
        <button className="primary-button" type="button" onClick={() => router.push("/new-appointment")}>
          {copy.newAppointment}
        </button>
      </div>

      <div className="calendar-controls">
        <div className="calendar-mode-toggle" role="group" aria-label={copy.title}>
          <button type="button" data-active={mode === "day"} onClick={() => setMode("day")}>
            {copy.day}
          </button>
          <button type="button" data-active={mode === "week"} onClick={() => setMode("week")}>
            {copy.week}
          </button>
        </div>
        <div className="calendar-navigation">
          <button type="button" onClick={() => moveRange(-1)} aria-label={copy.previous}>
            ‹
          </button>
          <button type="button" onClick={() => setAnchor(startOfDay(new Date()))}>
            {copy.today}
          </button>
          <button type="button" onClick={() => moveRange(1)} aria-label={copy.next}>
            ›
          </button>
        </div>
      </div>

      <div className="calendar-period-title">
        {mode === "day" ? fullDayFormatter.format(anchor) : monthFormatter.format(anchor)}
      </div>

      {loadError ? <p className="form-error">{loadError}</p> : null}
      {loading ? <p className="calendar-loading">{copy.loading}</p> : null}

      {!loading && !loadError && mode === "day" ? (
        <section className="calendar-day-view">
          {dayAppointments.length > 0 ? (
            <div className="calendar-day-list">{dayAppointments.map(renderAppointment)}</div>
          ) : (
            <div className="calendar-empty">{copy.emptyDay}</div>
          )}
        </section>
      ) : null}

      {!loading && !loadError && mode === "week" ? (
        <section className="calendar-week-view">
          {weekDays.map((day) => {
            const items = appointmentsForDay(day);
            const isToday = dateKey(day) === dateKey(new Date());
            return (
              <div className="calendar-week-day" data-today={isToday} key={dateKey(day)}>
                <div className="calendar-week-day-heading">
                  <strong>{dayFormatter.format(day)}</strong>
                  <span>{items.length}</span>
                </div>
                <div className="calendar-week-day-body">
                  {items.length > 0 ? items.map(renderAppointment) : <span className="calendar-no-items">—</span>}
                </div>
              </div>
            );
          })}
          {appointments.length === 0 ? <div className="calendar-week-empty">{copy.emptyWeek}</div> : null}
        </section>
      ) : null}

      {moving ? (
        <div className="calendar-dialog-backdrop" role="presentation" onMouseDown={() => setMoving(null)}>
          <div
            className="calendar-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reschedule-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="calendar-dialog-heading">
              <div>
                <h2 id="reschedule-title">{copy.rescheduleTitle}</h2>
                <p>{copy.rescheduleHint}</p>
              </div>
              <button className="dialog-close" type="button" aria-label={copy.cancel} onClick={() => setMoving(null)}>
                ×
              </button>
            </div>

            <div className="calendar-reschedule-form">
              <label className="field">
                <span>{copy.date}</span>
                <input type="date" value={moveDate} onChange={(event) => setMoveDate(event.target.value)} />
              </label>
              <label className="field">
                <span>{copy.time}</span>
                <input type="time" value={moveTime} onChange={(event) => setMoveTime(event.target.value)} />
              </label>
              <label className="field">
                <span>{copy.durationLabel}</span>
                <input
                  type="number"
                  min={15}
                  max={1440}
                  step={15}
                  inputMode="numeric"
                  value={moveDuration}
                  onChange={(event) => setMoveDuration(Number(event.target.value))}
                />
              </label>

              {overlapWarning ? (
                <div className="calendar-overlap-warning" role="alert">
                  <strong>{copy.overlapTitle}</strong>
                  <p>{copy.overlapMessage}</p>
                </div>
              ) : null}
              {moveError ? <p className="form-error">{moveError}</p> : null}

              <div className="calendar-dialog-actions">
                <button className="secondary-button" type="button" onClick={() => setMoving(null)} disabled={moveSaving}>
                  {copy.cancel}
                </button>
                <button
                  className="primary-button"
                  type="button"
                  disabled={moveSaving}
                  onClick={() => void saveMove(overlapWarning)}
                >
                  {moveSaving ? copy.saving : overlapWarning ? copy.keepOverlap : copy.save}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
