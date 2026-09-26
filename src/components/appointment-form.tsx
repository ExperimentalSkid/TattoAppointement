"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import type { Dictionary } from "@/i18n/dictionaries";
import type { AppointmentFormState } from "@/app/(app)/appointments/actions";
import { appointmentStatuses, type AppointmentStatusValue } from "@/lib/appointments";

type AppointmentAction = (
  state: AppointmentFormState,
  formData: FormData,
) => Promise<AppointmentFormState>;

type ClientOption = {
  id: string;
  name: string;
  phone: string;
};

type DesignOption = {
  id: string;
  title: string;
};

type InitialAppointment = {
  clientId: string;
  startsAtIso: string;
  durationMinutes: number;
  notes: string | null;
  status: AppointmentStatusValue;
  designIds: string[];
  finalDesignId: string | null;
};

const initialFormState: AppointmentFormState = { error: null };

function localInputValue(iso: string) {
  const date = new Date(iso);
  const localMs = date.getTime() - date.getTimezoneOffset() * 60_000;
  return new Date(localMs).toISOString().slice(0, 16);
}

function offsetForLocalValue(value: string) {
  if (!value) return new Date().getTimezoneOffset();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().getTimezoneOffset() : date.getTimezoneOffset();
}

export function AppointmentForm({
  action,
  clients,
  designs,
  copy,
  initial,
  cancelHref,
}: {
  action: AppointmentAction;
  clients: ClientOption[];
  designs: DesignOption[];
  copy: Dictionary["appointments"];
  initial?: InitialAppointment;
  cancelHref?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialFormState);
  const [startsAtLocal, setStartsAtLocal] = useState(() =>
    initial?.startsAtIso ? localInputValue(initial.startsAtIso) : "",
  );
  const [selectedDesignIds, setSelectedDesignIds] = useState<string[]>(initial?.designIds ?? []);
  const [finalDesignId, setFinalDesignId] = useState(initial?.finalDesignId ?? "");
  const timezoneOffset = useMemo(() => offsetForLocalValue(startsAtLocal), [startsAtLocal]);

  function toggleDesign(id: string, checked: boolean) {
    setSelectedDesignIds((current) => {
      if (checked) return current.includes(id) ? current : [...current, id];
      return current.filter((item) => item !== id);
    });

    if (!checked && finalDesignId === id) {
      setFinalDesignId("");
    }
  }

  const errorMessage =
    state.error === "required"
      ? copy.requiredError
      : state.error === "schedule"
        ? copy.scheduleError
        : state.error === "duration"
          ? copy.durationError
          : state.error === "client"
            ? copy.clientError
            : state.error === "designs"
              ? copy.designsError
              : state.error === "final"
                ? copy.finalError
                : state.error === "save"
                  ? copy.saveError
                  : null;

  return (
    <form action={formAction} className="appointment-form">
      <input type="hidden" name="timezoneOffset" value={timezoneOffset} />

      <section className="appointment-form-section">
        <div className="section-heading-row">
          <h2>{copy.clientSection}</h2>
          <Link className="text-link compact-link" href="/clients/new">
            {copy.addClient}
          </Link>
        </div>
        <div className="field">
          <label htmlFor="appointment-client">{copy.client}</label>
          <select
            id="appointment-client"
            name="clientId"
            defaultValue={initial?.clientId ?? ""}
            required
          >
            <option value="">{copy.selectClient}</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name} · {client.phone}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="appointment-form-section">
        <h2>{copy.scheduleSection}</h2>
        <div className="appointment-form-grid">
          <div className="field">
            <label htmlFor="appointment-start">{copy.start}</label>
            <input
              id="appointment-start"
              name="startsAtLocal"
              type="datetime-local"
              value={startsAtLocal}
              onChange={(event) => setStartsAtLocal(event.target.value)}
              suppressHydrationWarning
              required
            />
          </div>
          <div className="field">
            <label htmlFor="appointment-duration">{copy.duration}</label>
            <input
              id="appointment-duration"
              name="durationMinutes"
              type="number"
              inputMode="numeric"
              min={15}
              max={1440}
              step={15}
              defaultValue={initial?.durationMinutes ?? 120}
              required
            />
            <span className="field-help">{copy.durationHelp}</span>
          </div>
          <div className="field appointment-form-wide">
            <label htmlFor="appointment-status">{copy.status}</label>
            <select
              id="appointment-status"
              name="status"
              defaultValue={initial?.status ?? "PLANNED"}
            >
              {appointmentStatuses.map((status) => (
                <option key={status} value={status}>
                  {copy.statuses[status]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="appointment-form-section">
        <div className="section-heading-row">
          <div>
            <h2>{copy.designsSection}</h2>
            <p className="muted-copy">{copy.designsHelp}</p>
          </div>
          <Link className="text-link compact-link" href="/designs/new">
            {copy.addDesign}
          </Link>
        </div>

        {designs.length ? (
          <div className="appointment-design-picker">
            {designs.map((design) => {
              const selected = selectedDesignIds.includes(design.id);
              return (
                <article className="appointment-design-option" key={design.id} data-selected={selected}>
                  <label className="appointment-design-select">
                    <input
                      type="checkbox"
                      name="designIds"
                      value={design.id}
                      checked={selected}
                      onChange={(event) => toggleDesign(design.id, event.target.checked)}
                    />
                    <img
                      src={`/api/designs/${design.id}/image?variant=preview`}
                      alt=""
                      loading="lazy"
                    />
                    <strong>{design.title}</strong>
                  </label>
                  <label className="final-design-choice">
                    <input
                      type="radio"
                      name="finalDesignId"
                      value={design.id}
                      checked={finalDesignId === design.id}
                      disabled={!selected}
                      onChange={() => setFinalDesignId(design.id)}
                    />
                    {copy.markFinal}
                  </label>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="muted-copy">{copy.noDesigns}</p>
        )}

        <label className="no-final-choice">
          <input
            type="radio"
            name="finalDesignId"
            value=""
            checked={!finalDesignId}
            onChange={() => setFinalDesignId("")}
          />
          {copy.noFinalDesign}
        </label>
      </section>

      <section className="appointment-form-section">
        <h2>{copy.notesSection}</h2>
        <div className="field">
          <label htmlFor="appointment-notes">
            {copy.notes} <span className="field-optional">({copy.optional})</span>
          </label>
          <textarea
            id="appointment-notes"
            name="notes"
            rows={6}
            maxLength={5000}
            defaultValue={initial?.notes ?? ""}
          />
        </div>
      </section>

      {state.error === "overlap" ? (
        <div className="overlap-warning" role="alert">
          <strong>{copy.overlapWarning}</strong>
          <label>
            <input type="checkbox" name="allowOverlap" value="true" required />
            <span>{copy.allowOverlap}</span>
          </label>
        </div>
      ) : null}

      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}

      <div className="form-actions appointment-form-actions">
        <button className="primary-button" type="submit" disabled={pending}>
          {pending ? copy.saving : initial ? copy.saveChanges : copy.create}
        </button>
        {cancelHref ? (
          <Link className="secondary-button button-link" href={cancelHref}>
            {copy.cancel}
          </Link>
        ) : null}
      </div>
    </form>
  );
}
