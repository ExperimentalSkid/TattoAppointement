"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { Dictionary } from "@/i18n/dictionaries";
import type { DesignFormState } from "@/app/(app)/designs/actions";

type DesignAction = (
  state: DesignFormState,
  formData: FormData,
) => Promise<DesignFormState>;

const initialState: DesignFormState = { error: null };

export function DesignMetadataForm({
  action,
  copy,
  design,
}: {
  action: DesignAction;
  copy: Dictionary["designs"];
  design: { id: string; title: string; notes: string | null };
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const errorMessage =
    state.error === "title"
      ? copy.titleError
      : state.error === "notes"
        ? copy.notesError
        : state.error === "save"
          ? copy.saveError
          : null;

  return (
    <form action={formAction} className="design-form">
      <div className="field">
        <label htmlFor="design-title">{copy.title}</label>
        <input
          id="design-title"
          name="title"
          defaultValue={design.title}
          maxLength={160}
          required
        />
      </div>

      <div className="field">
        <label htmlFor="design-notes">
          {copy.notes} <span className="field-optional">({copy.optional})</span>
        </label>
        <textarea
          id="design-notes"
          name="notes"
          defaultValue={design.notes ?? ""}
          rows={6}
          maxLength={4000}
        />
      </div>

      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}

      <div className="form-actions">
        <button className="primary-button" type="submit" disabled={pending}>
          {pending ? copy.saving : copy.save}
        </button>
        <Link className="secondary-button button-link" href={`/designs/${design.id}`}>
          {copy.cancel}
        </Link>
      </div>
    </form>
  );
}
