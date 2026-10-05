"use client";

import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { emitDiagnostic } from "@/lib/client-diagnostics";
import type { Dictionary } from "@/i18n/dictionaries";
import type { ClientFormState } from "@/app/(app)/clients/actions";
import { CLIENT_FIELD_LIMITS, type ClientField } from "@/lib/client-fields";
import { SyncEditConflict } from "@/components/sync-edit-conflict";
import { HealthDataHint } from "@/components/legal-links";

type ClientAction = (
  state: ClientFormState,
  formData: FormData,
) => Promise<ClientFormState>;

type ContactResult = {
  name?: string[];
  tel?: string[];
};

type ContactsNavigator = Navigator & {
  contacts?: {
    select(
      properties: Array<"name" | "tel">,
      options: { multiple: boolean },
    ): Promise<ContactResult[]>;
  };
};

const initialClientFormState: ClientFormState = { error: null };
const fieldIds: Record<ClientField, string> = {
  name: "client-name", phone: "client-phone", email: "client-email", notes: "client-notes",
};

function ClientErrorSummary({ title, message, errors }: {
  title: string;
  message: string | null;
  errors: { field: ClientField; label: string; message: string }[];
}) {
  const feedbackRef = useRef<HTMLDivElement>(null);
  useEffect(() => { feedbackRef.current?.focus(); }, []);
  return <div ref={feedbackRef} className="appointment-error-summary" role="alert" tabIndex={-1}>
    <h2>{title}</h2>
    {errors.length ? <ul>{errors.map(({ field, label, message: fieldMessage }) => <li key={field}>
      <a href={`#${fieldIds[field]}`} onClick={event => {
        event.preventDefault();
        document.getElementById(fieldIds[field])?.focus();
      }}>{label}: {fieldMessage}</a>
    </li>)}</ul> : <p className="form-error">{message}</p>}
  </div>;
}

export function ClientForm({
  action,
  copy,
  initial,
  cancelHref = "/clients",
  locale,
  expectedVersion,
}: {
  action: ClientAction;
  copy: Dictionary["clients"];
  initial?: {
    name: string;
    phone: string;
    email: string | null;
    notes: string | null;
  };
  cancelHref?: string;
  locale: "en" | "es";
  expectedVersion?: string;
}) {
  const submittingRef = useRef(false);
  const [state, formAction, pending] = useActionState(async (previous: ClientFormState, formData: FormData) => {
    try {
      const result = await action(previous, formData);
      if (result.error === "save") emitDiagnostic("action_failed", { outcome: "failed", reason: "save" });
      return result;
    } catch (error) {
      unstable_rethrow(error);
      emitDiagnostic("action_failed", { outcome: "failed", reason: "unknown" });
      return { error: "save" } as ClientFormState;
    } finally {
      submittingRef.current = false;
    }
  }, initialClientFormState);
  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [baseline, setBaseline] = useState({ version: expectedVersion, name: initial?.name ?? "", phone: initial?.phone ?? "", email: initial?.email ?? "", notes: initial?.notes ?? "" });
  const [edited, setEdited] = useState(false);
  const [contactMessage, setContactMessage] = useState<string | null>(null);
  const [choosingContact, setChoosingContact] = useState(false);
  const choosingContactRef = useRef(false);
  const busy = pending || choosingContact;
  const dirty = name !== baseline.name || phone !== baseline.phone || email !== baseline.email || notes !== baseline.notes;
  if (!dirty && !busy && expectedVersion !== baseline.version) {
    const next = { version: expectedVersion, name: initial?.name ?? "", phone: initial?.phone ?? "", email: initial?.email ?? "", notes: initial?.notes ?? "" };
    setName(next.name);
    setPhone(next.phone);
    setEmail(next.email);
    setNotes(next.notes);
    setBaseline(next);
  }

  async function chooseContact() {
    if (pending || submittingRef.current || choosingContactRef.current) return;
    const contacts = (navigator as ContactsNavigator).contacts;

    if (!contacts?.select) {
      setContactMessage(copy.contactUnsupported);
      return;
    }

    choosingContactRef.current = true;
    setChoosingContact(true);
    setContactMessage(null);
    try {
      const selected = await contacts.select(["name", "tel"], { multiple: false });
      const contact = selected[0];
      if (!contact) return;

      if (contact.name?.[0]) { setName(contact.name[0]); setEdited(true); }
      if (contact.tel?.[0]) { setPhone(contact.tel[0]); setEdited(true); }
      setContactMessage(null);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setContactMessage(copy.contactFailed);
    } finally {
      choosingContactRef.current = false;
      setChoosingContact(false);
    }
  }

  const error = !pending && (state.error === "stale" || !edited) ? state.error : null;
  const invalidFields: ClientField[] = error
    ? state.fields ?? (error === "duplicate" ? ["phone"] : error === "required" ? ["name", "phone"] : error === "save" || error === "stale" ? [] : [error])
    : [];
  const fieldMessages: Record<ClientField, string> = {
    name: copy.nameError,
    phone: error === "duplicate" ? copy.duplicateError : copy.phoneError,
    email: copy.emailError,
    notes: copy.notesError,
  };
  const fieldErrors = invalidFields.map(field => ({ field, label: copy[field], message: fieldMessages[field] }));
  const errorMessage =
    error === "required"
      ? copy.requiredError
      : error === "duplicate"
        ? copy.duplicateError
        : error === "save"
          ? copy.saveError
          : null;

  function fieldProps(field: ClientField) {
    const invalid = invalidFields.includes(field);
    return {
      "aria-invalid": invalid || undefined,
      "aria-describedby": invalid ? `${fieldIds[field]}-error` : undefined,
    };
  }

  function fieldError(field: ClientField) {
    return invalidFields.includes(field) ? <p className="field-error form-error" id={`${fieldIds[field]}-error`}>{fieldMessages[field]}</p> : null;
  }

  return (
    <form data-sync-protect data-sync-dirty={dirty} data-sync-pending={busy} action={formAction} className="client-form" noValidate aria-busy={busy} onReset={event => event.preventDefault()} onSubmit={event => {
      if (busy || submittingRef.current || choosingContactRef.current) { event.preventDefault(); return; }
      submittingRef.current = true;
      setEdited(false);
      setContactMessage(null);
    }}>
      {initial ? <input type="hidden" name="expectedVersion" value={baseline.version ?? ""} /> : null}
      {error === "stale" ? <SyncEditConflict locale={locale} href={`${cancelHref}/edit`} /> : error ? <ClientErrorSummary title={copy.errorsTitle} message={errorMessage} errors={fieldErrors} /> : null}
      <button className="secondary-button contact-picker-button" type="button" onClick={chooseContact} disabled={busy}>
        {copy.chooseContact}
      </button>

      {contactMessage ? <p className="muted-copy" role="status">{contactMessage}</p> : null}

      <div className="client-form-grid">
        <div className="field">
          <label htmlFor="client-name">{copy.name}</label>
          <input
            id="client-name"
            name="name"
            value={name}
            onChange={(event) => { setName(event.target.value); setEdited(true); }}
            autoComplete="name"
            maxLength={CLIENT_FIELD_LIMITS.name}
            disabled={busy}
            {...fieldProps("name")}
            required
          />
          {fieldError("name")}
        </div>

        <div className="field">
          <label htmlFor="client-phone">{copy.phone}</label>
          <input
            id="client-phone"
            name="phone"
            type="tel"
            value={phone}
            onChange={(event) => { setPhone(event.target.value); setEdited(true); }}
            autoComplete="tel"
            inputMode="tel"
            maxLength={CLIENT_FIELD_LIMITS.phone}
            disabled={busy}
            {...fieldProps("phone")}
            required
          />
          {fieldError("phone")}
        </div>

        <div className="field client-form-wide">
          <label htmlFor="client-email">
            {copy.email} <span className="field-optional">({copy.optional})</span>
          </label>
          <input
            id="client-email"
            name="email"
            type="email"
            value={email}
            onChange={(event) => { setEmail(event.target.value); setEdited(true); }}
            autoComplete="email"
            inputMode="email"
            maxLength={CLIENT_FIELD_LIMITS.email}
            disabled={busy}
            {...fieldProps("email")}
          />
          {fieldError("email")}
        </div>

        <div className="field client-form-wide">
          <label htmlFor="client-notes">
            {copy.notes} <span className="field-optional">({copy.optional})</span>
          </label>
          <textarea
            id="client-notes"
            name="notes"
            value={notes}
            onChange={(event) => { setNotes(event.target.value); setEdited(true); }}
            rows={5}
            maxLength={CLIENT_FIELD_LIMITS.notes}
            disabled={busy}
            {...fieldProps("notes")}
          />
          {fieldError("notes")}
          <HealthDataHint locale={locale} />
        </div>
      </div>

      <div className="form-actions">
        <button className="primary-button" type="submit" disabled={busy}>
          {pending ? copy.saving : copy.save}
        </button>
        <Link className="secondary-button button-link" href={cancelHref}>
          {copy.cancel}
        </Link>
      </div>
    </form>
  );
}
