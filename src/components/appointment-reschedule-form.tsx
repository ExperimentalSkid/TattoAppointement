"use client";

import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/i18n/dictionaries";
import type { AppointmentFormState } from "@/lib/appointment-form-model";
import { LocalDateTime } from "@/components/local-date-time";
import { studioLocalInputValue, studioTimezoneOffset, studioTimeZone } from "@/lib/studio-time";
import { SyncEditConflict } from "@/components/sync-edit-conflict";

type RescheduleAction = (state: AppointmentFormState, formData: FormData) => Promise<AppointmentFormState>;

export function AppointmentRescheduleForm({ action, startsAtIso, expectedVersion, appointmentId, isActive, copy, locale, initialExpanded = false }: {
  action: RescheduleAction;
  startsAtIso: string;
  expectedVersion: string;
  appointmentId: string;
  isActive: boolean;
  copy: Dictionary["appointments"];
  locale: "en" | "es";
  initialExpanded?: boolean;
}) {
  const initialSchedule = studioLocalInputValue(startsAtIso);
  const [date, setDate] = useState(initialSchedule.slice(0, 10));
  const [time, setTime] = useState(initialSchedule.slice(11, 16));
  const [baseline, setBaseline] = useState({ version: expectedVersion, date: initialSchedule.slice(0, 10), time: initialSchedule.slice(11, 16) });
  const [expanded, setExpanded] = useState(initialExpanded);
  const [allowOverlap, setAllowOverlap] = useState(false);
  const [editedAfterError, setEditedAfterError] = useState(false);
  const [state, formAction, pending] = useActionState(async (previous: AppointmentFormState, formData: FormData): Promise<AppointmentFormState> => {
    try {
      return await action(previous, formData);
    } catch (error) {
      unstable_rethrow(error);
      return { error: "save" };
    }
  }, { error: null });
  const dirty = date !== baseline.date || time !== baseline.time;
  const inactiveConflict = !isActive && dirty;
  if (!dirty && !pending && baseline.version !== expectedVersion) {
    setDate(initialSchedule.slice(0, 10));
    setTime(initialSchedule.slice(11, 16));
    setBaseline({ version: expectedVersion, date: initialSchedule.slice(0, 10), time: initialSchedule.slice(11, 16) });
  }
  const dateRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const scheduleValue = date && time ? `${date}T${time}` : "";
  const showError = Boolean(state.error && (state.error === "stale" || !editedAfterError));
  const dateError = showError && Boolean(state.fieldErrors?.date);
  const timeError = showError && Boolean(state.fieldErrors?.time);

  useEffect(() => {
    if (expanded) dateRef.current?.focus();
  }, [expanded]);

  useEffect(() => {
    if (!state.error) return;
    if (state.fieldErrors?.date) dateRef.current?.focus();
    else if (state.fieldErrors?.time) timeRef.current?.focus();
    else feedbackRef.current?.focus();
  }, [state]);

  function scheduleChanged() {
    setAllowOverlap(false);
    setEditedAfterError(true);
  }

  // Retain an already-entered draft when a peer changes the booking's status.
  if (!isActive && !dirty && !pending) return null;

  return (
    <div className="appointment-reschedule" data-expanded={expanded} data-sync-protect data-sync-dirty={dirty} data-sync-pending={pending}>
      <button className="secondary-button" type="button" aria-expanded={expanded} aria-controls="appointment-reschedule-form" onClick={() => setExpanded(!expanded)} disabled={pending}>
        {copy.reschedule}
      </button>
      {inactiveConflict ? <SyncEditConflict locale={locale} href={`/appointments/${encodeURIComponent(appointmentId)}`} /> : null}
      {expanded ? (
        <form data-sync-protect data-sync-dirty={dirty} data-sync-pending={pending} id="appointment-reschedule-form" action={formAction} noValidate className="appointment-reschedule-form" onSubmit={() => setEditedAfterError(false)} onReset={event => event.preventDefault()}>
          <p className="muted-copy">{copy.rescheduleIntro}</p>
          <input type="hidden" name="expectedVersion" value={baseline.version} />
          <input type="hidden" name="startsAtLocal" value={scheduleValue} />
          <input type="hidden" name="timezoneOffset" value={String(studioTimezoneOffset(scheduleValue))} />
          <input type="hidden" name="timezoneName" value={studioTimeZone} />
          <input type="hidden" name="allowOverlap" value={allowOverlap ? "true" : "false"} />
          <div className="appointment-form-grid">
            <div className="field">
              <label htmlFor="reschedule-date">{copy.date}</label>
              <input ref={dateRef} id="reschedule-date" name="date" type="date" value={date} onChange={(event) => { setDate(event.target.value); scheduleChanged(); }} required disabled={pending} aria-invalid={dateError || undefined} aria-describedby={dateError ? "reschedule-date-error" : undefined} />
              {dateError ? <p className="form-error" id="reschedule-date-error">{state.fieldErrors?.date === "required" ? copy.dateRequired : copy.scheduleError}</p> : null}
            </div>
            <div className="field">
              <label htmlFor="reschedule-time">{copy.startTime}</label>
              <input ref={timeRef} id="reschedule-time" name="time" type="time" value={time} onChange={(event) => { setTime(event.target.value); scheduleChanged(); }} required disabled={pending} aria-invalid={timeError || undefined} aria-describedby={timeError ? "reschedule-timezone reschedule-time-error" : "reschedule-timezone"} />
              <span className="field-help" id="reschedule-timezone">{copy.timezoneHelp}</span>
              {timeError ? <p className="form-error" id="reschedule-time-error">{state.fieldErrors?.time === "required" ? copy.timeRequired : copy.scheduleError}</p> : null}
            </div>
          </div>
          {showError && !inactiveConflict && state.error === "stale" ? <SyncEditConflict locale={locale} href={`/appointments/${encodeURIComponent(appointmentId)}?reschedule=1`} /> : showError && !inactiveConflict ? (
            <div ref={feedbackRef} tabIndex={-1} className="appointment-form-feedback" role="alert">
              <p className="form-error">{state.error === "overlap" ? copy.overlapWarning : state.error === "required" ? copy.requiredError : state.error === "schedule" ? copy.scheduleError : copy.saveError}</p>
              {state.error === "overlap" ? (
                <>
                  {state.conflicts?.length ? <ul className="appointment-conflict-list">{state.conflicts.map((conflict) => (
                    <li key={conflict.id}>
                      <Link className="text-link" href={`/appointments/${conflict.id}`} target="_blank" rel="noopener noreferrer">{conflict.clientName} · <LocalDateTime iso={conflict.startsAtIso} locale={locale} /></Link>
                    </li>
                  ))}</ul> : null}
                  <label className="appointment-overlap-choice"><input type="checkbox" checked={allowOverlap} onChange={(event) => setAllowOverlap(event.target.checked)} disabled={pending} />{copy.allowOverlap}</label>
                </>
              ) : null}
            </div>
          ) : null}
          <div className="appointment-inline-actions">
            <button className="primary-button" type="submit" disabled={pending}>{pending ? copy.saving : copy.saveReschedule}</button>
            <button className="secondary-button" type="button" disabled={pending} onClick={() => setExpanded(false)}>{copy.cancel}</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
