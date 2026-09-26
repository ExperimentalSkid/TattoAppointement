"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { Dictionary } from "@/i18n/dictionaries";
import type { ClientFormState } from "@/app/(app)/clients/actions";

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

export function ClientForm({
  action,
  copy,
  initial,
  cancelHref = "/clients",
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
}) {
  const [state, formAction, pending] = useActionState(action, initialClientFormState);
  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [contactMessage, setContactMessage] = useState<string | null>(null);

  async function chooseContact() {
    const contacts = (navigator as ContactsNavigator).contacts;

    if (!contacts?.select) {
      setContactMessage(copy.contactUnsupported);
      return;
    }

    try {
      const selected = await contacts.select(["name", "tel"], { multiple: false });
      const contact = selected[0];
      if (!contact) return;

      if (contact.name?.[0]) setName(contact.name[0]);
      if (contact.tel?.[0]) setPhone(contact.tel[0]);
      setContactMessage(null);
    } catch {
      setContactMessage(copy.contactFailed);
    }
  }

  const errorMessage =
    state.error === "required"
      ? copy.requiredError
      : state.error === "duplicate"
        ? copy.duplicateError
        : state.error === "save"
          ? copy.saveError
          : null;

  return (
    <form action={formAction} className="client-form">
      <button className="secondary-button contact-picker-button" type="button" onClick={chooseContact}>
        {copy.chooseContact}
      </button>

      {contactMessage ? <p className="form-note">{contactMessage}</p> : null}

      <div className="client-form-grid">
        <div className="field">
          <label htmlFor="client-name">{copy.name}</label>
          <input
            id="client-name"
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            maxLength={120}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="client-phone">{copy.phone}</label>
          <input
            id="client-phone"
            name="phone"
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            autoComplete="tel"
            inputMode="tel"
            maxLength={40}
            required
          />
        </div>

        <div className="field client-form-wide">
          <label htmlFor="client-email">
            {copy.email} <span className="field-optional">({copy.optional})</span>
          </label>
          <input
            id="client-email"
            name="email"
            type="email"
            defaultValue={initial?.email ?? ""}
            autoComplete="email"
            inputMode="email"
            maxLength={254}
          />
        </div>

        <div className="field client-form-wide">
          <label htmlFor="client-notes">
            {copy.notes} <span className="field-optional">({copy.optional})</span>
          </label>
          <textarea
            id="client-notes"
            name="notes"
            defaultValue={initial?.notes ?? ""}
            rows={5}
            maxLength={4000}
          />
        </div>
      </div>

      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}

      <div className="form-actions">
        <button className="primary-button" type="submit" disabled={pending}>
          {pending ? copy.saving : copy.save}
        </button>
        <Link className="secondary-button button-link" href={cancelHref}>
          {copy.cancel}
        </Link>
      </div>
    </form>
  );
}
