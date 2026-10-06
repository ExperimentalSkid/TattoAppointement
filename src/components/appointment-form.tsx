"use client";

import Link from "next/link";
import { unstable_rethrow, useRouter, useSearchParams } from "next/navigation";
import { useActionState, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import type { Dictionary } from "@/i18n/dictionaries";
import { APPOINTMENT_NOTES_MAX_LENGTH, type AppointmentFormField, type AppointmentFormState, type AppointmentFieldError } from "@/lib/appointment-form-model";
import { appointmentStatuses, type AppointmentStatusValue } from "@/lib/appointments";
import { studioLocalInputValue, studioTimezoneOffset, studioTimeZone } from "@/lib/studio-time";
import { appointmentDraftKey, parseAppointmentDraft, readAppointmentDraft, removeAppointmentDraft, storeAppointmentDraft, type AppointmentDraft } from "@/lib/appointment-draft";
import { LocalDateTime } from "@/components/local-date-time";
import { SyncEditConflict } from "@/components/sync-edit-conflict";
import { emitDiagnostic } from "@/lib/client-diagnostics";
import { HealthDataHint } from "@/components/legal-links";

type AppointmentAction = (state: AppointmentFormState, formData: FormData) => Promise<AppointmentFormState>;
type ClientOption = { id: string; name: string; phone: string };
type DesignOption = { id: string; title: string };
type InitialAppointment = {
  expectedVersion: string;
  clientId: string; startsAtIso: string; notes: string | null; status: AppointmentStatusValue;
  designIds: string[]; finalDesignId: string | null; agreedPrice: string | null; depositRequired: string;
};
const fieldIds: Record<AppointmentFormField, string> = {
  clientId: "appointment-client", date: "appointment-date", time: "appointment-time", status: "appointment-status",
  designIds: "appointment-designs", finalDesignId: "appointment-final", notes: "appointment-notes",
  agreedPrice: "agreed-price", depositRequired: "deposit-required", initialPayment: "initial-payment",
};
const subscribeToStorage = (notify: () => void) => {
  window.addEventListener("storage", notify);
  return () => window.removeEventListener("storage", notify);
};
const serverSnapshot = () => null;

export function AppointmentForm({ action, clients, designs, copy, initial, initialDate, cancelHref, artistId, bookingPath, locale }: {
  action: AppointmentAction; clients: ClientOption[]; designs: DesignOption[]; copy: Dictionary["appointments"];
  initial?: InitialAppointment; initialDate?: string; cancelHref?: string; artistId: string; bookingPath: string; locale: "en" | "es";
}) {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.getAll("draft").length === 1 ? params.get("draft") : null;
  const draftKey = appointmentDraftKey(artistId, token);
  const getSnapshot = useCallback(() => readAppointmentDraft(draftKey), [draftKey]);
  const storedDraft = useSyncExternalStore(subscribeToStorage, getSnapshot, serverSnapshot);
  const [restoredDraft, setRestoredDraft] = useState<string | null>(null);
  const leavingForRelated = useRef(false);
  const createdClient = params.getAll("createdClient").length === 1 ? params.get("createdClient") : null;
  const createdDesign = params.getAll("createdDesign").length === 1 ? params.get("createdDesign") : null;
  const applySelections = (value: AppointmentDraft): AppointmentDraft => {
    const designIds = value.designIds.filter(id => designs.some(design => design.id === id));
    if (createdDesign && designs.some(design => design.id === createdDesign) && !designIds.includes(createdDesign)) designIds.push(createdDesign);
    return { ...value, clientId: createdClient && clients.some(client => client.id === createdClient) ? createdClient : clients.some(client => client.id === value.clientId) ? value.clientId : "", designIds, finalDesignId: designIds.includes(value.finalDesignId) ? value.finalDesignId : "" };
  };
  function initialModel(): AppointmentDraft {
    const local = initial?.startsAtIso ? studioLocalInputValue(initial.startsAtIso) : "";
    return applySelections({ expectedVersion: initial?.expectedVersion, clientId: initial?.clientId ?? "", date: local.slice(0, 10) || initialDate || "", time: local.slice(11, 16), status: initial?.status ?? "PLANNED", designIds: initial?.designIds ?? [], finalDesignId: initial?.finalDesignId ?? "", notes: initial?.notes ?? "", agreedPrice: initial?.agreedPrice ?? "", depositRequired: initial?.depositRequired ?? "0.00", initialPayment: "0.00", moneyOpen: params.get("section") === "money" || Boolean(initial?.agreedPrice || Number(initial?.depositRequired)) });
  }
  const [model, setModel] = useState<AppointmentDraft>(initialModel);
  const [baseline, setBaseline] = useState<AppointmentDraft>(model);
  // Restore only an explicit add/import round trip, never an unrelated new booking.
  if (storedDraft && restoredDraft !== storedDraft) {
    setRestoredDraft(storedDraft);
    const saved = parseAppointmentDraft(storedDraft, bookingPath);
    if (saved) setModel(applySelections(saved));
  }
  useEffect(() => {
    if (!restoredDraft || !token || leavingForRelated.current) return;
    removeAppointmentDraft(draftKey);
    const clean = new URLSearchParams(params.toString());
    clean.delete("draft");
    clean.delete("createdClient");
    clean.delete("createdDesign");
    window.history.replaceState(null, "", `${bookingPath}${clean.size ? `?${clean}` : ""}${window.location.hash}`);
  }, [restoredDraft, draftKey, token, params, bookingPath]);

  const [state, formAction, pending] = useActionState(async (previous: AppointmentFormState, formData: FormData): Promise<AppointmentFormState> => {
    try {
      const result = await action(previous, formData);
      if (result.error === "save") emitDiagnostic("action_failed", { outcome: "failed", reason: "save" });
      return result;
    } catch (error) {
      unstable_rethrow(error);
      emitDiagnostic("action_failed", { outcome: "failed", reason: "unknown" });
      return { error: "save" };
    }
  }, { error: null });
  const dirty = Boolean(restoredDraft) || JSON.stringify({ ...model, moneyOpen: false }) !== JSON.stringify({ ...baseline, moneyOpen: false });
  if (!dirty && !pending && model.expectedVersion !== initial?.expectedVersion) {
    const next = { ...initialModel(), moneyOpen: model.moneyOpen };
    setModel(next);
    setBaseline(next);
  }
  const [allowOverlap, setAllowOverlap] = useState(false);
  const [editedSchedule, setEditedSchedule] = useState(false);
  const [draftError, setDraftError] = useState(false);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const scheduleValue = model.date && model.time ? `${model.date}T${model.time}` : "";
  const timezoneOffset = useMemo(() => studioTimezoneOffset(scheduleValue), [scheduleValue]);
  const showOverlap = state.error === "overlap" && !editedSchedule;
  useEffect(() => { if (state.error) feedbackRef.current?.focus(); }, [state]);

  function change<K extends keyof AppointmentDraft>(key: K, value: AppointmentDraft[K]) {
    setModel(current => ({ ...current, [key]: value }));
    if (key === "date" || key === "time" || key === "status") { setAllowOverlap(false); setEditedSchedule(true); }
  }
  function toggleDesign(id: string, checked: boolean) {
    setModel(current => ({ ...current, designIds: checked ? [...new Set([...current.designIds, id])] : current.designIds.filter(item => item !== id), finalDesignId: !checked && current.finalDesignId === id ? "" : current.finalDesignId }));
  }
  function openRelated(event: MouseEvent<HTMLAnchorElement>, destination: "clients" | "designs") {
    event.preventDefault();
    if (pending) return;
    const nextToken = window.crypto.randomUUID();
    const nextKey = appointmentDraftKey(artistId, nextToken)!;
    if (!storeAppointmentDraft(nextKey, bookingPath, model)) { setDraftError(true); return; }
    const returnParams = new URLSearchParams();
    if (!initial && initialDate) returnParams.set("date", initialDate);
    returnParams.set("draft", nextToken);
    const returnTo = `${bookingPath}?${returnParams}`;
    leavingForRelated.current = true;
    window.history.replaceState(null, "", returnTo);
    router.push(`/${destination}/new?${new URLSearchParams({ returnTo })}`);
  }
  function errorText(field: AppointmentFormField, code: AppointmentFieldError) {
    if (code === "required") return field === "clientId" ? copy.clientRequired : field === "date" ? copy.dateRequired : copy.timeRequired;
    const messages = { schedule: copy.scheduleError, client: copy.clientError, designs: copy.designsError, final: copy.finalError, notes: copy.notesError, money: copy.moneyError, deposit: copy.depositError, status: copy.statusError };
    return messages[code];
  }
  const errors = Object.entries(state.fieldErrors ?? {}) as [AppointmentFormField, AppointmentFieldError][];
  const labels: Record<AppointmentFormField, string> = { clientId: copy.client, date: copy.date, time: copy.startTime, status: copy.status, designIds: copy.designsSection, finalDesignId: copy.finalDesign, notes: copy.notes, agreedPrice: copy.agreedPrice, depositRequired: copy.depositRequired, initialPayment: copy.initialPayment };
  const moneyHasError = errors.some(([field]) => ["agreedPrice", "depositRequired", "initialPayment"].includes(field));
  function fieldProps(field: AppointmentFormField, hint?: string) {
    const error = state.fieldErrors?.[field];
    return { "aria-invalid": error ? true as const : undefined, "aria-describedby": [hint, error ? `${fieldIds[field]}-error` : null].filter(Boolean).join(" ") || undefined };
  }
  function fieldError(field: AppointmentFormField) {
    const error = state.fieldErrors?.[field];
    return error ? <p className="field-error form-error" id={`${fieldIds[field]}-error`}>{errorText(field, error)}</p> : null;
  }
  function focusField(event: MouseEvent<HTMLAnchorElement>, field: AppointmentFormField) {
    event.preventDefault();
    document.getElementById(fieldIds[field])?.focus();
  }

  return (
    <form data-sync-protect data-sync-dirty={dirty} data-sync-pending={pending} action={formAction} noValidate className="appointment-form workspace-stack" onSubmit={() => setEditedSchedule(false)} onReset={event => event.preventDefault()}>
      {initial ? <input type="hidden" name="expectedVersion" value={model.expectedVersion ?? ""} /> : null}
      <input type="hidden" name="startsAtLocal" value={scheduleValue} />
      <input type="hidden" name="timezoneOffset" value={String(timezoneOffset)} />
      <input type="hidden" name="timezoneName" value={studioTimeZone} />
      <input type="hidden" name="allowOverlap" value={allowOverlap ? "true" : "false"} />
      {state.error === "stale" ? <SyncEditConflict locale={locale} href={bookingPath} /> : state.error && (state.error !== "overlap" || showOverlap) ? (
        <div ref={feedbackRef} tabIndex={-1} className="appointment-error-summary appointment-form-feedback" role="alert"><h2>{copy.errorsTitle}</h2>
          {errors.length ? <ul>{errors.map(([field, code]) => <li key={field}><a href={`#${fieldIds[field]}`} onClick={event => focusField(event, field)}>{labels[field]}: {errorText(field, code)}</a></li>)}</ul> : <p className="form-error">{showOverlap ? copy.overlapWarning : copy.saveError}</p>}
        </div>
      ) : null}
      {draftError ? <p className="form-error" role="alert">{copy.draftError}</p> : null}
      <section className="appointment-form-section workspace-section section-intro">
        <div className="section-heading-row"><h2>{copy.clientSection}</h2><Link className="text-link compact-link" href="/clients/new" onClick={event => openRelated(event, "clients")}>{copy.addClient}</Link></div>
        <div className="field"><label htmlFor="appointment-client">{copy.client}</label><select id="appointment-client" name="clientId" value={model.clientId} onChange={event => change("clientId", event.target.value)} required disabled={pending} {...fieldProps("clientId")}><option value="">{copy.selectClient}</option>{clients.map(client => <option key={client.id} value={client.id}>{client.name} · {client.phone}</option>)}</select>{fieldError("clientId")}</div>
      </section>
      <section className="appointment-form-section workspace-section section-intro">
        <h2>{copy.scheduleSection}</h2><div className="appointment-form-grid">
          <div className="field"><label htmlFor="appointment-date">{copy.date}</label><input id="appointment-date" name="date" type="date" value={model.date} onChange={event => change("date", event.target.value)} required disabled={pending} {...fieldProps("date")} />{fieldError("date")}</div>
          <div className="field"><label htmlFor="appointment-time">{copy.startTime}</label><input id="appointment-time" name="time" type="time" value={model.time} onChange={event => change("time", event.target.value)} required disabled={pending} {...fieldProps("time", "appointment-timezone")} /><span className="field-help" id="appointment-timezone">{copy.timezoneHelp}</span>{fieldError("time")}</div>
          <div className="field"><label htmlFor="appointment-status">{copy.status}</label><select id="appointment-status" name="status" value={model.status} onChange={event => change("status", event.target.value as AppointmentStatusValue)} disabled={pending} {...fieldProps("status")}>{appointmentStatuses.map(status => <option key={status} value={status}>{copy.statuses[status]}</option>)}</select>{fieldError("status")}</div>
        </div>
        {showOverlap ? <div className="overlap-warning" id="appointment-conflicts"><strong>{copy.overlapWarning}</strong>
          {state.conflicts?.length ? <ul className="appointment-conflict-list">{state.conflicts.map(conflict => <li key={conflict.id}><Link className="text-link" href={`/appointments/${encodeURIComponent(conflict.id)}`} target="_blank" rel="noopener noreferrer">{conflict.clientName} · <LocalDateTime iso={conflict.startsAtIso} locale={locale} /></Link></li>)}</ul> : null}
          <label className="appointment-overlap-choice" htmlFor="allow-overlap-confirmation"><input id="allow-overlap-confirmation" type="checkbox" checked={allowOverlap} onChange={event => setAllowOverlap(event.target.checked)} disabled={pending} />{copy.allowOverlap}</label>
        </div> : null}
      </section>
      <section id="appointment-designs" tabIndex={-1} className="appointment-form-section workspace-section section-intro" {...fieldProps("designIds")}>
        <div className="section-heading-row"><div><h2>{copy.designsSection} <span className="field-optional">({copy.optional})</span></h2><p className="muted-copy">{copy.designsHelp}</p></div><Link className="text-link compact-link" href="/designs/new" onClick={event => openRelated(event, "designs")}>{copy.addDesign}</Link></div>
        {designs.length ? <div className="appointment-design-picker">{designs.map(design => <article className="appointment-design-option artwork-object" key={design.id} data-selected={model.designIds.includes(design.id)}>
          <label className="appointment-design-select"><input type="checkbox" name="designIds" value={design.id} checked={model.designIds.includes(design.id)} onChange={event => toggleDesign(design.id, event.target.checked)} disabled={pending} />
            {/* Private thumbnails are already optimized by Sharp. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/designs/${design.id}/image?variant=preview`} alt="" loading="lazy" /><strong>{design.title}</strong>
          </label><label className="final-design-choice"><input type="radio" name="finalDesignId" value={design.id} checked={model.finalDesignId === design.id} disabled={pending || !model.designIds.includes(design.id)} onChange={() => change("finalDesignId", design.id)} />{copy.markFinal}</label>
        </article>)}</div> : <p className="muted-copy">{copy.noDesigns}</p>}
        {fieldError("designIds")}
        {model.designIds.length ? <label className="no-final-choice" id="appointment-final" tabIndex={-1} {...fieldProps("finalDesignId")}><input type="radio" name="finalDesignId" value="" checked={!model.finalDesignId} disabled={pending} onChange={() => change("finalDesignId", "")} />{copy.noFinalDesign}</label> : <input type="hidden" name="finalDesignId" value="" />}{fieldError("finalDesignId")}
      </section>
      <section className="appointment-form-section workspace-section section-intro"><h2>{copy.notesSection}</h2><div className="field"><label htmlFor="appointment-notes">{copy.notes} <span className="field-optional">({copy.optional})</span></label><textarea id="appointment-notes" name="notes" rows={4} maxLength={APPOINTMENT_NOTES_MAX_LENGTH} value={model.notes} onChange={event => change("notes", event.target.value)} disabled={pending} {...fieldProps("notes")} />{fieldError("notes")}<HealthDataHint locale={locale} /></div></section>
      <details id="appointment-money" className="appointment-money-disclosure appointment-form-section workspace-section section-intro" open={model.moneyOpen || moneyHasError} onToggle={event => change("moneyOpen", event.currentTarget.open)}>
        <summary>{copy.moneySection} <span className="field-optional">({copy.optional})</span></summary><p className="muted-copy">{copy.moneyOptionalHelp}</p><div className="appointment-form-grid">
          <div className="field"><label htmlFor="agreed-price">{copy.agreedPrice} (€) <span className="field-optional">({copy.optional})</span></label><input id="agreed-price" name="agreedPrice" type="text" inputMode="decimal" placeholder="0.00" value={model.agreedPrice} onChange={event => change("agreedPrice", event.target.value)} disabled={pending} {...fieldProps("agreedPrice")} />{fieldError("agreedPrice")}</div>
          <div className="field"><label htmlFor="deposit-required">{copy.depositRequired} (€)</label><input id="deposit-required" name="depositRequired" type="text" inputMode="decimal" placeholder="0.00" value={model.depositRequired} onChange={event => change("depositRequired", event.target.value)} disabled={pending} {...fieldProps("depositRequired")} />{fieldError("depositRequired")}</div>
          {!initial ? <div className="field appointment-form-wide"><label htmlFor="initial-payment">{copy.initialPayment} (€)</label><input id="initial-payment" name="initialPayment" type="text" inputMode="decimal" placeholder="0.00" value={model.initialPayment} onChange={event => change("initialPayment", event.target.value)} disabled={pending} {...fieldProps("initialPayment", "initial-payment-help")} /><span className="field-help" id="initial-payment-help">{copy.initialPaymentHelp}</span>{fieldError("initialPayment")}</div> : null}
        </div>
      </details>
      <div className="form-actions appointment-form-actions"><button className="primary-button" type="submit" disabled={pending}>{pending ? copy.saving : initial ? copy.saveChanges : copy.create}</button>{cancelHref ? <Link className="secondary-button button-link" href={cancelHref}>{copy.cancel}</Link> : null}</div>
    </form>
  );
}
