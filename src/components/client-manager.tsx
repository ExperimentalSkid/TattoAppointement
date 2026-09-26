"use client";

import { FormEvent, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Dictionary } from "@/i18n/dictionaries";
import type { Locale } from "@/i18n";

type ClientListItem = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  notes: string | null;
  updatedAt: string;
  appointmentCount: number;
};

type AppointmentHistoryItem = {
  id: string;
  startsAt: string;
  durationMinutes: number;
  status: "PLANNED" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
};

type ClientDetail = Omit<ClientListItem, "appointmentCount"> & {
  createdAt: string;
  appointments: AppointmentHistoryItem[];
};

type ClientFormState = {
  name: string;
  phone: string;
  email: string;
  notes: string;
};

type ContactRecord = {
  name?: string[];
  tel?: string[];
  email?: string[];
};

type ContactPicker = {
  select: (
    properties: Array<"name" | "tel" | "email">,
    options: { multiple: boolean },
  ) => Promise<ContactRecord[]>;
};

declare global {
  interface Navigator {
    contacts?: ContactPicker;
  }
}

const emptyForm: ClientFormState = {
  name: "",
  phone: "",
  email: "",
  notes: "",
};

const subscribeToContactPickerCapability = () => () => undefined;

function hasContactPicker() {
  return typeof navigator !== "undefined" && typeof navigator.contacts?.select === "function";
}

function sortClients(clients: ClientListItem[]) {
  return [...clients].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

export function ClientManager({
  initialClients,
  copy,
  locale,
}: {
  initialClients: ClientListItem[];
  copy: Dictionary["clients"];
  locale: Locale;
}) {
  const [clients, setClients] = useState(initialClients);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<ClientDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ClientFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const supportsContactPicker = useSyncExternalStore(
    subscribeToContactPickerCapability,
    hasContactPicker,
    () => false,
  );

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "es" ? "es-ES" : "en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(`/api/clients?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = (await response.json()) as { clients: ClientListItem[] };
        setClients(data.clients);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.error(error);
        }
      } finally {
        setSearching(false);
      }
    }, 220);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  async function openClient(id: string) {
    setLoadingDetail(true);
    try {
      const response = await fetch(`/api/clients/${id}`);
      if (!response.ok) return;
      const data = (await response.json()) as { client: ClientDetail };
      setSelected(data.client);
    } finally {
      setLoadingDetail(false);
    }
  }

  function openNewClient() {
    setEditingId(null);
    setForm(emptyForm);
    setFormError(null);
    setFormOpen(true);
  }

  function openEditClient() {
    if (!selected) return;
    setEditingId(selected.id);
    setForm({
      name: selected.name,
      phone: selected.phone,
      email: selected.email ?? "",
      notes: selected.notes ?? "",
    });
    setFormError(null);
    setFormOpen(true);
  }

  function closeForm() {
    if (saving) return;
    setFormOpen(false);
    setFormError(null);
  }

  function errorMessage(error: string | undefined) {
    switch (error) {
      case "name_required":
        return copy.errors.nameRequired;
      case "phone_required":
        return copy.errors.phoneRequired;
      case "phone_invalid":
        return copy.errors.phoneInvalid;
      case "email_invalid":
        return copy.errors.emailInvalid;
      case "duplicate_phone":
        return copy.errors.duplicate;
      default:
        return copy.errors.generic;
    }
  }

  async function pickContact() {
    if (!navigator.contacts?.select) return;

    try {
      const contacts = await navigator.contacts.select(["name", "tel", "email"], {
        multiple: false,
      });
      const contact = contacts[0];
      if (!contact) return;

      setForm((current) => ({
        ...current,
        name: contact.name?.[0] ?? current.name,
        phone: contact.tel?.[0] ?? current.phone,
        email: contact.email?.[0] ?? current.email,
      }));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFormError(copy.errors.contactPicker);
    }
  }

  async function submitClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);

    try {
      const response = await fetch(editingId ? `/api/clients/${editingId}` : "/api/clients", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = (await response.json()) as {
        client?: ClientListItem;
        existing?: ClientListItem;
        error?: string;
      };

      if (response.status === 409 && data.existing) {
        if (!editingId) {
          setClients((current) =>
            sortClients([
              data.existing!,
              ...current.filter((client) => client.id !== data.existing!.id),
            ]),
          );
          setFormOpen(false);
          await openClient(data.existing.id);
          return;
        }
        setFormError(copy.errors.duplicate);
        return;
      }

      if (!response.ok || !data.client) {
        setFormError(errorMessage(data.error));
        return;
      }

      setClients((current) =>
        sortClients([data.client!, ...current.filter((client) => client.id !== data.client!.id)]),
      );
      setFormOpen(false);
      await openClient(data.client.id);
    } catch {
      setFormError(copy.errors.generic);
    } finally {
      setSaving(false);
    }
  }

  const statusLabels = copy.statuses;

  return (
    <div className="clients-page">
      <div className="clients-toolbar">
        <div>
          <h1 className="page-heading">{copy.title}</h1>
          <p className="page-subtitle">{copy.subtitle}</p>
        </div>
        <button className="primary-button" type="button" onClick={openNewClient}>
          {copy.newClient}
        </button>
      </div>

      <div className="clients-workspace">
        <section className="clients-list-panel" aria-label={copy.listLabel}>
          <label className="client-search">
            <span>{copy.searchLabel}</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={copy.searchPlaceholder}
              type="search"
              autoComplete="off"
            />
          </label>

          <div className="client-list-status" aria-live="polite">
            {searching ? copy.searching : copy.resultCount.replace("{count}", String(clients.length))}
          </div>

          <div className="client-list">
            {clients.length === 0 && !searching ? (
              <div className="client-empty">
                <strong>{query ? copy.noResults : copy.emptyTitle}</strong>
                <p>{query ? copy.noResultsHint : copy.emptyHint}</p>
              </div>
            ) : null}

            {clients.map((client) => (
              <button
                className="client-list-item"
                data-active={selected?.id === client.id}
                key={client.id}
                type="button"
                onClick={() => void openClient(client.id)}
              >
                <span className="client-list-main">
                  <strong>{client.name}</strong>
                  <span>{client.phone}</span>
                </span>
                <span className="client-appointment-count">
                  {copy.appointmentCount.replace("{count}", String(client.appointmentCount))}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="client-detail-panel" aria-live="polite">
          {loadingDetail ? <p className="muted-text">{copy.loading}</p> : null}

          {!selected && !loadingDetail ? (
            <div className="client-detail-empty">
              <strong>{copy.selectTitle}</strong>
              <p>{copy.selectHint}</p>
            </div>
          ) : null}

          {selected && !loadingDetail ? (
            <div className="client-detail-content">
              <div className="client-detail-heading">
                <div>
                  <h2>{selected.name}</h2>
                  <p>{selected.phone}</p>
                </div>
                <button className="secondary-button" type="button" onClick={openEditClient}>
                  {copy.editClient}
                </button>
              </div>

              <dl className="client-facts">
                <div>
                  <dt>{copy.email}</dt>
                  <dd>{selected.email ?? copy.notProvided}</dd>
                </div>
                <div>
                  <dt>{copy.notes}</dt>
                  <dd>{selected.notes ?? copy.notProvided}</dd>
                </div>
              </dl>

              <div className="client-history">
                <h3>{copy.historyTitle}</h3>
                {selected.appointments.length === 0 ? (
                  <p className="muted-text">{copy.noAppointments}</p>
                ) : (
                  <div className="client-history-list">
                    {selected.appointments.map((appointment) => (
                      <div className="history-item" key={appointment.id}>
                        <div>
                          <strong>{dateFormatter.format(new Date(appointment.startsAt))}</strong>
                          <span>
                            {copy.duration.replace(
                              "{minutes}",
                              String(appointment.durationMinutes),
                            )}
                          </span>
                        </div>
                        <span className="history-status">{statusLabels[appointment.status]}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </section>
      </div>

      {formOpen ? (
        <div className="client-dialog-backdrop" role="presentation" onMouseDown={closeForm}>
          <div
            className="client-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="client-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="client-dialog-header">
              <div>
                <h2 id="client-dialog-title">
                  {editingId ? copy.editClient : copy.newClient}
                </h2>
                <p>{editingId ? copy.editHint : copy.newHint}</p>
              </div>
              <button className="dialog-close" type="button" onClick={closeForm} aria-label={copy.close}>
                ×
              </button>
            </div>

            {supportsContactPicker ? (
              <button className="contact-picker-button" type="button" onClick={() => void pickContact()}>
                {copy.chooseContact}
              </button>
            ) : null}

            <form className="client-form" onSubmit={submitClient}>
              <label className="field">
                <span>{copy.name}</span>
                <input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  autoComplete="name"
                  required
                />
              </label>

              <label className="field">
                <span>{copy.phone}</span>
                <input
                  value={form.phone}
                  onChange={(event) => setForm({ ...form, phone: event.target.value })}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  required
                />
              </label>

              <label className="field">
                <span>{copy.emailOptional}</span>
                <input
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                />
              </label>

              <label className="field">
                <span>{copy.notesOptional}</span>
                <textarea
                  value={form.notes}
                  onChange={(event) => setForm({ ...form, notes: event.target.value })}
                  rows={5}
                />
              </label>

              {formError ? <p className="form-error">{formError}</p> : null}

              <div className="client-form-actions">
                <button className="secondary-button" type="button" onClick={closeForm} disabled={saving}>
                  {copy.cancel}
                </button>
                <button className="primary-button" type="submit" disabled={saving}>
                  {saving ? copy.saving : copy.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
