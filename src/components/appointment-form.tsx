"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import type { Dictionary } from "@/i18n/dictionaries";
import type { AppointmentFormState } from "@/app/(app)/appointments/actions";
import { appointmentStatuses, type AppointmentStatusValue } from "@/lib/appointments";
import { studioLocalInputValue, studioTimezoneOffset, studioTimeZone } from "@/lib/studio-time";

type AppointmentAction = (
  state: AppointmentFormState,
  formData: FormData,
) => Promise<AppointmentFormState>;

type ClientOption = { id: string; name: string; phone: string };
type DesignOption = { id: string; title: string };

type InitialAppointment = {
  clientId: string;
  startsAtIso: string;
  notes: string | null;
  status: AppointmentStatusValue;
  designIds: string[];
  finalDesignId: string | null;
  agreedPrice: string | null;
  depositRequired: string;
};

const initialFormState: AppointmentFormState = { error: null };

export function AppointmentForm({ action, clients, designs, copy, initial, cancelHref }: {
  action: AppointmentAction;
  clients: ClientOption[];
  designs: DesignOption[];
  copy: Dictionary["appointments"];
  initial?: InitialAppointment;
  cancelHref?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialFormState);
  const [clientId, setClientId] = useState(initial?.clientId ?? "");
  const [startsAtLocal, setStartsAtLocal] = useState(() => initial?.startsAtIso ? studioLocalInputValue(initial.startsAtIso) : "");
  const [status, setStatus] = useState<AppointmentStatusValue>(initial?.status ?? "PLANNED");
  const [selectedDesignIds, setSelectedDesignIds] = useState<string[]>(initial?.designIds ?? []);
  const [finalDesignId, setFinalDesignId] = useState(initial?.finalDesignId ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [agreedPrice, setAgreedPrice] = useState(initial?.agreedPrice ?? "");
  const [depositRequired, setDepositRequired] = useState(initial?.depositRequired ?? "0.00");
  const [initialPayment, setInitialPayment] = useState("0.00");
  const [allowOverlap, setAllowOverlap] = useState(false);
  const timezoneOffset = useMemo(() => studioTimezoneOffset(startsAtLocal), [startsAtLocal]);

  function scheduleChanged() {
    setAllowOverlap(false);
  }

  function toggleDesign(id: string, checked: boolean) {
    setSelectedDesignIds((current) => checked ? (current.includes(id) ? current : [...current, id]) : current.filter((item) => item !== id));
    if (!checked && finalDesignId === id) setFinalDesignId("");
  }

  const errorMessage =
    state.error === "required" ? copy.requiredError
      : state.error === "schedule" ? copy.scheduleError
        : state.error === "client" ? copy.clientError
            : state.error === "designs" ? copy.designsError
              : state.error === "final" ? copy.finalError
                : state.error === "money" ? copy.moneyError
                  : state.error === "deposit" ? copy.depositError
                    : state.error === "save" ? copy.saveError
                      : null;

  return (
    <form action={formAction} className="appointment-form workspace-stack">
      <input type="hidden" name="timezoneOffset" value={String(timezoneOffset)} />
      <input type="hidden" name="timezoneName" value={studioTimeZone} />
      <input type="hidden" name="allowOverlap" value={allowOverlap ? "true" : "false"} />

      <section className="appointment-form-section workspace-section section-intro">
        <div className="section-heading-row">
          <h2>{copy.clientSection}</h2>
          <Link className="text-link compact-link" href="/clients/new">{copy.addClient}</Link>
        </div>
        <div className="field">
          <label htmlFor="appointment-client">{copy.client}</label>
          <select id="appointment-client" name="clientId" value={clientId} onChange={(event) => setClientId(event.target.value)} required>
            <option value="">{copy.selectClient}</option>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.name} · {client.phone}</option>)}
          </select>
        </div>
      </section>

      <section className="appointment-form-section workspace-section section-intro">
        <h2>{copy.scheduleSection}</h2>
        <div className="appointment-form-grid">
          <div className="field">
            <label htmlFor="appointment-start">{copy.start}</label>
            <input
              id="appointment-start"
              name="startsAtLocal"
              type="datetime-local"
              value={startsAtLocal}
              onChange={(event) => {
                setStartsAtLocal(event.target.value);
                scheduleChanged();
              }}
              suppressHydrationWarning
              required
            />
            <span className="field-help">{copy.client === "Cliente" ? "Hora de Madrid (Europe/Madrid)" : "Madrid time (Europe/Madrid)"}</span>
          </div>
          <div className="field">
            <label htmlFor="appointment-status">{copy.status}</label>
            <select
              id="appointment-status"
              name="status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as AppointmentStatusValue);
                scheduleChanged();
              }}
            >
              {appointmentStatuses.map((appointmentStatus) => <option key={appointmentStatus} value={appointmentStatus}>{copy.statuses[appointmentStatus]}</option>)}
            </select>
          </div>
        </div>
      </section>

      <section className="appointment-form-section workspace-section section-intro">
        <div className="section-heading-row">
          <div><h2>{copy.designsSection}</h2><p className="muted-copy">{copy.designsHelp}</p></div>
          <Link className="text-link compact-link" href="/designs/new">{copy.addDesign}</Link>
        </div>
        {designs.length ? (
          <div className="appointment-design-picker">
            {designs.map((design) => {
              const selected = selectedDesignIds.includes(design.id);
              return (
                <article className="appointment-design-option artwork-object" key={design.id} data-selected={selected}>
                  <label className="appointment-design-select">
                    <input type="checkbox" name="designIds" value={design.id} checked={selected} onChange={(event) => toggleDesign(design.id, event.target.checked)} />
                    {/* Authenticated previews are already optimized by Sharp. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/designs/${design.id}/image?variant=preview`} alt="" loading="lazy" />
                    <strong>{design.title}</strong>
                  </label>
                  <label className="final-design-choice">
                    <input type="radio" name="finalDesignId" value={design.id} checked={finalDesignId === design.id} disabled={!selected} onChange={() => setFinalDesignId(design.id)} />
                    {copy.markFinal}
                  </label>
                </article>
              );
            })}
          </div>
        ) : <p className="muted-copy">{copy.noDesigns}</p>}
        <label className="no-final-choice">
          <input type="radio" name="finalDesignId" value="" checked={!finalDesignId} onChange={() => setFinalDesignId("")} />
          {copy.noFinalDesign}
        </label>
      </section>

      <section className="appointment-form-section workspace-section section-intro">
        <h2>{copy.notesSection}</h2>
        <div className="field">
          <label htmlFor="appointment-notes">{copy.notes} <span className="field-optional">({copy.optional})</span></label>
          <textarea id="appointment-notes" name="notes" rows={6} maxLength={5000} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>
      </section>

      <section className="appointment-form-section workspace-section section-intro">
        <h2>{copy.moneySection}</h2>
        <div className="appointment-form-grid">
          <div className="field">
            <label htmlFor="agreed-price">{copy.agreedPrice} (€)</label>
            <input id="agreed-price" name="agreedPrice" type="text" inputMode="decimal" placeholder="0.00" value={agreedPrice} onChange={(event) => setAgreedPrice(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="deposit-required">{copy.depositRequired} (€)</label>
            <input id="deposit-required" name="depositRequired" type="text" inputMode="decimal" placeholder="0.00" value={depositRequired} onChange={(event) => setDepositRequired(event.target.value)} />
          </div>
          {!initial ? (
            <div className="field appointment-form-wide">
              <label htmlFor="initial-payment">{copy.initialPayment} (€)</label>
              <input id="initial-payment" name="initialPayment" type="text" inputMode="decimal" placeholder="0.00" value={initialPayment} onChange={(event) => setInitialPayment(event.target.value)} />
              <span className="field-help">{copy.initialPaymentHelp}</span>
            </div>
          ) : null}
        </div>
      </section>

      {state.error === "overlap" ? (
        <div className="overlap-warning" role="alert">
          <strong>{copy.overlapWarning}</strong>
          <label htmlFor="allow-overlap-confirmation">
            <input
              id="allow-overlap-confirmation"
              type="checkbox"
              checked={allowOverlap}
              onChange={(event) => setAllowOverlap(event.target.checked)}
            />
            <span>{copy.allowOverlap}</span>
          </label>
        </div>
      ) : null}

      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}

      <div className="form-actions appointment-form-actions">
        <button className="primary-button" type="submit" disabled={pending}>{pending ? copy.saving : initial ? copy.saveChanges : copy.create}</button>
        {cancelHref ? <Link className="secondary-button button-link" href={cancelHref}>{copy.cancel}</Link> : null}
      </div>
    </form>
  );
}
