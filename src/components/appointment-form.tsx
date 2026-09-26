"use client";

import Image from "next/image";
import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AppointmentCopy } from "@/i18n/appointment-copy";
import { calendarCopy } from "@/i18n/calendar-copy";

type AppointmentStatus = "PLANNED" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";

type ClientOption = {
  id: string;
  name: string;
  phone: string;
};

type DesignOption = {
  id: string;
  title: string;
  thumbUrl: string;
};

type InitialAppointment = {
  id: string;
  clientId: string;
  startsAt: string;
  durationMinutes: number;
  notes: string | null;
  status: AppointmentStatus;
  designIds: string[];
  finalDesignId: string | null;
};

function localDateParts(iso: string | undefined) {
  if (!iso) return { date: "", time: "" };
  const value = new Date(iso);
  const pad = (number: number) => String(number).padStart(2, "0");
  return {
    date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
    time: `${pad(value.getHours())}:${pad(value.getMinutes())}`,
  };
}

export function AppointmentForm({
  copy,
  initialClients,
  designs,
  appointment,
}: {
  copy: AppointmentCopy;
  initialClients: ClientOption[];
  designs: DesignOption[];
  appointment?: InitialAppointment;
}) {
  const router = useRouter();
  const initialSchedule = localDateParts(appointment?.startsAt);
  const [clients, setClients] = useState(initialClients);
  const [clientId, setClientId] = useState(appointment?.clientId ?? "");
  const [date, setDate] = useState(initialSchedule.date);
  const [time, setTime] = useState(initialSchedule.time);
  const [durationMinutes, setDurationMinutes] = useState(appointment?.durationMinutes ?? 120);
  const [notes, setNotes] = useState(appointment?.notes ?? "");
  const [status, setStatus] = useState<AppointmentStatus>(appointment?.status ?? "PLANNED");
  const [selectedDesignIds, setSelectedDesignIds] = useState<string[]>(appointment?.designIds ?? []);
  const [finalDesignId, setFinalDesignId] = useState(appointment?.finalDesignId ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientDialogOpen, setClientDialogOpen] = useState(false);
  const [newClient, setNewClient] = useState({ name: "", phone: "", email: "" });
  const [clientSaving, setClientSaving] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);

  const selectedDesigns = useMemo(
    () => designs.filter((design) => selectedDesignIds.includes(design.id)),
    [designs, selectedDesignIds],
  );

  function toggleDesign(id: string) {
    setSelectedDesignIds((current) => {
      const next = current.includes(id) ? current.filter((designId) => designId !== id) : [...current, id];
      if (!next.includes(finalDesignId)) setFinalDesignId("");
      return next;
    });
  }

  function errorMessage(code: string | undefined) {
    switch (code) {
      case "client_required":
        return copy.errors.clientRequired;
      case "start_required":
        return copy.errors.startRequired;
      case "start_invalid":
        return copy.errors.startInvalid;
      case "duration_invalid":
        return copy.errors.durationInvalid;
      case "status_invalid":
        return copy.errors.statusInvalid;
      case "too_many_designs":
        return copy.errors.tooManyDesigns;
      case "final_design_invalid":
        return copy.errors.finalDesignInvalid;
      case "notes_too_long":
        return copy.errors.notesTooLong;
      case "client_not_found":
        return copy.errors.clientNotFound;
      case "design_not_found":
        return copy.errors.designNotFound;
      default:
        return copy.errors.generic;
    }
  }

  async function persistAppointment(allowOverlap: boolean): Promise<void> {
    if (!date || !time) {
      setError(copy.errors.startRequired);
      return;
    }

    const startsAt = new Date(`${date}T${time}`);
    if (Number.isNaN(startsAt.getTime())) {
      setError(copy.errors.startInvalid);
      return;
    }

    const response = await fetch(
      appointment ? `/api/appointments/${appointment.id}` : "/api/appointments",
      {
        method: appointment ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          startsAt: startsAt.toISOString(),
          durationMinutes,
          notes,
          status,
          designIds: selectedDesignIds,
          finalDesignId: finalDesignId || null,
          allowOverlap,
        }),
      },
    );

    const data = (await response.json()) as { appointmentId?: string; error?: string };
    if (response.status === 409 && data.error === "overlap" && !allowOverlap) {
      const locale = document.documentElement.lang === "es" ? "es" : "en";
      const warning = calendarCopy[locale];
      if (window.confirm(`${warning.overlapTitle}\n\n${warning.overlapMessage}`)) {
        await persistAppointment(true);
      } else {
        setError(warning.overlapMessage);
      }
      return;
    }

    if (!response.ok || !data.appointmentId) {
      setError(errorMessage(data.error));
      return;
    }

    router.push(`/appointments/${data.appointmentId}`);
    router.refresh();
  }

  async function submitAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await persistAppointment(false);
    } catch {
      setError(copy.errors.generic);
    } finally {
      setSaving(false);
    }
  }

  async function saveQuickClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setClientSaving(true);
    setClientError(null);

    try {
      const response = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newClient, notes: "" }),
      });
      const data = (await response.json()) as {
        client?: ClientOption;
        existing?: ClientOption;
      };
      const client = data.client ?? data.existing;
      if (!client) {
        setClientError(copy.errors.clientSaveFailed);
        return;
      }

      setClients((current) => {
        const remaining = current.filter((item) => item.id !== client.id);
        return [...remaining, client].sort((a, b) => a.name.localeCompare(b.name));
      });
      setClientId(client.id);
      setNewClient({ name: "", phone: "", email: "" });
      setClientDialogOpen(false);
    } catch {
      setClientError(copy.errors.clientSaveFailed);
    } finally {
      setClientSaving(false);
    }
  }

  async function deleteAppointment() {
    if (!appointment || !window.confirm(copy.confirmDelete)) return;
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/appointments/${appointment.id}`, { method: "DELETE" });
      if (!response.ok) {
        setError(copy.errors.deleteFailed);
        return;
      }
      router.push("/calendar");
      router.refresh();
    } catch {
      setError(copy.errors.deleteFailed);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="appointment-page">
      <div className="appointment-heading">
        <div>
          <h1 className="page-heading">{appointment ? copy.editTitle : copy.newTitle}</h1>
          <p className="page-subtitle">{appointment ? copy.editHint : copy.createHint}</p>
        </div>
      </div>

      <form className="appointment-form" onSubmit={submitAppointment}>
        <section className="appointment-section">
          <div className="appointment-section-title">
            <h2>{copy.client}</h2>
            <button className="secondary-button" type="button" onClick={() => setClientDialogOpen(true)}>
              {copy.addClient}
            </button>
          </div>
          <label className="field">
            <span>{copy.chooseClient}</span>
            <select value={clientId} onChange={(event) => setClientId(event.target.value)} required>
              <option value="">{copy.chooseClient}</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name} — {client.phone}
                </option>
              ))}
            </select>
          </label>
          {clients.length === 0 ? <p className="appointment-help">{copy.noClients}</p> : null}
        </section>

        <section className="appointment-section">
          <h2>{copy.schedule}</h2>
          <div className="appointment-schedule-grid">
            <label className="field">
              <span>{copy.date}</span>
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
            </label>
            <label className="field">
              <span>{copy.time}</span>
              <input type="time" value={time} onChange={(event) => setTime(event.target.value)} required />
            </label>
            <label className="field">
              <span>{copy.duration}</span>
              <input
                type="number"
                min={15}
                max={1440}
                step={15}
                inputMode="numeric"
                value={durationMinutes}
                onChange={(event) => setDurationMinutes(Number(event.target.value))}
                required
              />
            </label>
          </div>
        </section>

        <section className="appointment-section">
          <div className="appointment-section-title">
            <div>
              <h2>{copy.designs}</h2>
              <p>{copy.designsHint}</p>
            </div>
            <span className="selection-count">
              {copy.selectedCount.replace("{count}", String(selectedDesignIds.length))}
            </span>
          </div>

          {designs.length === 0 ? (
            <p className="appointment-help">{copy.noDesigns}</p>
          ) : (
            <div className="appointment-design-grid">
              {designs.map((design) => {
                const checked = selectedDesignIds.includes(design.id);
                return (
                  <label className="appointment-design-option" data-selected={checked} key={design.id}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleDesign(design.id)}
                    />
                    <Image
                      src={design.thumbUrl}
                      alt=""
                      width={320}
                      height={320}
                      sizes="120px"
                      unoptimized
                    />
                    <span>{design.title}</span>
                  </label>
                );
              })}
            </div>
          )}

          <label className="field appointment-final-select">
            <span>{copy.finalDesign}</span>
            <select value={finalDesignId} onChange={(event) => setFinalDesignId(event.target.value)}>
              <option value="">{copy.noFinalDesign}</option>
              {selectedDesigns.map((design) => (
                <option value={design.id} key={design.id}>
                  {design.title}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="appointment-section">
          <label className="field">
            <span>{copy.notes}</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={copy.notesPlaceholder}
              rows={6}
              maxLength={10000}
            />
          </label>

          <label className="field">
            <span>{copy.status}</span>
            <select value={status} onChange={(event) => setStatus(event.target.value as AppointmentStatus)}>
              {Object.entries(copy.statuses).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </section>

        {error ? <p className="form-error appointment-error">{error}</p> : null}

        <div className="appointment-actions">
          {appointment ? (
            <button
              className="danger-button"
              type="button"
              disabled={saving || deleting}
              onClick={() => void deleteAppointment()}
            >
              {deleting ? copy.deleting : copy.delete}
            </button>
          ) : (
            <button className="secondary-button" type="button" onClick={() => router.push("/calendar")}>
              {copy.cancel}
            </button>
          )}
          <button className="primary-button" type="submit" disabled={saving || deleting}>
            {saving ? copy.saving : appointment ? copy.save : copy.create}
          </button>
        </div>
      </form>

      {clientDialogOpen ? (
        <div className="appointment-dialog-backdrop" role="presentation" onMouseDown={() => setClientDialogOpen(false)}>
          <div
            className="appointment-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="quick-client-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="appointment-dialog-heading">
              <div>
                <h2 id="quick-client-title">{copy.addClientTitle}</h2>
                <p>{copy.addClientHint}</p>
              </div>
              <button
                className="dialog-close"
                type="button"
                aria-label={copy.cancel}
                onClick={() => setClientDialogOpen(false)}
              >
                ×
              </button>
            </div>
            <form className="quick-client-form" onSubmit={saveQuickClient}>
              <label className="field">
                <span>{copy.clientName}</span>
                <input
                  value={newClient.name}
                  onChange={(event) => setNewClient({ ...newClient, name: event.target.value })}
                  autoComplete="name"
                  required
                />
              </label>
              <label className="field">
                <span>{copy.clientPhoneInput}</span>
                <input
                  value={newClient.phone}
                  onChange={(event) => setNewClient({ ...newClient, phone: event.target.value })}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  required
                />
              </label>
              <label className="field">
                <span>{copy.clientEmail}</span>
                <input
                  value={newClient.email}
                  onChange={(event) => setNewClient({ ...newClient, email: event.target.value })}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                />
              </label>
              {clientError ? <p className="form-error">{clientError}</p> : null}
              <div className="quick-client-actions">
                <button className="secondary-button" type="button" onClick={() => setClientDialogOpen(false)}>
                  {copy.cancel}
                </button>
                <button className="primary-button" type="submit" disabled={clientSaving}>
                  {clientSaving ? copy.saving : copy.saveClient}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
