"use client";

import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/i18n/dictionaries";
import type { DesignFormState } from "@/app/(app)/designs/actions";
import { designDetailPath } from "@/lib/design-navigation";
import { SyncEditConflict } from "@/components/sync-edit-conflict";
import { emitDiagnostic } from "@/lib/client-diagnostics";
import { HealthDataHint } from "@/components/legal-links";

type DesignAction = (
  state: DesignFormState,
  formData: FormData,
) => Promise<DesignFormState>;

const initialState: DesignFormState = { error: null };

export function DesignMetadataForm({
  action,
  copy,
  design,
  libraryQuery = "",
  locale,
}: {
  action: DesignAction;
  copy: Dictionary["designs"];
  design: { id: string; title: string; notes: string | null; expectedVersion: string };
  libraryQuery?: string;
  locale: "en" | "es";
}) {
  const [state, formAction, pending] = useActionState(async (previous: DesignFormState, formData: FormData): Promise<DesignFormState> => {
    try {
      const result = await action(previous, formData);
      if (result.error === "save") emitDiagnostic("action_failed", { outcome: "failed", reason: "save" });
      return result;
    } catch (error) {
      unstable_rethrow(error);
      emitDiagnostic("action_failed", { outcome: "failed", reason: "unknown" });
      return { error: "save" };
    }
  }, initialState);
  const [title, setTitle] = useState(design.title);
  const [notes, setNotes] = useState(design.notes ?? "");
  const [baseline, setBaseline] = useState({ version: design.expectedVersion, title: design.title, notes: design.notes ?? "" });
  const dirty = title !== baseline.title || notes !== baseline.notes;
  if (!dirty && !pending && baseline.version !== design.expectedVersion) {
    setTitle(design.title);
    setNotes(design.notes ?? "");
    setBaseline({ version: design.expectedVersion, title: design.title, notes: design.notes ?? "" });
  }
  const feedbackRef = useRef<HTMLDivElement>(null);
  const errorField = state.error === "title" || state.error === "notes" ? state.error : null;
  const errorMessage =
    state.error === "title"
      ? copy.titleError
      : state.error === "notes"
        ? copy.notesError
        : state.error === "save"
          ? copy.saveError
          : null;

  useEffect(() => {
    if (state.error) feedbackRef.current?.focus();
  }, [state]);

  return (
    <form data-sync-protect data-sync-dirty={dirty} data-sync-pending={pending} action={formAction} className="design-form" noValidate onReset={event => event.preventDefault()}>
      <input type="hidden" name="libraryQuery" value={libraryQuery} />
      <input type="hidden" name="expectedVersion" value={baseline.version} />
      {state.error === "stale" ? <SyncEditConflict locale={locale} href={`/designs/${encodeURIComponent(design.id)}/edit${libraryQuery ? `?${new URLSearchParams({ libraryQuery })}` : ""}`} /> : null}
      {errorMessage ? (
        <div ref={feedbackRef} tabIndex={-1} className="appointment-error-summary design-form-feedback" role="alert">
          <h2>{copy.errorsTitle}</h2>
          {errorField ? <ul><li>
            <a href={`#design-${errorField}`} onClick={event => {
              event.preventDefault();
              document.getElementById(`design-${errorField}`)?.focus();
            }}>{errorField === "title" ? copy.title : copy.notes}: {errorMessage}</a>
          </li></ul> : <p className="form-error">{errorMessage}</p>}
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="design-title">{copy.title}</label>
        <input
          id="design-title"
          name="title"
          value={title}
          onChange={event => setTitle(event.target.value)}
          maxLength={160}
          aria-invalid={state.error === "title" || undefined}
          aria-describedby={state.error === "title" ? "design-title-error" : undefined}
          required
          disabled={pending}
        />
        {state.error === "title" ? <p id="design-title-error" className="field-error form-error">{copy.titleError}</p> : null}
      </div>

      <div className="field">
        <label htmlFor="design-notes">
          {copy.notes} <span className="field-optional">({copy.optional})</span>
        </label>
        <textarea
          id="design-notes"
          name="notes"
          value={notes}
          onChange={event => setNotes(event.target.value)}
          rows={6}
          maxLength={4000}
          disabled={pending}
          aria-invalid={state.error === "notes" || undefined}
          aria-describedby={state.error === "notes" ? "design-notes-error" : undefined}
        />
        {state.error === "notes" ? <p id="design-notes-error" className="field-error form-error">{copy.notesError}</p> : null}
        <HealthDataHint locale={locale} />
      </div>

      <div className="form-actions">
        <button className="primary-button" type="submit" disabled={pending}>
          {pending ? copy.saving : copy.save}
        </button>
        <Link className="secondary-button button-link" href={designDetailPath(design.id, libraryQuery)}>
          {copy.cancel}
        </Link>
      </div>
    </form>
  );
}
